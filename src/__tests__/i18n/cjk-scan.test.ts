import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import ts from "typescript";

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

  // Exact-purpose allowlist entries. Keep these file-scoped and narrowly justified.
  const exactExcludePaths = new Map([
    [path.join("lib", "documents", "outline", "sanitize.ts"), "input parser tokens"],
    [path.join("lib", "documents", "outline", "structure-split.ts"), "input parser tokens"],
    [path.join("lib", "llm", "retry-after.ts"), "provider protocol markers"],
    [path.join("lib", "documents", "outline", "outline-refine-prompt.ts"), "dedicated LLM prompt data"],
  ].map(([entry, reason]) => [entry.replace(/\\/g, "/"), reason]));

  // Existing files/patterns excluded from the runtime-string scan.
  const excludePatterns = [
    // Locale data files
    path.join("lib", "i18n", "locales", "zh-CN.ts"),
    path.join("lib", "i18n", "locales", "en.ts"),
    path.join("lib", "i18n", "client-errors.ts"),
    path.join("lib", "i18n", "format.ts"),
    path.join("lib", "i18n", "registry.ts"),
    // Prompt localization data
    path.join("lib", "prompts", "locales", "zh-CN-prompts.ts"),
    path.join("lib", "prompts", "skills", "index.ts"),
    path.join("lib", "wiki", "prompts.ts"),
    path.join("lib", "prompts", "builders", "audit.ts"),
    // Parser/regex files: Chinese tokens are match patterns, not UI strings
    path.join("lib", "documents", "outline", "macro-split.ts"),
    path.join("lib", "brainstorm", "outline-markdown.ts"),
    path.join("lib", "brainstorm", "length-requirement.ts"),
    path.join("lib", "writing", "diagram-translate.ts"),
    // CJK detection regexes (detect language, not display)
    path.join("lib", "writing", "generator.ts"),
    path.join("lib", "queue", "workers", "outline-worker.ts"),
    "__tests__",
    // Brainstorm prompt data
    path.join("lib", "brainstorm", "archetypes"),
    path.join("lib", "brainstorm", "outline-prompt.ts"),
    path.join("lib", "brainstorm", "summary-prompt.ts"),
    path.join("lib", "brainstorm", "messages.ts"),
    // Brainstorm trigger regexes (match user Chinese input, not UI strings)
    path.join("hooks", "brainstorm", "use-brainstorm-chat.ts"),
  ];

  function shouldExclude(filePath: string): boolean {
    if (exactExcludePaths.has(filePath)) return true;
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

  function stripComments(content: string, file: string): string {
    const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
    // TypeScript offsets are UTF-16 code-unit positions; split("") preserves that indexing.
    const chars = content.split("");
    const ranges = new Map<string, ts.CommentRange>();

    function collect(rangesToAdd: ts.CommentRange[] | undefined): void {
      for (const range of rangesToAdd ?? []) {
        ranges.set(`${range.pos}:${range.end}`, range);
      }
    }

    function visit(node: ts.Node): void {
      collect(ts.getLeadingCommentRanges(content, node.getFullStart()));
      collect(ts.getTrailingCommentRanges(content, node.getEnd()));
      if (ts.isJsxExpression(node) && node.expression == null) {
        const innerStart = node.getStart(sourceFile) + 1;
        const innerEnd = node.getEnd() - 1;
        const inner = content.slice(innerStart, innerEnd).trim();
        if (inner.startsWith("/*") && inner.endsWith("*/")) {
          ranges.set(`${innerStart}:${innerEnd}`, { pos: innerStart, end: innerEnd, kind: ts.SyntaxKind.MultiLineCommentTrivia });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    for (const range of ranges.values()) {
      for (let i = range.pos; i < range.end; i++) {
        if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
      }
    }

    return chars.join("");
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

        const content = stripComments(fs.readFileSync(file, "utf-8"), file);
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
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

    // Goal: zero unauthorized CJK hardcoded strings in runtime code.
    // All UI strings are now routed through the i18n translation object.
    // The cap stays at 0; any new hardcoded Chinese must go through i18n.
    expect(violations.length).toBe(0);
  });
});
