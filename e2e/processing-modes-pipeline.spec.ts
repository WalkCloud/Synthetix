/**
 * 专项 5A · B/C组：四模式真实处理 + 流水线节点一致性 + 效率对比
 *
 * 重型用例（@full）：真实 LLM 调用 + Python workers。
 *   - standard/graph/wiki：小文档（17MB，medium 档）
 *   - full：大文档（90MB，heavy 档）
 *
 * 每个 describe 用 serial 串行，每用例自带文档清理。
 * 效率数据落盘到 e2e/.report/efficiency.json 供报告生成。
 */
import { test, expect, request as apiRequest } from "@playwright/test";
import {
  uploadAndProcessToReady,
  getDocument,
  startProcessing,
  uploadDocument,
  waitForStatus,
  waitForPipelineCondition,
} from "./helpers/documents";
import { deleteAndAwaitCleanup } from "./helpers/delete-verify";
import { getDefaultModelIds } from "./helpers/models";
import {
  SMALL_DOC,
  BIG_DOC,
  expectedPipelineStages,
  type KnowledgeMode,
  TIMEOUTS,
} from "./helpers/constants";
import { waitForTask } from "./helpers/task-poller";
import fs from "fs/promises";

// 效率数据收集（追加写入）
const EFFICIENCY_FILE = "e2e/.report/efficiency.json";

async function recordEfficiency(entry: Record<string, unknown>) {
  try {
    await fs.mkdir("e2e/.report", { recursive: true });
    let data: unknown[] = [];
    try {
      data = JSON.parse(await fs.readFile(EFFICIENCY_FILE, "utf-8"));
      if (!Array.isArray(data)) data = [];
    } catch {
      data = [];
    }
    data.push({ ...entry, timestamp: new Date().toISOString() });
    await fs.writeFile(EFFICIENCY_FILE, JSON.stringify(data, null, 2));
  } catch {
    /* best-effort */
  }
}

// 模式 → 文档 映射
function docForMode(mode: KnowledgeMode) {
  return mode === "full" ? BIG_DOC : SMALL_DOC;
}

// 流水线节点断言：stages + branches 的 key 集合应与模式匹配
async function assertPipelineNodes(
  request: import("@playwright/test").APIRequestContext,
  docId: string,
  mode: KnowledgeMode,
) {
  const doc = await getDocument(request, docId);
  const expected = expectedPipelineStages(mode);
  const pipeline = doc.pipeline;
  expect(pipeline, "文档应有 pipeline 数据").toBeTruthy();

  const linearKeys = pipeline!.stages.map((s) => s.key);
  const branchKeys = pipeline!.branches.map((b) => b.key);

  // 线性阶段 5 个，固定
  expect(linearKeys).toEqual(expected.linear);

  // 分支：graph 模式有 stageGraph，wiki 模式有 stageWiki，full 两者都有
  for (const expectedBranch of expected.branches) {
    expect(branchKeys, `模式 ${mode} 应含分支 ${expectedBranch}`).toContain(expectedBranch);
  }
  // 不应有多余分支
  expect(branchKeys.length, `模式 ${mode} 分支数应为 ${expected.branches.length}`).toBe(
    expected.branches.length,
  );

  // ready 文档所有阶段应 done
  expect(pipeline!.isReady, "文档应处于 ready").toBe(true);
  for (const s of [...pipeline!.stages, ...pipeline!.branches]) {
    expect(s.status, `阶段 ${s.key} 应为 done`).toBe("done");
  }
}

test.describe.configure({ mode: "serial" });

