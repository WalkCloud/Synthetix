import { db } from "@/lib/db";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsageSafely } from "@/lib/llm/usage";
import { buildSkeletonOutlinePrompt, buildPartExpansionPrompt } from "@/lib/brainstorm/outline-prompt";
import { buildSummaryPrompt, type ConversationSummary } from "@/lib/brainstorm/summary-prompt";
import { normalizeGeneratedOutline } from "@/lib/brainstorm/outline-normalizer";
import { parseMarkdownToSections } from "@/lib/brainstorm/outline-markdown";
import { evaluateOutlineQuality } from "@/lib/brainstorm/outline-quality";
import { composeArchetypeKey } from "@/lib/brainstorm/archetypes";
import type { TaskPayload, TaskResult } from "@/lib/queue/types";
import type { OutlineSection } from "@/lib/outline-tree";
import { renumberSections } from "@/lib/outline-tree";
import { getBrainstormMessages, resolveBrainstormLocale } from "@/lib/brainstorm/messages";

interface OutlineGeneratePayload extends TaskPayload {
  taskId: string;
  sessionId: string;
  userId: string;
  locale?: string;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse outline from LLM response: no JSON object found. Raw output: " + trimmed.slice(0, 500));
    }
    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  }
}

async function isTaskCancelled(taskId: string): Promise<boolean> {
  const task = await db.asyncTask.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  return task?.status === "cancelled";
}

async function summarizeConversation(
  provider: ReturnType<typeof createLLMProvider>,
  model: string,
  locale: "en" | "zh-CN",
  conversation: string,
): Promise<{ summary: ConversationSummary; inputTokens: number; outputTokens: number }> {
  const summaryPrompt = buildSummaryPrompt(locale);
  let lastResponseTokens = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await provider.chat({
      model,
      messages: [
        { role: "system", content: summaryPrompt },
        { role: "user", content: conversation },
      ],
      response_format: { type: "json_object" },
    });
    lastResponseTokens = { inputTokens: response.inputTokens, outputTokens: response.outputTokens };
    try {
      return { summary: parseJsonObject(response.content) as unknown as ConversationSummary, ...lastResponseTokens };
    } catch {
      if (attempt === 1) throw new Error("Failed to parse brainstorm summary JSON");
    }
  }

  throw new Error("Failed to parse brainstorm summary JSON");
}

