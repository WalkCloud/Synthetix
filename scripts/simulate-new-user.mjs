// Simulate a brand-new user's first-run experience via HTTP API.
// Assumes dev server is running on http://localhost:3000 and DB is wiped.
//
// Usage: node scripts/simulate-new-user.mjs
//
// Cookie jar is managed manually (the app uses httpOnly cookies, no Bearer header).
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";

// Minimal cookie jar: { name: value }
const jar = {};
let cookieHeader = () =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

function captureCookies(resp) {
  const setCookies = resp.headers.getSetCookie
    ? resp.headers.getSetCookie()
    : [];
  for (const sc of setCookies) {
    // parse "name=value; ..."
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq > -1) {
      jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }
}

async function call(method, path, { json, form, expectStatus } = {}) {
  const headers = { Cookie: cookieHeader() };
  const opts = { method, headers, redirect: "manual" };
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(json);
  } else if (form !== undefined) {
    // form is a FormData instance; let fetch set the boundary
    opts.body = form;
    delete headers["Content-Type"];
  }
  const start = Date.now();
  const resp = await fetch(BASE + path, opts);
  captureCookies(resp);
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const ms = Date.now() - start;
  const ok = expectStatus ? resp.status === expectStatus : resp.status < 400;
  const tag = ok ? "OK " : "ERR";
  console.log(
    `  [${tag}] ${method} ${path} → ${resp.status} (${ms}ms)` +
      (ok ? "" : ` expected ${expectStatus}`)
  );
  if (!ok) {
    console.log("    body:", typeof body === "string" ? body.slice(0, 200) : body);
  }
  return { status: resp.status, body, ok };
}

function step(title) {
  console.log(`\n━━━ ${title} ━━━`);
}

// ---------- run ----------
const ADMIN = {
  username: "admin",
  password: "Admin@123",
  displayName: "Admin",
};

let providerId, llmModelId, embedModelId;

// 1. pre-flight: confirm uninitialized
step("1. 预检 system/status（确认未初始化）");
{
  const { body, ok } = await call("GET", "/api/v1/system/status");
  if (!ok) process.exit(1);
  const initialized = body?.data?.initialized;
  console.log("    initialized =", initialized);
  if (initialized === true) {
    console.error("    ❌ 系统已初始化，无法模拟首跑。请先重置数据库。");
    process.exit(1);
  }
  console.log("    ✅ 数据库为空，可以创建首个 admin");
}

// 2. setup admin (bootstrap)
step("2. POST /auth/setup 创建首个 admin 账号");
{
  const { body, ok } = await call("POST", "/api/v1/auth/setup", {
    json: ADMIN,
    expectStatus: 201,
  });
  if (!ok) process.exit(1);
  console.log(
    "    创建用户:",
    body?.data?.username,
    "role=" + body?.data?.role,
    "id=" + body?.data?.id
  );
  console.log("    cookies 已捕获:", Object.keys(jar).join(", "));
}

// 3. login again to exercise login flow
step("3. POST /auth/login 验证登录流程");
{
  const { ok } = await call("POST", "/api/v1/auth/login", {
    json: { username: ADMIN.username, password: ADMIN.password },
  });
  if (!ok) process.exit(1);
  console.log("    ✅ 登录成功，token 已刷新");
}

// 4. configure LLM provider + models
step("4. POST /models/providers 配置 LLM 提供商 + 模型");
{
  // Use a realistic OpenAI-compatible config pointing at the configured base.
  // apiKey is set to a placeholder; capability-based resolution needs chat+writing.
  const payload = {
    name: "OpenAI 兼容（示例）",
    providerType: "openai_compatible",
    apiBaseUrl: "https://api.openai.com/v1",
    apiKey: "sk-simulated-placeholder-key",
    models: [
      {
        modelId: "gpt-4o-mini",
        modelName: "GPT-4o mini",
        capabilities: ["chat", "writing", "llm"],
        contextWindow: 128000,
        supportsStreaming: true,
        localOrCloud: "cloud",
        inputPrice: 0.15,
        outputPrice: 0.6,
      },
      {
        modelId: "text-embedding-3-small",
        modelName: "Text Embedding 3 Small",
        capabilities: ["embedding", "embed"],
        contextWindow: 8191,
        localOrCloud: "cloud",
        embeddingDim: 1536,
        embeddingBatchSize: 100,
      },
    ],
  };
  const { body, ok } = await call("POST", "/api/v1/models/providers", {
    json: payload,
    expectStatus: 201,
  });
  if (!ok) process.exit(1);
  providerId = body?.data?.id;
  const models = body?.data?.models || [];
  llmModelId = models.find((m) =>
    (m.capabilities || []).some((c) => ["chat", "writing", "llm"].includes(c))
  )?.id;
  embedModelId = models.find((m) =>
    (m.capabilities || []).some((c) => ["embedding", "embed"].includes(c))
  )?.id;
  console.log(
    "    提供商已创建:",
    body?.data?.name,
    "hasApiKey=" + body?.data?.hasApiKey,
    "id=" + providerId
  );
  console.log("    模型数量:", models.length);
  for (const m of models) {
    console.log(
      "      -",
      m.modelName,
      "(" + m.modelId + ")",
      "caps=[" + (m.capabilities || []).join(",") + "]",
      "id=" + m.id
    );
  }
}

