import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { buildTopology } from "@/lib/writing/topology-builder";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId } = await params;

  try {
    const result = await buildTopology(draftId);
    if (!result) return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
    return successResponse(result);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
