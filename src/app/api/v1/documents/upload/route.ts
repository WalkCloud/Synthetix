import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { SUPPORTED_FORMATS } from "@/types/documents";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import crypto from "crypto";
import { createReadStream, promises as fsp } from "fs";
import { pipeline } from "stream/promises";

const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || "104857600", 10);
const storage = new LocalStorageAdapter();

async function hashFileStream(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(
    createReadStream(filePath, { highWaterMark: 64 * 1024 }),
    hash,
  );
  return hash.digest("hex");
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return errorResponse({ code: "noFileProvided", message: "No file provided" }, 400);
  }

  if (file.size === 0) {
    return errorResponse({ code: "fileEmpty", message: "File is empty" }, 400);
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return errorResponse(`File exceeds ${MAX_UPLOAD_SIZE / 1048576}MB limit`, 400);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!SUPPORTED_FORMATS.includes(ext as typeof SUPPORTED_FORMATS[number])) {
    return errorResponse(`Unsupported format: .${ext}. Supported: ${SUPPORTED_FORMATS.join(", ")}`, 400);
  }

  // Create a placeholder Document row so we can stream the upload to its
  // owned directory. We compute the hash AFTER persisting to disk via a
  // streamed read, instead of synchronously hashing the in-memory buffer
  // on the Next.js event loop (which would stall the UI for big uploads).
  const doc = await db.document.create({
    data: {
      userId: user.id,
      originalName: file.name,
      originalFormat: ext,
      originalSize: file.size,
      originalHash: "",
      originalPath: "",
      status: "uploading",
    },
  });

  let filePath: string;
  try {
    filePath = await storage.saveOriginal(doc.id, file, user.id);
  } catch (err) {
    // Roll back placeholder if save itself failed.
    await db.document.delete({ where: { id: doc.id } }).catch(() => {});
    throw err;
  }

  const hash = await hashFileStream(filePath);

  const existing = await db.document.findFirst({
    where: { userId: user.id, originalHash: hash, NOT: { id: doc.id } },
  });
  if (existing) {
    // Drop the just-saved file and the placeholder row.
    await fsp.unlink(filePath).catch(() => {});
    await db.document.delete({ where: { id: doc.id } }).catch(() => {});
    return NextResponse.json(
      { success: false, error: "DUPLICATE", code: "conflict", existingId: existing.id },
      { status: 409 },
    );
  }

  const updatedDoc = await db.document.update({
    where: { id: doc.id },
    data: { originalHash: hash, originalPath: filePath, status: "pending" },
  });

  // NOTE: Processing does NOT start here. The document is persisted and left
  // in "pending" until the user clicks "Start Processing", which calls
  // /reprocess and submits the document_convert task. Uploading is a pure
  // store; the processing options are sent by the Start-Processing call.

  return successResponse({ document: updatedDoc }, 201);
}
