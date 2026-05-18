import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const AVATAR_DIR = join(process.cwd(), "data", "avatars");
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user)
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );

  let buffer: Buffer;
  let contentType: string;

  const ct = request.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("avatar") as File | null;
    if (!file)
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    if (file.size > MAX_FILE_SIZE)
      return NextResponse.json(
        { success: false, error: "File too large (max 5MB)" },
        { status: 400 }
      );
    if (!ALLOWED_TYPES.includes(file.type))
      return NextResponse.json(
        {
          success: false,
          error: `Invalid file type: ${file.type}. Allowed: JPEG, PNG, WebP, GIF`,
        },
        { status: 400 }
      );
    buffer = Buffer.from(await file.arrayBuffer());
    contentType = file.type;
  } else {
    // Accept raw binary upload with Content-Type header
    if (!ct.startsWith("image/"))
      return NextResponse.json(
        {
          success: false,
          error:
            "Use multipart/form-data with 'avatar' field, or send raw image binary with Content-Type header",
        },
        { status: 400 }
      );
    const len = parseInt(
      request.headers.get("content-length") || "0",
      10
    );
    if (len > MAX_FILE_SIZE)
      return NextResponse.json(
        { success: false, error: "File too large (max 5MB)" },
        { status: 400 }
      );
    buffer = Buffer.from(await request.arrayBuffer());
    contentType = ct;
  }

  // Ensure avatar directory exists
  if (!existsSync(AVATAR_DIR))
    await mkdir(AVATAR_DIR, { recursive: true });

  const ext =
    contentType === "image/jpeg"
      ? "jpg"
      : contentType === "image/png"
        ? "png"
        : contentType === "image/webp"
          ? "webp"
          : contentType === "image/gif"
            ? "gif"
            : "png";
  const filename = `${user.id}_${Date.now()}.${ext}`;
  const filepath = join(AVATAR_DIR, filename);

  await writeFile(filepath, buffer);

  // Construct URL relative to server
  const avatarUrl = `/api/v1/users/avatar/${filename}`;

  await db.user.update({
    where: { id: user.id },
    data: { avatarUrl },
  });

  return NextResponse.json({
    success: true,
    data: { avatarUrl },
  });
}

// Serve avatar image
export async function GET() {
  const user = await getAuthUser();
  if (!user)
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { avatarUrl: true },
  });

  if (!dbUser?.avatarUrl)
    return NextResponse.json(
      { success: false, error: "No avatar set" },
      { status: 404 }
    );

  return NextResponse.json({
    success: true,
    data: { avatarUrl: dbUser.avatarUrl },
  });
}
