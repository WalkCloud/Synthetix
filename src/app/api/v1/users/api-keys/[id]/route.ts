import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

/**
 * Revoke an API key (soft delete).
 *
 * Revokes rather than physically deleting, to preserve audit history; a revoked
 * key immediately fails authentication. Revoking twice returns 409.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const record = await db.apiKey.findFirst({ where: { id, userId: user.id } });
  if (!record) {
    return errorResponse({ code: "apiKeyNotFound", message: "API key not found" }, 404);
  }
  if (record.revokedAt) {
    return errorResponse(
      { code: "apiKeyAlreadyRevoked", message: "API key already revoked" },
      409,
    );
  }

  await db.apiKey.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });

  return successResponse({ success: true });
}
