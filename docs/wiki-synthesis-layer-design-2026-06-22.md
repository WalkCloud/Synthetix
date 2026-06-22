# Wiki 综合层设计方案

> **状态**：已批准，待实现
> **日期**：2026-06-22
> **分支**：`chore/windows-installer-v0.10.9`（当前）
> **灵感来源**：Karpathy LLM-Wiki（三层架构 + ingest/query/validate）+ Google OKF（开放知识格式规范）

---

## 一、背景与动机

### 1.1 外部参考

**Karpathy LLM-Wiki**（https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f）

核心论点：停止在每次查询时"重新发现"知识（RAG 的根本缺陷），转而让 LLM 承担人类因厌倦而放弃的 Wiki 维护工作。

- **三层架构**：原始资料（raw materials）→ Wiki 层（LLM 维护的 Markdown 知识页）→ 模式层（`index.md` 目录 + `log.md` 变更日志）
- **三种操作**：`ingest`（摄入新资料、更新 Wiki）/ `query`（查询已沉淀的知识）/ `validate`（一致性校验，发现矛盾）
- **关键洞察**：Wiki 会随使用越来越丰富，检索成本递减——形成正向飞轮

**Google OKF（开放知识格式）**（https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing）

核心论点：用一套极简、可移植的规范来标准化"知识文件"，实现跨工具互操作。

- Markdown 文件 + 最小化 YAML frontmatter（至少 `type` 字段）
- 文件路径即身份标识
- Markdown 链接构成知识图谱
- **三大原则**：最小化意见 / 生产者与消费者独立 / 是格式而非平台

### 1.2 Synthetix 当前的知识架构缺口

经深入探索，Synthetix 的知识表示**恰好只有两层，缺少第三层**：

| 层级 | 当前状态 | 存储 |
|---|---|---|
| 原始资料层 | ✅ 文档 → chunks → embeddings | SQLite `DocumentChunk` + `embeddings.bin` |
| 实体/关系层 | ✅ LightRAG 自动抽取的实体与关系 | `data/rag/<userId>/` GraphML + JSON |
| **综合/策展层** | ❌ **不存在** | — |

**缺失的关键能力**：
- ❌ 无文档级摘要/摘要层持久化（每次查询重新检索）
- ❌ 无跨文档的主题/概念综合层
- ❌ 无人类可读、可编辑、可积累的知识沉淀
- ❌ 搜索路径纯检索（`only_need_context=True`），无答案综合
- ❌ 写作管道逐节重新发现知识（每节独立做语义检索 + 上下文组装）

**核心问题**：当前写作流程是"每个 section 独立做语义检索 → 组装上下文 → 生成"。这就是 Karpathy 批判的"每次查询重新发现知识"。长文档写作中跨章节反复引用相同主题（如"架构"、"安全"），当前每个 section 都从零检索，没有积累。

### 1.3 目标

在 chunks/graph 层之上，新增一个 LLM 维护的 Markdown Wiki 综合层，形成"文档→Wiki→写作"的知识飞轮：**Wiki 随使用越来越丰富，写作时的检索成本和质量双双改善**。

---

## 二、核心理念对齐

借鉴 LLM-Wiki 的三层架构，映射到 Synthetix：

```
原始资料层（DocumentChunk + embeddings）
        ↓
实体关系层（LightRAG graph）
        ↓
Wiki 综合层（新增：人类可读、可编辑、可积累的 Markdown 知识页）
        ↓
写作消费（section 生成时优先查 Wiki）
```

**三种操作**：
- `synthesize`：文档 ready 后自动合成（逐 chunk 增量）
- `query`：写作时优先查 Wiki（廉价、已综合）
- `update`：section 生成后增量写回（单章节粒度）

**`index.md` + `log.md`**：每用户维护目录与变更日志（借鉴 LLM-Wiki 的 schema 层）

---

## 三、关键设计决策与修正

### 3.1 超大文档的上下文窗口问题（关键修正）

**原始缺陷**：初版计划设想 `synthesizeDocument(ctx, markdown)` 把整个文档 markdown 喂给 LLM。**这对超大文档会直接爆 LLM 上下文窗口**。

**修正后的合成策略**：纯逐 chunk 增量 + 分层摘要

```
Phase A — 逐 chunk 增量（永不爆窗口）
  for each DocumentChunk in document:
    输入 = [这一个 chunk 的内容] + [当前用户所有 Wiki 条目的 title 列表]
    LLM 一次调用 → 抽取该 chunk 的知识点 + 微摘要
    合并到 Wiki（去重/补充/冲突检测）

  每次调用上下文 ≈ 1个chunk(~500-2000 token) + title列表(~几百token) ≪ 上下文窗口

Phase B — 分层文档摘要
  拼接所有 chunk 微摘要（已压缩到原文 1/5~1/10）
  → 一次 LLM 生成 doc_summary 条目
  → 极端大文档：分批汇总后再汇总（两层 Reduce，兜底）
```

