import { db } from "@/lib/db";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { buildSkeletonOutlinePrompt, buildEnrichmentPrompt } from "@/lib/brainstorm/outline-prompt";
import { buildSummaryPrompt, type ConversationSummary } from "@/lib/brainstorm/summary-prompt";
import { normalizeGeneratedOutline } from "@/lib/brainstorm/outline-normalizer";
import { evaluateOutlineQuality } from "@/lib/brainstorm/outline-quality";
import { composeArchetypeKey } from "@/lib/brainstorm/archetypes";
import type { TaskPayload, TaskResult } from "@/lib/queue/types";
import type { OutlineSection } from "@/lib/outline-tree";
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

  // ── Phase B: Two-Stage Outline Generation ──────────────────────
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
    "\nGenerate the complete outline skeleton.",
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
      maxTokens: 4096,
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

  // Stage 1: Generate skeleton (fast, flat JSON)
  let outline = await generateSkeleton();
  let quality = evaluateOutlineQuality(outline, { lengthHint: summary.constraints?.lengthHint });

  if (!quality.ok) {
    const feedback = `Generated skeleton insufficient. Issues: ${quality.issues.join("; ")}. Ensure 2-3 levels of depth and 15-30 leaf sections.`;
    outline = await generateSkeleton(feedback);
    quality = evaluateOutlineQuality(outline, { lengthHint: summary.constraints?.lengthHint });
    if (!quality.ok) {
      throw new Error(`Outline skeleton did not meet quality requirements: ${quality.issues.join("; ")}`);
    }
  }

  onProgress(55);

  // Stage 2: Enrich chapters with detail fields (parallel, up to 3 concurrent)
  const enrichmentPrompt = buildEnrichmentPrompt(docLocale);
  const topLevelSections = outline.sections.filter((s) => !s.num.includes("."));

  async function enrichChapter(
    chapter: OutlineSection,
    fullRequirements: string,
  ): Promise<OutlineSection> {
    const chapterJson = JSON.stringify({ sections: [chapter] }, null, 2);
    const chunks: string[] = [];
    let streamInputTokens = 0;
    let streamOutputTokens = 0;

    for await (const chunk of provider.chatStream({
      model: modelId,
      messages: [
        { role: "system", content: enrichmentPrompt },
        { role: "user", content: `Document requirements:\n${fullRequirements}\n\nChapter to enrich:\n${chapterJson}` },
      ],
      response_format: { type: "json_object" },
      maxTokens: 4096,
    })) {
      chunks.push(chunk.content || "");
      if (chunk.inputTokens) streamInputTokens = chunk.inputTokens;
      if (chunk.outputTokens) streamOutputTokens = chunk.outputTokens;
    }

    totalInputTokens += streamInputTokens;
    totalOutputTokens += streamOutputTokens;

    const result = normalizeGeneratedOutline(parseJsonObject(chunks.join("")));
    return result.sections[0] || chapter;
  }

  const requirementsSummary = [
    summaryText,
    topicsStr(topicContext),
    constraintsContext,
  ].filter(Boolean).join("\n");

  const MAX_CONCURRENT = 3;
  const enrichedChapters: OutlineSection[] = [];
  for (let i = 0; i < topLevelSections.length; i += MAX_CONCURRENT) {
    const batch = topLevelSections.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(
      batch.map((chapter) =>
        enrichChapter(chapter, requirementsSummary).catch(() => chapter),
      ),
    );
    enrichedChapters.push(...results);
    onProgress(55 + Math.floor(((i + batch.length) / topLevelSections.length) * 30));
  }

  // Rebuild hierarchy: replace top-level sections with enriched versions
  const enrichedMap = new Map(enrichedChapters.map((c) => [c.num, c]));
  outline.sections = outline.sections.map((s) => {
    const enriched = enrichedMap.get(s.num.split(".")[0]);
    return enriched || s;
  });

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

  await recordTokenUsage({
    userId, modelConfigId: chatModel.id, module: "outline",
    inputTokens: totalInputTokens, outputTokens: totalOutputTokens, referenceId: sessionId,
  }).catch((err) => { console.warn("Failed to record token usage:", err); });

  if (await isTaskCancelled(taskId)) {
    return { cancelled: true };
  }

  await db.message.create({
    data: { sessionId, role: "system", content: messages.outlineReady },
  });

  onProgress(100);

  return { outline, title: outline.title || session.title };
}

function topicsStr(text: string): string {
  return text || "";
}
