import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { db } from "@/lib/db";
import type { ApiResponse } from "@/types/api";

const SUGGEST_PROMPT = `Given document section content, suggest a concise diagram description (1-3 sentences).
Focus on key relationships, flows, or structures.
Use the SAME language as the input content. If Chinese input → Chinese output. If English input → English output.

Examples:
Input (EN): "The system uses a microservices architecture with an API gateway..."
Output: "Architecture diagram: API Gateway → User Service → PostgreSQL, with Redis cache"

Input (CN): "系统采用微服务架构，通过API网关..."
Output: "微服务架构图：API 网关 → 用户服务 → PostgreSQL，配合 Redis 缓存"`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId, secId: sectionId } = await params;
  const body = await request.json();
  const { content } = body as { content?: string };

  if (!content || !content.trim()) {
    return NextResponse.json({ success: false, error: "Section content is required" }, { status: 400 });
  }

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return NextResponse.json({ success: false, error: "Draft not found" }, { status: 404 });
  }

  try {
    const writingModel = await resolveModel("writing");
    if (!writingModel?.provider) {
      return NextResponse.json({ success: false, error: "No LLM model configured" }, { status: 400 });
    }

    const provider = createLLMProvider({
      apiBaseUrl: writingModel.provider.apiBaseUrl,
      apiKey: writingModel.provider.apiKey,
    });

    const truncatedContent = content.slice(0, 3000);

    const response = await provider.chat({
      model: writingModel.modelId,
      messages: [
        { role: "system", content: SUGGEST_PROMPT },
        { role: "user", content: truncatedContent },
      ],
      temperature: 0.5,
      maxTokens: 200,
    });

    const suggestion = response.content.trim();
    return NextResponse.json({ success: true, data: { suggestion } });
  } catch (error) {
    console.error("[suggest-mermaid] error:", error);
    const message = error instanceof Error ? error.message : "Failed to generate suggestion";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
