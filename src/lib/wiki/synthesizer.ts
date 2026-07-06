/**
 * Wiki synthesizer — the core of the LLM-Wiki synthesized layer.
 *
 * TWO-PHASE pipeline that NEVER feeds full document text to the LLM:
 *
 * Phase A (per-chunk incremental): for each DocumentChunk, one LLM call
 *   reads ONLY that chunk + the existing entry titles list (for dedup).
 *   Extracts topics/concepts/claims + a micro-summary, then merges into
 *   the Wiki. Context per call ≈ 1 chunk + titles ≪ window. Document size
 *   only affects iteration count, never single-call context size.
 *
 * Phase B (layered document summary): concatenates the per-chunk
 *   micro-summaries (already ~5-10x compressed vs raw text) and generates
 *   a single doc_summary entry. Extremely large documents are batched
 *   through a two-layer Reduce so even the compressed summaries never
 *   overflow the window.
 *
 * Mirrors the auto-tagger pattern: resolves the writing LLM via
 * ProcessingContext, records token usage under module "wiki", and fails
 * non-blocking (try/catch + console.warn) so a synthesis error never
 * breaks document processing.
 */

import { db } from "@/lib/db";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import type { ChatParams, ChatResponse } from "@/lib/llm/types";
import { resolveLLMClient } from "@/lib/llm/client";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import os from "os";
import { estimateTokens } from "@/lib/documents/splitter";
import type { ProcessingContext } from "@/lib/documents/pipeline";
import {
  CHUNK_EXTRACTION_PROMPT,
  DOC_SUMMARY_PROMPT,
  buildExistingTitlesContext,
} from "@/lib/wiki/prompts";
import { mergeChunkKnowledge, getExistingTitles } from "@/lib/wiki/merger";
import { mergeEntry } from "@/lib/wiki/merger";
import { regenerateIndexMd } from "@/lib/wiki/index-md";
import {
  type ChunkKnowledge,
  type WikiSourceRef,
  WIKI_CONFIG,
  resolveWikiInputMaxTokens,
} from "@/lib/wiki/types";

/**
 * LLM client extended with userId (LLMClient itself doesn't carry it).
 * Used throughout this module for token-usage attribution.
 */
interface WikiClient {
  provider: ReturnType<typeof createLLMProvider>;
  modelId: string;
  modelConfigId: string;
  userId: string;
}

/** Minimal chunk shape consumed by the synthesizer (decouples from Prisma model). */
export interface SynthChunk {
  id: string;
  index: number;
  content: string;
  tokenCount?: number | null;
  title?: string | null;
}

/**
 * Per-chunk progress callback. Reports how many chunks have been processed
 * out of the total so the worker can update the task's progress bar —
 * without this, the bar sits frozen at a fixed percentage for the entire
 * (potentially long) per-chunk LLM loop.
 */
export type SynthProgressPhase = "extract" | "merge" | "summary";
export type SynthProgressFn = (processed: number, total: number, phase?: SynthProgressPhase) => void;

/**
 * Entry point: synthesize Wiki entries for a document from its chunks.
 *
 * This is the function the wiki-synthesize-worker calls. It loads chunks
 * from the DB (NOT full markdown), runs Phase A + Phase B, and refreshes
 * index.md at the end.
 *
 * @param onProgress Optional callback fired after each chunk in Phase A so
 *                   callers can report fine-grained progress (processed/total).
 */
