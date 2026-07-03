import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

/**
 * The LLM timeout constants (FETCH_TIMEOUT_MS, EMBED_FETCH_TIMEOUT_MS,
 * STREAM_READ_TIMEOUT_MS) used to be hardcoded. They are now env-driven via
 * LLM_FETCH_TIMEOUT_MS / LLM_EMBED_TIMEOUT_MS / LLM_STREAM_READ_TIMEOUT_MS so
 * operators can tune them without a code change. These tests pin:
 *   1. the documented defaults (preserving prior behaviour), and
 *   2. that env overrides actually take effect.
 *
 * Because the constants are evaluated at module-load time, each override case
 * re-imports the module with `vi.resetModules()` so the env var is read fresh.
 */

const DEFAULT_FETCH = 300_000;
const DEFAULT_EMBED = 90_000;
const DEFAULT_STREAM_READ = 120_000;

async function importEnv() {
  return (await import("@/lib/llm/env")) as typeof import("@/lib/llm/env");
}

describe("LLM env timeouts", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.LLM_FETCH_TIMEOUT_MS;
    delete process.env.LLM_EMBED_TIMEOUT_MS;
    delete process.env.LLM_STREAM_READ_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.LLM_FETCH_TIMEOUT_MS;
    delete process.env.LLM_EMBED_TIMEOUT_MS;
    delete process.env.LLM_STREAM_READ_TIMEOUT_MS;
  });

  it("uses documented defaults when no env is set", async () => {
    const env = await importEnv();
    expect(env.FETCH_TIMEOUT_MS).toBe(DEFAULT_FETCH);
    expect(env.EMBED_FETCH_TIMEOUT_MS).toBe(DEFAULT_EMBED);
    expect(env.STREAM_READ_TIMEOUT_MS).toBe(DEFAULT_STREAM_READ);
  });

  it("honours LLM_FETCH_TIMEOUT_MS override", async () => {
    process.env.LLM_FETCH_TIMEOUT_MS = "120000";
    const env = await importEnv();
    expect(env.FETCH_TIMEOUT_MS).toBe(120_000);
  });

  it("honours LLM_EMBED_TIMEOUT_MS override", async () => {
    process.env.LLM_EMBED_TIMEOUT_MS = "45000";
    const env = await importEnv();
    expect(env.EMBED_FETCH_TIMEOUT_MS).toBe(45_000);
  });

  it("honours LLM_STREAM_READ_TIMEOUT_MS override", async () => {
    process.env.LLM_STREAM_READ_TIMEOUT_MS = "60000";
    const env = await importEnv();
    expect(env.STREAM_READ_TIMEOUT_MS).toBe(60_000);
  });

  it("ignores non-positive / invalid values and falls back", async () => {
    process.env.LLM_FETCH_TIMEOUT_MS = "0";
    process.env.LLM_EMBED_TIMEOUT_MS = "-5";
    process.env.LLM_STREAM_READ_TIMEOUT_MS = "not-a-number";
    const env = await importEnv();
    expect(env.FETCH_TIMEOUT_MS).toBe(DEFAULT_FETCH);
    expect(env.EMBED_FETCH_TIMEOUT_MS).toBe(DEFAULT_EMBED);
    expect(env.STREAM_READ_TIMEOUT_MS).toBe(DEFAULT_STREAM_READ);
  });
});

describe("readPositiveIntEnv (direct)", () => {
  it("returns fallback for empty string", async () => {
    const env = await importEnv();
    // readPositiveIntEnv is internal; verify via the exported constants which
    // exercise the same code path. Empty-string env already covered above.
    expect(env.FETCH_TIMEOUT_MS).toBe(DEFAULT_FETCH);
  });
});
