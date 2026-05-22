import { db } from "@/lib/db";

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

function isTempId(id: string | undefined): boolean {
  return !!id && id.startsWith("_new_");
}

export async function patchOutline(draftId: string, body: { sections?: SectionInput[]; outline?: string }) {
  const deletes: string[] = [];
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const creates: { tempId?: string; parentTempId?: string; data: Record<string, unknown> }[] = [];

  for (const s of body.sections ?? []) {
    if (s._delete && s.id && !isTempId(s.id)) { deletes.push(s.id); continue; }
    if (s._new) {
      const parentTempId = isTempId(s.parentId ?? undefined) ? (s.parentId ?? undefined) : undefined;
      const resolvedParentId = isTempId(s.parentId ?? undefined) ? null : (s.parentId ?? null);
      creates.push({
        tempId: s.id, parentTempId,
        data: {
          draftId, title: s.title ?? "", index: s.index ?? 0, parentId: resolvedParentId,
          estimatedWords: s.estimatedWords ?? null, description: s.description ?? null,
          keyPoints: s.keyPoints ?? null, constraints: s.constraints ?? null, status: "pending",
        },
      });
      continue;
    }
    if (s.id && !isTempId(s.id)) {
      const data: Record<string, unknown> = {};
      if (s.title !== undefined) data.title = s.title;
      if (s.index !== undefined) data.index = s.index;
      if (s.parentId !== undefined && !isTempId(s.parentId ?? undefined)) data.parentId = s.parentId;
      if (s.estimatedWords !== undefined) data.estimatedWords = s.estimatedWords;
      if (Object.keys(data).length > 0) updates.push({ id: s.id, data });
    }
  }

  await db.$transaction(async (tx) => {
    if (deletes.length > 0) await tx.section.deleteMany({ where: { id: { in: deletes }, draftId } });
    for (const u of updates) await tx.section.update({ where: { id: u.id }, data: u.data });

    const tempIdMap = new Map<string, string>();
    for (const c of creates.filter((c) => !c.parentTempId)) {
      const created = await tx.section.create({ data: c.data as any });
      if (c.tempId) tempIdMap.set(c.tempId, created.id);
    }
    for (const c of creates.filter((c) => c.parentTempId)) {
      if (c.parentTempId) { const real = tempIdMap.get(c.parentTempId); if (real) c.data.parentId = real; }
      const created = await tx.section.create({ data: c.data as any });
      if (c.tempId) tempIdMap.set(c.tempId, created.id);
    }

    if (body.outline !== undefined) await tx.draft.update({ where: { id: draftId }, data: { outline: body.outline } });
  });

  return db.draft.findFirst({
    where: { id: draftId },
    include: { sections: { orderBy: { index: "asc" } } },
  });
}
