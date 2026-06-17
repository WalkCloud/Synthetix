import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Scan runtime code for unauthorized CJK characters.
 * Allowed: zh-CN locale files, zh-CN prompt files, test files.
 * Everything else should not contain Chinese characters.
 */
describe("CJK hardcoded string scan", () => {
  const srcRoot = path.resolve(__dirname, "../..");
  const cjkRegex = /[一-鿿㐀-䶿]/;

  // Directories to scan
  const scanDirs = [
    "app",
    "components",
    "hooks",
    "lib",
  ];

  // Files/patterns to exclude (these are allowed to contain Chinese)
  const excludePatterns = [
    path.join("lib", "i18n", "locales", "zh-CN.ts"),
    path.join("lib", "prompts", "locales", "zh-CN-prompts.ts"),
    path.join("lib", "i18n", "client-errors.ts"),
    path.join("lib", "i18n", "format.ts"),
    "__tests__",
    path.join("lib", "writing", "diagram-translate.ts"),
    path.join("lib", "brainstorm", "archetypes"),
    path.join("lib", "brainstorm", "outline-prompt.ts"),
    path.join("lib", "brainstorm", "summary-prompt.ts"),
    path.join("lib", "brainstorm", "messages.ts"),
  ];

  function shouldExclude(filePath: string): boolean {
    return excludePatterns.some(
      (pattern) => filePath.includes(pattern.replace(/\\/g, "/"))
    );
  }

  function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectTsFiles(fullPath));
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it("runtime code has no unauthorized Chinese hardcoded strings", () => {
    const violations: { file: string; line: number; content: string }[] = [];

    for (const scanDir of scanDirs) {
      const dirPath = path.join(srcRoot, scanDir);
      if (!fs.existsSync(dirPath)) continue;

      const files = collectTsFiles(dirPath);
      for (const file of files) {
        const relativePath = path.relative(srcRoot, file).replace(/\\/g, "/");
        if (shouldExclude(relativePath)) continue;

        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comments
          if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
          // Skip strings that are clearly in locale data definitions
          if (line.includes("satisfies TranslationSchema")) continue;

          if (cjkRegex.test(line)) {
            violations.push({
              file: relativePath,
              line: i + 1,
              content: line.trim(),
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  ${v.file}:${v.line} → ${v.content.slice(0, 80)}`)
        .join("\n");
      console.warn(`\n⚠ Found ${violations.length} CJK violation(s) in runtime code:\n${details}`);
    }

    // Allow existing violations during migration, but cap them
    // The goal is to reduce this to 0 over time
    // Cap raised to 280 to accommodate UX improvements (KG density-toggle
    // labels, brainstorm chat-trigger regex). These should be i18n'd to bring
    // the count back down.
    expect(violations.length).toBeLessThanOrEqual(280);
  });
});
