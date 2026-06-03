import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse } from "@/lib/api-helpers";
import {
  sanitizeFilename, contentDisposition, normalizeFormat,
  buildMarkdown, inlineAssetImages, runExport,
  renderPdfWithPlaywright, cleanupFiles, getTmpDir,
} from "@/lib/writing/export-pipeline";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId } = await params;
  const body = await request.json().catch(() => ({}));
  const format = normalizeFormat(body.format);
  if (!format) return errorResponse(`Unsupported format: ${String(body.format)}`, 400);

  try {
    const markdown = await buildMarkdown(draftId, user.id, { inlineAssets: false });
    const draft = await db.draft.findFirst({ where: { id: draftId, userId: user.id }, select: { title: true } });
    const filename = sanitizeFilename(draft?.title || "document");

    if (format === "markdown") {
      return new Response(markdown, {
        headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": contentDisposition(filename, "md") },
      });
    }

    const TMP_DIR = getTmpDir();
    const inlinedMarkdown = await buildMarkdown(draftId, user.id, { inlineAssets: true });
    const exportMarkdown = await inlineAssetImages(inlinedMarkdown);

    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

    const exportId = `${draftId}-${randomUUID()}`;
    const tmpMd = path.join(TMP_DIR, `export-${exportId}.md`);
    const tmpHtml = path.join(TMP_DIR, `export-${exportId}.html`);
    const tmpPdf = path.join(TMP_DIR, `export-${exportId}.pdf`);
    const tmpDocx = path.join(TMP_DIR, `export-${exportId}.docx`);

    fs.writeFileSync(tmpMd, exportMarkdown, "utf-8");

    if (format === "pdf") {
      await runExport(tmpMd, tmpHtml, "pdf");
      if (!fs.existsSync(tmpHtml)) return errorResponse({ code: "exportFailed", message: "PDF generation failed — ensure 'pip install markdown' is run" });
      await renderPdfWithPlaywright(tmpHtml, tmpPdf);
      if (!fs.existsSync(tmpPdf)) return errorResponse({ code: "exportFailed", message: "PDF generation failed — ensure Playwright Chromium is installed" });
      const pdfContent = fs.readFileSync(tmpPdf);
      cleanupFiles(tmpMd, tmpHtml, tmpPdf);
      return new Response(pdfContent, {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDisposition(filename, "pdf") },
      });
    }

    if (format === "docx") {
      await runExport(tmpMd, tmpDocx, "docx");
      if (!fs.existsSync(tmpDocx)) return errorResponse({ code: "exportFailed", message: "DOCX generation failed — ensure 'pip install python-docx' is run" });
      const docxContent = fs.readFileSync(tmpDocx);
      cleanupFiles(tmpMd, tmpDocx);
      return new Response(docxContent, {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": contentDisposition(filename, "docx") },
      });
    }

    return errorResponse(`Unsupported format: ${format}`, 400);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
