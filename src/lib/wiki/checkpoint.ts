import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SynthChunk } from "@/lib/wiki/synthesizer";

export const WIKI_CHECKPOINT_VERSION = 2 as const;
export const WIKI_ALGORITHM_VERSION = "wiki-synthesis-v2";

export type WikiInputUnitType = "segment" | "chunk";

export interface CompletedWikiUnit {
  id: string;
  index: number;
  microSummary: string;
}

export interface WikiCheckpointV2 {
  version: typeof WIKI_CHECKPOINT_VERSION;
  algorithmVersion: string;
  inputHash: string;
  completedUnits: CompletedWikiUnit[];
  failedUnitIds: string[];
  completedPrefix: number;
  updatedAt: string;
}

export function getWikiCheckpointPath(docId: string): string {
  const root = process.env.DB_PATH || path.join(os.homedir(), "synthetix-data");
  return path.join(root, "wiki-progress", `${docId}.json`);
}

export function orderWikiInputUnits(units: readonly SynthChunk[]): SynthChunk[] {
  const ordered = [...units].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  const ids = new Set<string>();
  for (const unit of ordered) {
    if (!unit.id || ids.has(unit.id)) throw new Error(`Invalid or duplicate Wiki input unit id: ${unit.id}`);
    ids.add(unit.id);
  }
  return ordered;
}

export function computeWikiInputHash(inputUnitType: WikiInputUnitType, units: readonly SynthChunk[]): string {
  const ordered = orderWikiInputUnits(units);
  return crypto.createHash("sha256").update(JSON.stringify({
    inputUnitType,
    units: ordered.map(({ id, index, content }) => ({ id, index, content })),
  })).digest("hex");
}

export function computeCompletedPrefix(
  orderedUnits: readonly SynthChunk[],
  completedUnits: readonly CompletedWikiUnit[],
): number {
  const completedIds = new Set(completedUnits.map((unit) => unit.id));
  let prefix = 0;
  for (const unit of orderedUnits) {
    if (!completedIds.has(unit.id)) break;
    prefix += 1;
  }
  return prefix;
}

export async function readWikiCheckpoint(
  filePath: string,
  inputHash: string,
  orderedUnits: readonly SynthChunk[],
): Promise<WikiCheckpointV2 | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Partial<WikiCheckpointV2>;
  if (value.version !== WIKI_CHECKPOINT_VERSION
    || value.algorithmVersion !== WIKI_ALGORITHM_VERSION
    || value.inputHash !== inputHash
    || !Array.isArray(value.completedUnits)
    || !Array.isArray(value.failedUnitIds)
    || typeof value.completedPrefix !== "number"
    || typeof value.updatedAt !== "string") {
    return null;
  }

  const inputIds = new Set(orderedUnits.map((unit) => unit.id));
  const completedIds = new Set<string>();
  for (const unit of value.completedUnits) {
    if (!unit || typeof unit.id !== "string" || typeof unit.index !== "number" || typeof unit.microSummary !== "string") return null;
    if (!inputIds.has(unit.id) || completedIds.has(unit.id)) return null;
    completedIds.add(unit.id);
  }
  const failedIds = new Set<string>();
  for (const id of value.failedUnitIds) {
    if (typeof id !== "string" || !inputIds.has(id) || completedIds.has(id) || failedIds.has(id)) return null;
    failedIds.add(id);
  }
  if (computeCompletedPrefix(orderedUnits, value.completedUnits) !== value.completedPrefix) return null;
  return value as WikiCheckpointV2;
}

export async function writeWikiCheckpoint(filePath: string, checkpoint: WikiCheckpointV2): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(checkpoint), "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function clearWikiCheckpoint(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
