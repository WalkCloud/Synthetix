import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

const AVATAR_DIR = join(process.cwd(), "data", "avatars");
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  let buffer: Buffer;
  let contentType: string;

  const ct = request.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("avatar") as File | null;
    if (!file)
      return errorResponse({ code: "noFileProvided", message: "No file provided" }, 400);
    if (file.size > MAX_FILE_SIZE)
      return errorResponse({ code: "invalidInput", message: "File too large (max 5MB)" }, 400);
    if (!ALLOWED_TYPES.includes(file.type))
      return errorResponse(`Invalid file type: ${file.type}. Allowed: JPEG, PNG, WebP, GIF`, 400);
    buffer = Buffer.from(await file.arrayBuffer());
    contentType = file.type;
  } else {
    if (!ct.startsWith("image/"))
      return errorResponse(
        "Use multipart/form-data with 'avatar' field, or send raw image binary with Content-Type header",
        400,
      );
    const len = parseInt(
      request.headers.get("content-length") || "0",
      10,
    );
    if (len > MAX_FILE_SIZE)
      return errorResponse({ code: "invalidInput", message: "File too large (max 5MB)" }, 400);
    buffer = Buffer.from(await request.arrayBuffer());
    contentType = ct;
  }

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

  const avatarUrl = `/api/v1/users/avatar/${filename}`;

  await db.user.update({
    where: { id: user.id },
    data: { avatarUrl },
  });

  return successResponse({ avatarUrl });
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { avatarUrl: true },
  });

  if (!dbUser?.avatarUrl)
    return errorResponse({ code: "notFound", message: "No avatar set" }, 404);

  return successResponse({ avatarUrl: dbUser.avatarUrl });
}
