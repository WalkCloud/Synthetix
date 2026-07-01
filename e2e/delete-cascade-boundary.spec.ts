/**
 * 专项 5B · 边界删除（P2）
 *
 * DEL-10/11/12：重复删除、删不存在文档、删 pending 文档。
 * 这些不需要完整文档处理，快速可跑，验证删除 API 的错误处理。
 */
import { test, expect, request } from "@playwright/test";
import { ADMIN } from "./helpers/constants";
import path from "path";

const VM_TEST_DIR = "Z:\\VM ShareFolder\\test";
const SMALL_DOC_PATH = path.join(VM_TEST_DIR, "[REDACTED-CLIENT-B]容器云平台建设方案参考-20260305.docx");

test.describe("5B · 边界删除 @smoke", () => {
  test("DEL-11 删除不存在的文档应 404", async () => {
    const ctx = await request.newContext({ baseURL: "http://localhost:3000" });
    // 先登录
    await ctx.post("/api/v1/auth/login", { data: { username: ADMIN.username, password: ADMIN.password } });

    const res = await ctx.delete("/api/v1/documents/nonexistent-doc-id-xxxxx");
    expect(res.status()).toBe(404);
    await ctx.dispose();
  });

  test("DEL-10 重复删除同一文档应 404", async () => {
    const ctx = await request.newContext({ baseURL: "http://localhost:3000" });
    await ctx.post("/api/v1/auth/login", { data: { username: ADMIN.username, password: ADMIN.password } });

    // 上传一个小文档（pending 状态，不处理）
    const fs = await import("fs/promises");
    const buffer = await fs.readFile(SMALL_DOC_PATH);
    const uploadRes = await ctx.post("/api/v1/documents/upload", {
      multipart: {
        file: { name: "boundary-test.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer },
        indexMode: "basic",
        splitStrategy: "structure-llm",
        indexTarget: "full",
        autoSplit: "true",
      },
    });
    const uploadBody = await uploadRes.json();
    if (!uploadBody.success) {
      // 文档已存在（之前测过），跳过
      await ctx.dispose();
      test.skip();
      return;
    }
    const docId = uploadBody.data.document.id;

    // 第一次删除成功
    const delRes1 = await ctx.delete(`/api/v1/documents/${docId}`);
    expect([200, 202].includes(delRes1.status())).toBeTruthy();

    // 等待 cleanup 触发
    await new Promise((r) => setTimeout(r, 3000));

    // 第二次删除应 404
    const delRes2 = await ctx.delete(`/api/v1/documents/${docId}`);
    expect(delRes2.status()).toBe(404);

    await ctx.dispose();
  });

  test("DEL-12 删除 pending（未处理）文档无 RAG 残留", async () => {
    const ctx = await request.newContext({ baseURL: "http://localhost:3000" });
    await ctx.post("/api/v1/auth/login", { data: { username: ADMIN.username, password: ADMIN.password } });

    const fs = await import("fs/promises");
    const buffer = await fs.readFile(SMALL_DOC_PATH);
    const uploadRes = await ctx.post("/api/v1/documents/upload", {
      multipart: {
        file: { name: "pending-delete-test.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer },
        indexMode: "basic",
        splitStrategy: "structure-llm",
        indexTarget: "full",
        autoSplit: "true",
      },
    });
    const uploadBody = await uploadRes.json();
    if (!uploadBody.success) {
      await ctx.dispose();
      test.skip();
      return;
    }
    const docId = uploadBody.data.document.id;

    // 确认 pending 状态（未点开始处理）
    const detailRes = await ctx.get(`/api/v1/library/documents/${docId}`);
    const detail = (await detailRes.json()).data;
    expect(["pending", "uploading"]).toContain(detail.status);

    // 删除
    const delRes = await ctx.delete(`/api/v1/documents/${docId}`);
    expect([200, 202].includes(delRes.status())).toBeTruthy();

    // 等待清理
    await new Promise((r) => setTimeout(r, 3000));

    // 从 library 列表应查不到
    const listRes = await ctx.get("/api/v1/library/documents");
    const list = (await listRes.json()).data ?? [];
    expect(list.some((d: { id: string }) => d.id === docId)).toBeFalsy();

    await ctx.dispose();
  });
});
