import { getAuthUser } from "@/lib/auth/session";
import { documentLifecycle } from "@/lib/documents/lifecycle";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function DELETE(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { ids }: { ids: string[] } = await request.json();
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return errorResponse({ code: "invalidInput", message: "ids required" }, 400);
  }

  const result = await documentLifecycle.deleteDocuments(user.id, ids);
  return successResponse({ deleted: result.deleted.length, results: result.results });
}
