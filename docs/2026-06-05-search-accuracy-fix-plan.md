# 文档检索准确度修复方案

> 日期：2026-06-05
> 状态：待实施
> 影响范围：检索核心链路（LightRAG 查询、RRF 融合、FTS5 关键词、语义回退）

---

## 问题总览

搜索"微服务治理"时，高度匹配的章节被排在后面，前面结果相关性差。

根本原因：**检索链路中存在 4 层分数稀释**，外加 4 个架构级缺陷，导致高质量语义/图信号被逐步削弱，最终无法反映在排序上。

---

## 根因链条（4 层分数稀释 + 4 个架构缺陷）

### 第一层：LightRAG 图排序被独立向量查询覆盖

**文件**：`workers/python/rag_query.py:222-233`

LightRAG 的 `aquery_data()` 已通过知识图谱 + 向量混合策略对 chunks 完成综合排序。但代码紧接着单独查询了一次向量数据库，用纯 cosine 相似度覆盖了 LightRAG 的排序：

```python
# ❌ 当前代码 — 覆盖 LightRAG 排名
vdb_results = await rag.chunks_vdb.query(query_text, top_k=max(limit, len(chunks)) * 2)
for vr in vdb_results:
    cosine_map[cid] = float(dist)

raw_score = cosine_map.get(chunk_id)  # 丢弃了 LightRAG 的综合排名
```

**影响**：昂贵的 LLM 驱动图检索被降级为"纯向量相似度"，实体关联、关系权重等图信号全部丢失。

**修复方案**：使用 LightRAG 返回的 chunks 自身顺序作为排名依据，仅对缺失的 chunk 回退到 VDB 查询：

```python
# ✅ 修复后
output_chunks = []
for i, chunk in enumerate(chunks):
    chunk_id = chunk.get("chunk_id", "")
    content_text = chunk.get("content", "")

    # 提取标题
    title = ""
    for line in content_text.split("\n"):
        line = line.strip()
        if line.startswith("#"):
            m = re.match(r"^(#{1,6})\s+(.+)", line)
            if m:
                title = m.group(2)
                break

    # 优先使用 LightRAG 自身排名：位置越靠前，分数越高
    # 衰减公式：第1名 1.0，最后一名 ≥0.7
    if len(chunks) > 1:
        t = i / (len(chunks) - 1)
        score = max(0.0, 1.0 - t * 0.3)
    else:
        score = 1.0

    # 可选：如果该 chunk 在 VDB 中有结果，用 VDB cosine 作为辅助参考
    # 但不再覆盖 LightRAG 的顺序
    vdb_score = cosine_map.get(chunk_id)
    if vdb_score is not None:
        score = score * 0.7 + vdb_score * 0.3  # 主信号仍为 LightRAG 排名

    output_chunks.append({
        "chunk_id": chunk_id,
        "content": content_text[:4000],
        "title": title,
        "score": round(score, 4),
    })
```

---

### 第二层：RRF 融合丢弃所有原始相关性分数

**文件**：`src/lib/search/semantic.ts:284-326`

当前使用纯位置 RRF，K=60：

```ts
// ❌ 当前代码
const rrf = 1 / (K + i + 1);  // K = 60
```

所有原始分数（cosine 相似度、关键词 rank、图排名）被丢弃。cosine 0.95 和 cosine 0.41 的两个 chunk，只要同在第 5 名，RRF 权重完全一样。

K=60 导致排名差异极小：
- 第1名：1/61 = 0.0164
- 第10名：1/70 = 0.0143（仅差 13%）
- 第20名：1/80 = 0.0125（仅差 24%）

**修复方案**：加权 RRF，保留原始分数，并降低 K：

```ts
// ✅ 修复后
function weightedRrfFuse(
  semantic: SearchResult[],
  keyword: SearchResult[],
  limit: number,
): SearchResult[] {
  const K = 20;  // 从 60 降到 20，增强排名差异

  const scoreMap = new Map<string, { result: SearchResult; weightedScore: number }>();

  for (const [mode, results] of [
    ["semantic", semantic],
    ["keyword", keyword],
  ] as const) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const rrfRank = 1 / (K + rank + 1);
      const weighted = r.score * rrfRank;  // ← 保留原始分数
      const existing = scoreMap.get(r.chunkId);
      if (!existing || existing.weightedScore < weighted) {
        scoreMap.set(r.chunkId, { result: r, weightedScore: weighted });
      }
    }
  }

  return [...scoreMap.values()]
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, limit)
    .map((entry) => entry.result);
}
```

---

### 第三层：FTS5 短查询中文被解释为严格 AND

**文件**：`src/lib/search/tokenizer.ts:20-35`

jieba 把"微服务治理"切成 `["微服务", "治理"]`，然后生成：

```sql
"微服务" "治理"   -- 隐式 AND：两个词必须同时出现在同一个 chunk 中
```

对于 2500-token 的 chunk，这两个词可能出现在完全不同段落，恰好被切分到不同 chunk 后，FTS5 完全匹配不到。

