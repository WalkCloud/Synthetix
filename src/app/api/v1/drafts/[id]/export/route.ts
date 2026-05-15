import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getAssetFilePath } from "@/lib/writing/diagram-generator";
import type { ApiResponse } from "@/types/api";

const EXPORT_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/export.py");
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";
const TMP_DIR = path.resolve("data/tmp");

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

function sanitizeFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

async function buildMarkdown(draftId: string, userId: string): Promise<string> {
  const draft = await db.draft.findFirst({
    where: { id: draftId, userId },
  });
  if (!draft) throw new Error("Draft not found");

  const sections = await db.section.findMany({
    where: {
      draftId,
      status: { in: ["locked", "summarized"] },
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
  for (const asset of assets) {
    const list = assetsBySection.get(asset.sectionId) || [];
    list.push(asset);
    assetsBySection.set(asset.sectionId, list);
  }

  const titleHeader = `# ${draft.title}\n\n`;
  const sectionParts = sections.map((section) => {
    let content = `## ${section.title}\n\n${section.content ?? ""}`;

    const sectionAssets = assetsBySection.get(section.id);
    if (sectionAssets && sectionAssets.length > 0) {
      const imageParts = sectionAssets
        .filter((a) => a.path)
        .map((a) => `\n\n![图：${a.title}](/api/v1/drafts/${draftId}/sections/${a.sectionId}/assets/${a.id}/serve)`);
      content += imageParts.join("");
    }

    return content + "\n\n";
  });
  return titleHeader + sectionParts.join("");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse> | Response> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id: draftId } = await params;
  const body = await request.json().catch(() => ({}));
  const format = body.format || "markdown";

  try {
    const markdown = await buildMarkdown(draftId, user.id);

    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
      select: { title: true },
    });
    const filename = sanitizeFilename(draft?.title || "document");

    if (format === "markdown") {
      return new Response(markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}.md"`,
        },
      });
    }

    const svgInlinedMarkdown = await inlineSvgImages(markdown);

    // Write temp markdown for Python converter
    if (!fs.existsSync(TMP_DIR)) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }
    const tmpMd = path.join(TMP_DIR, `export-${draftId}.md`);
    fs.writeFileSync(tmpMd, svgInlinedMarkdown, "utf-8");

    if (format === "pdf") {
      const tmpPdf = path.join(TMP_DIR, `export-${draftId}.html`);
      await runExport(tmpMd, tmpPdf, "pdf");

      if (!fs.existsSync(tmpPdf)) {
        return NextResponse.json(
          { success: false, error: "PDF generation failed — ensure 'pip install markdown' is run" },
          { status: 500 },
        );
      }

      const pdfContent = fs.readFileSync(tmpPdf, "utf-8");
      // Clean up temp files
      fs.unlinkSync(tmpMd);
      // Keep HTML for download (user opens in browser and prints to PDF)

      return new Response(pdfContent, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}.html"`,
        },
      });
    }

    if (format === "docx") {
      const tmpDocx = path.join(TMP_DIR, `export-${draftId}.docx`);
      await runExport(tmpMd, tmpDocx, "docx");

      if (!fs.existsSync(tmpDocx)) {
        return NextResponse.json(
          { success: false, error: "DOCX generation failed — ensure 'pip install python-docx' is run" },
          { status: 500 },
        );
      }

      const docxContent = fs.readFileSync(tmpDocx);
      fs.unlinkSync(tmpMd);
      fs.unlinkSync(tmpDocx);

      return new Response(docxContent, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${filename}.docx"`,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: `Unsupported format: ${format}` },
      { status: 400 },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 },
    );
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

async function inlineSvgImages(markdown: string): Promise<string> {
  const imgRe = /!\[([^\]]*)\]\(([^)]*\/assets\/[^)]*\/serve)\)/g;
  const matches = [...markdown.matchAll(imgRe)];

  if (matches.length === 0) return markdown;

  let result = markdown;
  for (const match of matches) {
    const alt = match[1];
    const url = match[2];

    const assetIdMatch = url.match(/\/assets\/([^/]+)\/serve/);
    if (!assetIdMatch) continue;

    const assetId = assetIdMatch[1];
    const asset = await db.sectionAsset.findUnique({ where: { id: assetId } });
    if (!asset || !asset.path || asset.status !== "ready") continue;

    try {
      const filePath = getAssetFilePath(asset.path);
      const svgContent = fs.readFileSync(filePath, "utf-8");
      const base64 = Buffer.from(svgContent).toString("base64");
      const dataUri = `data:image/svg+xml;base64,${base64}`;
      result = result.replace(match[0], `![${alt}](${dataUri})`);
    } catch {
      result = result.replace(match[0], `*${alt}（图片待生成）*`);
    }
  }

  return result;
}
