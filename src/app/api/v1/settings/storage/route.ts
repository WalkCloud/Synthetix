import { getAuthUser } from "@/lib/auth/session";
import { readSettings, writeSettings } from "@/lib/settings/store";
import { authErrorResponse, successResponse } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const ASSETS_DIR = path.join(DATA_DIR, "assets", "sections");
const RAG_DIR = path.join(DATA_DIR, "rag");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const SETTINGS_DIR = path.join(DATA_DIR, "settings");

async function getDirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        total += await getDirSize(full);
      } else {
        try {
          const stat = await fs.stat(full);
          total += stat.size;
        } catch {
          // skip files that can't be stat'd
        }
      }
    }
  } catch {
    // directory doesn't exist or can't be read
  }
  return total;
}

function getDiskInfo(): { diskFreeBytes: number; diskTotalBytes: number } {
  try {
    const stat = fsSync.statfsSync(DATA_DIR);
    const bsize = stat.bsize || 4096;
    return {
      diskFreeBytes: (stat.bavail || stat.bfree || 0) * bsize,
      diskTotalBytes: (stat.blocks || 0) * bsize,
    };
  } catch {
    return { diskFreeBytes: 0, diskTotalBytes: 0 };
  }
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const settings = readSettings(user.id);
  const dataRoot = settings.localPath || process.env.DOCUMENT_ROOT || "./data/documents";
  const dataRootAbs = path.isAbsolute(dataRoot) ? dataRoot : path.join(process.cwd(), dataRoot);

  let documentsBytes = 0;
  try {
    const agg = await db.document.aggregate({
      _sum: { originalSize: true, markdownSize: true },
    });
    documentsBytes = (agg._sum.originalSize || 0) + (agg._sum.markdownSize || 0);
  } catch {
    // db not ready
  }

  const documentsDirBytes = await getDirSize(dataRootAbs);
  const assetsBytes = await getDirSize(ASSETS_DIR);
  const indexBytes = await getDirSize(RAG_DIR);
  const tmpSettingsBytes = (await getDirSize(TMP_DIR)) + (await getDirSize(SETTINGS_DIR));
  const otherBytes = Math.max(0, documentsDirBytes - documentsBytes) + tmpSettingsBytes;

  const totalDataBytes = documentsDirBytes + assetsBytes + indexBytes + tmpSettingsBytes;
  const { diskFreeBytes, diskTotalBytes } = getDiskInfo();

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
    usage: {
      documentsBytes,
      assetsBytes,
      indexBytes,
      otherBytes,
      totalDataBytes,
      diskFreeBytes,
      diskTotalBytes,
    },
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
