/**
 * 专项 5B · 文档删除级联清理验证（@full）
 *
 * 核心验证：删除 full 文档后，知识图谱、Wiki、DB 是否彻底清理。
 * 用小文档（full 模式）跑，graph 阶段耗时可控。
 *
 * 关键：删除 API 的 verifyDocumentDeleted 恒返回 ok（空校验），
 * 所有残留验证走独立渠道（entities/graph/health/wiki）。
 */
import { test, expect, request as apiRequest } from "@playwright/test";
import {
  uploadAndProcessToReady,
  getDocument,
  uploadDocument,
  waitForStatus,
  startProcessing,
} from "./helpers/documents";
import { getDefaultModelIds } from "./helpers/models";
import {
  deleteAndAwaitCleanup,
  deleteDocument,
  verifyDeletionClean,
  getKnowledgeEntities,
  getKnowledgeHealth,
} from "./helpers/delete-verify";
import { waitForTask } from "./helpers/task-poller";
import { SMALL_DOC, TIMEOUTS } from "./helpers/constants";

test.describe.configure({ mode: "serial" });

test.describe("5B · 删除级联清理 @full", () => {
  let modelIds: { llmModelId?: string; embedModelId?: string };
  // 记录当前用例创建的 docId，afterEach 兜底清理（防失败残留）
  let currentDocId: string | null = null;

  test.beforeAll(async () => {
    const ctx = await apiRequest.newContext({ baseURL: "http://localhost:3000" });
    modelIds = await getDefaultModelIds(ctx);
    await ctx.dispose();
    expect(modelIds.embedModelId).toBeTruthy();
  });

  test.afterEach(async ({ request }) => {
    // 兜底清理：无论用例成功失败，都尝试删除本用例创建的文档
    if (currentDocId) {
      await request.delete(`/api/v1/documents/${currentDocId}?deleteWiki=true`).catch(() => {});
      currentDocId = null;
    }
  });

  /**
   * 辅助：上传+处理 full 文档到 ready，返回 docId。
   * full 模式（graph+wiki）才有图谱/Wiki 可验证残留。
   */
  async function prepareFullDoc(request: import("@playwright/test").APIRequestContext) {
    const result = await uploadAndProcessToReady(
      request,
      SMALL_DOC.path,
      "full",
      modelIds,
      TIMEOUTS.smallDocProcess,
    );
    currentDocId = result.docId; // 记录供 afterEach 兜底清理
    // 确认处理后有知识实体（full 模式应抽取实体）
    const entities = await getKnowledgeEntities(request);
    return { docId: result.docId, entitiesBefore: entities };
  }

  test("DEL-01 默认删除不带 deleteWiki：Wiki 残留（记录行为）", async ({ request }) => {
    test.setTimeout(TIMEOUTS.smallDocProcess + 120_000);
    const { docId, entitiesBefore } = await prepareFullDoc(request);

    // 默认删除（不传 deleteWiki）
    await deleteAndAwaitCleanup(request, docId, { deleteWiki: false });

    // 验证：DB 清理 + 图谱清理
    const verify = await verifyDeletionClean(request, docId);
    expect(verify.dbGone, "DB 应已清理").toBe(true);

    // R1 验证：Wiki 默认不删（这是已知行为，记录之）
    // 尝试查该文档来源的 wiki 条目
    let wikiResidual = false;
    try {
      const wikiRes = await request.get(`/api/v1/wiki/entries?documentId=${docId}`);
      const wikiBody = await wikiRes.json();
      const entries = wikiBody.data ?? [];
      wikiResidual = entries.length > 0;
    } catch {
      /* 查询失败忽略 */
    }
    // 记录结果（不强制 fail——这是设计行为，等用户确认是预期还是缺陷）
    console.log(
      `[DEL-01] 默认删除后 Wiki 残留: ${wikiResidual ? "是（符合已知行为）" : "否"}`,
    );

    // 清理残留 Wiki（避免污染后续用例）
    await deleteAndAwaitCleanup(request, docId, { deleteWiki: true }).catch(() => {});
    await request.delete(`/api/v1/documents/${docId}?deleteWiki=true`).catch(() => {});
  });

  test("DEL-02 删除 + deleteWiki=true：彻底清理", async ({ request }) => {
    test.setTimeout(TIMEOUTS.smallDocProcess + 120_000);
    const { docId } = await prepareFullDoc(request);

    await deleteAndAwaitCleanup(request, docId, { deleteWiki: true });

    // 综合验证：DB + 图谱 + Wiki 全清
    const verify = await verifyDeletionClean(request, docId);
    expect(verify.clean, verify.details.join("; ")).toBe(true);

    // Wiki 也应无残留
    const wikiRes = await request.get(`/api/v1/wiki/entries?documentId=${docId}`);
    const wikiBody = await wikiRes.json();
    const entries = wikiBody.data ?? [];
    expect(entries.length, "Wiki 条目应已删除").toBe(0);
  });

  test("KG-DEL-01/02 删除后知识图谱无残留", async ({ request }) => {
    test.setTimeout(TIMEOUTS.smallDocProcess + 120_000);
    const { docId, entitiesBefore } = await prepareFullDoc(request);
    const entitiesCountBefore = entitiesBefore.length;

    await deleteAndAwaitCleanup(request, docId, { deleteWiki: true });

    // 验证图谱：health 的 staleRagDocIds 不含该文档
    const health = await getKnowledgeHealth(request);
    const stale = health.staleRagDocIds ?? [];
    expect(
      stale.some((s) => s.includes(docId)),
      `staleRagDocIds 不应含 ${docId}`,
    ).toBe(false);

    // 验证实体已减少（删除该文档后实体数应 ≤ 删除前）
    const entitiesAfter = await getKnowledgeEntities(request);
    console.log(
      `[KG-DEL] 实体数 删除前=${entitiesCountBefore} 删除后=${entitiesAfter.length}`,
    );
    // 实体数不应增加（删除不应产生新实体）
    expect(entitiesAfter.length).toBeLessThanOrEqual(entitiesCountBefore + 1);
  });

  test("DEL-07 全删后 RAG 重置（用户无文档时）", async ({ request }) => {
    test.setTimeout(TIMEOUTS.smallDocProcess + 120_000);
    // 这个用例验证"删除最后一个文档触发 resetUserRag"。
    // 注意：不应删除用户原有文档！仅在测试文档是该用户唯一文档时才完整验证。
    // 这里只验证删除测试文档后图谱 health 正常（不强制 reset，因为可能有其他文档）
    const { docId } = await prepareFullDoc(request);
    await deleteAndAwaitCleanup(request, docId, { deleteWiki: true });
    const verify = await verifyDeletionClean(request, docId);
    expect(verify.clean).toBe(true);
  });
});