**关键保证**：LLM 永远不读全文。Phase A 读单个 chunk，Phase B 读已压缩的微摘要集合。文档再大，只是循环次数多，单次调用的上下文始终受控。

### 3.2 写回飞轮的粒度：单章节增量

写回飞轮采用**单章节增量更新，绝不整体重写**。大文档（50+ sections）整体重写 Wiki 是灾难性的。

```
Section N 生成完成
    ↓
抽取本节的"知识贡献"（新主张/新事实/新引用，一次 LLM 调用）
    ↓
查 Wiki：这些主张是否已存在？是否与已有条目冲突？
    ↓
增量更新：新增 / 补充 / 标记矛盾（只改相关条目）
    ↓
追加一条到 log.md
```

**为什么单章节更新是对的**：
1. **成本可控**：每节只做一次小型 LLM 调用（抽取该节知识），而非全文重写
2. **避免破坏**：只触碰该节真正引入的新知识，不重写已有条目
3. **可溯源**：每条 Wiki 更新都能追溯到具体 section（通过 `sourceRefs`）
4. **天然防重复**：跨章节反复出现的主题只在首次出现时创建，后续只是补充

### 3.3 触发时机：自动（不阻塞）

Wiki 合成是文档处理管道的异步阶段，**不阻塞写作流程**：

```
文档上传 → convert → embed → index → [graph] → ready
                                                    ↓
                                          wiki_synthesize（异步，后台）
                                                    ↓
                                          Wiki 准备就绪（通常在用户还没开始写草稿时）
```

- Wiki 任务在 graph 任务**之后**提交（若 graph 启用）
- Wiki 合成**不阻塞**文档变 ready——文档 ready 状态由现有逻辑决定，Wiki 在后台异步进行
- 即使用户立即开始写草稿，Wiki 还在合成，写作会优雅降级：先查 Wiki（可能为空）→ 回退到原始 RAG（现有行为）

### 3.4 前端呈现范围

从用户视角出发，回答四个核心问题：

| 用户会问 | Wiki 能补充 |
|---|---|
| "AI 写这段话，依据是什么？" | Wiki 作为第三种来源类型，无缝融入溯源面板 |
| "我的资料库里到底有什么知识？" | Wiki 浏览页：人类可读的综合知识 |
| "AI 综合的知识对不对？我能信吗？" | 置信度 + 可编辑 + 可溯源到原文 |
| "这个文档，系统已经学到什么了？" | 文档详情里的 Wiki 摘要 |

**三层次呈现**：
1. **写作溯源面板**（成本极低）：复用现有 `SectionReference` UI，新增 `wiki` 徽章
2. **独立 Wiki 浏览页**（透明度保障）：`/wiki` 列表 + `/wiki/[id]` 详情
3. **文档详情集成**（入口增值）：文档详情页加"知识沉淀"小卡片

**明确不做**（防止过度设计）：
- ❌ Wiki 内的图谱可视化（已有知识图谱页）
- ❌ 双向链接编辑器（Wiki 是查看+轻编辑，非创作）
- ❌ Wiki 写作工作台（核心是文档写作，Wiki 是输入）
- ❌ Wiki 版本对比/时间漫游（简单变更日志即可）
- ❌ 把 Wiki 塞进搜索结果（避免搜索页过载）

---

## 四、数据模型

### 4.1 Prisma Schema 新增 3 个 model

```prisma
model WikiEntry {
  id              String   @id @default(uuid())
  userId          String   @map("user_id")
  type            String   // "doc_summary" | "topic" | "concept" | "claim"
  title           String
  slug            String   // URL 安全的标识，OKF 风格的文件路径身份
  content         String   // Markdown 正文
  sourceRefs      String   @map("source_refs") // JSON: [{documentId, chunkId?, entityId?}]
  confidence      Float    @default(0.8)       // 0-1，LLM 自评或派生
  status          String   @default("active")  // active | superseded | conflicting
  lastValidatedAt DateTime? @map("last_validated_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  links     WikiLink[]  @relation("WikiLinkFrom")
  backlinks WikiLink[]  @relation("WikiLinkTo")

  @@unique([userId, slug])
  @@index([userId, type])
  @@index([userId, status])
  @@map("wiki_entries")
}

model WikiLink {
  id        String @id @default(uuid())
  fromId    String @map("from_id")
  toId      String @map("to_id")
  relation  String // "relates" | "supports" | "contradicts" | "derived_from"

  from WikiEntry @relation("WikiLinkFrom", fields: [fromId], references: [id], onDelete: Cascade)
  to   WikiEntry @relation("WikiLinkTo", fields: [toId], references: [id], onDelete: Cascade)

  @@unique([fromId, toId, relation])
  @@map("wiki_links")
}

model WikiChangeLog {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  entryId   String?  @map("entry_id")  // null = 全局事件（如重建）
  action    String   // "create" | "update" | "merge" | "supersede" | "conflict"
  summary   String   // 人类可读的变更描述（log.md 的一行）
  detail    String?  // JSON: before/after diff 摘要
  createdAt DateTime @default(now()) @map("created_at")

  @@index([userId, createdAt])
  @@index([entryId])
  @@map("wiki_change_log")
}
```

