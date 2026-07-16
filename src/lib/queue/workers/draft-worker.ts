import { db } from "@/lib/db";
import { generateSectionFull } from "@/lib/writing/generator";
import { generateSummary } from "@/lib/writing/summarizer";
import { createAssetRequests } from "@/lib/writing/asset-pipeline";
import { buildEffectiveConstraints } from "@/lib/writing/constraints";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import { persistSectionReferences } from "@/lib/writing/persist-references";
import type { TaskPayload, TaskResult, TaskExecutionContext } from "@/lib/queue/types";

interface DraftGenerateAllPayload extends TaskPayload {
  taskId: string;
  draftId: string;
  userId: string;
  overwrite?: boolean;
  stopOnError?: boolean;
  modelConfigId?: string;
}

async function restoreSectionAfterCancel(sectionId: string): Promise<void> {
  const section = await db.section.findUnique({
    where: { id: sectionId },
    select: { content: true },
  });
  await db.section.update({
    where: { id: sectionId },
    data: { status: section?.content ? "reviewing" : "pending" },
  });
}

async function updateTaskDraftProgress(
  taskId: string,
  data: {
    draftId: string;
    generated: number;
    total: number;
    currentSectionId?: string | null;
    currentSectionTitle?: string | null;
    skipped?: number;
  },
): Promise<void> {
  await db.asyncTask.updateMany({
    where: { id: taskId, status: "running" },
    data: {
      resultData: JSON.stringify(data),
      updatedAt: new Date(),
    },
  }).catch(() => {});
}

async function createAssetsFromContent(
  draftId: string,
  sectionId: string,
  rawContent: string,
  section: {
    title: string;
    description?: string | null;
    keyPoints?: string | null;
    estimatedWords?: number | null;
    constraints?: string | null;
  },
  constraints?: Parameters<typeof buildEffectiveConstraints>[1],
): Promise<string> {
  const { contentWithIds } = await createAssetRequests(
    draftId,
    sectionId,
    rawContent,
    section,
    buildEffectiveConstraints(section.constraints, constraints),
  );
  return contentWithIds;
}

async function finalizeGeneratedSection(
  sectionId: string,
  content: string,
  title: string,
  wordCount: number,
  summary: string | null,
  modelId?: string,
): Promise<void> {
  const nextVersion = await db.sectionVersion.count({ where: { sectionId } }) + 1;

  await db.sectionVersion.create({
    data: {
      sectionId,
      version: nextVersion,
      content,
      source: "generated",
      modelId: modelId || null,
      wordCount,
    },
  });

  await db.section.update({
    where: { id: sectionId },
    data: {
      content,
      summary,
      wordCount,
      status: "locked",
    },
  });
}

