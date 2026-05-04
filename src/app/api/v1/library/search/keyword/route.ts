import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { searchByKeyword } from "@/lib/search/fts";
import type { ApiResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { query, limit = 20, offset = 0 } = await request.json();
  if (!query || typeof query !== "string") {
    return NextResponse.json({ success: false, error: "query required" }, { status: 400 });
  }

  const results = await searchByKeyword(query, limit, offset);
  return NextResponse.json({ success: true, data: results });
}
