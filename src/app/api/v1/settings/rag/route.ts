import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { readSettings, writeSettings } from "@/lib/settings/store";
import type { ApiResponse } from "@/types/api";

export async function GET(): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const settings = readSettings(user.id);
  return NextResponse.json({
    success: true,
    data: {
      ragVectorDb: settings.ragVectorDb ?? "local",
      ragPgUrl: settings.ragPgUrl ?? "",
      ragPgHost: settings.ragPgHost ?? "",
      ragPgPort: settings.ragPgPort ?? 5432,
      ragPgDatabase: settings.ragPgDatabase ?? "",
      ragPgUser: settings.ragPgUser ?? "",
      ragPgPassword: settings.ragPgPassword ?? "",
      ragNeo4jUri: settings.ragNeo4jUri ?? "",
      ragNeo4jUser: settings.ragNeo4jUser ?? "",
      ragNeo4jPassword: settings.ragNeo4jPassword ?? "",
      ragMilvusUri: settings.ragMilvusUri ?? "",
      ragMilvusToken: settings.ragMilvusToken ?? "",
      ragMilvusUser: settings.ragMilvusUser ?? "",
      ragMilvusPassword: settings.ragMilvusPassword ?? "",
      ragMilvusDbName: settings.ragMilvusDbName ?? "",
      ragQdrantUrl: settings.ragQdrantUrl ?? "",
      ragQdrantApiKey: settings.ragQdrantApiKey ?? "",
    },
  });
}

export async function PUT(request: Request): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  writeSettings(user.id, {
    ragVectorDb: body.ragVectorDb,
    ragPgUrl: body.ragPgUrl,
    ragPgHost: body.ragPgHost,
    ragPgPort: body.ragPgPort,
    ragPgDatabase: body.ragPgDatabase,
    ragPgUser: body.ragPgUser,
    ragPgPassword: body.ragPgPassword,
    ragNeo4jUri: body.ragNeo4jUri,
    ragNeo4jUser: body.ragNeo4jUser,
    ragNeo4jPassword: body.ragNeo4jPassword,
    ragMilvusUri: body.ragMilvusUri,
    ragMilvusToken: body.ragMilvusToken,
    ragMilvusUser: body.ragMilvusUser,
    ragMilvusPassword: body.ragMilvusPassword,
    ragMilvusDbName: body.ragMilvusDbName,
    ragQdrantUrl: body.ragQdrantUrl,
    ragQdrantApiKey: body.ragQdrantApiKey,
  });

  return NextResponse.json({ success: true, data: { saved: true } });
}
