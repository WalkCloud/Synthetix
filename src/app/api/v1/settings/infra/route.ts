import { getAuthUser } from "@/lib/auth/session";
import { readSettings } from "@/lib/settings/store";
import { authErrorResponse, successResponse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const settings = readSettings(user.id);

  const dbType = settings.dbType ?? (process.env.DATABASE_URL?.startsWith("postgresql") ? "postgresql" : "sqlite");
  const storageType = settings.storageType ?? "local";
  const vectorDb = settings.ragVectorDb ?? "local";

  const dbConfigured = dbType === "sqlite" || !!(settings.pgHost || process.env.POSTGRES_HOST);
  const storageConfigured = storageType === "local" || !!(settings.s3Bucket || settings.s3Endpoint);
  const vectorConfigured = vectorDb === "local"
    || (vectorDb === "pgvector" && !!(settings.ragPgHost))
    || (vectorDb === "milvus" && !!(settings.ragMilvusUri))
    || (vectorDb === "qdrant" && !!(settings.ragQdrantUrl));

  return successResponse({
    database: {
      type: dbType,
      label: dbType === "postgresql" ? "PostgreSQL" : "SQLite",
      configured: dbConfigured,
    },
    storage: {
      type: storageType,
      label: storageType === "s3" ? "S3 Object Storage" : "Local Storage",
      configured: storageConfigured,
    },
    vectorDb: {
      type: vectorDb,
      label: vectorDb === "pgvector"
        ? "pgvector (PostgreSQL)"
        : vectorDb === "milvus"
          ? "Milvus"
          : vectorDb === "qdrant"
            ? "Qdrant"
            : "Local (NanoVectorDB)",
      configured: vectorConfigured,
    },
  });
}