User model 新增反向关系：`wikiEntries WikiEntry[]`

### 4.2 设计决策说明

- `sourceRefs` 用 JSON 而非关联表——Wiki 条目是"综合产物"，源引用是多对多且频繁变动，JSON 更轻量（与现有 `SectionReference` 的 `sourceType` 设计一致）
- `WikiLink` 用显式关系表实现知识图谱——这是 OKF "Markdown 链接即图谱"原则的数据库化，便于查询和可视化
- `slug` 作为 `@@unique([userId, slug])`——OKF 的"文件路径即身份"在数据库层的体现
- `confidence` (0-1)——综合知识的可信度，影响 UI 呈现和检索排序
- `status`——支持后续的 `validate` 一致性校验（标记矛盾条目）

---

## 五、Wiki 合成服务（`src/lib/wiki/`）

### 5.1 目录结构

```
src/lib/wiki/
├── synthesizer.ts      # 核心：文档→Wiki 条目合成（逐 chunk 增量 + 分层摘要）
├── merger.ts           # 增量合并：新条目并入现有 Wiki（去重/补充/冲突检测）
├── writer.ts           # 写回飞轮：section 生成后单章节增量更新 Wiki
├── query.ts            # 查询：按 section 检索相关 Wiki 条目（轻量 SQL）
├── index-md.ts         # index.md / log.md 生成与维护
├── prompts.ts          # 所有 Wiki 相关的 LLM prompts
└── types.ts            # WikiEntry / WikiLink 等类型导出
```

### 5.2 synthesizer.ts — 逐 chunk 增量合成

**修正后的签名**（不再接收全文 markdown）：

```typescript
synthesizeDocument(ctx: ProcessingContext, chunks: DocumentChunk[]): Promise<void>
```

**Phase A — 逐 chunk 增量抽取**：

```typescript
for (const chunk of chunks) {
  // 输入只含当前 chunk + 现有 Wiki 条目标题列表（轻量）
  const existingTitles = await getWikiTitles(userId);  // ["微服务通信", "服务发现", ...]
  const extracted = await extractChunkKnowledge(chunk, existingTitles, provider, modelId);
  // extracted: { microSummary, topics[], concepts[], claims[] }
  await mergeIntoWiki(userId, extracted, chunk, docId);
}
```

单次 LLM 调用的 prompt 结构：
```
[现有知识库条目标题列表，便于去重]
现有主题: 微服务通信, 服务发现, API网关...

[当前文档块内容]
{chunk.content}

请抽取本块的知识贡献（只输出 JSON）:
{
  "microSummary": "本块讲了...（100字内）",
  "topics": [{"title": "...", "content": "..."}],
  "concepts": [{"title": "...", "content": "..."}],
  "claims": [{"title": "...", "content": "...", "confidence": 0.9}]
}
```

**Phase B — 分层文档摘要**：

```typescript
// 拼接所有 chunk 的微摘要（已压缩到原文 1/5~1/10）
const microSummaries = collectedMicroSummaries.join("\n");

if (microSummaries.length < THRESHOLD) {
  // 一次 LLM 生成文档摘要
  const docSummary = await generateDocSummary(microSummaries, provider, modelId);
  await createWikiEntry(userId, "doc_summary", docTitle, docSummary, ...);
} else {
  // 极端大文档：分批汇总后再汇总（两层 Reduce，兜底）
  const batches = chunk(microSummaries, BATCH_SIZE);
  const batchSummaries = await Promise.all(batches.map(b => summarizeBatch(b)));
  const finalSummary = await generateDocSummary(batchSummaries.join("\n"), ...);
  await createWikiEntry(userId, "doc_summary", docTitle, finalSummary, ...);
}
```

**关键设计**：
- 复用 `ProcessingContext`（`ctx.writingModel`）获取 LLM 配置，与 `auto-tagger` 完全一致的 provider 解析模式
- token 用量记录到 `TokenUsage.module = "wiki"`
- 失败非阻塞（`try/catch` + `console.warn`，同 `auto-tagger`）
- `sourceRefs` 记录 chunkIndex → 生成时回填 chunkId

### 5.3 merger.ts — 增量合并逻辑

借鉴 Karpathy 的 `validate` 操作：合并时检测矛盾。

```typescript
async function mergeIntoWiki(
  userId: string,
  candidates: ExtractedKnowledge,
  sourceChunk: DocumentChunk,
  docId: string,
): Promise<void>
```

