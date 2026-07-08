import { describe, it, expect } from "vitest";
import {
  parseAllMarkers,
  injectMarkerIds,
  type ParsedMarker,
} from "@/lib/writing/marker-parser";

// ─── parseAllMarkers: IMAGE_REQUEST / DIAGRAM_REQUEST (request markers) ───

describe("parseAllMarkers — request markers", () => {
  it("parses an IMAGE_REQUEST with multiline fields", () => {
    const content = "Intro text\n[IMAGE_REQUEST:\ntype=illustration\ntitle=Architecture\nprompt=Draw a diagram\nid=abc1\n]\nRest";
    const markers = parseAllMarkers(content);
    expect(markers).toHaveLength(1);
    const m = markers[0];
    expect(m.kind).toBe("image");
    expect(m.markerId).toBe("abc1");
    expect(m.params.type).toBe("illustration");
    expect(m.params.title).toBe("Architecture");
    expect((m.params as { prompt: string }).prompt).toBe("Draw a diagram");
  });

  it("parses a DIAGRAM_REQUEST with multiline fields", () => {
    const content = "[DIAGRAM_REQUEST:\ntype=architecture\ntitle=System\npurpose=Overview\nnodes=API,DB\nflows=API->DB\nid=def2\n]";
    const markers = parseAllMarkers(content);
    expect(markers).toHaveLength(1);
    const m = markers[0];
    expect(m.kind).toBe("diagram");
    expect(m.markerId).toBe("def2");
    expect(m.params.type).toBe("architecture");
    expect((m.params as { purpose?: string }).purpose).toBe("Overview");
    expect((m.params as { nodes?: string }).nodes).toBe("API,DB");
    expect((m.params as { flows?: string }).flows).toBe("API->DB");
  });

  it("auto-generates a markerId when request marker has no id field", () => {
    const content = "[IMAGE_REQUEST:\ntype=illustration\ntitle=No ID\n]";
    const markers = parseAllMarkers(content);
    expect(markers).toHaveLength(1);
    expect(markers[0].markerId).toBeTruthy();
    expect(markers[0].markerId.length).toBeGreaterThanOrEqual(4);
  });

  it("uses default values when fields are missing", () => {
    const content = "[IMAGE_REQUEST:\n]";
    const markers = parseAllMarkers(content);
    expect(markers).toHaveLength(1);
    const m = markers[0];
    expect(m.params.type).toBe("illustration");
    expect(m.params.title).toBe("Illustration");
    expect((m.params as { prompt: string }).prompt).toBe("");
  });

  it("falls back to description field when prompt is absent", () => {
    const content = "[IMAGE_REQUEST:\ndescription=alt text\n]";
    const markers = parseAllMarkers(content);
    expect((markers[0].params as { prompt: string }).prompt).toBe("alt text");
  });

  it("reports correct startIndex and endIndex", () => {
    const prefix = "Some prefix text. ";
    const marker = "[IMAGE_REQUEST:\nid=x1\n]";
    const content = prefix + marker + " suffix";
    const markers = parseAllMarkers(content);
    expect(markers[0].startIndex).toBe(prefix.length);
    expect(markers[0].endIndex).toBe(prefix.length + marker.length);
    expect(content.slice(markers[0].startIndex, markers[0].endIndex)).toBe(marker);
  });

  it("parses multiple markers in the same content", () => {
    const content = [
      "[IMAGE_REQUEST:\nid=m1\ntitle=First\n]",
      "[DIAGRAM_REQUEST:\nid=m2\ntitle=Second\n]",
    ].join("\n---\n");
    const markers = parseAllMarkers(content);
    expect(markers).toHaveLength(2);
    expect(markers[0].markerId).toBe("m1");
    expect(markers[1].markerId).toBe("m2");
  });

  it("returns empty array when no markers present", () => {
    expect(parseAllMarkers("just plain text")).toEqual([]);
  });
});

// ─── parseAllMarkers: IMAGE / DIAGRAM (confirmed asset markers) ───

describe("parseAllMarkers — confirmed asset markers (pipe format)", () => {
  it("parses an IMAGE marker with pipe-delimited fields", () => {
    const content = "[IMAGE:asset-123|id=abc1|title=Photo|type=illustration|prompt=desc]";
    const markers = parseAllMarkers(content);
    expect(markers).toHaveLength(1);
    const m = markers[0];
    expect(m.kind).toBe("image");
    expect(m.markerId).toBe("abc1");
    expect(m.params.title).toBe("Photo");
  });

  it("parses a DIAGRAM marker with pipe-delimited fields", () => {
    const content = "[DIAGRAM:asset-456|id=def2|title=Flow|type=architecture]";
    const markers = parseAllMarkers(content);
    expect(markers).toHaveLength(1);
    expect(markers[0].kind).toBe("diagram");
    expect(markers[0].markerId).toBe("def2");
  });

  it("skips confirmed markers without an id field", () => {
    const content = "[IMAGE:asset-789|title=NoID]";
    const markers = parseAllMarkers(content);
    expect(markers).toHaveLength(0);
  });
});

// ─── injectMarkerIds ───

describe("injectMarkerIds", () => {
  it("injects an id into a request marker that has none", () => {
    const content = "[IMAGE_REQUEST:\ntype=illustration\ntitle=Test\n]";
    const result = injectMarkerIds(content);
    expect(result).toContain("id=");
    // The injected id should be parseable
    const markers = parseAllMarkers(result);
    expect(markers).toHaveLength(1);
    expect(markers[0].markerId).toBeTruthy();
  });

  it("does not modify a request marker that already has an id", () => {
    const content = "[IMAGE_REQUEST:\nid=existing\ntitle=Test\n]";
    const result = injectMarkerIds(content);
    expect(result).toBe(content);
  });

  it("injects ids into multiple request markers independently", () => {
    const content = [
      "[IMAGE_REQUEST:\ntitle=First\n]",
      "[DIAGRAM_REQUEST:\ntitle=Second\n]",
    ].join("\n");
    const result = injectMarkerIds(content);
    const markers = parseAllMarkers(result);
    expect(markers).toHaveLength(2);
    expect(markers[0].markerId).not.toBe(markers[1].markerId);
  });

  it("does not touch confirmed (non-request) markers", () => {
    const content = "[IMAGE:asset-1|id=keep|title=Test]";
    const result = injectMarkerIds(content);
    expect(result).toBe(content);
  });

  it("returns content unchanged when no markers present", () => {
    const content = "plain text without markers";
    expect(injectMarkerIds(content)).toBe(content);
  });

  it("preserves existing fields when injecting id into multiline marker", () => {
    const content = "[IMAGE_REQUEST:\ntype=illustration\ntitle=Test\nprompt=Draw\n]";
    const result = injectMarkerIds(content);
    const markers = parseAllMarkers(result);
    expect(markers[0].params.type).toBe("illustration");
    expect(markers[0].params.title).toBe("Test");
    expect((markers[0].params as { prompt: string }).prompt).toBe("Draw");
  });
});
