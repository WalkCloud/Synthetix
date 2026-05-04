import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user)
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );

  const { searchParams } = new URL(request.url);
  const module = searchParams.get("module");
  const days = parseInt(searchParams.get("days") || "30");

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where = {
    userId: user.id,
    createdAt: { gte: since },
    ...(module && { module }),
  };

  const [usage, summary] = await Promise.all([
    db.tokenUsage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.tokenUsage.aggregate({
      where,
      _sum: { inputTokens: true, outputTokens: true, costEstimate: true },
      _count: true,
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      usage,
      summary: {
        totalInputTokens: summary._sum.inputTokens ?? 0,
        totalOutputTokens: summary._sum.outputTokens ?? 0,
        totalCost: summary._sum.costEstimate ?? 0,
        totalCalls: summary._count,
      },
    },
  });
}