export async function generateOutline(
  payload: TaskPayload,
  onProgress: (progress: number) => void,
): Promise<TaskResult> {
  const { taskId, sessionId, userId, locale: payloadLocale } = payload as OutlineGeneratePayload;

  onProgress(5);

  const session = await db.brainstormSession.findFirst({
    where: { id: sessionId, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) throw new Error("Session not found");

  onProgress(10);

  const chatModel = await resolveModel("chat", userId);
  if (!chatModel) throw new Error("No chat model configured");
  const modelId = chatModel.modelId;

  const conversation = session.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
    .join("\n\n");

  const hasCJK = /[一-鿿぀-ヿ가-힯]/.test(conversation);
  const docLocale = resolveBrainstormLocale(payloadLocale) ?? (hasCJK ? "zh-CN" as const : "en" as const);
  const messages = getBrainstormMessages(docLocale);
  const provider = createLLMProvider(chatModel.provider);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  onProgress(15);

  // ── Phase A: Conversation Summary ──────────────────────────────
  const summaryResult = await summarizeConversation(provider, modelId, docLocale, conversation);
  totalInputTokens += summaryResult.inputTokens;
  totalOutputTokens += summaryResult.outputTokens;

  const summary = summaryResult.summary;

  const archetype = composeArchetypeKey(summary.archetype, summary.secondaryArchetype);
  const summaryText = summary.summary || "";

  onProgress(30);

  // ── Phase B Stage 1: Chapter-level skeleton (small JSON, never truncates) ──
  const skeletonPrompt = buildSkeletonOutlinePrompt(archetype, docLocale);

  const sectionsContext = summary.confirmedSections?.length
    ? `\n\nConfirmed sections from user's chosen direction:\n${summary.confirmedSections.map((s, i) => `${i + 1}. ${s.title} — ${s.intent}`).join("\n")}`
    : "";

  const constraintsContext = summary.constraints
    ? [
        summary.constraints.tone && `Tone: ${summary.constraints.tone}`,
        summary.constraints.depth && `Depth: ${summary.constraints.depth}`,
        summary.constraints.lengthHint && `Length: ${summary.constraints.lengthHint}`,
        summary.constraints.audience && `Audience: ${summary.constraints.audience}`,
        summary.constraints.boundaries?.length && `Boundaries: ${summary.constraints.boundaries.join(", ")}`,
      ].filter(Boolean).join("\n")
    : "";

  const confirmedStructureContext = summary.confirmedStructure?.length
    ? `\nConfirmed structure to preserve:\n${JSON.stringify(summary.confirmedStructure, null, 2)}`
    : "";

  const topicContext = [
    summary.documentPurpose && `Document purpose: ${summary.documentPurpose}`,
    summary.targetAudience && `Target audience: ${summary.targetAudience}`,
    summary.requiredScope?.length && `Required scope: ${summary.requiredScope.join(", ")}`,
    summary.keyTopics?.length && `Key topics: ${summary.keyTopics.join(", ")}`,
    summary.mustInclude?.length && `Must include: ${summary.mustInclude.join(", ")}`,
    summary.mustAvoid?.length && `Must avoid: ${summary.mustAvoid.join(", ")}`,
  ].filter(Boolean).join("\n");

  const conversationContext = conversation.length > 20_000
    ? conversation.slice(-20_000)
    : conversation;

  const structuredSummary = JSON.stringify(summary, null, 2);
  const userMessage = [
    `Document requirement: ${summaryText}`,
    sectionsContext,
    confirmedStructureContext,
    topicContext && `\nRequirement details:\n${topicContext}`,
    constraintsContext && `\nConstraints:\n${constraintsContext}`,
    `\nStructured requirements summary:\n${structuredSummary}`,
    `\nFull conversation context, newest details preserved:\n${conversationContext}`,
    "\nGenerate the top-level part skeleton (level 1 only).",
  ].filter(Boolean).join("\n");

  async function generateSkeleton(feedback?: string): Promise<ReturnType<typeof normalizeGeneratedOutline>> {
    const chunks: string[] = [];
    let streamInputTokens = 0;
    let streamOutputTokens = 0;

    for await (const chunk of provider.chatStream({
      model: modelId,
      messages: [
        { role: "system", content: skeletonPrompt },
        { role: "user", content: feedback ? `${userMessage}\n\n${feedback}` : userMessage },
      ],
      response_format: { type: "json_object" },
      maxTokens: 2048,
    })) {
      chunks.push(chunk.content || "");
      if (chunk.inputTokens) streamInputTokens = chunk.inputTokens;
      if (chunk.outputTokens) streamOutputTokens = chunk.outputTokens;
    }

    totalInputTokens += streamInputTokens;
    totalOutputTokens += streamOutputTokens;

    return normalizeGeneratedOutline(parseJsonObject(chunks.join("")));
  }

  onProgress(35);

  // Stage 1: top-level chapters only. Sub-sections are expanded per-chapter in
  // Stage 2, so validate ONLY the chapter count here (no depth/leaf/detail —
  // those come from Stage 2). The old check (minDepth 2 / minLeaf 8+) would
  // reject a correct chapter-only skeleton.
  let outline = await generateSkeleton();
  let quality = evaluateOutlineQuality(outline, {
    lengthHint: summary.constraints?.lengthHint,
    checkDetailFields: false,
    minDepth: 1,
    minLeafCount: 0,
  });

  if (!quality.ok) {
    const feedback = `Generated skeleton insufficient. Issues: ${quality.issues.join("; ")}. Output ONLY 4-8 top-level chapters with plain integer "num" (no sub-sections, no dotted numbers).`;
    outline = await generateSkeleton(feedback);
    quality = evaluateOutlineQuality(outline, {
      lengthHint: summary.constraints?.lengthHint,
      checkDetailFields: false,
      minDepth: 1,
      minLeafCount: 0,
    });
    if (!quality.ok) {
      throw new Error(`Outline skeleton did not meet chapter requirements: ${quality.issues.join("; ")}`);
    }
  }

  onProgress(45);

  // ── Phase B Stage 2: Part-level markdown expansion (adaptive depth) ──
  // One LLM call per part emits that part's full markdown outline; heading
  // depth (##/###/####/#####) is decided by the model per chapter based on
  // content complexity (NOT a fixed depth). Parsed back into a tree by
  // parseMarkdownToSections. Sibling-part titles are injected as context to
  // prevent cross-part duplication. ~6 calls vs the old ~84 recursive node
  // calls — far fewer tokens, far faster, and each part is internally coherent.
  const partExpansionPrompt = buildPartExpansionPrompt(docLocale);
  const MAX_CONCURRENT = 8;

  const requirementsSummary = [
    summaryText,
    topicContext,
    constraintsContext,
  ].filter(Boolean).join("\n");

  async function expandPart(part: OutlineSection): Promise<OutlineSection> {
    const partContext = JSON.stringify({
      num: part.num,
      title: part.title,
      description: part.description,
      estimatedWords: part.estimatedWords,
    }, null, 2);
    const siblings = outline.sections
      .filter((p) => p.num !== part.num)
      .map((p) => `${p.num} ${p.title}`)
      .join("\n") || "(none)";
    const chunks: string[] = [];
    let streamInputTokens = 0;
    let streamOutputTokens = 0;

    for await (const chunk of provider.chatStream({
      model: modelId,
      messages: [
        { role: "system", content: partExpansionPrompt },
        { role: "user", content: `Document requirements:\n${requirementsSummary}\n\nPart to expand:\n${partContext}\n\nOther parts (avoid duplicating these topics):\n${siblings}` },
      ],
      maxTokens: 8192,
    })) {
      chunks.push(chunk.content || "");
      if (chunk.inputTokens) streamInputTokens = chunk.inputTokens;
      if (chunk.outputTokens) streamOutputTokens = chunk.outputTokens;
    }

    totalInputTokens += streamInputTokens;
    totalOutputTokens += streamOutputTokens;

    const children = parseMarkdownToSections(chunks.join(""));
    return children.length > 0 ? { ...part, children } : part;
  }

  let partsDone = 0;
  const totalParts = outline.sections.length;
  const expandedParts: OutlineSection[] = [];
  for (let i = 0; i < outline.sections.length; i += MAX_CONCURRENT) {
    const batch = outline.sections.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(batch.map((p) => expandPart(p).catch(() => p)));
    expandedParts.push(...results);
    partsDone += batch.length;
    onProgress(45 + Math.floor((partsDone / totalParts) * 43));
  }

  outline.sections = renumberSections(expandedParts);

  onProgress(88);

  // ── Phase C: Store ───────────────────────────────────────────────
  onProgress(92);

  if (await isTaskCancelled(taskId)) {
    return { cancelled: true };
  }

  await db.brainstormSession.update({
    where: { id: sessionId },
    data: { outline: JSON.stringify(outline), title: outline.title || session.title },
  });

  onProgress(96);

  await recordTokenUsageSafely({
    userId, modelConfigId: chatModel.id, module: "outline",
    inputTokens: totalInputTokens, outputTokens: totalOutputTokens, referenceId: sessionId,
  });

  if (await isTaskCancelled(taskId)) {
    return { cancelled: true };
  }

  await db.message.create({
    data: { sessionId, role: "system", content: messages.outlineReady },
  });

  onProgress(100);

  return { outline, title: outline.title || session.title };
}
