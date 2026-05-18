import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const AVATAR_DIR = join(process.cwd(), "data", "avatars");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Prevent path traversal
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return NextResponse.json(
      { success: false, error: "Invalid filename" },
      { status: 400 }
    );
  }

  const filepath = join(AVATAR_DIR, filename);

  if (!existsSync(filepath)) {
    return NextResponse.json(
      { success: false, error: "Avatar not found" },
      { status: 404 }
    );
  }

  const buffer = await readFile(filepath);

  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : ext === "gif"
            ? "image/gif"
            : "application/octet-stream";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
