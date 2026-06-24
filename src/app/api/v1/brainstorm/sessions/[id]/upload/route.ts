import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { convertToMarkdown } from "@/lib/documents/converter";
import { SUPPORTED_FORMATS, BRAINSTORM_MAX_UPLOAD_BYTES, BRAINSTORM_MAX_CONTENT_CHARS } from "@/types/documents";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { resolveLocale } from "@/lib/i18n/server";
import { getBrainstormMessages, isDefaultBrainstormTitle, resolveBrainstormLocale } from "@/lib/brainstorm/messages";
import path from "path";
import fs from "fs/promises";

const TEXT_FORMATS = ["txt", "md"];

async function extractContent(file: File, userId: string, sessionId: string): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";

  if (TEXT_FORMATS.includes(ext)) {
    const text = await file.text();
    return text;
  }

  const tmpDir = path.join("data", "tmp", userId, sessionId);
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `upload.${ext}`);
  await fs.writeFile(tmpPath, Buffer.from(await file.arrayBuffer()));

  try {
    await convertToMarkdown(tmpPath, tmpDir);
    const mdPath = path.join(tmpDir, "full.md");
    return await fs.readFile(mdPath, "utf-8");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: sessionId } = await params;
  const session = await db.brainstormSession.findFirst({ where: { id: sessionId, userId: user.id } });
  if (!session) return errorResponse({ code: "notFound", message: "Session not found" }, 404);
  const locale = resolveBrainstormLocale(request.headers.get("x-locale")) ?? await resolveLocale();
  const messages = getBrainstormMessages(locale);

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return errorResponse({ code: "noFileProvided", message: "No file provided" }, 400);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!SUPPORTED_FORMATS.includes(ext as typeof SUPPORTED_FORMATS[number])) {
    return errorResponse({ code: "unsupportedFormat", message: `Unsupported format: .${ext}` }, 400);
  }

  if (file.size > BRAINSTORM_MAX_UPLOAD_BYTES) {
    return errorResponse({ code: "fileTooLarge", message: `File exceeds ${BRAINSTORM_MAX_UPLOAD_BYTES / 1024 / 1024}MB limit` }, 400);
  }

  try {
    const fullText = await extractContent(file, user.id, sessionId);

    const content = fullText.length > BRAINSTORM_MAX_CONTENT_CHARS
      ? fullText.slice(0, BRAINSTORM_MAX_CONTENT_CHARS) + "\n\n...(document content truncated)"
      : fullText;

    const systemMsg = await db.message.create({
      data: {
        sessionId,
        role: "system",
        content: messages.uploadSystem(file.name),
      },
    });

    const userMsg = await db.message.create({
      data: {
        sessionId,
        role: "user",
        content: messages.uploadUser(file.name, content),
      },
    });

    if (isDefaultBrainstormTitle(session.title)) {
      const baseName = file.name.replace(/\.[^.]+$/, "");
      await db.brainstormSession.update({
        where: { id: sessionId },
        data: { title: baseName.length > 40 ? baseName.slice(0, 40) + "…" : baseName },
      }).catch(() => {});
    }

    return successResponse({ systemMessage: systemMsg, userMessage: userMsg, fileName: file.name });
  } catch (err) {
    return errorResponse(err);
  }
}
