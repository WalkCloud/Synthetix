import { describe, it, expect } from "vitest";
import en from "@/lib/i18n/locales/en";
import zhCN from "@/lib/i18n/locales/zh-CN";

/**
 * Recursively collect all leaf-key paths from a nested object.
 * e.g. { common: { actions: { save: "..." } } } → ["common.actions.save"]
 */
function collectPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...collectPaths(value as Record<string, unknown>, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

describe("i18n locale parity", () => {
  it("en and zh-CN have identical key structures", () => {
    const enPaths = collectPaths(en as unknown as Record<string, unknown>).sort();
    const zhCNPaths = collectPaths(zhCN as unknown as Record<string, unknown>).sort();

    expect(enPaths).toEqual(zhCNPaths);
  });

  it("en has no empty string values", () => {
    const paths = collectPaths(en as unknown as Record<string, unknown>);
    const emptyKeys = paths.filter((path) => {
      const value = path.split(".").reduce<unknown>((obj, key) => (obj as Record<string, unknown>)?.[key], en);
      return value === "";
    });
    expect(emptyKeys).toEqual([]);
  });

  it("zh-CN has no empty string values", () => {
    const paths = collectPaths(zhCN as unknown as Record<string, unknown>);
    const emptyKeys = paths.filter((path) => {
      const value = path
        .split(".")
        .reduce<unknown>((obj, key) => (obj as Record<string, unknown>)?.[key], zhCN);
      return value === "";
    });
    expect(emptyKeys).toEqual([]);
  });
});
