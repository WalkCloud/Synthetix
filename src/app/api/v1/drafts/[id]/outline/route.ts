import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
  getErrorMessage,
} from "@/lib/api-helpers";

interface SectionInput {
  id?: string;
  title?: string;
  index?: number;
  parentId?: string | null;
  estimatedWords?: number;
  description?: string | null;
  keyPoints?: string | null;
  constraints?: string | null;
  _delete?: boolean;
  _new?: boolean;
}

interface OutlineUpdateBody {
  sections: SectionInput[];
  outline?: string;
}

function isTempId(id: string | undefined): boolean {
  return !!id && id.startsWith("_new_");
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId } = await params;

  let body: OutlineUpdateBody;
  try {
    body = (await request.json()) as OutlineUpdateBody;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
      select: { id: true },
    });
    if (!draft) return errorResponse("Draft not found", 404);

    const deletes: string[] = [];
    const updates: { id: string; data: Record<string, unknown> }[] = [];
    const creates: { tempId?: string; parentTempId?: string; data: Record<string, unknown> }[] = [];

    for (const s of body.sections ?? []) {
      if (s._delete && s.id && !isTempId(s.id)) {
        deletes.push(s.id);
        continue;
      }

      if (s._new) {
        const parentTempId = isTempId(s.parentId ?? undefined) ? (s.parentId ?? undefined) : undefined;
        const resolvedParentId = isTempId(s.parentId ?? undefined) ? null : (s.parentId ?? null);
        const createData: Record<string, unknown> = {
          draftId,
          title: s.title ?? "",
          index: s.index ?? 0,
          parentId: resolvedParentId,
          estimatedWords: s.estimatedWords ?? null,
          description: s.description ?? null,
          keyPoints: s.keyPoints ?? null,
          constraints: s.constraints ?? null,
          status: "pending",
        };
        creates.push({
          tempId: s.id,
          parentTempId,
          data: createData,
        });
        continue;
      }

      if (s.id && !isTempId(s.id)) {
        const data: Record<string, unknown> = {};
        if (s.title !== undefined) data.title = s.title;
        if (s.index !== undefined) data.index = s.index;
        if (s.parentId !== undefined && !isTempId(s.parentId ?? undefined)) data.parentId = s.parentId;
        if (s.estimatedWords !== undefined) data.estimatedWords = s.estimatedWords;
        if (Object.keys(data).length > 0) {
          updates.push({ id: s.id, data });
        }
      }
    }

    await db.$transaction(async (tx) => {
      if (deletes.length > 0) {
        await tx.section.deleteMany({
          where: { id: { in: deletes }, draftId },
        });
      }

      for (const u of updates) {
        await tx.section.update({
          where: { id: u.id },
          data: u.data,
        });
      }

      const tempIdMap = new Map<string, string>();

      const parents = creates.filter((c) => !c.parentTempId);
      for (const c of parents) {
        const created = await tx.section.create({ data: c.data as any });
        if (c.tempId) {
          tempIdMap.set(c.tempId, created.id);
        }
      }

      const children = creates.filter((c) => c.parentTempId);
      for (const c of children) {
        if (c.parentTempId) {
          const realParentId = tempIdMap.get(c.parentTempId);
          if (realParentId) {
            c.data.parentId = realParentId;
          }
        }
        const created = await tx.section.create({ data: c.data as any });
        if (c.tempId) {
          tempIdMap.set(c.tempId, created.id);
        }
      }

      if (body.outline !== undefined) {
        await tx.draft.update({
          where: { id: draftId },
          data: { outline: body.outline },
        });
      }
    });

    const updated = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
      include: { sections: { orderBy: { index: "asc" } } },
    });

    return successResponse(updated);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
