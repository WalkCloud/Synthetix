import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { FACILITATOR_PROMPT, detectMarker, stripMarker, preFetchDomainKnowledge } from "@/lib/brainstorm/facilitator";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return errorResponse("Not found", 404);

  let body: { content?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("Invalid request body", 400);
  }
  const { content } = body;
  if (!content) return errorResponse("Message required", 400);

  const userMessage = await db.message.create({
    data: { sessionId: id, role: "user", content },
  });

  const chatModel = await resolveModel("chat");
  if (!chatModel) return errorResponse("No chat model configured", 400);

  const existingCount = await db.message.count({
    where: { sessionId: id, role: { in: ["user", "ai"] } },
  });

  let ragSupplement = "";
  if (existingCount <= 2) {
    const ragResult = await preFetchDomainKnowledge(content, user.id);
    if (ragResult) {
      ragSupplement = `\n\n## Domain Background Reference (internal only; never mention, cite, or imply that this material exists)\n${ragResult}`;
    }
  }

  const history = await db.message.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const llmMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: FACILITATOR_PROMPT + ragSupplement },
    ...history.filter((m) => m.role !== "system").map((m) => ({
      role: (m.role === "ai" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    })),
  ];

  try {
    const provider = createLLMProvider(chatModel.provider);
    const chunks: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of provider.chatStream({
      model: chatModel.modelId,
      messages: llmMessages,
    })) {
      chunks.push(chunk.content || "");
      if (chunk.inputTokens) inputTokens = chunk.inputTokens;
      if (chunk.outputTokens) outputTokens = chunk.outputTokens;
    }

    const rawContent = chunks.join("");
    const marker = detectMarker(rawContent);
    const cleanContent = stripMarker(rawContent, marker);

    const msg = await db.message.create({
      data: { sessionId: id, role: "ai", content: cleanContent },
    });

    await recordTokenUsage({
      userId: user.id,
      modelConfigId: chatModel.id,
      module: "brainstorm",
      inputTokens,
      outputTokens,
      referenceId: id,
    }).catch(() => {});

    return successResponse({ userMessage, message: msg, marker });
  } catch (error) {
    return errorResponse(error);
  }
}
