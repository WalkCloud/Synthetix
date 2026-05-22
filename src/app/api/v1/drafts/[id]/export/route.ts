import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { getAssetFilePath } from "@/lib/writing/diagram-generator";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import {
  authErrorResponse,
  errorResponse,
} from "@/lib/api-helpers";

export const runtime = "nodejs";

const EXPORT_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/export.py");
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";
const TMP_DIR = path.resolve("data/tmp");
const CONFIRMED_SECTION_STATUSES = ["locked", "summarized"];
const ASSET_MARKER_RE = /\[(DIAGRAM|IMAGE):([a-f0-9-]+)\]/g;

type ExportFormat = "markdown" | "pdf" | "docx";

interface ExportAsset {
  id: string;
  sectionId: string;
  title: string;
  path: string | null;
  mimeType: string | null;
}

function sanitizeFilename(title: string): string {
  const sanitized = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return sanitized || "document";
}

function contentDisposition(filename: string, ext: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, "") || "document";
  const encoded = encodeURIComponent(`${filename}.${ext}`);
  return `attachment; filename="${fallback}.${ext}"; filename*=UTF-8''${encoded}`;
}

function normalizeFormat(format: unknown): ExportFormat | null {
  if (format === "md" || format === "markdown" || format === undefined || format === null) {
    return "markdown";
  }
  if (format === "doc" || format === "docs" || format === "docx") {
    return "docx";
  }
  if (format === "pdf") {
    return "pdf";
  }
  return null;
}

function parseOutlineNumber(section: { constraints: string | null }): string | null {
  if (!section.constraints) return null;
  try {
    const parsed = JSON.parse(section.constraints) as { outlineNumber?: unknown };
    return typeof parsed.outlineNumber === "string" && parsed.outlineNumber.trim()
      ? parsed.outlineNumber.trim()
      : null;
  } catch {
    return null;
  }
}

function buildSectionDepths(
  sections: Array<{ id: string; parentId: string | null }>,
): Map<string, number> {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const cache = new Map<string, number>();

  function depthOf(sectionId: string): number {
    const cached = cache.get(sectionId);
    if (cached !== undefined) return cached;

    const section = byId.get(sectionId);
    if (!section?.parentId) {
      cache.set(sectionId, 0);
      return 0;
    }

    const depth = depthOf(section.parentId) + 1;
    cache.set(sectionId, depth);
    return depth;
  }

  for (const section of sections) {
    depthOf(section.id);
  }

  return cache;
}

function assetMarkdown(asset: ExportAsset, draftId: string, inline: boolean): string | null {
  if (!asset.path) return null;
  const alt = asset.title ? `Figure: ${asset.title}` : "Figure";
  const src = inline
    ? `asset://${asset.id}`
    : `/api/v1/drafts/${draftId}/sections/${asset.sectionId}/assets/${asset.id}/serve`;
  return `![${alt}](${src})`;
}