export async function synthesizeDocument(
  ctx: ProcessingContext,
  chunks: SynthChunk[],
  onProgress?: SynthProgressFn,
): Promise<{ entriesCreated: number; entriesUpdated: number; docSummaryCreated: boolean; chunksProcessed: number; chunksTotal: number; completed: boolean; chunksFailed?: number; extractionMs?: number; mergeMs?: number; summaryMs?: number; fusionCalls?: number }> {
  if (chunks.length === 0) {
    return { entriesCreated: 0, entriesUpdated: 0, docSummaryCreated: false, chunksProcessed: 0, chunksTotal: 0, completed: true };
  }

  const client = await resolveWikiClient(ctx);
  if (!client) {
    console.warn("[wiki] No writing model configured — skipping synthesis");
    return { entriesCreated: 0, entriesUpdated: 0, docSummaryCreated: false, chunksProcessed: 0, chunksTotal: chunks.length, completed: false };
  }

  // Dynamic Phase-A input cap: derived from the writing model's context window
  // instead of the old fixed 2000. See resolveWikiInputMaxTokens() for the
  // rationale and env overrides.
  const inputMaxTokens = resolveWikiInputMaxTokens(ctx.contextWindow);
  console.log(`[wiki] Phase-A input cap = ${inputMaxTokens} tokens (contextWindow=${ctx.contextWindow})`);

  // ---- Resume from checkpoint: skip already-processed chunks ----
  // The progress file lives in the doc's wiki dir. On timeout/re-trigger,
  // the worker reads this to continue from where it left off.
  const progressFile = getWikiProgressPath(ctx.docId);
  const checkpoint = readCheckpoint(progressFile);
  const startIndex = checkpoint?.lastProcessedChunkIndex != null
    ? checkpoint.lastProcessedChunkIndex + 1
    : 0;

  // Filter chunks to process (skip already-done ones)
  const chunksToProcess = chunks.filter((c) => c.index >= startIndex);
  if (startIndex > 0) {
    console.log(`[wiki] Resuming from chunk ${startIndex} (${chunksToProcess.length}/${chunks.length} remaining)`);
  }

  const existingTitles = await getExistingTitles(ctx.doc.userId);
  let created = 0;
  let updated = 0;
  const microSummaries: string[] = [];

  // Load previously collected micro-summaries (for Phase B continuity)
  if (checkpoint?.microSummaries) {
    microSummaries.push(...checkpoint.microSummaries);
  }

  // ---- Phase A: per-chunk incremental extraction + merge ----
  //
  // Two-stage to safely parallelise the LLM-bound work while keeping the
  // DB-write stage serial:
  //
  //   Stage 1 (CONCURRENT): extractChunkKnowledge — pure LLM call reading a
  //     SNAPSHOT of existingTitles. No DB writes, no shared-state mutation, so
  //     N chunks can run in parallel safely. The adaptive limiter (now wired
  //     into the adapter) paces these against the provider's real capacity.
  //
  //   Stage 2 (SERIAL): mergeChunkKnowledge — writes WikiEntry rows + mutates
  //     the shared existingTitles array (dedup awareness) + ensures unique
  //     slugs (check-then-create). Concurrent merges would race on all three.
  //     Running serially preserves the original merge semantics exactly.
  //
  // microSummaries + checkpoint advance ONLY in the serial stage, ordered by
  // chunk.index — so resume-on-timeout stays correct regardless of the order
  // in which concurrent extractions completed.
  let failedCount = 0;
  let fusionCalls = 0;
  const WIKI_EXTRACT_CONCURRENCY = readPositiveIntEnv("WIKI_EXTRACT_CONCURRENCY", WIKI_CONFIG.extractSchedulerConcurrency);
  const extractionStarted = Date.now();
  let extractionMs = 0;
  let mergeMs = 0;

  interface ExtractResult {
    chunk: SynthChunk;
    knowledge: ChunkKnowledge | null; // null = extraction failed
  }

  for (let offset = 0; offset < chunksToProcess.length; offset += WIKI_EXTRACT_CONCURRENCY) {
    const batch = chunksToProcess.slice(offset, offset + WIKI_EXTRACT_CONCURRENCY);
    const extractResults = new Array<ExtractResult>(batch.length);
    const titlesSnapshot = existingTitles.slice();

    let batchExtractDone = 0;
    await runBounded(batch, WIKI_EXTRACT_CONCURRENCY, async (chunk, i) => {
      try {
        const knowledge = await extractChunkKnowledge(chunk, titlesSnapshot, client, inputMaxTokens);
        extractResults[i] = { chunk, knowledge };
      } catch (err) {
        // A single chunk failing must not abort the whole document.
        console.warn(`[wiki] Chunk ${chunk.index} extraction failed (non-blocking):`, err);
        extractResults[i] = { chunk, knowledge: null };
      }
      batchExtractDone++;
      onProgress?.(startIndex + offset + batchExtractDone, chunks.length, "extract");
    });
    extractionMs = Date.now() - extractionStarted;

    const mergeStarted = Date.now();
    // Merge this batch immediately, strictly in chunk-index order. This preserves
    // DB correctness while advancing checkpoints much earlier on large docs.
    for (const { chunk, knowledge } of extractResults) {
      if (!knowledge) {
        failedCount++;
        microSummaries.push(`Chunk ${chunk.index}: (extraction failed)`);
        // Do NOT advance checkpoint past a failed chunk — re-trigger retries it.
        writeCheckpoint(progressFile, {
          lastProcessedChunkIndex: chunk.index - 1,
          microSummaries,
          totalChunks: chunks.length,
        });
        continue;
      }

      microSummaries.push(knowledge.microSummary);

      const stats = await mergeChunkKnowledge(
        ctx.doc.userId,
        { documentId: ctx.docId, chunkId: chunk.id, chunkIndex: chunk.index },
        knowledge,
        existingTitles,
        client, // enables LLM fusion when merging into existing entries
      );
      created += stats.created;
      updated += stats.updated;
      fusionCalls += stats.fusionCalls;

      writeCheckpoint(progressFile, {
        lastProcessedChunkIndex: chunk.index,
        microSummaries,
        totalChunks: chunks.length,
      });
      onProgress?.(chunk.index + 1, chunks.length, "merge");
    }
    mergeMs += Date.now() - mergeStarted;
  }

  // If ALL chunks failed (e.g. network down, DNS unreachable), don't mark
  // as completed — the user needs to know it failed and re-trigger.
  if (chunksToProcess.length > 0 && failedCount === chunksToProcess.length) {
    console.error(`[wiki] All ${failedCount} chunks failed for doc ${ctx.docId} — likely network/API issue`);
    return {
      entriesCreated: 0,
      entriesUpdated: 0,
      docSummaryCreated: false,
      chunksProcessed: chunks.length - failedCount,
      chunksTotal: chunks.length,
      completed: false,
      chunksFailed: failedCount,
      extractionMs,
      mergeMs,
      fusionCalls,
    };
  }

  // All chunks processed — Phase B can now run
  // ---- Phase B: layered document summary ----
  let docSummaryCreated = false;
  const summaryStarted = Date.now();
  try {
    onProgress?.(chunks.length, chunks.length, "summary");
    docSummaryCreated = await generateDocSummary(ctx, microSummaries, client, existingTitles);
    if (docSummaryCreated) created += 1;
  } catch (err) {
    console.warn(`[wiki] Doc summary generation failed (non-blocking):`, err);
  }
  const summaryMs = Date.now() - summaryStarted;

  // Clear checkpoint (all done)
  clearCheckpoint(progressFile);

  // Refresh the on-disk index.md so the user can browse the new state
  await regenerateIndexMd(ctx.doc.userId).catch(() => {});

  return {
    entriesCreated: created,
    entriesUpdated: updated,
    docSummaryCreated,
    chunksProcessed: chunks.length,
    chunksTotal: chunks.length,
    completed: true,
    chunksFailed: failedCount,
    extractionMs,
    mergeMs,
    summaryMs,
    fusionCalls,
  };
}

