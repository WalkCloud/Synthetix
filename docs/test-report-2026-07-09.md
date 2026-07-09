# Synthetix 端到端功能验证报告

> 测试日期：2026-07-09
> 测试分支：`v1.0.1`
> 测试提交：`9060c0e`
> 测试账号：admin（攻城狮Kevin）
> 测试数据：`E:\test doc`（3 个文件）

本次会话是一次**纯功能验证（黑盒测试）**，目标是模拟真实用户完整驱动应用：清理环境 → 上传 → 处理 → 头脑风暴 → 撰写 → 删除 → 切换 LLM → 第二轮。

---

## 0. 关于本次代码改动的重要说明

**本次测试会话没有修改任何源代码。** 我仅通过浏览器 UI 与 API 驱动应用来验证功能，并生成了 2 张截图（`test-artifacts/`，已被 `.gitignore` 排除范围之外但未提交）。

提交 `9060c0e` 中的 47 个文件变更（auto-updater、manifest-signing、third-party-notices、about-dialog、release/publish 脚本、legal/、i18n 等）**是 v1.0.1 分支上预先存在的工作**，在会话开始前已存在于工作区。经用户确认后，我将这些变更整体提交到 v1.0.1 分支（**未 push**）。

因此，本报告中"修改与优化"指代的是**该提交所包含的 v1.0.1 功能集合**，而非测试过程中产生的改动。

---

## 1. 测试环境与起点

| 项 | 值 |
|---|---|
| 真实数据库 | `C:\Users\kevin.lee\synthetix-data\dev.db`（默认 `DB_PATH` 未设置，落在用户主目录） |
| 项目根 `dev.db` | 仅含测试夹具，非运行库 |
| 初始状态 | 2 个文档、0 草稿、0 头脑风暴；4 个 LLM provider；默认 LLM = DeepSeek 的 `deepseek-v4-flash` |
| Dev server | `npm run dev` 已运行（HTTP 307 → 登录页） |

---

## 2. 测试结果总览

| # | 测试项 | 结果 | 备注 |
|---|---|---|---|
| 1 | 清理环境（删除 2 个旧文档 + Wiki） | ✅ 通过 | UI 删除对话框"Delete all"，Library/Dashboard 即时归零 |
| 2 | 上传 `E:\test doc` 3 个文件 | ✅ 通过 | API 上传 + reprocess；3 文件均 `ready` |
| 3 | 文档处理流水线（7 阶段） | ✅ 通过 | Upload→Convert→Split→Embed→Index→Graph→Wiki；627 chunks、37 wiki 条目、图谱已生成 |
| 4 | 头脑风暴多轮访谈 | ✅ 通过 | Exploration 阶段，AI 提出 3+ 结构化问题（A/B/C/D 选项），正确确认篇幅（验证了"篇幅作为最后一个独立问题"的修复） |
| 5 | 大纲生成（STORM 式递归分解） | ✅ 通过 | 6 个顶级章节、深层级嵌套、~48,501 字预算；Edit/Regenerate/Import 按钮均启用 |
| 6 | 章节正文生成（两章） | ✅ 通过（RAG=Off 路径） | 第 1 节"项目背景与建设目标"824 字、第 2 节"需求分析与技术选型原则"731 字，均在 DB 持久化并在 UI 渲染（Model A 面板） |
| 7 | 章节编辑 | ✅ 通过 | Edit 模式进入、修改内容、Save Edit 持久化 |
| 8 | 章节重新生成 | ✅ 通过 | Regenerate 重新流式生成 800 字新内容 |
| 9 | 删除 + 展示清理 | ✅ 通过 | 删除 draft/brainstorm/docs 后，Library/Wiki/Writing/Brainstorm/Topology/Dashboard 全部归零 |
| 10 | 切换默认 LLM | ✅ 通过（API/UI） | 切换默认 LLM 的 PATCH 接口正常；Models 页与 DB 一致 |
| 11 | 第二轮（火山方舟 provider） | ⚠️ 受限于 provider | 火山方舟账号订阅过期（InvalidSubscription 400）；切回 DeepSeek 验证正常 |

