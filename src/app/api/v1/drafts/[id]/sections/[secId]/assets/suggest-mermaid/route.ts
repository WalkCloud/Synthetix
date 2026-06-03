import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { db } from "@/lib/db";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

const SUGGEST_PROMPT = `Given document section content, suggest a concise diagram description (1-3 sentences).
Focus on key relationships, flows, or structures.
Use the SAME language as the input content. If Chinese input → Chinese output. If English input → English output.

Examples:
Input (EN): "The system uses a microservices architecture with an API gateway..."
Output: "Architecture diagram: API Gateway → User Service → PostgreSQL, with Redis cache"

Input: "The system uses a microservice architecture behind an API gateway..."
Output: "Microservice architecture diagram: API Gateway -> User Service -> PostgreSQL, with Redis cache"`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId, secId: sectionId } = await params;
  const body = await request.json();
  const { content } = body as { content?: string };

  if (!content || !content.trim()) {
    return errorResponse({ code: "invalidInput", message: "Section content is required" }, 400);
  }

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
  }

  try {
    const writingModel = await resolveModel("writing", user.id);
    if (!writingModel?.provider) {
      return errorResponse({ code: "modelNotConfigured", message: "No LLM model configured" }, 400);
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
    return successResponse({ suggestion });
  } catch (error) {
    console.error("[suggest-mermaid] error:", error);
    return errorResponse(error);
  }
}