function replaceAssetMarkers(
  content: string,
  assetsById: Map<string, ExportAsset>,
  draftId: string,
  inlineAssets: boolean,
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

async function buildMarkdown(
  draftId: string,
  userId: string,
  options: { inlineAssets: boolean },
): Promise<string> {
  const draft = await db.draft.findFirst({
    where: { id: draftId, userId },
  });
  if (!draft) throw new Error("Draft not found");

  const sections = await db.section.findMany({
    where: {
      draftId,
      status: { in: CONFIRMED_SECTION_STATUSES },
    },
    orderBy: { index: "asc" },
  });

  if (sections.length === 0) {
    throw new Error("No confirmed sections available to export");
  }

  const sectionIds = sections.map((s) => s.id);
  const assets = await db.sectionAsset.findMany({
    where: {
      draftId,
      sectionId: { in: sectionIds },
      status: "ready",
    },
    orderBy: { createdAt: "asc" },
  });

  const assetsBySection = new Map<string, typeof assets>();
  const assetsById = new Map<string, ExportAsset>();
  for (const asset of assets) {
    const list = assetsBySection.get(asset.sectionId) || [];
    list.push(asset);
    assetsBySection.set(asset.sectionId, list);
    assetsById.set(asset.id, asset);
  }

  const depths = buildSectionDepths(sections);
  const titleHeader = `# ${draft.title}\n\n`;
  const sectionParts = sections.map((section) => {
    const depth = depths.get(section.id) ?? 0;
    const headingLevel = Math.min(6, depth + 2);
    const headingPrefix = "#".repeat(headingLevel);
    const outlineNumber = parseOutlineNumber(section);
    const headingTitle = outlineNumber
      ? `${outlineNumber}. ${section.title.replace(/^\d+(\.\d+)*\.?\s*/, "")}`
      : section.title;
    const rawContent = stripLeadingSectionTitle(section.content ?? "", section.title);
    const markerResult = replaceAssetMarkers(
      rawContent,
      assetsById,
      draftId,
      options.inlineAssets,
    );

    let content = `${headingPrefix} ${headingTitle}\n\n${markerResult.content}`;

    const sectionAssets = assetsBySection.get(section.id);
    if (sectionAssets && sectionAssets.length > 0) {
      const imageParts = sectionAssets
        .filter((a) => a.path && !markerResult.referencedAssetIds.has(a.id))
        .map((a) => {
          const markdown = assetMarkdown(a, draftId, options.inlineAssets);
          return markdown ? `\n\n${markdown}` : "";
        })
        .filter(Boolean);
      content += imageParts.join("");
    }

    return content + "\n\n";
  });
  return titleHeader + sectionParts.join("");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId } = await params;
  const body = await request.json().catch(() => ({}));
  const format = normalizeFormat(body.format);

  if (!format) {
    return errorResponse(`Unsupported format: ${String(body.format)}`, 400);
  }

  try {
    const markdown = await buildMarkdown(draftId, user.id, { inlineAssets: false });

    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
      select: { title: true },
    });
    const filename = sanitizeFilename(draft?.title || "document");

    if (format === "markdown") {
      return new Response(markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": contentDisposition(filename, "md"),
        },
      });
    }

    const inlinedMarkdown = await buildMarkdown(draftId, user.id, { inlineAssets: true });
    const exportMarkdown = await inlineAssetImages(inlinedMarkdown);

    if (!fs.existsSync(TMP_DIR)) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }

    const exportId = `${draftId}-${randomUUID()}`;
    const tmpMd = path.join(TMP_DIR, `export-${exportId}.md`);
    const tmpHtml = path.join(TMP_DIR, `export-${exportId}.html`);
    const tmpPdf = path.join(TMP_DIR, `export-${exportId}.pdf`);
    const tmpDocx = path.join(TMP_DIR, `export-${exportId}.docx`);

    fs.writeFileSync(tmpMd, exportMarkdown, "utf-8");

    if (format === "pdf") {
      await runExport(tmpMd, tmpHtml, "pdf");

      if (!fs.existsSync(tmpHtml)) {
        return errorResponse("PDF generation failed — ensure 'pip install markdown' is run");
      }

      await renderPdfWithPlaywright(tmpHtml, tmpPdf);

      if (!fs.existsSync(tmpPdf)) {
        return errorResponse("PDF generation failed — ensure Playwright Chromium is installed");
      }

      const pdfContent = fs.readFileSync(tmpPdf);
      cleanupFiles(tmpMd, tmpHtml, tmpPdf);

      return new Response(pdfContent, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": contentDisposition(filename, "pdf"),
        },
      });
    }

    if (format === "docx") {
      await runExport(tmpMd, tmpDocx, "docx");

      if (!fs.existsSync(tmpDocx)) {
        return errorResponse("DOCX generation failed — ensure 'pip install python-docx' is run");
      }

      const docxContent = fs.readFileSync(tmpDocx);
      cleanupFiles(tmpMd, tmpDocx);

      return new Response(docxContent, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": contentDisposition(filename, "docx"),
        },
      });
    }

    return errorResponse(`Unsupported format: ${format}`, 400);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

function runExport(input: string, output: string, format: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_PATH, [
      EXPORT_SCRIPT,
      "--input", input,
      "--output", output,
      "--format", format,
    ], { stdio: "pipe", timeout: 60_000 });

    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code: number | null) => {
      code === 0 ? resolve() : reject(new Error(stderr || `Export failed with code ${code}`));
    });
    proc.on("error", (err: Error) => reject(err));
  });
}

async function inlineAssetImages(markdown: string): Promise<string> {
  const imgRe = /!\[([^\]]*)\]\((asset:\/\/[a-f0-9-]+|[^)]*\/assets\/[^)]*\/serve)\)/g;
  const matches = [...markdown.matchAll(imgRe)];

  if (matches.length === 0) return markdown;

  let result = markdown;
  for (const match of matches) {
    const alt = match[1];
    const url = match[2];

    const assetIdMatch = url.match(/^asset:\/\/([a-f0-9-]+)$/) ?? url.match(/\/assets\/([^/]+)\/serve/);
    if (!assetIdMatch) continue;

    const assetId = assetIdMatch[1];
    const asset = await db.sectionAsset.findUnique({ where: { id: assetId } });
    if (!asset || !asset.path || asset.status !== "ready") continue;

    try {
      const filePath = getAssetFilePath(asset.path);

      const fileContent = fs.readFileSync(filePath);
      const mimeType = asset.mimeType
        || (asset.path.endsWith(".svg") ? "image/svg+xml"
          : asset.path.endsWith(".jpg") || asset.path.endsWith(".jpeg") ? "image/jpeg"
            : asset.path.endsWith(".webp") ? "image/webp"
              : "image/png");
      const dataUri = `data:${mimeType};base64,${fileContent.toString("base64")}`;
      result = result.replace(match[0], `![${alt}](${dataUri})`);
    } catch {
      result = result.replace(match[0], `*${alt} unavailable*`);
    }
  }

  return result;
}

async function renderPdfWithPlaywright(htmlPath: string, outputPath: string): Promise<void> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Playwright is not installed. Run: pnpm install");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).toString(), {
      waitUntil: "networkidle",
    });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: {
        top: "20mm",
        right: "22mm",
        bottom: "20mm",
        left: "22mm",
      },
    });
  } finally {
    await browser.close();
  }
}

function cleanupFiles(...files: string[]) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  }
}