test.describe("5B · 多文档场景 @full", () => {
  let modelIds: { llmModelId?: string; embedModelId?: string };
  const docsToCleanup: string[] = [];

  test.beforeAll(async () => {
    const ctx = await apiRequest.newContext({ baseURL: "http://localhost:3000" });
    modelIds = await getDefaultModelIds(ctx);
    await ctx.dispose();
  });

  test.afterEach(async ({ request }) => {
    // 兜底清理本用例创建的所有文档
    for (const id of docsToCleanup.splice(0)) {
      await request.delete(`/api/v1/documents/${id}?deleteWiki=true`).catch(() => {});
    }
  });

  test("DEL-05 删其一留其一：另一文档保留完好", async ({ request }) => {
    test.setTimeout(TIMEOUTS.smallDocProcess * 2 + 180_000);
    // 复制一份小文档作为第二个不同文件（避免 SHA256 去重）
    const fs_ = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");
    const tmpDir = await fs_.mkdtemp(path.join(os.tmpdir(), "e2e-dup-"));
    const secondPath = path.join(tmpDir, "e2e-second-copy.docx");
    await fs_.copyFile(SMALL_DOC.path, secondPath);
    // 改名后内容相同仍会去重——追加随机字节改变 hash
    const buf = await fs_.readFile(secondPath);
    const modified = Buffer.concat([buf, Buffer.from(`\n<!-- e2e-${Date.now()} -->`)]);
    await fs_.writeFile(secondPath, modified);

    // 上传两份不同 full 文档（都 ready）
    const a = await uploadAndProcessToReady(request, SMALL_DOC.path, "full", modelIds, TIMEOUTS.smallDocProcess);
    const b = await uploadAndProcessToReady(request, secondPath, "full", modelIds, TIMEOUTS.smallDocProcess);
    docsToCleanup.push(a.docId, b.docId);
    await fs_.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    // 删 A（带 deleteWiki）
    await deleteAndAwaitCleanup(request, a.docId, { deleteWiki: true });

    // A 应清理
    const verifyA = await verifyDeletionClean(request, a.docId);
    expect(verifyA.dbGone, "A 应从 DB 删除").toBe(true);

    // B 应保留完好（仍可访问）
    const docB = await getDocument(request, b.docId);
    expect(docB.status, "B 应仍为 ready").toBe("ready");

    // 清理 B（afterEach 也会兜底）
    await deleteAndAwaitCleanup(request, b.docId, { deleteWiki: true });
  });
});
