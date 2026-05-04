import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { SUPPORTED_FORMATS } from "@/types/documents";
import type { ApiResponse } from "@/types/api";
import crypto from "crypto";

const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || "104857600", 10);
const storage = new LocalStorageAdapter();

export async function POST(request: Request): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ success: false, error: "File is empty" }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json(
      { success: false, error: `File exceeds ${MAX_UPLOAD_SIZE / 1048576}MB limit` },
      { status: 400 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!SUPPORTED_FORMATS.includes(ext as typeof SUPPORTED_FORMATS[number])) {
    return NextResponse.json(
      { success: false, error: `Unsupported format: .${ext}. Supported: ${SUPPORTED_FORMATS.join(", ")}` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");

  const existing = await db.document.findFirst({
    where: { userId: user.id, originalHash: hash },
  });
  if (existing) {
    return NextResponse.json(
      { success: false, error: "DUPLICATE", message: "This file was already uploaded.", data: { existingId: existing.id } },
      { status: 409 }
    );
  }

  const doc = await db.document.create({
    data: {
      userId: user.id,
      originalName: file.name,
      originalFormat: ext,
      originalSize: file.size,
      originalHash: hash,
      originalPath: "",
      status: "uploading",
    },
  });

  const filePath = await storage.saveOriginal(doc.id, file, user.id);
  await db.document.update({
    where: { id: doc.id },
    data: { originalPath: filePath },
  });

  const task = await db.asyncTask.create({
    data: {
      userId: user.id,
      type: "document_convert",
      status: "pending",
      inputData: JSON.stringify({ docId: doc.id }),
    },
  });

  return NextResponse.json(
    { success: true, data: { document: doc, taskId: task.id } },
    { status: 201 }
  );
}