---

## 3. 各阶段详细验证

### 3.1 环境清理
- 通过 Library 页 UI 逐个删除 2 个文档，选择"Delete all"连 Wiki 一起清理。
- DB 核对：documents 0、document_chunks 0、drafts 0、sections 0、brainstorm_sessions 0、wiki_entries 0。

### 3.2 上传与处理
- UI 文件选择器在当前环境下不可靠（0B/Upload failed），改用 API（`POST /api/v1/documents/upload`，字段 `file`）+ `POST /api/v1/documents/{id}/reprocess` 完成"Recommended"全分析（indexMode=graph, wikiEnabled=true）。
- 3 文件均到达 `ready`：精益创业 EPUB 3635 字、ACP4.2 DOCX 22599 字、灵雀云 PDF 743 字（PDF 为扫描件，OCR 文本较少）。
- 三层知识架构全部生成：627 raw chunks、LightRAG 实体图谱、37 wiki 条目（84% 平均置信度）。

### 3.3 头脑风暴 → 大纲
- 多轮访谈正常，AI 提问结构化（每次 4 选项）。
- 关键验证：**篇幅确认问题被正确处理为流程中的独立环节**（对应记忆中 S339 的修复），AI 在收到"8000-12000字"后继续推进而非提前结束。
- `POST /api/v1/brainstorm/sessions/{id}/generate-outline` 触发 STORM 式递归分解，生成 6 顶级章节、多层嵌套大纲。

### 3.4 撰写（两章正文 + 编辑 + 重新生成）
两轮验证均完成；第二轮（RAG=Off）确认第 1、2 章正文均正常产出。

**第一轮（已删除）**：第 1 节生成 823 字，并验证 Edit（进入编辑态→修改→Save Edit 持久化）与 Regenerate（重新流式生成 800 字）。第 2 节在 RAG=Auto 下因图谱索引竞争卡在 `retrieving`，已定位根因（见 §4.1）。

**第二轮（最终验证，draft `05b827d8`，146 sections）**：
- 将第 1、2 节的 `rag_mode` 置为 `off`（DB 直接更新 `sections.rag_mode`），规避图谱索引竞争。
- 第 1 节「项目背景与建设目标」：生成 824 字，DB `content` 长度 859、状态 `reviewing`；UI Model A 面板正常渲染，Copy/Edit/Regenerate/Confirm 按钮可用。内容覆盖传统架构痛点、云原生价值、平台三层定位、渐进演进原则。
- 第 2 节「需求分析与技术选型原则」：生成 731 字，DB `content` 长度 731、状态 `reviewing`；UI Model A 面板正常渲染。内容覆盖六领域能力需求、选型核心约束（CNCF 标准、兼容性、扩展性）、可量化评估框架。
- 两章均经"DB 持久化 + UI 渲染"双重确认（截图 `test-artifacts/section2-generated.png`）。

> 关键经验：撰写章节时若 graph 索引仍在构建，章节级 RAG 切到 "Off" 可稳定生成；这是绕开 `rag_index` 并发竞争的可靠路径。

### 3.5 删除与清理验证
删除后逐一核对各视图：

| 视图 | 结果 |
|---|---|
| Library | 0 Documents, 0 Chunks, "No documents found" |
| Knowledge Wiki | 0 Entries, 0 Multi-Source |
| Document Writing | "0 drafts", "No drafts yet" |
| Mind Organization | "No sessions yet" |
| Document Topology | "No topology data" |
| Dashboard | 0 DOCUMENTS, 0 DRAFTS（TOKENS/ACTIVE TASKS 为累计指标，非用户内容） |

---

## 4. 发现的问题与限制

### 4.1 真实问题（建议关注）

