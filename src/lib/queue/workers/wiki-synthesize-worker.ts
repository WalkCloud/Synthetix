/**
 * Wiki synthesis worker — the async pipeline phase that precipitates
 * synthesized knowledge entries after a document is indexed.
 *
 * Mirrors the rag-embed-index-worker structure: loads ProcessingContext,
 * resolves the writing model, reads the document's chunks from the DB
 * (NOT full markdown — this is what keeps the LLM context-bounded), and
 * invokes the synthesizer. Non-blocking on document readiness — the
 * document is already `ready` by the time this runs.
 */

import { db } from "@/lib/db";
import { loadProcessingTask, resolveProcessingModels } from "@/lib/documents/pipeline";
import { synthesizeDocument, type SynthChunk } from "@/lib/wiki/synthesizer";

export async function processWikiSynthesize(
  taskId: string,
): Promise<{ ok: boolean; wiki?: { entriesCreated: number; entriesUpdated: number; docSummaryCreated: boolean } }> {
  await db.asyncTask.update({
    where: { id: taskId },
    data: { status: "running", progress: 10 },
  });

  let docId: string | undefined;

  try {
    const ctx = await loadProcessingTask(taskId);
    docId = ctx.docId;

    // Resolve the writing LLM (same pattern as rag-embed-index-worker +
    // auto-tagger). Without a writing model we skip gracefully.
    await resolveProcessingModels(ctx);

    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 30 },
    });

    // Load chunks from the DB — NOT the full markdown. This is the key to
    // never overflowing the LLM context: the synthesizer processes one chunk
    // at a time regardless of total document size.
    const chunks = await db.documentChunk.findMany({
      where: { documentId: ctx.docId },
      orderBy: { index: "asc" },
      select: { id: true, index: true, content: true, tokenCount: true, title: true },
    });

    if (chunks.length === 0) {
      await db.asyncTask.update({
        where: { id: taskId },
        data: { status: "completed", progress: 100, resultData: JSON.stringify({ entriesCreated: 0, reason: "no chunks" }) },
      });
      return { ok: true, wiki: { entriesCreated: 0, entriesUpdated: 0, docSummaryCreated: false } };
    }

    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 50 },
    });

    const synthChunks: SynthChunk[] = chunks.map((c) => ({
      id: c.id,
      index: c.index,
      content: c.content,
      tokenCount: c.tokenCount,
      title: c.title,
    }));

    const result = await synthesizeDocument(ctx, synthChunks);

    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        progress: 100,
        resultData: JSON.stringify({
          entriesCreated: result.entriesCreated,
          entriesUpdated: result.entriesUpdated,
          docSummaryCreated: result.docSummaryCreated,
        }),
      },
    });

    return { ok: true, wiki: result };
  } catch (error) {
    if (docId) {
      // Wiki failure does NOT mark the document as failed — it is already
      // `ready`. We only record the task failure for diagnostics.
    }
    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Wiki synthesis failed",
      },
    });
    // Re-throw so the queue records the failure, but the document stays ready
    throw error;
  }
}