- 新条目标题与现有条目相似度（Jieba 分词 Jaccard）≥ 阈值 → 触发 `update` 或 `merge`
- 内容语义冲突（LLM 判断）→ 标记 `status = "conflicting"`，写入 `WikiChangeLog` 供用户审阅
- 无冲突 → `create` 新条目
- 每次合并写入 `WikiChangeLog`（即 `log.md` 的一行）

### 5.4 query.ts — Wiki 检索（写作时优先查）

```typescript
export async function queryWikiForSection(
  section: { title; description; keyPoints },
  draftTitle: string,
  userId: string,
): Promise<WikiEntry[]>
```

- 基于 section 的 title + keyPoints + retrievalQuery 构建 Wiki 查询
- 优先用 `WikiEntry.title` 的关键词匹配（Jieba 分词 + SQLite LIKE）
- 返回 top-N（默认 5）相关条目，按 confidence + 相关度排序
- **轻量**：纯 SQL 查询，无 LLM 调用，无 embedding——这是"廉价检索"的核心价值

### 5.5 writer.ts — 写回飞轮（单章节增量）

```typescript
export async function updateWikiAfterSection(
  section: { id; title; content },
  draftId: string,
  userId: string,
  usedWikiEntryIds: string[],
): Promise<void>
```

**流程**（一次 LLM 调用）：
1. LLM 阅读该 section 的生成内容，抽取"知识贡献"：
   ```json
   {
     "newClaims": [{"title": "...", "content": "...", "confidence": 0.85}],
     "updatedTopics": [{"existingSlug": "...", "addition": "补充内容"}],
     "crossRefs": [{"from": "claim-A", "to": "topic-B", "relation": "supports"}]
   }
   ```
2. 对每个 `newClaims` → 调用 `merger` 合并到 Wiki（去重检测）
3. 对每个 `updatedTopics` → 更新对应 WikiEntry.content（追加，非覆盖）
4. `crossRefs` → 创建 `WikiLink`
5. `usedWikiEntryIds` 里的条目 → 提升 `confidence`（被引用=被验证）
6. 写入 `WikiChangeLog`

**关键设计**：
- **单章节粒度**：每次只处理一个 section 的内容，不触碰其他条目
- **增量而非重写**：`updatedTopics` 只追加补充内容到现有 `content` 末尾，加 `--- Update <date> ---` 分隔
- **成本控制**：一次 LLM 调用抽取 + 批量 DB 写入；token 用量记录到 `module = "wiki"`
- **失败非阻塞**：写回失败不影响 section 生成结果（section 已成功生成）
- fire-and-forget 异步执行（不进入队列，避免延迟 section 保存的响应）

### 5.6 index-md.ts — schema 层

- `regenerateIndexMd(userId)`：扫描所有 active WikiEntry，生成 Markdown 目录（按 type 分组，含链接），存到 `data/wiki/<userId>/index.md`
- `appendChangeLog(userId, entry)`：增量追加到 `data/wiki/<userId>/log.md`
- 借鉴 LLM-Wiki 的 `index.md`（目录）+ `log.md`（变更日志）双文件设计

---

## 六、管道集成 — 自动触发

### 6.1 新增 TaskType

`src/lib/queue/types.ts`：
```typescript
export type TaskType =
  | "document_convert" | "document_cleanup" | "rag_embed_index"
  | "rag_index" | "wiki_synthesize"  // ← 新增
  | "outline_generate" | "draft_generate_all"
  | `_test_${string}`;
```

### 6.2 新增 worker

`src/lib/queue/workers/wiki-synthesize-worker.ts`，仿照 `rag-embed-index-worker.ts`：
- 读取文档的所有 chunks（`db.documentChunk.findMany`）
- 调用 `synthesizer.synthesizeDocument(ctx, chunks)`
- 调用 `index-md.appendChangeLog`
- 超时 5 分钟，并发独立配置 `QUEUE_WIKI_SYNTHESIZE_CONCURRENCY`

### 6.3 触发点

在 `rag-embed-index-worker.ts` 末尾（`shouldEnqueueGraphIndex` 判断之后）：

```typescript
// Wiki 合成在 graph 之后（如果有）或 basic index 之后立即触发
const wikiEnabled = shouldEnqueueWikiSynthesis(ctx.options); // 默认 true，可关闭
if (wikiEnabled && stillExists) {
  await getQueue().submit("wiki_synthesize", { docId: ctx.docId }, ctx.doc.userId);
}
```

**关键**：Wiki 任务在 graph 任务**之后**提交（若 graph 启用），这样 graph 的实体抽取结果可以被 Wiki 合成参考。但 Wiki 合成**不阻塞**文档变 ready。

### 6.4 队列注册

`src/lib/queue/index.ts`：
```typescript
queue.registerWorker("wiki_synthesize", async (payload) => {
  const taskId = payload.taskId as string;
  return processWikiSynthesize(taskId);
});
// taskTimeoutMs: wiki_synthesize: 5 * 60 * 1000
// taskConcurrency: wiki_synthesize: QUEUE_WIKI_SYNTHESIZE_CONCURRENCY
```

