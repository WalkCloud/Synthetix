import { describe, expect, it } from "vitest";
import { computeDocumentPipeline, computeDisplayStatus } from "@/lib/documents/pipeline-stages";

type DocLike = { status: string; originalPath?: string | null; conversionMethod?: string | null };
const doc = (over: Partial<DocLike> = {}): DocLike => ({
  status: "converting",
  originalPath: "/path/x.docx",
  conversionMethod: null,
  ...over,
});
const task = (status: string, progress = 0) => ({ status, progress });

// Collect linear stage statuses by key.
const byKey = (p: ReturnType<typeof computeDocumentPipeline>) =>
  Object.fromEntries(p.stages.map((s) => [s.key, s.status])) as Record<string, string>;
// Collect branch statuses by key.
const branchKey = (p: ReturnType<typeof computeDocumentPipeline>) =>
  Object.fromEntries(p.branches.map((b) => [b.key, b.status])) as Record<string, string>;

describe("computeDocumentPipeline", () => {
  it("shows convert active (rest pending) for a fresh convert in graph mode", () => {
    // wikiEnabled defaults true, but a never-submitted wiki task is pending,
    // so the doc is still processing — only linear stages asserted here.
    const p = computeDocumentPipeline({ doc: doc(), convertTask: task("running", 5), graphMode: true });
    const k = byKey(p);
    expect(p.stages).toHaveLength(5); // linear stages only now
    expect(k.stageUpload).toBe("done");
    expect(k.stageConvert).toBe("active");
    expect(k.stageSplit).toBe("pending");
    expect(k.stageEmbed).toBe("pending");
    expect(k.stageIndex).toBe("pending");
    // Graph is a branch, not a linear stage.
    expect(branchKey(p).stageGraph).toBe("pending");
    expect(p.isProcessing).toBe(true);
    expect(p.isReady).toBe(false);
  });

  it("distinguishes convert vs split via conversionMethod", () => {
    // convert sub-step done (conversionMethod set) while the task still runs => split active
    const p = computeDocumentPipeline({
      doc: doc({ conversionMethod: "docling" }),
      convertTask: task("running", 5),
      graphMode: false,
      wikiEnabled: false,
    });
    const k = byKey(p);
    expect(k.stageConvert).toBe("done");
    expect(k.stageSplit).toBe("active");
    expect(p.stages).toHaveLength(5); // basic mode: no graph branch
    expect(p.branches).toHaveLength(0); // no graph, wiki disabled
  });

  it("splits embed vs index at the progress-70 boundary", () => {
    const base = { convertTask: task("completed", 100), graphMode: false, wikiEnabled: false };
    const embedding = computeDocumentPipeline({ ...base, doc: doc({ conversionMethod: "docling" }), embedTask: task("running", 40) });
    expect(byKey(embedding).stageEmbed).toBe("active");
    expect(byKey(embedding).stageIndex).toBe("pending");

    const indexing = computeDocumentPipeline({ ...base, doc: doc({ conversionMethod: "docling" }), embedTask: task("running", 75) });
    expect(byKey(indexing).stageEmbed).toBe("done");
    expect(byKey(indexing).stageIndex).toBe("active");
  });

  it("marks graph branch active with its live percentage during extraction", () => {
    const p = computeDocumentPipeline({
      doc: doc({ status: "indexing_graph", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("running", 45),
      graphMode: true,
      wikiEnabled: false,
    });
    expect(branchKey(p).stageGraph).toBe("active");
    expect(byKey(p).stageIndex).toBe("done");
    expect(p.branches.find((b) => b.key === "stageGraph")!.progress).toBe(45);
    expect(p.isProcessing).toBe(true);
    expect(p.isReady).toBe(false);
  });

  it("is ready only once the graph branch completes (graph mode)", () => {
    const p = computeDocumentPipeline({
      doc: doc({ status: "ready", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("completed", 100),
      graphMode: true,
      wikiEnabled: false,
    });
    expect(p.stages.every((s) => s.status === "done")).toBe(true);
    expect(p.branches.every((b) => b.status === "done")).toBe(true);
    expect(p.isReady).toBe(true);
    expect(p.isProcessing).toBe(false);
    expect(p.overallPercent).toBe(100);
  });

  it("omits the graph branch in basic mode and can still be ready", () => {
    const p = computeDocumentPipeline({
      doc: doc({ status: "ready", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphMode: false,
      wikiEnabled: false,
    });
    expect(p.stages).toHaveLength(5);
    expect(p.branches.find((b) => b.key === "stageGraph")).toBeUndefined();
    expect(p.isReady).toBe(true);
  });

  it("marks the pipeline failed when convert failed", () => {
    const p = computeDocumentPipeline({ doc: doc({ status: "failed" }), convertTask: task("failed", 0), graphMode: true });
    expect(p.isFailed).toBe(true);
    expect(p.isProcessing).toBe(false);
  });

  it("aggregate percent grows as stages complete", () => {
    const early = computeDocumentPipeline({ doc: doc(), convertTask: task("running", 5), graphMode: true, wikiEnabled: false });
    const later = computeDocumentPipeline({
      doc: doc({ status: "indexing_graph", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("running", 80),
      graphMode: true,
      wikiEnabled: false,
    });
    expect(later.overallPercent).toBeGreaterThan(early.overallPercent);
    expect(later.overallPercent).toBeGreaterThan(60);
  });

  // ---- New: branch structure + wiki progress ----

  it("forks graph and wiki into parallel branches after the linear stages", () => {
    const p = computeDocumentPipeline({
      doc: doc({ status: "indexing_graph", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("running", 40),
      wikiTask: task("running", 60),
      graphMode: true,
      wikiEnabled: true,
    });
    // Linear stages stay 5; wiki + graph are both branches (wiki first since
    // it completes faster, then the slow graph extraction).
    expect(p.stages).toHaveLength(5);
    expect(p.branches.map((b) => b.key)).toEqual(["stageWiki", "stageGraph"]);
    // Both branches can be active simultaneously (parallel), each with its own %.
    const graph = p.branches.find((b) => b.key === "stageGraph")!;
    const wiki = p.branches.find((b) => b.key === "stageWiki")!;
    expect(graph.status).toBe("active");
    expect(graph.progress).toBe(40);
    expect(wiki.status).toBe("active");
    expect(wiki.progress).toBe(60);
    expect(p.isReady).toBe(false); // neither branch done yet
  });

  it("treats branches as independent: wiki can complete before graph", () => {
    // Wiki done, graph still running — both are independent, no monotonic
    // coupling between them. Doc is NOT ready (graph pending).
    const p = computeDocumentPipeline({
      doc: doc({ status: "indexing_graph", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("running", 40),
      wikiTask: task("completed", 100),
      graphMode: true,
      wikiEnabled: true,
    });
    expect(branchKey(p).stageWiki).toBe("done");
    expect(branchKey(p).stageGraph).toBe("active");
    expect(p.isReady).toBe(false);
  });

  it("is ready only when BOTH graph and wiki branches are done", () => {
    const p = computeDocumentPipeline({
      doc: doc({ status: "ready", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("completed", 100),
      wikiTask: task("completed", 100),
      graphMode: true,
      wikiEnabled: true,
    });
    expect(p.isReady).toBe(true);
    expect(p.overallPercent).toBe(100);
  });

  it("isBasicReady once the linear chain finishes, even while graph/wiki run", () => {
    // The document is searchable now (embed + index done), but graph + wiki
    // branches are still in flight. isReady is false, but isBasicReady must be
    // true so the UI can show "Ready · enhancing" instead of generic Processing.
    const p = computeDocumentPipeline({
      doc: doc({ status: "ready", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("running", 40),
      wikiTask: task("running", 50),
      graphMode: true,
      wikiEnabled: true,
    });
    expect(p.isReady).toBe(false);
    expect(p.isBasicReady).toBe(true);
  });

  it("isBasicReady is false while the linear chain is still running", () => {
    // Embed/index not done → basic retrieval not usable yet.
    const p = computeDocumentPipeline({
      doc: doc({ conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("running", 40),
      graphMode: true,
      wikiEnabled: false,
    });
    expect(p.isBasicReady).toBe(false);
  });

  it("keeps a branch pending until the linear chain (index) completes", () => {
    // graph task is "running" but index isn't done yet → graph branch stays
    // pending (can't run before its prerequisite stage finished).
    const p = computeDocumentPipeline({
      doc: doc({ conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("running", 40), // index not done
      graphTask: task("running", 45),
      graphMode: true,
      wikiEnabled: false,
    });
    expect(branchKey(p).stageGraph).toBe("pending");
    expect(p.branches.find((b) => b.key === "stageGraph")!.progress).toBeNull();
  });

  it("renders only a wiki branch in basic mode (single branch, no fork)", () => {
    const p = computeDocumentPipeline({
      doc: doc({ status: "ready", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      wikiTask: task("running", 70),
      graphMode: false,
      wikiEnabled: true,
    });
    expect(p.branches.map((b) => b.key)).toEqual(["stageWiki"]);
    expect(branchKey(p).stageWiki).toBe("active");
    expect(p.isReady).toBe(false); // wiki still running
  });
});

describe("computeDisplayStatus (consistent list vs detail)", () => {
  const mk = (over: Parameters<typeof computeDocumentPipeline>[0]) =>
    computeDisplayStatus(computeDocumentPipeline(over), over.doc.status);

  it("returns 'enhancing' when basic retrieval ready but graph branch running (list must match detail)", () => {
    // This is the exact scenario that previously made the list show "ready"
    // while the detail pipeline showed graph "active" — they must now agree.
    const ds = mk({
      doc: doc({ status: "ready", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("running", 40),
      graphMode: true,
      wikiEnabled: true,
    });
    expect(ds).toBe("enhancing");
  });

  it("returns 'ready' only when ALL stages + branches complete", () => {
    const ds = mk({
      doc: doc({ status: "ready", conversionMethod: "docling" }),
      convertTask: task("completed", 100),
      embedTask: task("completed", 100),
      graphTask: task("completed", 100),
      wikiTask: task("completed", 100),
      graphMode: true,
      wikiEnabled: true,
    });
    expect(ds).toBe("ready");
  });

  it("returns 'processing' mid-linear-chain (convert active)", () => {
    const ds = mk({
      doc: doc({ status: "converting" }),
      convertTask: task("running", 30),
      graphMode: true,
      wikiEnabled: false,
    });
    expect(ds).toBe("processing");
  });

  it("returns 'pending' for an uploaded-but-not-started doc", () => {
    const ds = mk({ doc: doc({ status: "pending" }), graphMode: false, wikiEnabled: false });
    expect(ds).toBe("pending");
  });

  it("returns 'failed' when a required stage failed", () => {
    const ds = mk({
      doc: doc({ status: "failed" }),
      convertTask: task("failed", 0),
      graphMode: true,
      wikiEnabled: false,
    });
    expect(ds).toBe("failed");
  });
});
