import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { createLLMProvider } from "@/lib/llm/factory";
import type { ApiResponse } from "@/types/api";

const SOCRATIC_PROMPT = `You are a skilled brainstorming facilitator using the Socratic method.
Your role is to help users clarify their thoughts through targeted questions.

Question phases:
1. Understanding: Clarify intent and scope
2. Deepening: Explore details, relationships, and edge cases
3. Structuring: Help organize into a logical framework

Rules:
- Ask ONE question at a time
- Build on previous answers
- Keep responses concise (2-4 sentences + one question)
- When the user signals readiness (e.g., "generate outline", "I think we're done", "let's move on"), suggest generating an outline
- If asked to generate an outline, respond with: OUTLINE_REQUESTED`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

  const { content } = await request.json();
  if (!content) return NextResponse.json({ success: false, error: "Message required" }, { status: 400 });

  // Save user message
  await db.message.create({
    data: { sessionId: id, role: "user", content },
  });

  // Get chat model
  const chatModel = await db.modelConfig.findFirst({
    where: { isDefaultFor: "chat" },
    include: { provider: true },
  });

  if (!chatModel) {
    return NextResponse.json({ success: false, error: "No chat model configured" }, { status: 400 });
  }

  // Get conversation history
  const history = await db.message.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const llmMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SOCRATIC_PROMPT },
    ...history.filter((m) => m.role !== "system").map((m) => ({
      role: (m.role === "ai" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    })),
  ];

  try {
    const provider = createLLMProvider(chatModel.provider);
    const chunks: string[] = [];

    for await (const chunk of provider.chatStream({
      model: chatModel.modelId,
      messages: llmMessages,
    })) {
      chunks.push(chunk.content || "");
    }

    const aiContent = chunks.join("");

    const msg = await db.message.create({
      data: { sessionId: id, role: "ai", content: aiContent },
    });

    // Check if outline was requested
    const outlineRequested = aiContent.includes("OUTLINE_REQUESTED");

    return NextResponse.json({
      success: true,
      data: { message: msg, outlineRequested },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "AI response failed",
    }, { status: 500 });
  }
}
