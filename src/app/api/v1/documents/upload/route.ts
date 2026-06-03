import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { SUPPORTED_FORMATS } from "@/types/documents";
import { getQueue } from "@/lib/queue";
import type { ProcessingOptions } from "@/lib/queue/types";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import crypto from "crypto";

const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || "104857600", 10);
const storage = new LocalStorageAdapter();

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

  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");

  const existing = await db.document.findFirst({
    where: { userId: user.id, originalHash: hash },
  });
  if (existing) {
    return errorResponse({ code: "conflict", message: "DUPLICATE" }, 409);
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

  const options: ProcessingOptions = {
    llmModelId: (formData.get("llmModelId") as string) || undefined,
    embedModelId: (formData.get("embedModelId") as string) || undefined,
    contextUsage: formData.get("contextUsage") ? parseInt(formData.get("contextUsage") as string) : undefined,
    splitStrategy: (formData.get("splitStrategy") as ProcessingOptions["splitStrategy"]) || undefined,
    indexTarget: (formData.get("indexTarget") as ProcessingOptions["indexTarget"]) || undefined,
    indexMode: (formData.get("indexMode") as ProcessingOptions["indexMode"]) || undefined,
    autoSplit: formData.get("autoSplit") ? (formData.get("autoSplit") as string) === "true" : undefined,
  };

  const queue = getQueue();
  const taskId = await queue.submit("document_convert", { docId: doc.id, options }, user.id);

  return successResponse({ document: doc, taskId }, 201);
}
