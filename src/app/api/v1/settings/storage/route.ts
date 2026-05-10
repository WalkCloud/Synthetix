import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { readSettings, writeSettings } from "@/lib/settings/store";
import type { ApiResponse } from "@/types/api";

export async function GET(): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const settings = readSettings(user.id);
  return NextResponse.json({
    success: true,
    data: {
      storageType: settings.storageType ?? "local",
      localPath: settings.localPath ?? process.env.DOCUMENT_ROOT ?? "./data/documents",
      s3Bucket: settings.s3Bucket ?? "",
      s3Region: settings.s3Region ?? "",
      s3Endpoint: settings.s3Endpoint ?? "",
      s3AccessKey: settings.s3AccessKey ?? "",
      minioEndpoint: settings.minioEndpoint ?? "",
      minioBucket: settings.minioBucket ?? "",
      minioAccessKey: settings.minioAccessKey ?? "",
      quotaGB: settings.quotaGB ?? 100,
    },
  });
}

export async function PUT(request: Request): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  writeSettings(user.id, {
    storageType: body.storageType,
    localPath: body.localPath,
    s3Bucket: body.s3Bucket,
    s3Region: body.s3Region,
    s3Endpoint: body.s3Endpoint,
    s3AccessKey: body.s3AccessKey,
    minioEndpoint: body.minioEndpoint,
    minioBucket: body.minioBucket,
    minioAccessKey: body.minioAccessKey,
    quotaGB: body.quotaGB,
  });

  return NextResponse.json({ success: true, data: { saved: true } });
}