**修复方案**：短查询（≤3 个 token）使用 OR 连接：

```ts
// ✅ 修复后
tokenizeQuery(query: string): string {
  const jieba = getJieba();
  const tokens = jieba.cutForSearch(query).filter((t) => t.trim().length > 0);
  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) return "";

  if (uniqueTokens.length <= 3) {
    // 短查询：OR 提升召回率
    return uniqueTokens.map((t) => `"${t}"`).join(" OR ");
  }

  // 长查询：保持原有滑动窗口 + AND 行为
  const groups: string[] = [];
  const windowSize = Math.min(3, uniqueTokens.length);
  for (let i = 0; i <= uniqueTokens.length - windowSize; i++) {
    const group = uniqueTokens.slice(i, i + windowSize).map((t) => `"${t}"`).join(" ");
    groups.push(`(${group})`);
  }
  return groups.join(" OR ");
}
```

---

### 第四层：语义相似度阈值过低

**文件**：`src/lib/search/semantic.ts:16`

```ts
// ❌ 当前
const MIN_COSINE_THRESHOLD = 0.4;  // cosine 0.4 ≈ 66° 夹角
```

cosine 0.4 意味着向量已经相当"正交"，大量弱相关甚至不相关的 chunk 通过过滤。配合前面三层的分数稀释，弱结果有机会排到前面。

**修复方案**：

```ts
// ✅ 修复后
const MIN_COSINE_THRESHOLD = 0.55;  // ≈ 56° 夹角 — 仍有召回空间，但过滤掉明显不相关的
```

---

## 额外发现的 4 个架构缺陷

### 缺陷 5：关键词搜索缺少用户隔离

**文件**：`src/lib/search/fts.ts:106-154`

当前 SQL 缺少 `user_id` 过滤，导致多用户场景下可能混入其他用户的文档匹配结果。

**修复方案**：

```ts
// ✅ 修复后：searchByKeyword 增加 userId 参数
export async function searchByKeyword(
  query: string,
  userId: string,      // ← 新增
  limit = 20,
  offset = 0,
): Promise<SearchResult[]> {
  // ...
  const rows = await db.$queryRawUnsafe<...>(
    `SELECT f.rowid, f.rank, ...
     FROM document_fts f
     JOIN document_chunks dc ON dc.rowid = f.rowid
     JOIN documents d ON d.id = dc.document_id
     WHERE document_fts MATCH ?
       AND d.user_id = ?    -- ← 新增
     ORDER BY f.rank
     LIMIT ? OFFSET ?`,
    tokenized,
    userId,              // ← 新增
    limit,
    offset,
  );
}
```

同时需要在 `semantic.ts:240` 调用处传入 `userId`：

```ts
let keywordResults = await searchByKeyword(query, userId, limit * 2).catch(() => []);
```

以及 keyword route：

```ts
const results = await searchByKeyword(query, user.id, limit, offset);
```

---

### 缺陷 6：暴力嵌入回退只采样 500 个 chunk

**文件**：`src/lib/search/semantic.ts:96-107`

```ts
// ❌ 当前
const chunks = await db.documentChunk.findMany({
    where: { embedding: { not: null }, document: { userId } },
    take: 500,  // ← 只取前 500 个，无 ORDER BY
});
```

当文档量超过 500 个 chunk 时，大量文档根本不会参与相似度计算。相关 chunk 可能在 500 之外被直接忽略。

**修复方案**（短期）：

```ts
// ✅ 短期修复：增加采样量，按文档分组均匀采样
const totalCount = await db.documentChunk.count({
    where: { embedding: { not: null }, document: { userId } },
});

// 如果总量不大，全部加载
const take = Math.min(totalCount, 2000);
const chunks = await db.documentChunk.findMany({
    where: { embedding: { not: null }, document: { userId } },
    take,
});
```

**长期方案**：引入近似最近邻（ANN）索引，如 pgvector 的 ivfflat/hnsw，或专用于向量的存储后端（如 Milvus/Qdrant）。

---

### 缺陷 7：Score 衰减公式过弱

**文件**：`workers/python/rag_query.py:252-256`

```python
# ❌ 当前
t = i / (len(chunks) - 1)
score = 1.0 - t * t * 0.3   # 最后一名仍有 0.7
```

第 40 名和第 1 名分数只差 0.3，导致靠后 chunk 仍然获得虚高分数。

**修复方案**：

```python
# ✅ 修复后：线性衰减，差异更明显
if len(chunks) > 1:
    t = i / (len(chunks) - 1)
    score = max(0.3, 1.0 - t * 0.6)   # 第1名 1.0，最后一名 0.4
else:
    score = 1.0
```

---

### 缺陷 8：QueryParam 配置过于精简

**文件**：`workers/python/rag_query.py:208-212`

```python
# ❌ 当前
param = QueryParam(
    mode=mode,
    chunk_top_k=limit,      # 默认 20，对 mix 模式偏小
    only_need_context=True,
)
```

