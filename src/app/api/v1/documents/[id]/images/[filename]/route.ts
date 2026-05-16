import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { LocalStorageAdapter } from "@/lib/documents/storage";

const storage = new LocalStorageAdapter();

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id, filename } = await params;

  // Validate document ownership
  const doc = await db.document.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!doc) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Read image from storage
  const imageBuffer = storage.readImage(id, user.id, filename);
  if (!imageBuffer) {
    return new NextResponse("Image not found", { status: 404 });
  }

  // Determine MIME type from extension
  const ext = filename.split(".").pop()?.toLowerCase() || "png";
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new NextResponse(new Uint8Array(imageBuffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