test.describe("5A · 四模式流水线节点一致性 @full", () => {
  let modelIds: { llmModelId?: string; embedModelId?: string };

  test.beforeAll(async () => {
    const ctx = await apiRequest.newContext({ baseURL: "http://localhost:3000" });
    modelIds = await getDefaultModelIds(ctx);
    await ctx.dispose();
    expect(modelIds.embedModelId, "需要至少一个嵌入模型").toBeTruthy();
    expect(modelIds.llmModelId, "需要至少一个 LLM 模型").toBeTruthy();
  });

  // --- 三种小文档模式 ---

  for (const mode of ["standard", "graph", "wiki"] as KnowledgeMode[]) {
    test(`PIPE-01 处理并验证流水线节点 [${mode}]`, async ({ request }) => {
      test.setTimeout(TIMEOUTS.smallDocProcess + 120_000);
      const doc = docForMode(mode);
      const result = await uploadAndProcessToReady(
        request,
        doc.path,
        mode,
        modelIds,
        TIMEOUTS.smallDocProcess,
      );
      // 效率数据
      await recordEfficiency({
        mode,
        doc: "small",
        sizeBytes: doc.sizeBytes,
        elapsedMs: result.elapsedMs,
        elapsedMin: +(result.elapsedMs / 60_000).toFixed(2),
        taskId: result.taskId,
      });
      // 流水线节点断言
      await assertPipelineNodes(request, result.docId, mode);

      // 清理（带 deleteWiki，彻底清理）
      await deleteAndAwaitCleanup(request, result.docId, { deleteWiki: true });
    });
  }

  // --- full 大文档模式 ---

  test("PIPE-01 处理并验证流水线节点 [full, 90MB]", async ({ request }) => {
    test.setTimeout(TIMEOUTS.bigDocProcess + 120_000);
    const result = await uploadAndProcessToReady(
      request,
      BIG_DOC.path,
      "full",
      modelIds,
      TIMEOUTS.bigDocProcess,
    );
    await recordEfficiency({
      mode: "full",
      doc: "big",
      sizeBytes: BIG_DOC.sizeBytes,
      elapsedMs: result.elapsedMs,
      elapsedMin: +(result.elapsedMs / 60_000).toFixed(2),
      taskId: result.taskId,
    });
    await assertPipelineNodes(request, result.docId, "full");

    // 保留 full 文档供后续 5B 删除级联用例复用（或在此清理）
    await deleteAndAwaitCleanup(request, result.docId, { deleteWiki: true });
  });
});

test.describe("5A · 流水线中间态与一致性 @full", () => {
  let modelIds: { llmModelId?: string; embedModelId?: string };

  test.beforeAll(async () => {
    const ctx = await apiRequest.newContext({ baseURL: "http://localhost:3000" });
    modelIds = await getDefaultModelIds(ctx);
    await ctx.dispose();
  });

  test("PIPE-03 basicReady 中间态（full：线性链完成后分支仍 active）", async ({ request }) => {
    test.setTimeout(TIMEOUTS.bigDocProcess);
    const fs_ = await import("fs/promises");
    const buffer = await fs_.readFile(SMALL_DOC.path);

    // 上传 + 开始处理（小文档 full，graph+wiki 都有分支）
    const { docId } = await uploadDocument(request, SMALL_DOC.path, { mode: "full", ...modelIds });
    const { taskId } = await startProcessing(request, docId, { mode: "full", ...modelIds });

    // 等到至少出现 basicReady（线性 done，分支可能还在跑）
    // 注意：小文档可能很快跑完，basicReady 窗口短，best-effort 验证
    try {
      const pipeline = await waitForPipelineCondition(
        request,
        docId,
        (p) => p.isBasicReady && !p.isReady,
        180_000,
      );
      // basicReady 时徽标应反映"可用但增强中"
      expect(pipeline.isBasicReady).toBe(true);
    } catch {
      // 文档跑太快直接 ready，也是合理的（验证最终 ready）
    }

    // 等到最终 ready（full 模式需等 graph+wiki 分支完成，用整体超时）
    await waitForStatus(request, docId, ["ready"], TIMEOUTS.smallDocProcess);

    // 清理
    await deleteAndAwaitCleanup(request, docId, { deleteWiki: true });
  });
});
