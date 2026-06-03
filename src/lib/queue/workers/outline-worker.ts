import { db } from "@/lib/db";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { buildOutlinePrompt, resolveDocumentLanguage } from "@/lib/prompts";
import type { TaskPayload, TaskResult } from "@/lib/queue/types";

interface OutlineGeneratePayload extends TaskPayload {
  taskId: string;
  sessionId: string;
  userId: string;
}

export async function generateOutline(
  payload: TaskPayload,
  onProgress: (progress: number) => void,
): Promise<TaskResult> {
  const { sessionId, userId } = payload as OutlineGeneratePayload;

  onProgress(5);

  const session = await db.brainstormSession.findFirst({
    where: { id: sessionId, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) throw new Error("Session not found");

  onProgress(10);

  const chatModel = await resolveModel("chat", userId);
  if (!chatModel) throw new Error("No chat model configured");

  const conversation = session.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
    .join("\n\n");

  // Detect document language from conversation content
  const hasCJK = /[一-鿿぀-ヿ가-힯]/.test(conversation);
  const docLocale = hasCJK ? "zh-CN" as const : "en" as const;
  const outlinePrompt = buildOutlinePrompt(docLocale);

  onProgress(20);

  const provider = createLLMProvider(chatModel.provider);
  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  onProgress(30);

  for await (const chunk of provider.chatStream({
    model: chatModel.modelId,
    messages: [
      { role: "system", content: outlinePrompt },
      { role: "user", content: `Here is the brainstorming conversation:\n\n${conversation}\n\nGenerate the outline.` },
    ],
  })) {
    chunks.push(chunk.content || "");
    if (chunk.inputTokens) inputTokens = chunk.inputTokens;
    if (chunk.outputTokens) outputTokens = chunk.outputTokens;
  }

  onProgress(85);

  const raw = chunks.join("");
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse outline from LLM response: no JSON object found. Raw output: " + raw.slice(0, 500));
  }
  const outline = JSON.parse(jsonMatch[0]);

  onProgress(90);

  await db.brainstormSession.update({
    where: { id: sessionId },
    data: { outline: JSON.stringify(outline), title: outline.title || session.title },
  });

  onProgress(95);

  await recordTokenUsage({
    userId, modelConfigId: chatModel.id, module: "outline",
    inputTokens, outputTokens, referenceId: sessionId,
  }).catch((err) => { console.warn("Failed to record token usage:", err); });

  await db.message.create({
    data: { sessionId, role: "system", content: "Outline generated and ready for review." },
  });

  onProgress(100);

  return { outline, title: outline.title || session.title };
}
