import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

const FACILITATOR_PROMPT = `You are a top-tier Document Architect. Your goal is to help the user build a high-quality document outline.

Your job is to build the skeleton, not fill in the content! Do not let the user write specific content!

## Core Process (strictly follow)

### Phase 1: Understand Requirements (1-2 rounds of dialogue)
When the user first describes their idea, quickly gather the following key information (skip if already provided):
- **Writing context**: What is the purpose of this document? Who is the target audience?
- **Core requirements**: What topics or chapters must be covered? Any special requirements?
- **Length expectations**: Roughly how many words? Is it a report, white paper, thesis, or other format?

**Note**: Use brief, natural dialogue to gather info. Don't throw all questions at once! Respond to the user's idea first, then ask 1-2 targeted questions.
If the user uploaded a document, extract this information directly from the document content without asking.

### Phase 2: Generate Outline
Once you fully understand the requirements, provide an initial outline suggestion.
- Use Markdown lists for chapter titles and brief descriptions.
- At the end, ask: "Is this structure direction right? Do you want to add or remove any chapters, or should I generate the final outline?"

### Phase 3: Iterative Revision
The user will suggest modifications to your outline. Adjust based on their feedback and show the complete revised version again.

## Trigger Condition
When you feel the outline structure is essentially ready, or the user explicitly confirms the outline and asks you to generate it, immediately append the marker at the end of your reply: OUTLINE_REQUESTED

If the user confirms the current outline, reply directly: OUTLINE_REQUESTED

## Response Principles
- Keep each reply concise and clear, avoid lengthy responses
- Use chapter-level Markdown lists for the outline, do not expand into content
- Always reply in the SAME LANGUAGE as the user's input. If the user speaks Chinese, you MUST reply in Chinese. If English, reply in English. Maintain a professional and efficient tone.`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return errorResponse("Not found", 404);

  const { content } = await request.json();
  if (!content) return errorResponse("Message required", 400);

  await db.message.create({
    data: { sessionId: id, role: "user", content },
  });

  const chatModel = await resolveModel("chat");

  if (!chatModel) {
    return errorResponse("No chat model configured", 400);
  }

  const history = await db.message.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const llmMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: FACILITATOR_PROMPT },
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

    const aiContent = chunks.join("");

    const msg = await db.message.create({
      data: { sessionId: id, role: "ai", content: aiContent },
    });

    await recordTokenUsage({
      userId: user.id,
      modelConfigId: chatModel.id,
      module: "brainstorm",
      inputTokens,
      outputTokens,
      referenceId: id,
    }).catch((err) => { console.warn("Failed to record token usage:", err); });

    const outlineRequested = aiContent.includes("OUTLINE_REQUESTED");

    return successResponse({ message: msg, outlineRequested });
  } catch (error) {
    return errorResponse(error);
  }
}