---

## 七、写作管道改造 — 优先查 Wiki

### 7.1 改造 generator.ts 的 fetchRagReferences

在现有 `semanticSearch` 调用**之前**插入 Wiki 查询：

```typescript
// 1. 先查 Wiki（廉价、已综合）
const wikiEntries = await queryWikiForSection(section, draftTitle, userId);

// 2. Wiki 命中且足够 → 减少原始 RAG 的检索量（如 limit 减半）
// 3. Wiki 未命中或不足 → 回退到现有 semanticSearch（现有行为）
const ragReferences = wikiEntries.length >= 3
  ? await fetchRagReferencesReduced(...)  // limit 减半
  : await fetchRagReferences(...);        // 现有行为
```

### 7.2 改造 context.ts 的 assembleContext

新增 Wiki 上下文区块（在 RAG references 之前）：

```typescript
function buildWikiContextSection(entries: WikiEntry[]): string {
  if (entries.length === 0) return "";
  const blocks = entries.map(e =>
    `### ${e.title} [confidence: ${(e.confidence*100).toFixed(0)}%]\n${e.content}`
  );
  return ["## Synthesized Knowledge Base", "", ...blocks].join("\n");
}
```

在 `assembleContext` 中插入到 `buildOutlineSummary` 之后、`buildRagReferencesSection` 之前。

**关键设计**：
- Wiki 上下文标记为"synthesized knowledge"（区别于原始 RAG 的"reference material"），让 LLM 知道这是已综合的可信知识
- Wiki 条目的 `sourceRefs` 不展开到 prompt（避免膨胀），但在 `SectionReference` 中以 `sourceType: "wiki"` 记录溯源

### 7.3 SectionReference.sourceType 扩展

`sourceType` 字段新增 `"wiki"` 类型。由于该列已是 `String` 类型，**无需数据库迁移**，只需更新类型定义和 4 处硬编码二元判断。

---

## 八、前端呈现设计

### 8.1 设计语言遵守

Wiki 前端必须完全复用 Synthetix 现有设计语言，详见"附录 B：前端设计规范摘要"。

核心约定：
- 页面骨架：`<div><Header title={t.wiki.title} /><div className="p-8">...</div></div>`
- 卡片：`bg-card border border-border rounded-[16px] p-5 hover:border-primary/30 transition-all`
- 徽章配色遵循 `bg-X-100 text-X-700 dark:bg-X-950/35 dark:text-X-300` 模式
- 主色 violet（`primary`），强调 orange/amber，语义 emerald/red/blue
- 入场动画 `animate-fade-in-up`

### 8.2 层次 1：写作溯源面板（融入现有 UI）

复用 `reference-panel.tsx` 的 `SectionReference` UI，新增 `wiki` 徽章。

需要修改的 4 处硬编码二元判断：

| 文件 | 改动点 |
|---|---|
| `src/lib/writing/generator.ts` 第 127 行 | 二元判断改三元，加 `wiki` 分支 |
| `src/lib/writing/persist-references.ts` 第 3-23、45-71 行 | `WritingReference` 联合类型加 `wiki` 成员；`createMany` 加 `wiki` 分支 |
| `src/lib/writing/reference-view.ts` 第 18、42 行 | `RagReferenceView.sourceType` 加 `"wiki"`；映射逻辑透传 |
| `src/components/writing/reference-panel.tsx` 第 279-292 行 | `referenceBadge` 加 `wiki` 分支（新颜色 + "Wiki" 文字） |

Wiki 徽章配色（复用主色 violet）：
```typescript
if (ref.sourceType === "wiki") {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-violet-50 text-violet-600 border border-violet-100 dark:bg-violet-950/35 dark:text-violet-300">
      Wiki
    </span>
  );
}
```

API 路由层、SSE 事件层、前端 hook 层（`generate/route.ts`、`drafts/[id]/route.ts`、`sse-events.ts`、`use-generation.ts`、`page.tsx`）**完全不需要改**——它们都是泛型透传 `sourceType`。

### 8.3 层次 2：独立 Wiki 浏览页

**页面位置**：侧边栏 `workspace` 组，`/library` 之后新增 `/wiki` 入口。

**侧边栏注册**（`src/components/layout/sidebar.tsx`）：
- navGroups 的 workspace 组新增 `{ href: "/wiki", labelKey: "knowledgeBase", icon: 书本图标 }`
- i18n 同步：`src/lib/i18n/types.ts` 加 `wiki` 命名空间，`locales/en.ts` 和 `zh-CN.ts` 同步翻译

**列表页 `/wiki`**：

```
┌─ Header: 知识库 ─────────────────────────────────────────┐
│                                                          │
│  ┌─ StatsRibbon (4列统计) ─────────────────────────────┐ │
│  │ [12 文档摘要] [47 主题] [89 概念] [23 主张]          │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ 筛选 + 搜索栏 ────────────────────────────────────┐  │
│  │ [全部] [文档摘要] [主题] [概念] [主张]  🔍搜索...    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ WikiEntryCard ────────────────────────────────────┐  │
│  │ 微服务通信模式                          [主题] [85%]│  │
│  │ 同步与异步通信模式的选择，gRPC 适合内部...           │  │
│  │ 📄 文档A, 文档B  ·  🔗 服务发现, API网关  ·  2天前  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**WikiEntryCard 复用 `semantic-results.tsx` 卡片模式**。

