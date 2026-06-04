import { db } from "@/lib/db";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { buildLightweightOutlinePrompt } from "@/lib/brainstorm/outline-prompt";
import { buildSummaryPrompt, type ConversationSummary } from "@/lib/brainstorm/summary-prompt";
import { normalizeGeneratedOutline } from "@/lib/brainstorm/outline-normalizer";
import { evaluateOutlineQuality } from "@/lib/brainstorm/outline-quality";
import { composeArchetypeKey } from "@/lib/brainstorm/archetypes";
import type { TaskPayload, TaskResult } from "@/lib/queue/types";
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

  // ── Phase B: Outline Generation ────────────────────────────────
  const outlinePrompt = buildLightweightOutlinePrompt(archetype, docLocale);

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
    "\nGenerate the complete outline.",
  ].filter(Boolean).join("\n");

  onProgress(35);

  async function generateOutlineFromPrompt(feedback?: string) {
    const chunks: string[] = [];
    let chunkCount = 0;
    let lastProgressChunk = 0;
    let streamInputTokens = 0;
    let streamOutputTokens = 0;

    for await (const chunk of provider.chatStream({
      model: modelId,
      messages: [
        { role: "system", content: outlinePrompt },
        { role: "user", content: feedback ? `${userMessage}\n\n${feedback}` : userMessage },
      ],
      response_format: { type: "json_object" },
      maxTokens: 16384,
    })) {
      chunks.push(chunk.content || "");
      if (chunk.inputTokens) streamInputTokens = chunk.inputTokens;
      if (chunk.outputTokens) streamOutputTokens = chunk.outputTokens;

      chunkCount++;
      if (chunkCount - lastProgressChunk >= 10) {
        lastProgressChunk = chunkCount;
        const progress = Math.min(35 + Math.floor((chunkCount / 60) * 50), 85);
        onProgress(progress);
      }
    }

    totalInputTokens += streamInputTokens;
    totalOutputTokens += streamOutputTokens;

    return normalizeGeneratedOutline(parseJsonObject(chunks.join("")));
  }

  let outline = await generateOutlineFromPrompt();
  let quality = evaluateOutlineQuality(outline, { lengthHint: summary.constraints?.lengthHint });

  if (!quality.ok) {
    const feedback = [
      "The previous outline is too shallow and cannot be saved.",
      "Quality issues:",
      ...quality.issues.map((issue) => `- ${issue}`),
      "Regenerate the complete outline. Keep the same JSON schema. Use 2-3 levels of hierarchy and create meaningful child sections for modules, phases, analysis dimensions, risks, deliverables, and evidence groups.",
    ].join("\n");
    outline = await generateOutlineFromPrompt(feedback);
    quality = evaluateOutlineQuality(outline, { lengthHint: summary.constraints?.lengthHint });
    if (!quality.ok) {
      throw new Error(`Generated outline did not meet quality requirements: ${quality.issues.join("; ")}`);
    }
  }

  onProgress(88);

  // ── Phase C: Parse, Normalize, Store ───────────────────────────
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
