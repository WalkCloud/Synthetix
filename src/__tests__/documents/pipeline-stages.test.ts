import { describe, expect, it } from "vitest";
import { computeDocumentPipeline } from "@/lib/documents/pipeline-stages";

type DocLike = { status: string; originalPath?: string | null; conversionMethod?: string | null };
const doc = (over: Partial<DocLike> = {}): DocLike => ({
  status: "converting",
  originalPath: "/path/x.docx",
  conversionMethod: null,
  ...over,
});
const task = (status: string, progress = 0) => ({ status, progress });
const byKey = (p: ReturnType<typeof computeDocumentPipeline>) =>
  Object.fromEntries(p.stages.map((s) => [s.key, s.status])) as Record<string, string>;

describe("computeDocumentPipeline", () => {
  it("shows convert active (rest pending) for a fresh convert in graph mode (6 dots)", () => {
    const p = computeDocumentPipeline({ doc: doc(), convertTask: task("running", 5), graphMode: true });
    const k = byKey(p);
    expect(p.stages).toHaveLength(6);
    expect(k.stageUpload).toBe("done");
    expect(k.stageConvert).toBe("active");
    expect(k.stageSplit).toBe("pending");
    expect(k.stageEmbed).toBe("pending");
    expect(k.stageIndex).toBe("pending");
    expect(k.stageGraph).toBe("pending");
    expect(p.isProcessing).toBe(true);
    expect(p.isReady).toBe(false);
  });

  it("distinguishes convert vs split via conversionMethod", () => {
    // convert sub-step done (conversionMethod set) while the task still runs => split active
    const p = computeDocumentPipeline({
      doc: doc({ conversionMethod: "docling" }),
      convertTask: task("running", 5),
      graphMode: false,
    });
    const k = byKey(p);
    expect(k.stageConvert).toBe("done");
    expect(k.stageSplit).toBe("active");
    expect(p.stages).toHaveLength(5); // basic mode: no graph dot
  });

  it("splits embed vs index at the progress-70 boundary", () => {
    const base = { convertTask: task("completed", 100), graphMode: false };
    const embedding = computeDocumentPipeline({ ...base, doc: doc({ conversionMethod: "docling" }), embedTask: task("running", 40) });
    expect(byKey(embedding).stageEmbed).toBe("active");
    expect(byKey(embedding).stageIndex).toBe("pending");

    const indexing = computeDocumentPipeline({ ...base, doc: doc({ conversionMethod: "docling" }), embedTask: task("running", 75) });
    expect(byKey(indexing).stageEmbed).toBe("done");
    expect(byKey(indexing).stageIndex).toBe("active");
  });

  it("marks graph active with its live percentage during extraction", () => {
    const p = computeDocumentPipeline({
      doc: doc({ status: "indexing_graph", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("running", 45),
      graphMode: true,
    });
    expect(byKey(p).stageGraph).toBe("active");
    expect(byKey(p).stageIndex).toBe("done");
    expect(p.stages.find((s) => s.key === "stageGraph")!.progress).toBe(45);
    expect(p.isProcessing).toBe(true);
    expect(p.isReady).toBe(false);
  });

  it("is ready only once the graph stage completes (graph mode)", () => {
    const p = computeDocumentPipeline({
      doc: doc({ status: "ready", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("completed", 100),
      graphMode: true,
    });
    expect(p.stages.every((s) => s.status === "done")).toBe(true);
    expect(p.isReady).toBe(true);
    expect(p.isProcessing).toBe(false);
    expect(p.overallPercent).toBe(100);
  });

  it("omits the graph dot in basic mode and can still be ready", () => {
    const p = computeDocumentPipeline({
      doc: doc({ status: "ready", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphMode: false,
    });
    expect(p.stages).toHaveLength(5);
    expect(p.stages.find((s) => s.key === "stageGraph")).toBeUndefined();
    expect(p.isReady).toBe(true);
  });

  it("marks the pipeline failed when convert failed", () => {
    const p = computeDocumentPipeline({ doc: doc({ status: "failed" }), convertTask: task("failed", 0), graphMode: true });
    expect(p.isFailed).toBe(true);
    expect(p.isProcessing).toBe(false);
  });

  it("aggregate percent grows as stages complete", () => {
    const early = computeDocumentPipeline({ doc: doc(), convertTask: task("running", 5), graphMode: true });
    const later = computeDocumentPipeline({
      doc: doc({ status: "indexing_graph", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("running", 80),
      graphMode: true,
    });
    expect(later.overallPercent).toBeGreaterThan(early.overallPercent);
    expect(later.overallPercent).toBeGreaterThan(80);
  });
});
