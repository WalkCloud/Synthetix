/**
 * Application metadata — single read point for About dialog and legal pages.
 *
 * Static identity (name/version/license) comes from src/generated/app-version.ts
 * (git-tracked, always present after the first `npm run generate:meta`).
 *
 * Dynamic provenance (buildTime/commit) lives in public/build-info.json
 * (git-ignored) and is fetched at runtime by client components via
 * {@link fetchBuildInfo}. When the JSON is absent (clean checkout / dev without
 * running generate:meta), it falls back to { buildTime: null, commit: "dev" }.
 */
import { appVersion } from "@/generated/app-version";

export { appVersion };

export type BuildInfo = {
  buildTime: string | null;
  commit: string;
};

/** Dev fallback when build-info.json has not been generated. */
export const BUILD_INFO_FALLBACK: BuildInfo = {
  buildTime: null,
  commit: "dev",
};

/**
 * Fetch dynamic build info from /build-info.json at runtime.
 * Returns the dev fallback if the file is missing or the request fails.
 * Safe to call from client components ("use client").
 */
export async function fetchBuildInfo(): Promise<BuildInfo> {
  try {
    const res = await fetch("/build-info.json", { cache: "no-store" });
    if (!res.ok) return BUILD_INFO_FALLBACK;
    const data = (await res.json()) as Partial<BuildInfo>;
    return {
      buildTime: typeof data.buildTime === "string" ? data.buildTime : null,
      commit: typeof data.commit === "string" ? data.commit : "dev",
    };
  } catch {
    return BUILD_INFO_FALLBACK;
  }
}
