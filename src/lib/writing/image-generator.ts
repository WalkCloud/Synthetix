import path from "node:path";
import fs from "node:fs/promises";
import { db } from "@/lib/db";
import { createLLMProvider } from "@/lib/llm/factory";
import { resolveModel } from "@/lib/llm/resolve-model";
import { parseCapabilities } from "@/lib/llm/capabilities";
import { decrypt } from "@/lib/crypto";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "sections");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export interface ImageGenerationResult {
  success: boolean;
  path?: string;
  error?: string;
}

interface ImageRequest {
  prompt: string;
  title: string;
  sectionId: string;
  draftId: string;
}

function parseImageRequest(rawPrompt: string): ImageRequest | null {
  const fields: Record<string, string> = {};
  for (const line of rawPrompt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      fields[key] = val;
    }
  }

  const prompt = fields.prompt || fields.description || "";
  if (!prompt) return null;

  return {
    prompt,
    title: fields.title || "illustration",
    sectionId: fields.sectionId || "",
    draftId: fields.draftId || "",
  };
}

async function generateImageViaApi(
  prompt: string,
  providerBaseUrl: string,
  providerApiKey: string | null,
  model: string
): Promise<Buffer | null> {
  const baseUrl = providerBaseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const url = `${baseUrl}/v1/images/generations`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (providerApiKey) {
    headers["Authorization"] = `Bearer ${decrypt(providerApiKey)}`;
  }

  const body = JSON.stringify({
    model,
    prompt,
    n: 1,
    size: "1024x1024",
    response_format: "b64_json",
  });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Image generation failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    data: Array<{ b64_json?: string; url?: string }>;
  };

  const result = data.data?.[0];
  if (!result) return null;

  if (result.b64_json) {
    return Buffer.from(result.b64_json, "base64");
  }

  if (result.url) {
    const imgResp = await fetch(result.url);
    if (!imgResp.ok) throw new Error("Failed to download generated image");
    return Buffer.from(await imgResp.arrayBuffer());
  }

  return null;
}

export async function generateImageAsset(assetId: string): Promise<ImageGenerationResult> {
  const asset = await db.sectionAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    return { success: false, error: "Asset not found" };
  }

  if (asset.type !== "image") {
    return { success: false, error: `Unsupported asset type: ${asset.type}` };
  }

  await db.sectionAsset.update({
    where: { id: assetId },
    data: { status: "generating" },
  });

  try {
    const request = parseImageRequest(asset.prompt || "");
    if (!request) {
      throw new Error("Invalid image request: missing prompt");
    }

    let imageModel = await resolveModel("image_generation");
    if (!imageModel?.provider) {
      imageModel = await resolveModel("writing");
    }
    if (!imageModel?.provider) {
      throw new Error("No model provider configured for image generation. Please configure one in Model Management → Image Generation.");
    }

    const provider = imageModel.provider;
    const configuredModelId = imageModel.modelId;

    const isImageCapable = parseCapabilities(imageModel.capabilities).includes("image_generation");

    let imageBuffer: Buffer | null = null;

    if (isImageCapable) {
      imageBuffer = await generateImageViaApi(
        request.prompt,
        provider.apiBaseUrl,
        provider.apiKey,
        configuredModelId
      );
    }

    if (!imageBuffer) {
      const fallbackCandidates = ["dall-e-3", "gpt-image-2", "flux-1", "wanx-v3"];
      for (const candidateModel of fallbackCandidates) {
        try {
          imageBuffer = await generateImageViaApi(
            request.prompt,
            provider.apiBaseUrl,
            provider.apiKey,
            candidateModel
          );
          if (imageBuffer) break;
        } catch (err) {
          console.warn(`Image fallback model ${candidateModel} failed:`, err);
          continue;
        }
      }
    }

    if (!imageBuffer) {
      throw new Error("Image generation returned no data from any model");
    }

    const sectionDir = path.join(ASSETS_DIR, asset.sectionId);
    await ensureDir(sectionDir);

    const sanitizedTitle = request.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40);
    const filename = `image-${sanitizedTitle}.png`;
    const filePath = path.join(sectionDir, filename);

    await fs.writeFile(filePath, imageBuffer);

    const relativePath = `assets/sections/${asset.sectionId}/${filename}`;

    await db.sectionAsset.update({
      where: { id: assetId },
      data: {
        path: relativePath,
        mimeType: "image/png",
        status: "ready",
        metadata: JSON.stringify({
          ...(asset.metadata ? JSON.parse(asset.metadata) : {}),
          prompt: request.prompt,
          generatedAt: new Date().toISOString(),
        }),
      },
    });

    return { success: true, path: relativePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db.sectionAsset.update({
      where: { id: assetId },
      data: {
        status: "failed",
        metadata: JSON.stringify({
          ...(asset.metadata ? JSON.parse(asset.metadata) : {}),
          error: message,
          failedAt: new Date().toISOString(),
        }),
      },
    });
    return { success: false, error: message };
  }
}

export async function generateAllPendingImages(
  draftId: string,
  sectionId: string
): Promise<{ total: number; succeeded: number; failed: number }> {
  const assets = await db.sectionAsset.findMany({
    where: { draftId, sectionId, status: "pending", type: "image" },
  });

  let succeeded = 0;
  let failed = 0;

  for (const asset of assets) {
    const result = await generateImageAsset(asset.id);
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return { total: assets.length, succeeded, failed };
}
