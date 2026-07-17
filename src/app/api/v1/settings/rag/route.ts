import { getAuthUser } from "@/lib/auth/session";
import { readSettings, writeSettings } from "@/lib/settings/store";
import {
  InvalidSecretUpdateError,
  maskSecret,
  mergeSecretUpdates,
  parseClearSecrets,
} from "@/lib/settings/secrets";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const settings = readSettings(user.id);
  const ragPgUrl = maskSecret(settings.ragPgUrl);
  const ragPgPassword = maskSecret(settings.ragPgPassword);
  const ragNeo4jPassword = maskSecret(settings.ragNeo4jPassword);
  const ragMilvusToken = maskSecret(settings.ragMilvusToken);
  const ragMilvusPassword = maskSecret(settings.ragMilvusPassword);
  const ragQdrantApiKey = maskSecret(settings.ragQdrantApiKey);

  return successResponse({
    ragVectorDb: settings.ragVectorDb ?? "local",
    // Connection URLs can contain embedded credentials, so never return even a partial URL.
    ragPgUrl: "",
    ragPgUrlConfigured: ragPgUrl.configured,
    ragPgHost: settings.ragPgHost ?? "",
    ragPgPort: settings.ragPgPort ?? 5432,
    ragPgDatabase: settings.ragPgDatabase ?? "",
    ragPgUser: settings.ragPgUser ?? "",
    ragPgPassword: ragPgPassword.masked,
    ragPgPasswordConfigured: ragPgPassword.configured,
    ragNeo4jUri: settings.ragNeo4jUri ?? "",
    ragNeo4jUser: settings.ragNeo4jUser ?? "",
    ragNeo4jPassword: ragNeo4jPassword.masked,
    ragNeo4jPasswordConfigured: ragNeo4jPassword.configured,
    ragMilvusUri: settings.ragMilvusUri ?? "",
    ragMilvusToken: ragMilvusToken.masked,
    ragMilvusTokenConfigured: ragMilvusToken.configured,
    ragMilvusUser: settings.ragMilvusUser ?? "",
    ragMilvusPassword: ragMilvusPassword.masked,
    ragMilvusPasswordConfigured: ragMilvusPassword.configured,
    ragMilvusDbName: settings.ragMilvusDbName ?? "",
    ragQdrantUrl: settings.ragQdrantUrl ?? "",
    ragQdrantApiKey: ragQdrantApiKey.masked,
    ragQdrantApiKeyConfigured: ragQdrantApiKey.configured,
  });
}

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const body = await request.json();
  const current = readSettings(user.id);
  try {
    const clearSecrets = parseClearSecrets(body.clearSecrets);
    const updates = mergeSecretUpdates(current, {
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
    }, clearSecrets);
    writeSettings(user.id, updates, clearSecrets);
    return successResponse({ saved: true });
  } catch (error) {
    if (error instanceof InvalidSecretUpdateError) {
      return errorResponse({ code: "validationError", message: error.message }, 422);
    }
    throw error;
  }
}
