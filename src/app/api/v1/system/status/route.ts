import { db } from "@/lib/db";
import { successResponse } from "@/lib/api-helpers";

export async function GET() {
  try {
    const userCount = await db.user.count();
    return successResponse({ initialized: userCount > 0 });
  } catch {
    return successResponse({ initialized: false });
  }
}
