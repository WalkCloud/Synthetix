import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { convertToMarkdown } from "@/lib/documents/converter";
import { SUPPORTED_FORMATS } from "@/types/documents";
import type { ApiResponse } from "@/types/api";
import path from "path";
import fs from "fs/promises";

const TEXT_FORMATS = ["txt", "md"];

async function extractContent(file: File, userId: string, sessionId: string): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";

  // Plain text formats — read directly, no conversion needed
  if (TEXT_FORMATS.includes(ext)) {
    const text = await file.text();
    return text;
  }

  // Binary formats — use MarkItDown conversion pipeline
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
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id: sessionId } = await params;
  const session = await db.brainstormSession.findFirst({ where: { id: sessionId, userId: user.id } });
  if (!session) return NextResponse.json({ success: false, error: "Session not found" }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!SUPPORTED_FORMATS.includes(ext as typeof SUPPORTED_FORMATS[number])) {
    return NextResponse.json(
      { success: false, error: `Unsupported format: .${ext}` },
      { status: 400 }
    );
  }

  try {
    const fullText = await extractContent(file, user.id, sessionId);

    const content = fullText.length > 4000
      ? fullText.slice(0, 4000) + "\n\n...(document content truncated)"
      : fullText;

    const systemMsg = await db.message.create({
      data: {
        sessionId,
        role: "system",
        content: `User uploaded document "${file.name}", content extracted.`,
      },
    });

    const userMsg = await db.message.create({
      data: {
        sessionId,
        role: "user",
        content: `I uploaded a document "${file.name}", please help me build a document outline based on the following content:\n\n${content}`,
      },
    });

    if (session.title === "New Brainstorming Session") {
      const baseName = file.name.replace(/\.[^.]+$/, "");
      await db.brainstormSession.update({
        where: { id: sessionId },
        data: { title: baseName.length > 40 ? baseName.slice(0, 40) + "…" : baseName },
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      data: { systemMessage: systemMsg, userMessage: userMsg, fileName: file.name },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "File processing failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