`chunk_top_k=20` 在 `mix` 模式下可能限制了混合检索的候选池，导致部分相关 chunk 在内部竞争中被提前淘汰。

**修复方案**：

```python
# ✅ 修复后
param = QueryParam(
    mode=mode,
    chunk_top_k=max(limit * 3, 50),   # 扩大候选池
    only_need_context=True,
)
```

> 注：LightRAG v1.5.0 支持的 QueryParam 字段请查阅源码确认，上述为保守调优。

---

## 修改文件清单

| 优先级 | 文件 | 修改内容 | 预估影响 |
|:---:|------|---------|---------|
| P0 | `workers/python/rag_query.py:222-264` | 移除独立 VDB 查询，保留 LightRAG 排名，VDB 仅作辅助 | 显著改善语义检索排序 |
| P0 | `src/lib/search/semantic.ts:284-326` | 纯位置 RRF → 加权 RRF，K 从 60 降到 20 | 显著改善融合排序 |
| P0 | `src/lib/search/tokenizer.ts:20-35` | 短查询（≤3 token）使用 OR | 提升中文关键词召回 |
| P0 | `src/lib/search/semantic.ts:16` | MIN_COSINE_THRESHOLD 0.4 → 0.55 | 过滤弱相关结果 |
| P1 | `src/lib/search/fts.ts:106-154` | searchByKeyword 增加 userId 参数，SQL 增加 user_id 过滤 | 安全 + 准确度 |
| P1 | `src/lib/search/semantic.ts:96-107` | 暴力回退采样从 500 提升到 2000 或全量 | 召回率 |
| P1 | `src/lib/search/semantic.ts:240` | searchByKeyword 调用传入 userId | 配合 P1 #5 |
| P1 | `src/app/api/v1/library/search/keyword/route.ts` | 调用 searchByKeyword 传入 user.id | 配合 P1 #5 |
| P1 | `workers/python/rag_query.py:252-256` | 位置衰减公式加强 | 排名区分度 |
| P1 | `workers/python/rag_query.py:208-212` | chunk_top_k 从 limit 提升到 limit*3 或 50 | 混合检索候选池 |

---

## 实施顺序建议

```
Step 1: 修改 rag_query.py（P0 #1 + P1 #9 + P1 #10）
        └─ 这是 LightRAG 查询的核心，先修复上游信号

Step 2: 修改 semantic.ts（P0 #2 + P0 #4 + P1 #6 + P1 #7）
        └─ 修复融合层和过滤层

Step 3: 修改 tokenizer.ts（P0 #3）
        └─ 修复关键词召回

Step 4: 修改 fts.ts + keyword route + semantic.ts 调用（P1 #5 + #6 + #7 + #8）
        └─ 修复用户隔离

Step 5: 运行验证
```

---

## 验证清单

1. **搜索 "微服务治理"**
   - 前 3 名结果应与微服务治理直接相关
   - 不应出现无关的技术栈或章节

2. **搜索 "Kubernetes"**
   - 单英文词，验证短查询 OR 逻辑不破坏英文检索

3. **搜索 "服务发现 负载均衡 熔断"**
   - 长查询（>3 token），验证原有滑动窗口逻辑仍适用

4. **搜索纯数字/符号**
   - 如 "HTTP 404"，验证 tokenizer 不崩溃

5. **多用户隔离验证**
   - 用户 A 上传包含 "微服务" 的文档
   - 用户 B 搜索 "微服务"，结果中不应出现用户 A 的文档

6. **构建检查**
   - `pnpm lint` — 零错误
   - `pnpm build` — 成功
   - `pnpm test` — 通过（如有相关测试）

---

## 回滚预案

每项修改均为局部、可独立回滚：
- `rag_query.py` 和 `semantic.ts` 的修改可通过 `git checkout -- <file>` 秒级回滚
- `tokenizer.ts` 的修改影响面最小（仅关键词查询语法）
- `fts.ts` 的 userId 修改是新增参数，不影响旧调用（需同步更新调用处）

建议在开始实施前创建分支：`git checkout -b fix/search-accuracy-2026-06-05`

---

## 附录：当前代码中的关键参数速查

| 参数 | 当前值 | 建议值 | 位置 |
|------|-------|-------|------|
| MIN_COSINE_THRESHOLD | 0.4 | 0.55 | `semantic.ts:16` |
| RRF K | 60 | 20 | `semantic.ts:289` |
| chunk_top_k | limit (默认20) | max(limit*3, 50) | `rag_query.py:210` |
| 暴力回退 take | 500 | 2000 或全量 | `semantic.ts:106` |
| 位置衰减 | `1 - t²×0.3` | `max(0.3, 1 - t×0.6)` | `rag_query.py:254` |

---

## 参考

- LightRAG 版本：`lightrag-hku==1.5.0`
- 已有设计文档：`docs/2026-06-05-search-accuracy-improvement.md`（识别了前 4 个问题）
- 本方案在此基础上补充了用户隔离、采样量、衰减公式、QueryParam 等 4 个额外缺陷
