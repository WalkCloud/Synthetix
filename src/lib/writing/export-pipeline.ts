import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { spawn } from "child_process";
import { db } from "@/lib/db";
import { getAssetFilePath } from "@/lib/writing/diagram-generator";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import { CONFIRMED_SECTION_STATUSES } from "@/types/writing";

const EXPORT_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/export.py");
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";
const TMP_DIR = path.resolve("data/tmp");
const ASSET_MARKER_RE = /\[(DIAGRAM|IMAGE):([a-f0-9-]+)\]/g;

export type ExportFormat = "markdown" | "pdf" | "docx";

export function sanitizeFilename(title: string): string {
  const sanitized = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
  return sanitized || "document";
}

export function contentDisposition(filename: string, ext: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, "") || "document";
  const encoded = encodeURIComponent(`${filename}.${ext}`);
  return `attachment; filename="${fallback}.${ext}"; filename*=UTF-8''${encoded}`;
}

export function normalizeFormat(format: unknown): ExportFormat | null {
  if (format === "md" || format === "markdown" || format === undefined || format === null) return "markdown";
  if (format === "doc" || format === "docs" || format === "docx") return "docx";
  if (format === "pdf") return "pdf";
  return null;
}

function parseOutlineNumber(section: { constraints: string | null }): string | null {
  if (!section.constraints) return null;
  try {
    const parsed = JSON.parse(section.constraints) as { outlineNumber?: unknown };
    return typeof parsed.outlineNumber === "string" && parsed.outlineNumber.trim() ? parsed.outlineNumber.trim() : null;
  } catch { return null; }
}

function buildSectionDepths(sections: Array<{ id: string; parentId: string | null }>): Map<string, number> {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const cache = new Map<string, number>();
  function depthOf(id: string): number {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const s = byId.get(id);
    if (!s?.parentId) { cache.set(id, 0); return 0; }
    const d = depthOf(s.parentId) + 1;
    cache.set(id, d);
    return d;
  }
  for (const s of sections) depthOf(s.id);
  return cache;
}

function assetMarkdown(asset: { id: string; sectionId: string; title: string; path: string | null }, draftId: string, inline: boolean): string | null {
  if (!asset.path) return null;
  const alt = asset.title ? `Figure: ${asset.title}` : "Figure";
  const src = inline ? `asset://${asset.id}` : `/api/v1/drafts/${draftId}/sections/${asset.sectionId}/assets/${asset.id}/serve`;
  return `![${alt}](${src})`;
}

function replaceAssetMarkers(
  content: string, assetsById: Map<string, { id: string; sectionId: string; title: string; path: string | null }>,
  draftId: string, inlineAssets: boolean,
): { content: string; referencedAssetIds: Set<string> } {
  const referencedAssetIds = new Set<string>();
  const replaced = content.replace(ASSET_MARKER_RE, (marker, _type, assetId: string) => {
    const asset = assetsById.get(assetId);
    if (!asset) return marker;
    referencedAssetIds.add(assetId);
    return assetMarkdown(asset, draftId, inlineAssets) ?? `*${asset.title || "Image"} unavailable*`;
  });
  return { content: replaced, referencedAssetIds };
}