**条目详情页 `/wiki/[id]`**：

复用 `EntityEvidencePanel` 的双栏布局（`grid lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]`）：

```
┌─ Header: 微服务通信模式  [主题] [85%置信] ────────────────┐
│                                                            │
│  ┌─ 左栏：知识内容 (主) ──────┐  ┌─ 右栏：溯源 (侧) ──────┐ │
│  │                            │  │                        │ │
│  │  ## 微服务通信模式         │  │  📄 来源文档           │ │
│  │  [MarkdownRenderer 渲染]   │  │  · 文档A (chunk 3,5)   │ │
│  │                            │  │  · 文档B (chunk 12)    │ │
│  │  [编辑] [查看历史]         │  │                        │ │
│  │                            │  │  🔗 关联条目           │ │
│  │                            │  │  · [[服务发现]] 90%    │ │
│  │                            │  │  · [[API网关]] 82%     │ │
│  └────────────────────────────┘  └────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

**用户能做什么**：
1. **阅读**——人类可读的综合知识
2. **溯源**——点击来源文档跳转到文档库对应 chunk
3. **验证**——看置信度，判断是否可信
4. **修正**——点"编辑"改错的内容
5. **探索**——点关联条目在 Wiki 内跳转

### 8.4 层次 3：文档详情集成

在现有文档详情页（`/library/[id]`）的"概览"Tab 加一个小卡片：

```
文档详情 / 概览
├── 处理流水线 (现有)
├── 关键指标 (现有)
├── 文档详情 (现有)
└── 知识沉淀 (新增)
    └── 本文档已沉淀到知识库:
        → 1 个文档摘要
        → 3 个主题条目
        → 8 个概念条目
        [在知识库中查看 →]
