import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { spawnPythonJson } from "@/lib/python";

const PYTHON_SCRIPT = path.resolve("workers/python/convert.py");

// Match the queue-layer document_convert timeout (DOCUMENT_CONVERT_TIMEOUT_MS).
// Large DOCX files (70MB+) can take 8-10 minutes to convert in Docling; the old
// 10-minute ceiling was too close to that floor and caused spurious timeouts.
const CONVERT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Bump when Docling behavior changes (e.g. code-fence export enabled) so every
// cached conversion is invalidated at once. Stored in the sidecar and compared
// on read; a mismatch forces a fresh conversion.
const CONVERSION_CACHE_VERSION = 1;
const CACHE_FILENAME = ".convert-cache.json";

export interface ConversionResult {
  markdown: string;
  structure: string;
  imageManifest: string | null;
  imageCount: number;
  format: string;
  conversionMethod: "docling";
  metadata?: {
    pageCount?: number;
    hasTables?: boolean;
    hasFigures?: boolean;
    hasStructure?: boolean;
  };
}

// Cache key: the source file's sha256 + byte size, both already written to the
// Document row at upload time. A null originalHash means the source was never
// hashed, in which case the caller must not cache (see convertDocument).
export interface ConversionCacheKey {
  originalHash: string;
  originalSize: number;
}

interface CachedPayload {
  version: number;
  originalHash: string;
  originalSize: number;
  markdown: string;
  structure: string;
  imageManifest: string | null;
  imageCount: number;
  format: string;
  metadata?: ConversionResult["metadata"];
}

function cacheFilePath(outputDir: string): string {
  return path.join(outputDir, CACHE_FILENAME);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

// Returns a cached ConversionResult iff the sidecar matches the key (same source
// hash + size), the cache version is current, AND every referenced artifact file
// still exists on disk. Any mismatch → null (caller falls back to conversion).
async function readConversionCache(
  outputDir: string,
  key: ConversionCacheKey,
): Promise<ConversionResult | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(cacheFilePath(outputDir), "utf-8");
  } catch {
    return null;
  }

  let parsed: CachedPayload;
  try {
    parsed = JSON.parse(raw) as CachedPayload;
  } catch {
    return null;
  }

  if (parsed.version !== CONVERSION_CACHE_VERSION) return null;
  if (parsed.originalHash !== key.originalHash) return null;
  if (parsed.originalSize !== key.originalSize) return null;

  const referenced = [parsed.markdown, parsed.structure, parsed.imageManifest].filter(
    Boolean,
  ) as string[];
  for (const p of referenced) {
    if (!(await fileExists(p))) return null;
  }

  return {
    markdown: parsed.markdown,
    structure: parsed.structure,
    imageManifest: parsed.imageManifest ?? null,
    imageCount: parsed.imageCount ?? 0,
    format: parsed.format ?? "docling",
    conversionMethod: "docling",
    metadata: parsed.metadata,
  };
}

// Cache writes are best-effort: a failure to persist the sidecar must never
// block a successful conversion.
async function writeConversionCache(
  outputDir: string,
  key: ConversionCacheKey,
  result: ConversionResult,
): Promise<void> {
  const payload: CachedPayload = {
    version: CONVERSION_CACHE_VERSION,
    originalHash: key.originalHash,
    originalSize: key.originalSize,
    markdown: result.markdown,
    structure: result.structure,
    imageManifest: result.imageManifest,
    imageCount: result.imageCount,
    format: result.format,
    metadata: result.metadata,
  };
  try {
    await fsp.mkdir(outputDir, { recursive: true });
    await fsp.writeFile(cacheFilePath(outputDir), JSON.stringify(payload), "utf-8");
  } catch {
    /* best-effort */
  }
}

export async function convertDocumentFile(
  inputPath: string,
  outputDir: string,
  cacheKey?: ConversionCacheKey,
): Promise<ConversionResult> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  if (cacheKey) {
    const cached = await readConversionCache(outputDir, cacheKey);
    if (cached) return cached;
  }

  const result = await spawnPythonJson<ConversionResult>(PYTHON_SCRIPT, [inputPath, outputDir], {
    timeout: CONVERT_TIMEOUT_MS,
  });

  if (cacheKey) {
    await writeConversionCache(outputDir, cacheKey, result);
  }

  return result;
}

export function convertToMarkdown(
  inputPath: string,
  outputDir: string,
  cacheKey?: ConversionCacheKey,
): Promise<string> {
  return convertDocumentFile(inputPath, outputDir, cacheKey).then((r) => r.markdown);
}
