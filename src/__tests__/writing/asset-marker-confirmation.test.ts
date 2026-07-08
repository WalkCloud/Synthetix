/**
 * Tests for asset marker confirmation behaviour.
 *
 * These tests lock the behaviour of replaceMarkerWithAsset() in
 * marker-parser.ts, which was extracted from confirm-asset/route.ts
 * (design §4.4) to centralise marker replacement logic.
 */

import { replaceMarkerWithAsset } from "@/lib/writing/marker-parser";
import { describe, it, expect } from "vitest";

describe("asset marker replacement — request marker → confirmed marker", () => {
  it("replaces an IMAGE_REQUEST marker with an IMAGE marker", () => {
    const content = "Text [IMAGE_REQUEST:\ntype=illustration\ntitle=Photo\nid=m1\nprompt=desc\n] more";
    const result = replaceMarkerWithAsset(content, { markerId: "m1", assetId: "asset-1", assetType: "image" });
    expect(result.ok).toBe(true);
    expect((result as { content: string }).content).toContain("[IMAGE:asset-1|");
    expect((result as { content: string }).content).toContain("id=m1");
    expect((result as { content: string }).content).toContain("title=Photo");
    expect((result as { content: string }).content).not.toContain("IMAGE_REQUEST");
  });

  it("replaces a DIAGRAM_REQUEST marker with a DIAGRAM marker", () => {
    const content = "[DIAGRAM_REQUEST:\ntype=architecture\ntitle=Flow\nid=d1\npurpose=overview\n]";
    const result = replaceMarkerWithAsset(content, { markerId: "d1", assetId: "asset-2", assetType: "diagram" });
    expect(result.ok).toBe(true);
    expect((result as { content: string }).content).toContain("[DIAGRAM:asset-2|");
    expect((result as { content: string }).content).toContain("id=d1");
    expect((result as { content: string }).content).toContain("purpose=overview");
  });

  it("preserves fields other than id from the request marker", () => {
    const content = "[IMAGE_REQUEST:\nid=keep1\ntitle=My Title\ntype=photo\nsize=large\n]";
    const result = replaceMarkerWithAsset(content, { markerId: "keep1", assetId: "asset-3", assetType: "image" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result as { content: string }).content).toContain("title=My Title");
      expect((result as { content: string }).content).toContain("type=photo");
      expect((result as { content: string }).content).toContain("size=large");
    }
  });

  it("uses IMAGE tag for mermaid asset type", () => {
    const content = "[IMAGE_REQUEST:\nid=m2\n]";
    const result = replaceMarkerWithAsset(content, { markerId: "m2", assetId: "asset-4", assetType: "mermaid" });
    expect(result.ok).toBe(true);
    expect((result as { content: string }).content).toContain("[IMAGE:");
  });

  it("uses IMAGE tag for svg asset type", () => {
    const content = "[IMAGE_REQUEST:\nid=s1\n]";
    const result = replaceMarkerWithAsset(content, { markerId: "s1", assetId: "asset-5", assetType: "svg" });
    expect(result.ok).toBe(true);
    expect((result as { content: string }).content).toContain("[IMAGE:");
  });

  it("uses DIAGRAM tag for non-image asset types", () => {
    const content = "[DIAGRAM_REQUEST:\nid=d2\n]";
    const result = replaceMarkerWithAsset(content, { markerId: "d2", assetId: "asset-6", assetType: "diagram" });
    expect(result.ok).toBe(true);
    expect((result as { content: string }).content).toContain("[DIAGRAM:");
  });
});

describe("asset marker replacement — confirmed marker re-confirmation", () => {
  it("replaces an existing IMAGE marker with a new one (re-confirm)", () => {
    const content = "[IMAGE:old-asset|id=r1|title=Original|type=photo]";
    const result = replaceMarkerWithAsset(content, { markerId: "r1", assetId: "new-asset", assetType: "image" });
    expect(result.ok).toBe(true);
    expect((result as { content: string }).content).toContain("[IMAGE:new-asset|");
    expect((result as { content: string }).content).toContain("id=r1");
    expect((result as { content: string }).content).toContain("title=Original");
    expect((result as { content: string }).content).not.toContain("old-asset");
  });

  it("replaces an existing DIAGRAM marker", () => {
    const content = "Prefix [DIAGRAM:old|id=r2|title=Diagram] suffix";
    const result = replaceMarkerWithAsset(content, { markerId: "r2", assetId: "new-diagram", assetType: "diagram" });
    expect(result.ok).toBe(true);
    expect((result as { content: string }).content).toContain("[DIAGRAM:new-diagram|");
    expect((result as { content: string }).content).toContain("id=r2");
  });
});

describe("asset marker replacement — not found", () => {
  it("returns not_found when markerId does not exist", () => {
    const content = "No markers here";
    const result = replaceMarkerWithAsset(content, { markerId: "nonexistent", assetId: "asset-1", assetType: "image" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("returns not_found when marker exists but id differs", () => {
    const content = "[IMAGE_REQUEST:\nid=other\n]";
    const result = replaceMarkerWithAsset(content, { markerId: "wrong-id", assetId: "asset-1", assetType: "image" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });
});

describe("asset marker replacement — special characters in markerId", () => {
  it("handles markerId with dots safely (regex escaping)", () => {
    const content = "[IMAGE_REQUEST:\nid=marker.1.2\ntitle=Test\n]";
    const result = replaceMarkerWithAsset(content, { markerId: "marker.1.2", assetId: "asset-x", assetType: "image" });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result as { content: string }).content).toContain("id=marker.1.2");
  });
});
