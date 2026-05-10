import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { semanticSearch } from "@/lib/search/semantic";
import type { ApiResponse } from "@/types/api";
import type { QueryMode } from "@/lib/queue/types";

const VALID_MODES: QueryMode[] = ["local", "global", "hybrid", "mix", "naive", "bypass"];

export async function POST(request: Request): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { query, limit = 20, mode = "hybrid" } = await request.json();
  if (!query || typeof query !== "string") {
    return NextResponse.json({ success: false, error: "query required" }, { status: 400 });
  }

  const queryMode: QueryMode = VALID_MODES.includes(mode as QueryMode) ? (mode as QueryMode) : "hybrid";

  try {
    const results = await semanticSearch(query, user.id, limit, queryMode);
    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}
