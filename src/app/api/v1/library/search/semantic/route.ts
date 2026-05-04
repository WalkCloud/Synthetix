import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { semanticSearch } from "@/lib/search/semantic";
import type { ApiResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { query, limit = 20 } = await request.json();
  if (!query || typeof query !== "string") {
    return NextResponse.json({ success: false, error: "query required" }, { status: 400 });
  }

  try {
    const results = await semanticSearch(query, user.id, limit);
    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}
