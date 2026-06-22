import { getAuthUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { appendChangeLog } from "@/lib/wiki/index-md";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

/**
 * GET /api/v1/wiki/entries/[id]
 *
 * Fetch a single Wiki entry with its outgoing links + incoming backlinks
 * (the OKF "links form the graph" realized as a navigable graph view).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;

  const entry = await db.wikiEntry.findFirst({
    where: { id, userId: user.id },
    include: {
      links: {
        include: { to: { select: { id: true, title: true, slug: true, type: true } } },
      },
      backlinks: {
        include: { from: { select: { id: true, title: true, slug: true, type: true } } },
      },
    },
  });

  if (!entry) return errorResponse({ code: "notFound", message: "Wiki entry not found" }, 404);

  let sourceRefs: unknown[] = [];
  try {
    const parsed = JSON.parse(entry.sourceRefs);
    if (Array.isArray(parsed)) sourceRefs = parsed;
  } catch { /* malformed */ }

  return successResponse({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    slug: entry.slug,
    content: entry.content,
    confidence: entry.confidence,
    status: entry.status,
    sourceRefs,
    lastValidatedAt: entry.lastValidatedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    links: entry.links.map((l) => ({
      id: l.id,
      relation: l.relation,
      target: l.to,
    })),
    backlinks: entry.backlinks.map((l) => ({
      id: l.id,
      relation: l.relation,
      source: l.from,
    })),
  });
}

/**
 * PATCH /api/v1/wiki/entries/[id]
 *
 * User-initiated edit of a Wiki entry (correcting LLM-synthesized content).
 * Records a change-log entry so the edit is auditable in log.md.
 *
 * Body: { title?, content?, confidence? }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;

  let body: { title?: string; content?: string; confidence?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse({ code: "invalidBody", message: "Invalid JSON body" }, 400);
  }

  const existing = await db.wikiEntry.findFirst({
    where: { id, userId: user.id },
    select: { id: true, title: true, content: true, confidence: true },
  });
  if (!existing) return errorResponse({ code: "notFound", message: "Wiki entry not found" }, 404);

  const data: { title?: string; content?: string; confidence?: number } = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if (typeof body.content === "string") data.content = body.content;
  if (typeof body.confidence === "number" && body.confidence >= 0 && body.confidence <= 1) {
    data.confidence = body.confidence;
  }

  if (Object.keys(data).length === 0) {
    return errorResponse({ code: "noChanges", message: "No editable fields provided" }, 400);
  }

  const updated = await db.wikiEntry.update({
    where: { id },
    data,
    select: { id: true, title: true, content: true, confidence: true, updatedAt: true },
  });

  const changes: string[] = [];
  if (data.title) changes.push("title");
  if (data.content) changes.push("content");
  if (data.confidence !== undefined) changes.push("confidence");
  await appendChangeLog(
    user.id,
    id,
    "update",
    `User edited "${updated.title}" (${changes.join(", ")})`,
  );

  return successResponse(updated);
}
