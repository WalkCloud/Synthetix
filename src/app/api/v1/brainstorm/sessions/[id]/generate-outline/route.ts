import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { OUTLINE_PROMPT } from "@/lib/brainstorm/outline-prompt";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return errorResponse("Not found", 404);

  const chatModel = await resolveModel("chat");
  if (!chatModel) return errorResponse("No chat model configured", 400);

  const conversation = session.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
    .join("\n\n");

  try {
    const provider = createLLMProvider(chatModel.provider);
    const chunks: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of provider.chatStream({
      model: chatModel.modelId,
      messages: [
        { role: "system", content: OUTLINE_PROMPT },
        { role: "user", content: `Here is the brainstorming conversation:\n\n${conversation}\n\nGenerate the outline.` },
      ],
    })) {
      chunks.push(chunk.content || "");
      if (chunk.inputTokens) inputTokens = chunk.inputTokens;
      if (chunk.outputTokens) outputTokens = chunk.outputTokens;
    }

    const raw = chunks.join("");
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const outline = jsonMatch ? JSON.parse(jsonMatch[0]) : {
      title: session.title,
      sections: [{ num: "1", title: "Introduction", keyPoints: [], estimatedWords: 500 }],
    };

    await db.brainstormSession.update({
      where: { id },
      data: { outline: JSON.stringify(outline), title: outline.title || session.title },
    });

    await recordTokenUsage({
      userId: user.id, modelConfigId: chatModel.id, module: "outline",
      inputTokens, outputTokens, referenceId: id,
    }).catch((err) => { console.warn("Failed to record token usage:", err); });

    await db.message.create({ data: { sessionId: id, role: "system", content: "Outline generated and ready for review." } });

    return successResponse(outline);
  } catch (error) {
    return errorResponse(error);
  }
}