export async function buildMarkdown(draftId: string, userId: string, options: { inlineAssets: boolean }): Promise<string> {
  const draft = await db.draft.findFirst({ where: { id: draftId, userId } });
  if (!draft) throw new Error("Draft not found");

  const sections = await db.section.findMany({
    where: { draftId, status: { in: CONFIRMED_SECTION_STATUSES } },
    orderBy: { index: "asc" },
  });
  if (sections.length === 0) throw new Error("No confirmed sections available to export");

  const assets = await db.sectionAsset.findMany({
    where: { draftId, sectionId: { in: sections.map((s) => s.id) }, status: "ready" },
    orderBy: { createdAt: "asc" },
  });

  const assetsBySection = new Map<string, typeof assets>();
  const assetsById = new Map<string, { id: string; sectionId: string; title: string; path: string | null }>();
  for (const a of assets) {
    const list = assetsBySection.get(a.sectionId) || [];
    list.push(a); assetsBySection.set(a.sectionId, list);
    assetsById.set(a.id, a);
  }

  const depths = buildSectionDepths(sections);
  const titleHeader = `# ${draft.title}\n\n`;
  const sectionParts = sections.map((section) => {
    const depth = depths.get(section.id) ?? 0;
    const headingLevel = Math.min(6, depth + 2);
    const headingPrefix = "#".repeat(headingLevel);
    const outlineNumber = parseOutlineNumber(section);
    const headingTitle = outlineNumber ? `${outlineNumber}. ${section.title.replace(/^\d+(\.\d+)*\.?\s*/, "")}` : section.title;
    const rawContent = stripLeadingSectionTitle(section.content ?? "", section.title);
    const markerResult = replaceAssetMarkers(rawContent, assetsById, draftId, options.inlineAssets);
    let content = `${headingPrefix} ${headingTitle}\n\n${markerResult.content}`;
    const sectionAssets = assetsBySection.get(section.id);
    if (sectionAssets && sectionAssets.length > 0) {
      const imageParts = sectionAssets
        .filter((a) => a.path && !markerResult.referencedAssetIds.has(a.id))
        .map((a) => assetMarkdown(a, draftId, options.inlineAssets))
        .filter(Boolean) as string[];
      content += imageParts.map((m) => `\n\n${m}`).join("");
    }
    return content + "\n\n";
  });
  return titleHeader + sectionParts.join("");
}

export async function inlineAssetImages(markdown: string): Promise<string> {
  const imgRe = /!\[([^\]]*)\]\((asset:\/\/[a-f0-9-]+|[^)]*\/assets\/[^)]*\/serve)\)/g;
  const matches = [...markdown.matchAll(imgRe)];
  if (matches.length === 0) return markdown;

  let result = markdown;
  for (const match of matches) {
    const alt = match[1];
    const url = match[2];
    const assetIdMatch = url.match(/^asset:\/\/([a-f0-9-]+)$/) ?? url.match(/\/assets\/([^/]+)\/serve/);
    if (!assetIdMatch) continue;
    const asset = await db.sectionAsset.findUnique({ where: { id: assetIdMatch[1] } });
    if (!asset || !asset.path || asset.status !== "ready") continue;
    try {
      const filePath = getAssetFilePath(asset.path);
      const fileContent = fs.readFileSync(filePath);
      const mimeType = asset.mimeType
        || (asset.path.endsWith(".svg") ? "image/svg+xml"
          : asset.path.endsWith(".jpg") || asset.path.endsWith(".jpeg") ? "image/jpeg"
            : asset.path.endsWith(".webp") ? "image/webp" : "image/png");
      result = result.replace(match[0], `![${alt}](data:${mimeType};base64,${fileContent.toString("base64")})`);
    } catch {
      result = result.replace(match[0], `*${alt} unavailable*`);
    }
  }
  return result;
}

export function runExport(input: string, output: string, format: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_PATH, [EXPORT_SCRIPT, "--input", input, "--output", output, "--format", format], { stdio: "pipe", timeout: 60_000 });
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code: number | null) => { code === 0 ? resolve() : reject(new Error(stderr || `Export failed with code ${code}`)); });
    proc.on("error", (err: Error) => reject(err));
  });
}

export async function renderPdfWithPlaywright(htmlPath: string, outputPath: string): Promise<void> {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { throw new Error("Playwright is not installed. Run: pnpm install"); }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "networkidle" });
    await page.pdf({ path: outputPath, format: "A4", printBackground: true, margin: { top: "20mm", right: "22mm", bottom: "20mm", left: "22mm" } });
  } finally { await browser.close(); }
}

export function cleanupFiles(...files: string[]) {
  for (const file of files) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
}

export function getTmpDir(): string { return TMP_DIR; }