// 5. set default models per slot
step("5. PATCH /models/configs/[id]/default 设置默认 LLM + Embedding");
{
  if (llmModelId) {
    const { ok } = await call(
      "PATCH",
      `/api/v1/models/configs/${llmModelId}/default`,
      { json: { setDefault: true, defaultFor: "llm" } }
    );
    if (ok) console.log("    ✅ 默认 LLM 已设置 id=" + llmModelId);
  }
  if (embedModelId) {
    const { ok } = await call(
      "PATCH",
      `/api/v1/models/configs/${embedModelId}/default`,
      { json: { setDefault: true, defaultFor: "embedding" } }
    );
    if (ok) console.log("    ✅ 默认 Embedding 已设置 id=" + embedModelId);
  }
}

// 6. verify providers list + system initialized
step("6. GET /models/providers + system/status 验证配置已持久化");
{
  const { body } = await call("GET", "/api/v1/models/providers");
  const providers = body?.data || [];
  console.log("    提供商数量:", providers.length);
  for (const p of providers) {
    console.log(
      "      -",
      p.name,
      "models=" + (p.models?.length || 0),
      "hasApiKey=" + p.hasApiKey
    );
  }
  const st = await call("GET", "/api/v1/system/status");
  console.log("    initialized 现在为:", st.body?.data?.initialized);
}

// 7. upload a document
step("7. POST /documents/upload 上传文档");
let docId = null;
{
  // Use a small markdown fixture so conversion succeeds without external deps.
  const fixturePath = "tmp/sim-newuser-fixture.md";
  const content = `# 测试文档：新用户首跑示例

## 概述
这是一个用于模拟新用户首次上传的测试文档。Synthetix 会将其转换为 Markdown、切片、建立 FTS 与向量索引。

## 关键事实
- 产品名称：Synthetix
- 部署方式：本地自托管
- 默认存储：SQLite + 本地文件系统
- 检索方式：FTS5 + 语义检索（LightRAG）

## 结论
新用户流程验证：账号创建、登录、模型配置、文档上传与索引。
`;
  // ensure fixture exists
  const { writeFileSync, mkdirSync } = await import("node:fs");
  try {
    mkdirSync("tmp", { recursive: true });
  } catch {}
  writeFileSync(fixturePath, content, "utf8");

  const fd = new FormData();
  const buf = readFileSync(fixturePath);
  fd.append("file", new Blob([buf]), "sim-newuser-fixture.md");
  // processing options (strings, as the route reads them)
  fd.append("indexTarget", "full");
  fd.append("indexMode", "basic");

  const { body, ok } = await call("POST", "/api/v1/documents/upload", {
    form: fd,
    expectStatus: 201,
  });
  if (!ok) process.exit(1);
  docId = body?.data?.document?.id;
  console.log(
    "    文档已上传:",
    body?.data?.document?.originalName,
    "status=" + body?.data?.document?.status,
    "id=" + docId
  );
}

// 8. poll conversion status
step("8. 轮询 /documents/[id]/status 直到 ready/failed");
if (docId) {
  const started = Date.now();
  let last = null;
  for (let i = 0; i < 60; i++) {
    const { body } = await call("GET", `/api/v1/documents/${docId}/status`);
    const d = body?.data || {};
    const cur = `${d.status}|${d.taskStatus}|${d.progress ?? "-"}`;
    if (cur !== last) {
      console.log(
        `    [${((Date.now() - started) / 1000).toFixed(0)}s] status=${
          d.status
        } task=${d.taskStatus} progress=${d.progress ?? "-"}${d.error ? " err=" + d.error : ""}`
      );
      last = cur;
    }
    if (d.status === "ready" || d.status === "failed") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// 9. final document list
step("9. GET /documents 最终文档列表");
{
  const { body } = await call("GET", "/api/v1/documents?limit=10");
  const docs = body?.data || [];
  console.log("    文档总数:", body?.total ?? docs.length);
  for (const d of docs) {
    console.log(
      "      -",
      d.originalName,
      "status=" + d.status,
      "size=" + d.originalSize,
      "chunks? n/a"
    );
  }
}

console.log("\n✅ 新用户首跑模拟完成\n");
console.log("    账号:", ADMIN.username, "/ " + ADMIN.password);
console.log("    cookie jar keys:", Object.keys(jar).join(", "));
console.log("    后续可用这些 cookie 继续访问受保护接口\n");
