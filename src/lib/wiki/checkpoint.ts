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

interface CheckpointFileHandle {
  writeFile(data: string, encoding: BufferEncoding): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface WikiCheckpointFileSystem {
  mkdir(dirPath: string): Promise<void>;
  open(filePath: string, flags: string): Promise<CheckpointFileHandle>;
  rename(from: string, to: string): Promise<void>;
  rm(filePath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  syncDirectory(dirPath: string): Promise<void>;
}

const defaultFileSystem: WikiCheckpointFileSystem = {
  async mkdir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
  },
  open(filePath, flags) {
    return fs.open(filePath, flags);
  },
  rename(from, to) {
    return fs.rename(from, to);
  },
  async rm(filePath) {
    await fs.rm(filePath, { force: true });
  },
  unlink(filePath) {
    return fs.unlink(filePath);
  },
  async syncDirectory(dirPath) {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(dirPath, "r");
      await handle.sync();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "EINVAL")) return;
      throw error;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  },
};

export async function writeWikiCheckpoint(
  filePath: string,
  checkpoint: WikiCheckpointV2,
  fileSystem: WikiCheckpointFileSystem = defaultFileSystem,
): Promise<void> {
  const dirPath = path.dirname(filePath);
  await fileSystem.mkdir(dirPath);
  const tempPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  let handle: CheckpointFileHandle | undefined;
  try {
    handle = await fileSystem.open(tempPath, "wx");
    await handle.writeFile(JSON.stringify(checkpoint), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fileSystem.rename(tempPath, filePath);
    await fileSystem.syncDirectory(dirPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fileSystem.rm(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function clearWikiCheckpoint(
  filePath: string,
  fileSystem: WikiCheckpointFileSystem = defaultFileSystem,
): Promise<void> {
  try {
    await fileSystem.unlink(filePath);
    await fileSystem.syncDirectory(path.dirname(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