export async function generateDraftAll(
  payload: DraftGenerateAllPayload,
  ctx: TaskExecutionContext,
): Promise<TaskResult> {
  const {
    taskId,
    draftId,
    userId,
    overwrite = false,
    stopOnError = true,
    modelConfigId,
  } = payload;
  const onProgress = (progress: number) => { void ctx.reportProgress(progress); };

  async function isCancelled(): Promise<boolean> {
    return ctx.signal.aborted;
  }

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId },
  });
  if (!draft) {
    throw new Error("Draft not found");
  }

  const sections = await db.section.findMany({
    where: { draftId },
    orderBy: { index: "asc" },
  });

  const targets = sections.filter((section) => {
    if (overwrite) return !["retrieving", "generating", "comparing"].includes(section.status);
    if (section.status === "reviewing" && section.content) return true;
    return section.status === "pending" || section.status === "failed";
  });

  if (targets.length === 0) {
    await onProgress(100);
    return { draftId, generated: 0, total: 0, skipped: sections.length };
  }

  let generated = 0;
  const errors: { sectionId: string; title: string; error: string }[] = [];

  await updateTaskDraftProgress(taskId, {
    draftId,
    generated,
    total: targets.length,
    currentSectionId: null,
    currentSectionTitle: null,
    skipped: sections.length - targets.length,
  });

  for (let i = 0; i < targets.length; i++) {
    if (await isCancelled()) {
      return { generated, cancelled: true, errors };
    }

    const section = targets[i];
    const baseProgress = Math.floor((i / targets.length) * 100);
    await onProgress(baseProgress);
    await updateTaskDraftProgress(taskId, {
      draftId,
      generated,
      total: targets.length,
      currentSectionId: section.id,
      currentSectionTitle: section.title,
      skipped: sections.length - targets.length,
    });

    try {
      if (!overwrite && section.status === "reviewing" && section.content) {
        const wordCount = section.wordCount ?? section.content.split(/\s+/).filter(Boolean).length;
        let summary = section.summary;

        if (!summary) {
          try {
            summary = await generateSummary(section.content, section.title, userId, section.id);
          } catch (error) {
            console.warn(`Summary generation failed for section ${section.id}:`, error);
          }
        }

        if (await isCancelled()) {
          return { generated, cancelled: true, errors };
        }

        await finalizeGeneratedSection(
          section.id,
          section.content,
          section.title,
          wordCount,
          summary,
        );

        generated += 1;
        await onProgress(Math.floor(((i + 1) / targets.length) * 100));
        await updateTaskDraftProgress(taskId, {
          draftId,
          generated,
          total: targets.length,
          currentSectionId: null,
          currentSectionTitle: null,
          skipped: sections.length - targets.length,
        });
        continue;
      }

      await db.section.update({
        where: { id: section.id },
        data: {
          status: "retrieving",
          content: overwrite ? null : section.content,
          summary: overwrite ? null : section.summary,
          wordCount: overwrite ? null : section.wordCount,
        },
      });

      if (await isCancelled()) {
        await restoreSectionAfterCancel(section.id);
        return { generated, cancelled: true, errors };
      }

      const completedSections = await db.section.findMany({
        where: {
          draftId,
          index: { lt: section.index },
          status: { in: ["locked", "summarized", "reviewing"] },
          summary: { not: null },
        },
        select: { title: true, summary: true, status: true },
        orderBy: { index: "asc" },
      });

      const sectionConstraints = section.estimatedWords ? { wordLimit: section.estimatedWords } : undefined;
      const result = await generateSectionFull(
        draft,
        section,
        completedSections,
        userId,
        sectionConstraints,
        modelConfigId,
      );

      if (await isCancelled()) {
        await restoreSectionAfterCancel(section.id);
        return { generated, cancelled: true, errors };
      }

      await persistSectionReferences(section.id, result.ragReferences);

      await db.section.update({
        where: { id: section.id },
        data: { status: "generating" },
      });

      if (await isCancelled()) {
        await restoreSectionAfterCancel(section.id);
        return { generated, cancelled: true, errors };
      }

      const content = stripLeadingSectionTitle(
        await createAssetsFromContent(draftId, section.id, result.content, section, sectionConstraints),
        section.title,
      );

      if (await isCancelled()) {
        await restoreSectionAfterCancel(section.id);
        return { generated, cancelled: true, errors };
      }

      const wordCount = content.split(/\s+/).filter(Boolean).length;
      let summary: string | null = null;

      try {
        summary = await generateSummary(content, section.title, userId, section.id);
      } catch (error) {
        console.warn(`Summary generation failed for section ${section.id}:`, error);
      }

      if (await isCancelled()) {
        await restoreSectionAfterCancel(section.id);
        return { generated, cancelled: true, errors };
      }

      await finalizeGeneratedSection(
        section.id,
        content,
        section.title,
        wordCount,
        summary,
        result.modelConfigId,
      );

      generated += 1;
      await onProgress(Math.floor(((i + 1) / targets.length) * 100));
      await updateTaskDraftProgress(taskId, {
        draftId,
        generated,
        total: targets.length,
        currentSectionId: null,
        currentSectionTitle: null,
        skipped: sections.length - targets.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push({ sectionId: section.id, title: section.title, error: message });
      await db.section.update({
        where: { id: section.id },
        data: { status: "failed" },
      });
      if (stopOnError) {
        throw new Error(`Section "${section.title}" failed: ${message}`);
      }
    }
  }

  return {
    draftId,
    generated,
    total: targets.length,
    skipped: sections.length - targets.length,
    errors,
  };
}
