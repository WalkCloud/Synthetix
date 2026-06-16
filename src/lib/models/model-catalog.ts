/**
 * LiteLLM Model Catalog Integration
 *
 * Loads the LiteLLM model_prices_and_context_window.json from the local
 * data directory.  On first run (file missing), downloads it once from
 * GitHub.  After that it's just a static file — no TTL, no runtime network.
 *
 * To update the catalog, delete the file and restart, or run:
 *   node -e "require('./src/lib/models/model-catalog').refreshCatalog()"
 */

import fs from "fs";
import path from "path";
import { resolveDataDir } from "@/lib/db-path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  key: string;
  maxInputTokens: number;
  maxOutputTokens: number | null;
  embeddingDim: number | null;
  mode: string | null;
  inputPrice: number | null;
  outputPrice: number | null;
  provider: string | null;
}

export interface LookupResult {
  entry: CatalogEntry;
  matchType: "exact";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATALOG_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _catalog: Map<string, CatalogEntry> | null = null;
let _loading: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function catalogFilePath(): string {
  return path.join(resolveDataDir(), "litellm-catalog.json");
}

function loadFromFile(filePath: string): Map<string, CatalogEntry> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const map = new Map<string, CatalogEntry>();
    for (const [key, model] of Object.entries(data)) {
      if (key === "sample_spec") continue;
      const m = model as Record<string, unknown>;
      if (!m) continue;
      const maxInput = (m["max_input_tokens"] as number) ?? (m["max_tokens"] as number) ?? 0;
      if (maxInput <= 0) continue;
      map.set(key, {
        key,
        maxInputTokens: maxInput,
        maxOutputTokens: (m["max_output_tokens"] as number) ?? null,
        embeddingDim: (m["output_vector_size"] as number) ?? null,
        mode: (m["mode"] as string) ?? null,
        inputPrice: (m["input_cost_per_token"] as number) ?? null,
        outputPrice: (m["output_cost_per_token"] as number) ?? null,
        provider: (m["litellm_provider"] as string) ?? null,
      });
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

async function downloadAndSave(filePath: string): Promise<Map<string, CatalogEntry>> {
  const resp = await fetch(CATALOG_URL, {
    headers: { "Accept": "application/json", "User-Agent": "Synthetix/1.0" },
  });
  if (!resp.ok) throw new Error(`Failed to download catalog: ${resp.status}`);

  const text = await resp.text();
  // Save raw JSON directly (no transformation) so the file is a drop-in
  // replacement for the upstream source.
  fs.writeFileSync(filePath, text, "utf-8");

  // Now parse the saved file
  const map = loadFromFile(filePath);
  if (!map) throw new Error("Catalog file saved but could not be parsed");
  return map;
}

const STALE_MS = 7 * 24 * 60 * 60 * 1000; // auto-refresh after 7 days

// ---------------------------------------------------------------------------
// Initialisation (called lazily on first lookup)
// ---------------------------------------------------------------------------

async function ensureCatalog(): Promise<void> {
  if (_catalog) return;
  if (_loading) { await _loading; return; }

  _loading = (async () => {
    const filePath = catalogFilePath();

    // 1. Try local file
    _catalog = loadFromFile(filePath);

    // 2. File missing — download (blocking, must have it)
    if (!_catalog) {
      console.log("[catalog] downloading LiteLLM catalog (~1.5 MB)...");
      try {
        _catalog = await downloadAndSave(filePath);
        console.log("[catalog] saved to", filePath);
      } catch (err) {
        console.warn("[catalog] download failed:", (err as Error).message);
        _catalog = new Map();
      }
      return;
    }

    // 3. File exists but stale — background refresh (non-blocking)
    try {
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs > STALE_MS) {
        console.log("[catalog] stale (>7d), background refresh...");
        downloadAndSave(filePath)
          .then((fresh) => { _catalog = fresh; console.log("[catalog] refreshed"); })
          .catch(() => { /* keep using stale copy */ });
      }
    } catch { /* stat failed — keep using loaded catalog */ }
  })();

  await _loading;
  _loading = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a model in the catalog by exact match only.
 * Returns null if the model is not in the catalog — never guesses.
 */
export async function lookupModel(query: string): Promise<LookupResult | null> {
  await ensureCatalog();
  if (!_catalog || _catalog.size === 0) return null;

  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q) return null;

  const entry = _catalog.get(query) ?? _catalog.get(q);
  if (entry) return { entry, matchType: "exact" };
  return null;
}

export async function lookupContextWindow(modelId: string): Promise<number> {
  const result = await lookupModel(modelId);
  return result?.entry.maxInputTokens ?? 0;
}

export async function lookupEmbeddingDim(modelId: string): Promise<number | null> {
  const result = await lookupModel(modelId);
  return result?.entry.embeddingDim ?? null;
}

export async function lookupMaxOutputTokens(modelId: string): Promise<number | null> {
  const result = await lookupModel(modelId);
  return result?.entry.maxOutputTokens ?? null;
}

/**
 * Force re-download the catalog from GitHub.
 * Useful for manual updates — just call this and restart.
 */
export async function refreshCatalog(): Promise<void> {
  const filePath = catalogFilePath();
  console.log("[catalog] refreshing from GitHub...");
  try {
    _catalog = await downloadAndSave(filePath);
    console.log("[catalog] updated successfully");
  } catch (err) {
    console.error("[catalog] refresh failed:", (err as Error).message);
    throw err;
  }
}
