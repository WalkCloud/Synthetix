import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

let mockUserId: string | null = null;
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: async () => (mockUserId ? { id: mockUserId } : null),
}));

import { db } from "@/lib/db";
import { GET } from "@/app/api/v1/drafts/[id]/sections/[secId]/assets/[assetId]/serve/route";

const OWNER_ID = "test-asset-serve-owner";
const OTHER_USER_ID = "test-asset-serve-other";
const DRAFT_ID = "test-asset-serve-draft";
const SECTION_ID = "test-asset-serve-section";
const OTHER_SECTION_ID = "test-asset-serve-other-section";
const READY_ASSET_ID = "test-asset-serve-ready";
const PENDING_ASSET_ID = "test-asset-serve-pending";
const RELATIVE_PATH = `assets/sections/${SECTION_ID}/asset.bin`;
const FILE_PATH = path.join(process.cwd(), "data", RELATIVE_PATH);
const FILE_BYTES = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);

async function clearTestRows(): Promise<void> {
  await db.sectionAsset.deleteMany({
    where: { id: { in: [READY_ASSET_ID, PENDING_ASSET_ID] } },
  });
  await db.section.deleteMany({
    where: { id: { in: [SECTION_ID, OTHER_SECTION_ID] } },
  });
  await db.draft.deleteMany({ where: { id: DRAFT_ID } });
  await db.user.deleteMany({ where: { id: { in: [OWNER_ID, OTHER_USER_ID] } } });
}

async function seed(): Promise<void> {
  await clearTestRows();
  await db.user.createMany({
    data: [
      { id: OWNER_ID, username: OWNER_ID, passwordHash: "x" },
      { id: OTHER_USER_ID, username: OTHER_USER_ID, passwordHash: "x" },
    ],
  });
  await db.draft.create({
    data: { id: DRAFT_ID, userId: OWNER_ID, title: "Owned draft", outline: "[]" },
  });
  await db.section.createMany({
    data: [
      { id: SECTION_ID, draftId: DRAFT_ID, index: 0, title: "Section" },
      { id: OTHER_SECTION_ID, draftId: DRAFT_ID, index: 1, title: "Other section" },
    ],
  });
  await db.sectionAsset.createMany({
    data: [
      {
        id: READY_ASSET_ID,
        draftId: DRAFT_ID,
        sectionId: SECTION_ID,
        type: "image",
        title: "Ready asset",
        path: RELATIVE_PATH,
        mimeType: "application/octet-stream",
        status: "ready",
      },
      {
        id: PENDING_ASSET_ID,
        draftId: DRAFT_ID,
        sectionId: SECTION_ID,
        type: "image",
        title: "Pending asset",
        path: RELATIVE_PATH,
        mimeType: "application/octet-stream",
        status: "pending",
      },
    ],
  });
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, FILE_BYTES);
}

async function serveAs(
  userId: string,
  options: { sectionId?: string; assetId?: string; ifNoneMatch?: string } = {},
): Promise<Response> {
  mockUserId = userId;
  const sectionId = options.sectionId ?? SECTION_ID;
  const assetId = options.assetId ?? READY_ASSET_ID;
  const request = new Request(
    `http://t/api/v1/drafts/${DRAFT_ID}/sections/${sectionId}/assets/${assetId}/serve`,
    { headers: options.ifNoneMatch ? { "If-None-Match": options.ifNoneMatch } : undefined },
  );
  return GET(request, {
    params: Promise.resolve({ id: DRAFT_ID, secId: sectionId, assetId }),
  });
}

describe("GET section asset serve ownership", () => {
  beforeEach(async () => {
    mockUserId = null;
    await seed();
  });

  afterEach(async () => {
    mockUserId = null;
    await clearTestRows();
    await fs.rm(path.join(process.cwd(), "data", "assets", "sections", SECTION_ID), {
      recursive: true,
      force: true,
    });
  });

  it("returns 404 when an authenticated user requests another user's draft asset", async () => {
    const response = await serveAs(OTHER_USER_ID);

    expect(response.status).toBe(404);
  });

  it("serves the owner's ready asset with the original binary body and cache headers", async () => {
    const response = await serveAs(OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, must-revalidate");
    expect(response.headers.get("ETag")).toMatch(new RegExp(`^"${READY_ASSET_ID}-\\d+"$`));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(FILE_BYTES);
  });

  it("returns 304 with the existing ETag when If-None-Match matches", async () => {
    const first = await serveAs(OWNER_ID);
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();

    const response = await serveAs(OWNER_ID, { ifNoneMatch: etag! });

    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe(etag);
    expect(await response.text()).toBe("");
  });

  it("returns 404 for an asset requested through the wrong section", async () => {
    const response = await serveAs(OWNER_ID, { sectionId: OTHER_SECTION_ID });

    expect(response.status).toBe(404);
  });

  it("returns 404 for a non-ready asset", async () => {
    const response = await serveAs(OWNER_ID, { assetId: PENDING_ASSET_ID });

    expect(response.status).toBe(404);
  });
});
