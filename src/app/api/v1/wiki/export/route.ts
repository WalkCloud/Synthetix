import { getAuthUser } from "@/lib/auth/session";
import { readIndexMd, readLogMd, regenerateIndexMd, regenerateLogMd } from "@/lib/wiki/index-md";
import { authErrorResponse, errorResponse } from "@/lib/api-helpers";

/**
 * GET /api/v1/wiki/export?format=index|log
 *
 * Export the Wiki as OKF-format Markdown (portable to Obsidian etc.).
 *   ?format=index — the index.md directory (regenerated on-demand if stale)
 *   ?format=log   — the log.md change history
 *   ?format=refresh — force-regenerate both files, then return index
 *
 * Returns plain text/markdown (not JSON) for direct download / Obsidian import.
 */
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "index";

  try {
    let content: string;
    let filename: string;

    if (format === "refresh") {
      await Promise.all([regenerateIndexMd(user.id), regenerateLogMd(user.id)]);
      content = await readIndexMd(user.id);
      filename = "index.md";
    } else if (format === "log") {
      content = await readLogMd(user.id);
      filename = "log.md";
    } else {
      content = await readIndexMd(user.id);
      filename = "index.md";
    }

    return new Response(content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
