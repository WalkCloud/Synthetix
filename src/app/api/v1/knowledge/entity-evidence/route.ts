import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { semanticSearch } from "@/lib/search/semantic";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { searchParams } = new URL(request.url);
  const entity = searchParams.get("entity")?.trim();
  if (!entity) return errorResponse({ code: "invalidInput", message: "Entity is required" }, 400);

  const results = await semanticSearch(entity, user.id, 8, "mix");
  return successResponse({
    entity,
    documentChunks: results.map((result) => ({
      chunkId: result.chunkId,
      documentId: result.documentId,
      documentName: result.documentName,
      title: result.title,
      content: result.content,
      score: result.score,
      source: result.source,
    })),
  });
}
