import { getAuthUser } from "@/lib/auth/session";
import { semanticSearch } from "@/lib/search/semantic";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import type { QueryMode } from "@/lib/queue/types";

const VALID_MODES: QueryMode[] = ["local", "global", "hybrid", "mix", "naive", "bypass"];

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { query, limit = 20, mode = "hybrid" } = await request.json();
  if (!query || typeof query !== "string") {
    return errorResponse({ code: "invalidInput", message: "query required" }, 400);
  }

  const queryMode: QueryMode = VALID_MODES.includes(mode as QueryMode) ? (mode as QueryMode) : "hybrid";

  try {
    const results = await semanticSearch(query, user.id, limit, queryMode);
    return successResponse(results);
  } catch (error) {
    return errorResponse(error);
  }
}