```

### 8.5 颜色系统（Wiki 类型徽章）

| Wiki 类型 | 用途 | 配色 |
|---|---|---|
| `doc_summary` | 文档级摘要 | `violet`（主色，最高层级） |
| `topic` | 主题 | `blue`（信息） |
| `concept` | 概念 | `emerald`（成功/确认） |
| `claim` | 主张 | `amber`（需验证） |
| `conflicting` | 冲突 | `red`（危险） |

---

## 九、API 路由

`src/app/api/v1/wiki/`：
- `GET /api/v1/wiki/entries` — 列出 Wiki 条目（分页、按 type 过滤）
- `GET /api/v1/wiki/entries/[id]` — 单条目详情（含 links/backlinks）
- `PATCH /api/v1/wiki/entries/[id]` — 手动编辑（用户可修正 LLM 生成的内容）
- `GET /api/v1/wiki/index.md` — 导出 index.md（OKF 格式）
- `GET /api/v1/wiki/log.md` — 导出 log.md
- `POST /api/v1/wiki/synthesize` — 手动触发某文档的 Wiki 合成
- `POST /api/v1/wiki/validate` — 触发一致性校验（后续迭代）

---

## 十、配置开关

`ProcessingOptions` 新增：
```typescript
wikiEnabled?: boolean;  // 默认 true，可全局关闭省 token
```

在 Settings 页面新增"Wiki 综合层"开关（与 graph mode 开关并列）。

---

## 十一、validate 一致性校验（后续迭代，Phase 2）

- `POST /api/v1/wiki/validate` 路由触发后台扫描
- LLM 检查所有 `status = "active"` 条目间的一致性
- 发现矛盾 → 标记 `conflicting` + 创建 `WikiChangeLog` 记录
- 借鉴 Karpathy 的 `validate` 操作，演化现有 `audit.ts` 能力

---

## 十二、测试策略

遵循 AGENTS.md "写测试"要求，新建 `src/__tests__/wiki/`：
- `synthesizer.test.ts` — 合成逻辑（mock LLM），验证逐 chunk 增量不爆窗口
- `merger.test.ts` — 合并/去重/冲突检测（纯逻辑）
- `query.test.ts` — Wiki 检索相关性
- `writer.test.ts` — 写回飞轮增量更新
- `pipeline-integration.test.ts` — 管道集成（mock daemon）

---

## 十三、实现顺序

1. **阶段 1**（数据模型）— Prisma schema + migrate + User 关系
2. **阶段 2**（合成服务）— synthesizer（逐 chunk 增量 + 分层摘要）+ merger + prompts + types + index-md（纯逻辑，可先测试）
3. **阶段 3**（管道集成）— TaskType + wiki-synthesize-worker + 队列注册 + 触发点
4. **阶段 4**（写作查询）— query.ts + generator 改造 + context 改造
5. **阶段 5**（写回飞轮）— writer.ts + section 路由集成（单章节增量）
6. **阶段 6-前端层1**（溯源融入）— 4 处硬编码改动 + wiki 徽章
7. **阶段 6-前端层2**（浏览页）— `/wiki` 列表 + `/wiki/[id]` 详情
8. **阶段 6-前端层3**（文档详情）— 知识沉淀小卡片
9. **阶段 6-API** — wiki 路由
10. **测试** — synthesizer/merger/query/writer

每个阶段完成后运行 `npm test` 和 `npx tsc --noEmit` 验证。

---

## 十四、预期收益

- **写作质量**：跨章节主题一致性提升（Wiki 积累 → 后续章节直接复用已综合知识）
- **Token 节省**：Wiki 命中时减少原始 RAG 检索量（从 8 chunks → 4 chunks + Wiki）
- **知识透明度**：用户可在 Wiki 页面看到/编辑 LLM 综合的知识，不再黑盒
- **OKF 互操作**：`index.md` / `log.md` 导出支持 Obsidian 等工具消费
- **飞轮效应**：长期维护同一知识库、反复写作的场景下，Wiki 越用越丰富

---

## 十五、诚实的张力评估

1. **产品定位差异**：Synthetix 是写作工具，不是 Wiki/Q&A 工具。Wiki 层是"增强"而非"核心"。它服务于"让写作更准、更省 token"，而非变成独立产品。
2. **LightRAG 已部分缓解"重新发现"问题**：`kv_store_llm_response_cache.json` 已缓存抽取结果。但这是机器层缓存，不是人类可读的综合层——两者价值不同。
3. **OKF 的"生产者/消费者独立"对单用户自托管价值较低**：它的互操作性在多团队协作场景更有意义。对 Synthetix，导出能力是"加分项"非"必需"。
4. **Token 成本**：Wiki 维护需要额外 LLM 调用。但 `TokenUsage` 追踪 + 按 module 归因已为此做好准备，且 Wiki 积累后减少写作时的检索 token，长期可能净节省。
5. **"积累越来越丰富"的飞轮在一次性写作场景较弱**：如果用户每次都上传全新文档写一篇就走，Wiki 积累价值有限。飞轮在长期维护同一知识库、反复写作的场景最强。

---

## 附录 A：阶段工作量评估

| 阶段 | 复杂度 | 是否复用现有 |
|---|---|---|
| 阶段 1：Prisma schema | ⭐ 低 | 标准 Prisma 操作 |
| 阶段 2：合成服务 | ⭐⭐⭐ 高 | 复用 auto-tagger 模式 |
| 阶段 3：管道集成 | ⭐⭐ 中 | 复用现有 worker 模式 |
| 阶段 4：写作查询 | ⭐⭐ 中 | 复用现有检索模式 |
| 阶段 5：写回飞轮 | ⭐⭐ 中 | 复用 merger |
| 前端层 1：溯源融入 | ⭐ 极低 | 4 处代码改动 |
| 前端层 2：Wiki 浏览页 | ⭐⭐⭐ 中 | 复用 StatsRibbon/Card/Tabs |
| 前端层 3：文档详情卡片 | ⭐ 极低 | 一个静态卡片 |
| API 路由 | ⭐⭐ 中 | 标准 RESTful |

---

## 附录 B：前端设计规范摘要

> 完整规范见探索报告，此处仅列 Wiki 实现必须遵守的核心约定。

**布局**：
- Dashboard 布局：侧边栏固定 `w-[260px]`（左）+ 主内容区 `ml-[260px]`
- 页面骨架：`<div><Header title={...} /><div className="p-8">...</div></div>`
- 没有全局 Header，Header 是每个页面单独渲染的

**侧边栏注册**（`src/components/layout/sidebar.tsx`）：
- navGroups 的 workspace 组新增项
- 图标用内联 SVG path（`viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"`）
- 激活态判定：`pathname === item.href` 或 `pathname.startsWith(item.href)`（`/` 除外）
- 激活样式：`bg-primary-50 text-primary font-semibold dark:bg-primary/10`
- 链接项样式：`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium`

**i18n**：
- `src/lib/i18n/types.ts` 加 `wiki` 命名空间
- `locales/en.ts` 和 `zh-CN.ts` 同步翻译
- 用 `const { t, format, locale } = useLocale()`，文案绝不硬编码

**主题色板**：
- Primary（品牌紫）：light `#7C3AED` / dark `#8B5CF6`
- 配套 `--primary-50`…`--primary-900` 完整色阶
- 语义色：成功 emerald / 警告 amber / 危险 red / 信息 blue
- 中性色：背景 light `#F8FAFC` dark `#0B0F19`；卡片 light `#FFFFFF` dark `#111827`

**圆角令牌**：sm 6px / md 8px / lg 12px / xl 16px / 2xl 20px / 3xl 24px