/**
 * Phase A core: one LLM call reading ONLY a single chunk + titles list.
 * Parses the strict-JSON response into a ChunkKnowledge.
 */
async function chatWithTokenRetry(
  client: WikiClient,
  params: ChatParams,
  retryMaxTokens: number,
): Promise<ChatResponse> {
  const response = await client.provider.chat(params);
  if (response.finishReason === "length" || response.finishReason === "max_tokens") {
    return client.provider.chat({ ...params, maxTokens: Math.max(retryMaxTokens, params.maxTokens ?? 0) });
  }
  return response;
}

async function extractChunkKnowledge(
  chunk: SynthChunk,
  existingTitles: { title: string; slug: string }[],
  client: WikiClient,
  inputMaxTokens: number,
): Promise<ChunkKnowledge> {
  const titlesCtx = truncateTitlesList(
    existingTitles.map((t) => t.title),
    WIKI_CONFIG.titlesListMaxTokens,
  );
  const truncatedChunk = truncateToTokens(chunk.content, inputMaxTokens);

  const response = await chatWithTokenRetry(client, {
    model: client.modelId,
    messages: [
      { role: "system", content: CHUNK_EXTRACTION_PROMPT },
      { role: "user", content: `${buildExistingTitlesContext(titlesCtx)}\n\n--- Chunk content ---\n${truncatedChunk}` },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
    maxTokens: WIKI_CONFIG.extractionMaxTokens,
  }, WIKI_CONFIG.extractionRetryMaxTokens);

  await recordTokenUsage({
    userId: client.userId,
    modelConfigId: client.modelConfigId,
    module: "wiki",
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  }).catch(() => {});

  return parseChunkKnowledge(response.content);
}

/**
 * Phase B: generate a doc_summary entry from collected micro-summaries.
 *
 * Micro-summaries are already ~5-10x smaller than raw text, so most
 * documents fit in a single call. For extremely large documents
 * (summaries exceed the batch threshold), apply a two-layer Reduce:
 * batch the summaries, summarize each batch, then summarize the batches.
 */
async function generateDocSummary(
  ctx: ProcessingContext,
  microSummaries: string[],
  client: WikiClient,
  existingTitles: { title: string; slug: string }[],
): Promise<boolean> {
  const joined = microSummaries
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");

  // Two-layer Reduce for extremely large documents
  let finalInput = joined;
  if (joined.length > WIKI_CONFIG.docSummaryBatchChars) {
    const batches = chunkStringArray(microSummaries, WIKI_CONFIG.docSummaryBatchChars);
    const batchSummaries: string[] = [];
    for (let i = 0; i < batches.length; i++) {
      const bs = await summarizeBatch(batches[i], i + 1, client);
      batchSummaries.push(bs);
    }
    finalInput = batchSummaries.map((s, i) => `Section ${i + 1}: ${s}`).join("\n");
  }

  const response = await client.provider.chat({
    model: client.modelId,
    messages: [
      { role: "system", content: DOC_SUMMARY_PROMPT },
      { role: "user", content: `Document: ${ctx.doc.originalName}\n\nMicro-summaries:\n${finalInput}` },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
    maxTokens: WIKI_CONFIG.docSummaryMaxTokens,
  });

  await recordTokenUsage({
    userId: client.userId,
    modelConfigId: client.modelConfigId,
    module: "wiki",
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  }).catch(() => {});

  const parsed = safeJsonParse(response.content);
  if (!parsed || typeof parsed.title !== "string" || typeof parsed.content !== "string") {
    return false;
  }

  const sourceRef: WikiSourceRef = { documentId: ctx.docId };
  await mergeEntry(
    ctx.doc.userId,
    "doc_summary",
    String(parsed.title),
    String(parsed.content),
    sourceRef,
    0.85,
    existingTitles,
    client,
  );

  // Create links from the doc_summary to its key topics (OKF link-as-graph)
  if (Array.isArray(parsed.keyTopics)) {
    await linkDocSummaryToTopics(ctx.doc.userId, String(parsed.title), parsed.keyTopics, existingTitles);
  }

  return true;
}

/** Summarize a batch of micro-summaries (layer-1 of the two-layer Reduce). */
async function summarizeBatch(summaries: string[], batchNum: number, client: WikiClient): Promise<string> {
  const joined = summaries.map((s) => `- ${s}`).join("\n");
  const response = await client.provider.chat({
    model: client.modelId,
    messages: [
      {
        role: "system",
        content: "Summarize the following section summaries into 2-3 sentences of the key points. Match the source language. Output plain text, no JSON.",
      },
      { role: "user", content: `Batch ${batchNum}:\n${joined}` },
    ],
    temperature: 0.3,
    maxTokens: WIKI_CONFIG.batchSummaryMaxTokens,
  });

  await recordTokenUsage({
    userId: client.userId,
    modelConfigId: client.modelConfigId,
    module: "wiki",
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  }).catch(() => {});

  return response.content.trim();
}

/** Create WikiLink edges from a doc_summary to topics mentioned in keyTopics. */
async function linkDocSummaryToTopics(
  userId: string,
  docSummaryTitle: string,
  keyTopics: unknown,
  existingTitles: { title: string; slug: string }[],
): Promise<void> {
  if (!Array.isArray(keyTopics)) return;
  const fromEntry = await db.wikiEntry.findFirst({
    where: { userId, title: docSummaryTitle, type: "doc_summary" },
    select: { id: true },
  });
  if (!fromEntry) return;

  for (const topicName of keyTopics) {
    if (typeof topicName !== "string") continue;
    // Find a matching existing entry by similarity
    const match = existingTitles.find((t) => t.title.toLowerCase().includes(topicName.toLowerCase()));
    if (!match) continue;
    const toEntry = await db.wikiEntry.findUnique({
      where: { userId_slug: { userId, slug: match.slug } },
      select: { id: true },
    });
    if (!toEntry || toEntry.id === fromEntry.id) continue;
    await db.wikiLink
      .upsert({
        where: {
          fromId_toId_relation: { fromId: fromEntry.id, toId: toEntry.id, relation: "derived_from" },
        },
        update: {},
        create: { fromId: fromEntry.id, toId: toEntry.id, relation: "derived_from" },
      })
      .catch(() => {});
  }
}

// ---- checkpoint (resume-on-timeout) ----

interface WikiCheckpoint {
  lastProcessedChunkIndex: number;
  microSummaries: string[];
  totalChunks: number;
}

/** Resolve the per-document wiki progress file path. */
function getWikiProgressPath(docId: string): string {
  const root = process.env.DB_PATH || path.join(os.homedir(), "synthetix-data");
  return path.join(root, "wiki-progress", `${docId}.json`);
}

/** Read the checkpoint (returns null if none — first run). */
function readCheckpoint(filePath: string): WikiCheckpoint | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as WikiCheckpoint;
    if (typeof parsed.lastProcessedChunkIndex === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Write the checkpoint after each chunk (atomic-ish: mkdir + write). */
function writeCheckpoint(filePath: string, data: WikiCheckpoint): void {
  try {
    fsp.mkdir(path.dirname(filePath), { recursive: true }).then(() => {
      fsp.writeFile(filePath, JSON.stringify(data), "utf-8").catch(() => {});
    }).catch(() => {});
  } catch {
    // Non-blocking — checkpoint is best-effort
  }
}

/** Clear the checkpoint when all chunks are done. */
function clearCheckpoint(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* already gone */ }
}

// ---- helpers ----

/** Resolve the writing LLM client, preferring ProcessingContext's configured model. */
async function resolveWikiClient(ctx: ProcessingContext): Promise<WikiClient | null> {
  if (ctx.writingModel?.provider) {
    return {
      provider: createLLMProvider({
        apiBaseUrl: ctx.writingModel.provider.apiBaseUrl,
        apiKey: ctx.writingModel.provider.apiKey,
        providerType: ctx.writingModel.provider.providerType,
      }),
      modelId: ctx.writingModel.modelId,
      modelConfigId: ctx.writingModel.id,
      userId: ctx.doc.userId,
    };
  }
  // Fallback: resolve via capability (same as auto-tagger)
  const resolved = await resolveLLMClient("writing", ctx.doc.userId);
  if (!resolved) return null;
  return {
    provider: resolved.provider,
    modelId: resolved.modelId,
    modelConfigId: resolved.modelConfigId,
    userId: ctx.doc.userId,
  };
}

function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  // Char-based fallback: ~4 chars/token. Truncate at sentence boundary if possible.
  const charLimit = maxTokens * 4;
  if (text.length <= charLimit) return text;
  const cut = text.slice(0, charLimit);
  const lastPeriod = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return (lastPeriod > charLimit * 0.5 ? cut.slice(0, lastPeriod) : cut) + "\n[truncated]";
}

function truncateTitlesList(titles: string[], maxTokens: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const t of titles) {
    const tokens = estimateTokens(t) + 2; // +2 for "- " prefix
    if (used + tokens > maxTokens) break;
    out.push(t);
    used += tokens;
  }
  return out;
}

