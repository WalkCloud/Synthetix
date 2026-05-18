import { getAuthUser } from "@/lib/auth/session";
import { readSettings, writeSettings } from "@/lib/settings/store";
import { authErrorResponse, successResponse } from "@/lib/api-helpers";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const settings = readSettings(user.id);
  return successResponse({
    storageType: settings.storageType ?? "local",
    localPath: settings.localPath ?? process.env.DOCUMENT_ROOT ?? "./data/documents",
    cachePath: settings.cachePath ?? "./data/cache",
    s3Bucket: settings.s3Bucket ?? "",
    s3Region: settings.s3Region ?? "",
    s3Endpoint: settings.s3Endpoint ?? "",
    s3AccessKey: settings.s3AccessKey ?? "",
    s3SecretKey: settings.s3SecretKey ?? "",
    minioEndpoint: settings.minioEndpoint ?? "",
    minioBucket: settings.minioBucket ?? "",
    minioAccessKey: settings.minioAccessKey ?? "",
    quotaGB: settings.quotaGB ?? 100,
  });
}

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const body = await request.json();
  writeSettings(user.id, {
    storageType: body.storageType,
    localPath: body.localPath,
    cachePath: body.cachePath,
    s3Bucket: body.s3Bucket,
    s3Region: body.s3Region,
    s3Endpoint: body.s3Endpoint,
    s3AccessKey: body.s3AccessKey,
    s3SecretKey: body.s3SecretKey,
    minioEndpoint: body.minioEndpoint,
    minioBucket: body.minioBucket,
    minioAccessKey: body.minioAccessKey,
    quotaGB: body.quotaGB,
  });

  return successResponse({ saved: true });
}
