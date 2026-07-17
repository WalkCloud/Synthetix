/**
 * Wiki synthesis worker — the async pipeline phase that precipitates
 * synthesized knowledge entries after a document is indexed.
 *
 * Mirrors the rag-embed-index-worker structure: loads ProcessingContext,
 * resolves the writing model, reads the document's chunks from the DB
 * (NOT full markdown — this is what keeps the LLM context-bounded), and
 * invokes the synthesizer. Non-blocking on document readiness — the
 * document is already `ready` by the time this runs.
 *
 * Auto-retry: if the first pass leaves some units incomplete (a common
 * case when a single chunk's LLM call fails), the worker automatically
 * retries the incomplete units by re-running the synthesizer — which
 * uses the crash-durable checkpoint to skip already-completed units and
 * only reprocesses the failed ones.
 */

import { db } from "@/lib/db";
import { loadProcessingTask, resolveProcessingModels } from "@/lib/documents/pipeline";
import { synthesizeDocument, type SynthChunk } from "@/lib/wiki/synthesizer";
import { failedOutcome, type WorkerResult, type TaskExecutionContext } from "@/lib/queue/types";

/** Maximum number of auto-retry passes for incomplete wiki units. */
const WIKI_MAX_RETRIES = 2;

export async function processWikiSynthesize(
  taskId: string,
  taskCtx: TaskExecutionContext,
): Promise<WorkerResult> {
  let docId: string | undefined;

  try {
    const procCtx = await loadProcessingTask(taskId, taskCtx.signal);
    docId = procCtx.docId;

    await resolveProcessingModels(procCtx);

    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 30 },
    });

    // ── Input unit selection: prefer DocumentSegments, fall back to chunks ──
    const segments = await db.documentSegment.findMany({
      where: { documentId: procCtx.docId },
      orderBy: { index: "asc" },
    });

    let synthChunks: SynthChunk[];
    let inputUnitType: "segment" | "chunk";

    if (segments.length >= 2) {
      const atoms = await db.documentAtom.findMany({
        where: { documentId: procCtx.docId },
        orderBy: { index: "asc" },
        select: { index: true, content: true },
      });
      const atomByIndex = new Map(atoms.map((a) => [a.index, a.content]));
      synthChunks = segments.map((seg) => {
        const parts: string[] = [];
        for (let i = seg.startAtomIndex; i <= seg.endAtomIndex; i++) {
          const text = atomByIndex.get(i);
          if (text) parts.push(text);
        }
        return {
          id: seg.id,
          index: seg.index,
          content: parts.join("\n\n"),
          tokenCount: seg.tokenCount ?? undefined,
          title: seg.title,
        };
      });
      inputUnitType = "segment";
      console.log(`[wiki] doc ${procCtx.docId}: using ${synthChunks.length} segments as input`);
    } else {
      const chunks = await db.documentChunk.findMany({
        where: { documentId: procCtx.docId },
        orderBy: { index: "asc" },
        select: { id: true, index: true, content: true, tokenCount: true, title: true },
      });

      if (chunks.length === 0) {
        return {
          ok: true,
          reason: "no chunks",
          wiki: {
            entriesCreated: 0, entriesUpdated: 0, docSummaryCreated: false,
            chunksProcessed: 0, chunksTotal: 0, completed: true,
          },
        };
      }

      synthChunks = chunks.map((c) => ({
        id: c.id, index: c.index, content: c.content,
        tokenCount: c.tokenCount, title: c.title,
      }));
      inputUnitType = "chunk";
    }

    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 50 },
    });

    // ── Synthesize with auto-retry for incomplete units ──
    // The synthesizer uses a crash-durable checkpoint: each call skips
    // already-completed units and only processes the remaining ones.
    // If some units fail (e.g. transient LLM error), we retry the whole
    // synthesizer call — it will pick up from the checkpoint and only
    // reattempt the failed units.
    let result = await runSynthesizePass(procCtx, synthChunks, inputUnitType, taskId);
    let retryCount = 0;

    while (!result.completed && retryCount < WIKI_MAX_RETRIES) {
      retryCount++;
      const failedCount = result.failedUnitIds?.length ?? result.chunksFailed ?? 0;
      console.log(
        `[wiki] doc ${procCtx.docId}: ${failedCount} unit(s) failed, ` +
        `auto-retry ${retryCount}/${WIKI_MAX_RETRIES} (checkpoint will skip completed units)`,
      );

      // Brief pause before retry to allow transient API issues to recover.
      await new Promise((r) => setTimeout(r, 5000));

      result = await runSynthesizePass(procCtx, synthChunks, inputUnitType, taskId);
    }

    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 98 },
    });

    const resultData = {
      inputUnitType,
      inputUnitCount: synthChunks.length,
      entriesCreated: result.entriesCreated,
      entriesUpdated: result.entriesUpdated,
      docSummaryCreated: result.docSummaryCreated,
      chunksProcessed: result.chunksProcessed,
      chunksTotal: result.chunksTotal,
      chunksFailed: result.chunksFailed,
      failedUnitIds: result.failedUnitIds,
      extractionMs: result.extractionMs,
      mergeMs: result.mergeMs,
      summaryMs: result.summaryMs,
      fusionCalls: result.fusionCalls,
      completed: result.completed,
      retriesUsed: retryCount,
    };

    if (!result.completed) {
      console.warn(
        `[wiki] doc ${procCtx.docId}: synthesis incomplete after ${retryCount} retry(s) ` +
        `(${result.chunksFailed}/${result.chunksTotal} units still failed). ` +
        `Partial results (${result.entriesCreated} entries) are preserved.`,
      );
      return failedOutcome("Wiki synthesis did not complete", resultData);
    }

    return resultData;
  } catch (error) {
    if (docId) {
      // Wiki failure does NOT mark the document as failed — it is already
      // `ready`. We only record the task failure for diagnostics.
    }
    throw error;
  }
}

/**
 * Single synthesis pass. The synthesizer internally uses a crash-durable
 * checkpoint, so calling this again after a partial failure will skip
 * completed units and only reprocess the incomplete ones.
 */
async function runSynthesizePass(
  procCtx: Parameters<typeof synthesizeDocument>[0],
  synthChunks: SynthChunk[],
  inputUnitType: "segment" | "chunk",
  taskId: string,
) {
  return synthesizeDocument(procCtx, synthChunks, inputUnitType, (processed, total, phase = "extract") => {
    const frac = total > 0 ? processed / total : 0;
    const [floor, ceil] = phase === "merge" ? [65, 88] : phase === "summary" ? [88, 98] : [30, 65];
    const pct = Math.round(floor + frac * (ceil - floor));
    db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: pct },
    }).catch(() => {});
  });
}
