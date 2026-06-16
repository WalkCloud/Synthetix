import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/locales/en";
import zhCN from "@/lib/i18n/locales/zh-CN";

/**
 * The set of `module` strings that production code actually writes via
 * `recordTokenUsage` / `recordTokenUsageSafely`. Keep this in sync with grep:
 *
 *     grep -rn "module: \"" src/app src/lib --include='*.ts' \
 *       | grep -v "_archive" | grep -v "src/generated"
 *
 * If you add a new call site with a new module string, add it here AND add a
 * label to en.models.usage.modules and zh-CN.models.usage.modules.
 *
 * The "dashed_container" / "double_rect" strings in src/lib/writing/diagram-spec.ts
 * are mermaid node-type tags, not token-usage modules — do not include them.
 */
const PRODUCTION_MODULES = new Set([
  "brainstorm",
  "outline",
  "writing",
  "embedding",
  "comparison",
  "audit",
  "summary",
  "auto-tag",
  "mermaid",
  "search",
  "graph",
]);

function dictKeys(dict: Record<string, string>): Set<string> {
  return new Set(Object.keys(dict));
}

describe("models.usage.modules i18n dictionary", () => {
  it("zh-CN dictionary keys match the set of production module strings", () => {
    const keys = dictKeys(zhCN.models.usage.modules);
    expect(keys).toEqual(PRODUCTION_MODULES);
  });

  it("en dictionary keys match the set of production module strings", () => {
    const keys = dictKeys(en.models.usage.modules);
    expect(keys).toEqual(PRODUCTION_MODULES);
  });

  it("zh-CN and en have the same set of keys (no missing translations)", () => {
    expect(dictKeys(zhCN.models.usage.modules)).toEqual(dictKeys(en.models.usage.modules));
  });
});