function chunkStringArray(arr: string[], maxChars: number): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const s of arr) {
    if (size + s.length > maxChars && current.length > 0) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(s);
    size += s.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function safeJsonParse(raw: string): Record<string, unknown> | null {
  // Without response_format enforcement, the model may wrap JSON in markdown
  // fences OR surround it with conversational text ("Here is...:\n{...}").
  // Strategy: strip code fences, then locate the outermost { ... } block.
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  // Fast path: the whole response is the JSON object.
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    // fall through to brace extraction
  }

  // Slow path: extract the first balanced { ... } substring. Handles
  // "Here is the result:\n{ \"microSummary\": ... }" and trailing prose.
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, i + 1));
          return typeof parsed === "object" && parsed !== null ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseChunkKnowledge(raw: string): ChunkKnowledge {
  const parsed = safeJsonParse(raw);
  if (!parsed) {
    throw new Error("Wiki extraction returned invalid JSON");
  }
  return {
    microSummary: typeof parsed.microSummary === "string" ? String(parsed.microSummary).slice(0, 120) : "",
    topics: (parseArray(parsed.topics).map(parseTopic).filter(Boolean) as ChunkKnowledge["topics"]).slice(0, WIKI_CONFIG.maxTopicsPerChunk),
    concepts: (parseArray(parsed.concepts).map(parseConcept).filter(Boolean) as ChunkKnowledge["concepts"]).slice(0, WIKI_CONFIG.maxConceptsPerChunk),
    claims: (parseArray(parsed.claims).map(parseClaim).filter(Boolean) as ChunkKnowledge["claims"]).slice(0, WIKI_CONFIG.maxClaimsPerChunk),
  };
}

function parseArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : [];
}

function parseTopic(o: Record<string, unknown>): ChunkKnowledge["topics"][number] | null {
  if (typeof o.title !== "string" || typeof o.content !== "string") return null;
  const title = o.title.trim();
  const content = o.content.trim();
  // Drop trivial stubs — they add noise without reference value. A real topic
  // needs a meaningful title and at least minEntryContentChars of substance.
  if (title.length < 2 || content.length < WIKI_CONFIG.minEntryContentChars) return null;
  return { title, content };
}

function parseConcept(o: Record<string, unknown>): ChunkKnowledge["concepts"][number] | null {
  if (typeof o.title !== "string" || typeof o.content !== "string") return null;
  const title = o.title.trim();
  const content = o.content.trim();
  if (title.length < 2 || content.length < WIKI_CONFIG.minEntryContentChars) return null;
  return { title, content };
}

function parseClaim(o: Record<string, unknown>): ChunkKnowledge["claims"][number] | null {
  if (typeof o.title !== "string" || typeof o.content !== "string") return null;
  const title = o.title.trim();
  const content = o.content.trim();
  if (title.length < 2 || content.length < WIKI_CONFIG.minEntryContentChars) return null;
  const confidence = typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0.7;
  return { title, content, confidence };
}

/**
 * Bounded-concurrency worker pool. Runs `fn` over `items` with at most
 * `concurrency` in flight, preserving each item's INDEX (fn receives (item, i))
 * so callers can write results into a pre-sized array in original order
 * regardless of completion order.
 *
 * Mirrors the boundedAll pattern in pipeline.ts but is index-aware and kept
 * local to avoid a cross-module coupling.
 */
async function runBounded<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      if (i >= items.length) break;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
}

/** Read a positive int from env, falling back to `fallback` when unset/invalid. */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
