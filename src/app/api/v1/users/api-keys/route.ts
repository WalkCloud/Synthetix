import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { generateApiKeyMaterial } from "@/lib/auth/api-key";

/** List/representation DTO: never carries hashedKey or plaintext. */
function toApiKeyDto(record: {
  id: string;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    keyLast4: record.keyLast4,
    lastUsedAt: record.lastUsedAt,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
    status: record.revokedAt ? ("revoked" as const) : ("active" as const),
  };
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const keys = await db.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return successResponse(keys.map(toApiKeyDto));
}

const createSchema = z.object({
  name: z.string().trim().min(1, "apiKeyNameRequired").max(100),
});

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse({ code: "apiKeyNameRequired", message: "Key name is required" }, 400);
  }

  const material = generateApiKeyMaterial(parsed.data.name);
  const created = await db.apiKey.create({
    data: {
      userId: user.id,
      name: material.name,
      hashedKey: material.hashedKey,
      keyPrefix: material.keyPrefix,
      keyLast4: material.keyLast4,
    },
  });

  // The creation response is the only chance to return the plaintext; thereafter only the masked DTO is returned.
  return successResponse(
    {
      id: created.id,
      name: created.name,
      key: material.plaintext,
      keyPrefix: created.keyPrefix,
      keyLast4: created.keyLast4,
      createdAt: created.createdAt,
    },
    201,
  );
}