**字体**：`--font-sans: Inter`、`--font-display: Plus Jakarta Sans`（标题/数字用 `font-display`，大数字加 `tabular-nums`）

**暗色模式**：`next-themes` 的 `attribute="class"`，CSS 用 `@custom-variant dark`。每个带颜色的组件都要写 dark 变体。

**动画**：入场用 `animate-fade-in-up` 及带延迟的 `-1`…`-6`（0.05s 步进）。骨架屏用 `shimmer-slide`。

**可直接复用的组件**：
- `Header`（`@/components/layout/header`）
- `StatusBadge`（`@/components/shared/status-badge`）
- `EmptyState`、`LoadingState`、`Spinner`（`@/components/shared/*`）
- `Button`、`Select*`、`Dialog`（`@/components/ui/*`）
- `MarkdownRenderer`（`@/components/shared/markdown-renderer`）
- `StatsRibbon`（`@/components/library/stats-ribbon`）

**手写组件模式**（无原语但高度一致）：
- 卡片：`bg-card border border-border rounded-[16px] p-5` + `animate-fade-in-up`
- 可点击卡片 hover：`hover:border-primary/30 hover:shadow-md transition-all cursor-pointer`
- Tabs（下划线式）：`py-3 px-5 text-sm font-medium border-b-2 -mb-px`，激活 `text-primary border-primary`
- 筛选 pill：`px-3.5 py-1.5 rounded-full border text-[13px] font-medium`，激活 `border-primary text-primary bg-primary-100`
- 搜索输入框：绝对定位放大镜 + `py-2 pr-3 pl-9 border rounded-lg`

**关键参考文件路径**：
- 布局：`src/app/(dashboard)/layout.tsx`、`src/components/layout/sidebar.tsx`、`src/components/layout/header.tsx`
- 主题：`src/app/globals.css`、`src/components/providers.tsx`
- 复合页参考（最接近 Wiki 形态）：`src/app/(dashboard)/search/page.tsx`
- 列表+表格参考：`src/app/(dashboard)/library/page.tsx`、`src/components/library/document-table.tsx`
- 详情页参考：`src/app/(dashboard)/library/[id]/page.tsx`
- 知识/详情面板参考：`src/components/topology/entity-evidence-panel.tsx`
- 搜索结果卡参考：`src/components/library/semantic-results.tsx`
- 徽章配色参考：`src/lib/search/result-badge.ts`、`src/components/shared/status-badge.tsx`
- i18n：`src/lib/i18n/types.ts`、`src/lib/i18n/locales/en.ts`、`src/lib/i18n/locales/zh-CN.ts`

---

## 附录 C：溯源面板融入的完整修改清单

要无缝融入 `wiki` 类型到写作溯源面板，需要改动的文件（按依赖顺序）：

| 优先级 | 文件 | 改动点 |
|---|---|---|
| 必改 | `prisma/schema.prisma` 第 288 行 | 注释加 `wiki`（列类型已是 String，无需迁移） |
| 必改 | `src/types/documents.ts` 第 87 行 | `SearchResultSource` 加 `"wiki"` |
| 必改 | `src/lib/search/semantic.ts` | 新增产出 `source: "wiki"` 的检索函数 |
| 必改 | `src/lib/writing/generator.ts` 第 127 行 | 二元判断改三元，加 `wiki` 分支 |
| 必改 | `src/lib/writing/context.ts` 第 29 行 | `ContextInput.ragReferences` 的 `sourceType` 联合类型加 `"wiki"` |
| 必改 | `src/lib/writing/persist-references.ts` 第 3-23、45-71 行 | `WritingReference` 联合类型加 `wiki` 成员；`createMany` 加 `wiki` 分支 |
| 必改 | `src/lib/writing/reference-view.ts` 第 18、42 行 | `RagReferenceView.sourceType` 加 `"wiki"`；映射逻辑透传 |
| 必改 | `src/components/writing/reference-panel.tsx` 第 279-292 行 | `referenceBadge` 加 `wiki` 分支（新颜色 + "Wiki" 文字） |
| 可选 | `src/components/writing/reference-panel.tsx` 第 273-277 行 | 若 wiki 是独立检索通道，模式切换加 `wiki` 档 |
| 可选 | `src/lib/writing/context.ts` 第 220 行 | prompt header 加 `[Type: wiki]` 提示 LLM |

**关键观察**：API 路由层（`generate/route.ts`、`drafts/[id]/route.ts`）、SSE 事件层（`sse-events.ts`）、前端 hook 层（`use-generation.ts`、`page.tsx`）**完全不需要改** —— 它们都是泛型透传 `sourceType`，只要上下游类型对齐就自动工作。

真正的"硬编码二元判断"只有 **3 处**：`generator.ts:127`、`persist-references.ts:45`、`reference-view.ts:42`，加上 UI 徽章 `reference-panel.tsx:279`。
