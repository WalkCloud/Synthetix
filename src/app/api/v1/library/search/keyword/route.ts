import { getAuthUser } from "@/lib/auth/session";
import { searchByKeyword } from "@/lib/search/fts";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { query, limit = 20, offset = 0 } = await request.json();
  if (!query || typeof query !== "string") {
    return errorResponse("query required", 400);
  }

  const results = await searchByKeyword(query, limit, offset);
  return successResponse(results);
}