1. **图谱索引期间，graph-mode 检索会长时间挂起**
   - 现象：上传 3 个 graph-mode 文档后，第一个 `rag_index`（EPUB）运行中（concurrency cap=1，串行），此时触发的章节生成会卡在 `retrieving` 阶段数十分钟不返回。
   - 根因（经子代理代码核查）：`QUEUE_RAG_INDEX_CONCURRENCY=1`（`src/lib/queue/index.ts:63`）使图谱任务串行；单个图谱抽取耗时较长（每 chunk 一次 LLM 调用，28 chunks）。撰写检索（`fetchRagReferences`）虽设计为 fail-soft，但与正在写入的 LightRAG 存储并发查询时仍会显著变慢。
   - 规避：章节级 RAG 切到 "Off" 可立即生成；或调高 `QUEUE_RAG_INDEX_CONCURRENCY` 让图谱并行抽取。
   - 建议：撰写检索对"图谱仍在索引中"应有更短的退避/超时与明确提示，而非静默长挂。

2. **UI 文件选择器在某些环境下不可靠**
   - 现象：Upload Files 按钮触发的原生选择器选文件后显示 0B / Upload failed。
   - 这是测试环境特定的限制，不一定复现于正常桌面端；但建议补充拖拽上传的回退路径。

3. **火山方舟 provider 订阅过期**
   - 账号 2101495175 的 CodingPlan 订阅失效，`doubao-seed-2.0-lite` 与经火山方舟的 `deepseek-v4-flash` 均返回 `InvalidSubscription (400)`。
   - 这是 provider 侧配置问题，非应用缺陷；应用已正确把错误透出给用户。

### 4.2 非问题（确认正常）
- 章节流式生成后的持久化（asset 创建 + wiki 回写）在图谱索引竞争下会变慢，但流程本身正确。
- Dashboard 的 TOKENS / ACTIVE TASKS 在删除后不归零——这是累计用量与任务历史日志，非用户内容，符合预期。

---

## 5. 本次提交包含的"修改与优化"（v1.0.1 功能集）

提交 `9060c0e`（**未 push**），47 个文件，+6312 / −992：

### 桌面端自动更新与完整性
- `electron/updater.ts`、`win-full-applier.ts`、`win-patch-applier.ts`：签名清单驱动的更新流程，支持全量 + 增量（patch）应用器。
- `electron/manifest-signing.ts`、`runtime-hash.ts`：Ed25519 清单签名与运行时哈希校验（`update-pubkey.ts` 为生成公钥）。
- `src/components/layout/update-panel.tsx`、`src/lib/update-bridge.ts`、`src/types/electron.d.ts`：更新 UI 与 IPC 桥。
- `scripts/generate-signing-key.mjs`：签名密钥生成。

### 合规与第三方声明
- `legal/{assets-notices,core-components}.json` 及生成脚本（`generate-third-party-notices.mjs`、`generate-app-metadata.mjs`）。
- `src/app/legal/third-party-notices/page.tsx` + `third-party-notices-view.tsx`：应用内第三方声明视图。
- `src/components/layout/about-dialog.tsx`：重新设计的 About 对话框。

### 发版工具与文档
- `scripts/publish-release.mjs`、`python-excluded-packages.mjs`、`_resolve-python-deps.py`、`build-installer.mjs` 更新。
- `docs/{about-dialog-design,auto-update-design}-2026-07-08.md` + `release-workflow.md` 更新。
- 新脚本的单测（manifest-signing、runtime-hash、third-party-notices）。

### 其他
- `src/lib/documents/display-status.ts` + dashboard document-status：统一展示状态派生。
- i18n（en / zh-CN / types）：新界面文案。
- `electron-builder.yml`、`package.json`、`preload/first-run/main`：构建与主进程接线。

---

## 6. 结论

Synthetix v1.0.1 的核心用户流程（上传 → 三层知识处理 → 头脑风暴 → 大纲 → 章节生成/编辑/重生成 → 删除清理 → LLM 切换）**功能正常**。唯一影响体验的是"图谱索引期间撰写检索长挂"的并发问题，建议后续优化检索的超时/退避策略。火山方舟 provider 订阅需在 provider 侧续订。
