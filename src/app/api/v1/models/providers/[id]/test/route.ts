import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { createLLMProvider } from "@/lib/llm/factory";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user)
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );

  const { id } = await params;
  const provider = await db.modelProvider.findFirst({
    where: { id, userId: user.id },
  });

  if (!provider) {
    return NextResponse.json(
      { success: false, error: "Provider not found" },
      { status: 404 },
    );
  }

  try {
    const llm = createLLMProvider({
      apiBaseUrl: provider.apiBaseUrl,
      apiKey: provider.apiKey,
    });
    const connected = await llm.testConnection();

    if (connected) {
      const models = await llm.getModels();
      return NextResponse.json({
        success: true,
        data: { connected: true, models },
      });
    }
    return NextResponse.json({
      success: true,
      data: { connected: false },
    });
  } catch (err) {
    return NextResponse.json({
      success: true,
      data: {
        connected: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
