# Dual-Path Document System — Refined Design

> **Status**: Design Review Complete  
> **Supersedes**: `dual-path-document-system-design.md` (cross-analysis applied)  
> **Scope**: Path A (Domain Documents) optimization, Path B (RAG Chunks) untouched  

---

## 1. 设计目标与范围

### 1.1 保留原设计的核心价值
- **双路并行架构**不变：Path A（Domain Documents）+ Path B（RAG Chunks）
- **Docling 作为转换主路径**，MarkItDown fallback
- **Path A 失败不阻塞 Path B**，文档仍可达 `ready`
- **Domain 文档可编辑**，且编辑只影响后续生成

### 1.2 本次改进的六大痛点

原设计在概念层面已成立，但工程实施层面存在以下**可落地的优化空间**：

| # | 痛点 | 影响 | 本文档的改进 |
|---|---|---|---|
| 1 | **LLM 调用链路过长**（分类 → N 个摘要 → 生成时选择） | 单文档处理成本 +30~50%，延迟 8~23s | 合并分类+摘要为**单次 LLM 调用** |
| 2 | **Domain 无稳定标识** | 重新处理文档后，用户编辑过的 Domain 内容关联丢失 | 引入 **contentHash 锚定** + 编辑继承策略 |
| 3 | **Domain Docs 在 Prompt 中位置靠后** | LLM 注意力衰减，"优先使用 Domain" 的指令落空 | 调整至 **RAG 之前**，加显式优先级指令 |
| 4 | **selectDomainDocuments 全量查询** | 用户文档多时报出 500 条记录，DB + LLM 输入压力大 | **粗筛（向量 Top-20）→ 细选（LLM Top-4）** |
| 5 | **图像提取无映射表** | TS 端无法将 structure.json 的 `image_ref` 关联到实际文件 | Python 端输出 **image manifest** |
| 6 | **8000 字符截断 vs 完整知识矛盾** | Path A 的核心卖点是"完整领域知识"，但硬截断后无异于大 chunk | 引入 **子分块 + 运行时动态组装** |

### 1.3 非目标（明确排除）
- 不修改 Path B（RAG pipeline）的任何逻辑
- 不替换现有的向量数据库或索引结构
- 不引入新的异步队列或事件系统
- 不修改用户认证或权限模型

---

## 2. 核心改进详解

### 2.1 改进一：合并 Domain 分类与摘要（单次 LLM 调用）

#### 原设计的问题
原设计在 Phase 2 中执行：
1. `classifyDomains(previews)` → 返回 `{ domains: [{ key, label, sectionIndices }] }`
2. 按 domain 分组后，**每个 domain 并行调用** `generateDomainSummary(group)`

对于 5 个 domain 的文档，这意味着 **1 + 5 = 6 次 LLM 调用**。

#### 改进方案
让 LLM 在分类的同时生成摘要，输出格式：

```json
{
  "domains": [
    {
      "key": "financial_analysis",
      "label": "财务分析",
      "sectionIndices": [2, 3, 4, 8],
      "summary": "涵盖财务报表分析方法、比率分析及现金流评估框架，适用于公司财务健康度评估场景。"
    },
    {
      "key": "accounting_basics",
      "label": "会计基础",
      "sectionIndices": [0, 1],
      "summary": "介绍会计恒等式、复式记账法及常见会计科目分类。"
    }
  ]
}
```

#### 技术理由
- LLM 在分类时已经阅读了所有 section previews（~4000 tokens），此时生成摘要的**边际成本极低**
- 减少 5 次 API round-trip，延迟从 8~23s 降至 **3~8s**
- 摘要质量反而可能更高，因为 LLM 在分类时拥有全局视角

#### Prompt 调整（`domainClassifyAndSummarize`）

```
You are a document domain analyst. Given a list of document sections with their 
headings and content previews, classify them into 2-6 thematic domains and generate 
a concise summary for each domain.

Rules:
- Produce 2-6 domains (no more, no less)
- Domain keys must be lowercase snake_case English (e.g. "financial_analysis")
- Domain labels must be in the SAME LANGUAGE as the document content
- Adjacent sections about related topics should share a domain
- Each section must appear in exactly one domain
- A domain should ideally contain 2+ sections unless the document is short
- Summaries must be 100-200 characters, capturing key topics and methodologies

Output JSON:
{
  "domains": [
    {
      "key": "snake_case_key",
      "label": "Human Readable Label",
      "sectionIndices": [0, 1, 2],
      "summary": "Concise summary of what this domain covers."
    }
  ]
}
```

#### 短路与降级逻辑（不变）
- `sections.length <= 2` → 单 domain，`summary = 首段 300 字符`
- `no writingModel` → 按 H1 分组，`summary = 首段 150 字符`

---

### 2.2 改进二：Domain 稳定标识与编辑持久化

#### 原设计的问题
Domain 的 `id` 是每次重新处理时新生成的 CUID。如果用户编辑了某个 domain 的 content/summary，然后重新上传了同一份文档，旧编辑内容**无法关联到新 domain**。

#### 改进方案：引入 `stableDomainId`

**数据模型变更**：

```prisma
model DomainDocument {
  id              String   @id @default(cuid())
  stableDomainId  String   // NEW: 稳定标识，用于跨处理周期关联
  documentId      String
  userId          String
  domain          String   // snake_case key: "financial_terms"
  domainLabel     String   // display label
  title           String
  content         String
  summary         String?
  headingPath     String?
  tokenCount      Int      @default(0)
  index           Int      @default(0)
  sourcePages     String?
  isUserEdited    Boolean  @default(false)  // NEW: 标记是否被用户编辑过
  editCount       Int      @default(0)       // NEW: 编辑次数

  document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user            User     @relation(fields: [userId], references: [id])

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([documentId])
  @@index([userId, stableDomainId])
  @@index([documentId, stableDomainId])
}
```

#### `stableDomainId` 生成算法

```typescript
function generateStableDomainId(
  documentId: string,
  headingPath: string | null,
  contentPreview: string,  // 前 500 字符
): string {
  const normalizedPath = (headingPath || "root").toLowerCase().trim();
  const normalizedContent = contentPreview
    .slice(0, 500)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  
  const hash = createHash("sha256")
    .update(`${documentId}:${normalizedPath}:${normalizedContent}`)
    .digest("hex")
    .slice(0, 16);
  
  return hash;
}
```

**逻辑**：基于 `documentId + headingPath + 内容指纹` 生成哈希。同一文档重新处理时，如果 headingPath 和内容前 500 字符未变，`stableDomainId` 保持不变。

#### 编辑继承策略（Re-process 时）

```typescript
async function persistDomainDocuments(
  newDomains: DomainGroup[],
  documentId: string,
  userId: string,
): Promise<void> {
  // 1. 查询旧记录中用户编辑过的内容
  const oldEdited = await prisma.domainDocument.findMany({
    where: { documentId, isUserEdited: true },
    select: { stableDomainId: true, content: true, summary: true },
  });
  const editMap = new Map(oldEdited.map(d => [d.stableDomainId, d]));

  // 2. 生成新记录的 stableDomainId
  const newRecords = newDomains.map(group => {
    const stableId = generateStableDomainId(
      documentId,
      group.sections[0]?.headingPath || null,
      group.sections.map(s => s.content).join(" ").slice(0, 500),
    );
    
    const oldEdit = editMap.get(stableId);
    
    return {
      stableDomainId: stableId,
      documentId,
      userId,
      domain: group.domain,
      domainLabel: group.domainLabel,
      title: group.sections[0]?.headingText || "Untitled",
      content: oldEdit?.content ?? assembleDomainContent(group.sections),
      summary: oldEdit?.summary ?? group.summary,
      headingPath: group.sections[0]?.headingPath || null,
      tokenCount: estimateTokenCount(group.sections),
      isUserEdited: !!oldEdit,
    };
  });

  // 3. 原子替换：删除旧记录，插入新记录
  await prisma.$transaction([
    prisma.domainDocument.deleteMany({ where: { documentId } }),
    prisma.domainDocument.createMany({ data: newRecords }),
  ]);
}
```

**效果**：用户编辑过的 domain，在文档重新处理后**内容自动保留**；未编辑的 domain 则使用新生成的内容。

---

### 2.3 改进三：Prompt 中 Domain Docs 的位置修正

#### 原设计的问题
原设计将 Domain Docs 放在 RAG 之后：
> outline → completed summaries → RAG → **domain docs** → target section → constraints

LLM 的注意力机制对 prompt 中间位置的重视程度通常低于开头和结尾。虽然原设计加了 "Prioritize them over the RAG references above" 的指令，但**物理位置与逻辑优先级不匹配**。

#### 改进方案

**调整后的 Block Order**：
```
1. Outline                    (结构约束)
2. Completed summaries        (已完成内容的连贯性)
3. [NEW] Domain Knowledge Base (主要参考)
4. RAG References             (补充参考)
5. Target section             (当前任务)
6. Constraints                (硬性约束)
7. Instruction                (行动指令)
```

**Domain Knowledge Base 格式**：

```
## Domain Knowledge Base

The following domain-specific documents are the PRIMARY reference for this section.
Use them before consulting the RAG references below. If there is a conflict between
Domain Knowledge and RAG snippets, prioritize Domain Knowledge.

### 财务分析 — Chapter 3: Financial Statements
> Source: annual_report.pdf
> Relevance: High (directly related to current section topic)

[full content or truncated content]

---

### 会计基础 — Chapter 1: Accounting Principles
> Source: annual_report.pdf
> Relevance: Medium (foundational knowledge)

[full content or truncated content]
```

**关键变化**：
- 位置从 RAG 之后 → **RAG 之前**
- 增加显式指令："If there is a conflict between Domain Knowledge and RAG snippets, prioritize Domain Knowledge"
- 增加 `Relevance` 标签（由 `selectDomainDocuments` 根据 LLM 选择时的 confidence 标注）

---

### 2.4 改进四：selectDomainDocuments 粗筛 + 细选

#### 原设计的问题
原设计直接 `Load all user's DomainDocuments from DB`，然后全量喂给 LLM。当用户有 50+ 文档时，这可能产生：
- DB 查询沉重（即使只取 summary，也是 50×5=250 条记录）
- LLM 输入噪音大（不相关的 domain 干扰选择质量）

#### 改进方案：两阶段选择

```typescript
async function selectDomainDocuments(
  draftTitle: string,
  section: { title: string; description?: string | null; keyPoints?: string | null },
  userId: string,
  provider: any,
  modelId: string,
  ragDocumentIds?: string[],
): Promise<DomainDocumentMeta[]> {
  // ===== Stage 1: 粗筛（轻量级，无需 LLM） =====
  const queryText = `${draftTitle} ${section.title} ${section.description || ""} ${section.keyPoints || ""}`;
  
  // 1a. 获取候选 pool（限制 100 条）
  const candidates = await prisma.domainDocument.findMany({
    where: {
      userId,
      ...(ragDocumentIds?.length ? { documentId: { in: ragDocumentIds } } : {}),
    },
    select: {
      id: true,
      stableDomainId: true,
      domain: true,
      domainLabel: true,
      title: true,
      summary: true,
      tokenCount: true,
      headingPath: true,
      documentId: true,
    },
    take: 100,
  });

  if (candidates.length === 0) return [];
  if (candidates.length <= 8) {
    // 候选少，跳过粗筛，直接细选
    return fineSelect(candidates, queryText, provider, modelId);
  }

  // 1b. 关键词粗筛（零成本）
  const queryTokens = new Set(tokenize(queryText.toLowerCase()));
  const scored = candidates.map(c => {
    const text = `${c.domainLabel} ${c.title} ${c.summary || ""}`.toLowerCase();
    const textTokens = new Set(tokenize(text));
    const overlap = [...queryTokens].filter(t => textTokens.has(t)).length;
    return { ...c, score: overlap / queryTokens.size };
  });

  // 1c. 取 Top-20 进入细选
  const topCandidates = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ score, ...rest }) => rest);

  // ===== Stage 2: 细选（LLM，仅 20 个候选） =====
  return fineSelect(topCandidates, queryText, provider, modelId);
}

async function fineSelect(
  candidates: DomainDocumentMeta[],
  queryText: string,
  provider: any,
  modelId: string,
): Promise<DomainDocumentMeta[]> {
  const compactIndex = candidates.map(c => ({
    id: c.id,
    domain: c.domainLabel,
    title: c.title,
    summary: (c.summary || "").slice(0, 150),
    tokens: c.tokenCount,
  }));

  const response = await callLLM(provider, modelId, {
    system: domainSelectPrompt,
    user: `Query: ${queryText}\n\nAvailable domains:\n${JSON.stringify(compactIndex, null, 2)}`,
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(response);
    const selectedIds = parsed.selectedIds || [];
    const validIds = selectedIds.filter((id: string) =>
      candidates.some(c => c.id === id)
    );
    return candidates.filter(c => validIds.includes(c.id)).slice(0, 4);
  } catch {
    return [];
  }
}
```

**效果**：
- LLM 输入从 250 条 → **最多 20 条**，噪音降低 90%
- DB 查询始终有 `take: 100` 上限，避免意外全表扫描
- 关键词粗筛零成本（纯本地字符串匹配）

---

### 2.5 改进五：Image Manifest 映射表

#### 原设计的问题
Python 端提取图像时使用 `hashlib.md5(img_bytes).hexdigest()[:8]` 生成文件名，但 `structure.json` 中的 `figure` 节点只有 `image_ref`（可能是 Docling 内部 ID），没有文件名映射。TS 端无法可靠地将 markdown 中的 `![caption](images/xxx.png)` 关联到正确的文件。

#### 改进方案

**Python 端（`convert.py`）**：

```python
def _extract_images(conversion_result, images_dir):
    """Extract images and build manifest for TS-side association."""
    manifest = []
    count = 0
    
    try:
        for item, level in conversion_result.document.iterate_items():
            if hasattr(item, 'image') and item.image:
                img_bytes = item.image
                if len(img_bytes) < 500:
                    continue
                
                import hashlib
                h = hashlib.md5(img_bytes).hexdigest()[:8]
                fname = f"img_{count:03d}_{h}.png"
                fpath = os.path.join(images_dir, fname)
                
                with open(fpath, "wb") as f:
                    f.write(img_bytes)
                
                # Build manifest entry with Docling's internal ref
                manifest.append({
                    "ref": getattr(item, 'ref', f"figure_{count}"),
                    "filename": fname,
                    "path": f"images/{fname}",
                    "page": getattr(item, 'page_no', None),
                    "caption": getattr(item, 'caption', None) or f"Figure {count}",
                    "size": len(img_bytes),
                })
                count += 1
    except Exception as e:
        print(f"[Image extraction warning]: {e}", file=sys.stderr)
    
    # Write manifest
    manifest_path = os.path.join(images_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"images": manifest, "count": count}, f, ensure_ascii=False, indent=2)
    
    return count
```

**TS 端解析时**：

```typescript
// docling-parser.ts
interface ImageManifest {
  images: {
    ref: string;
    filename: string;
    path: string;
    page: number | null;
    caption: string | null;
    size: number;
  }[];
  count: number;
}

function resolveImageRef(
  doclingImageRef: string,
  manifest: ImageManifest,
): string | null {
  const entry = manifest.images.find(img => img.ref === doclingImageRef);
  return entry?.path ?? null;
}
```

**效果**：TS 端可通过 `manifest.json` 精确关联 Docling 的 `image_ref` 到实际文件路径。

---

### 2.6 改进六：超长 Domain 的子分块与动态组装

#### 原设计的问题
原设计硬性限制：
- `DOMAIN_DOC_TOTAL_CHAR_LIMIT = 8000`
- `DOMAIN_DOC_PER_CHAR_LIMIT = 4000`

如果一个 domain 是 30 页的财务方法论（可能 15000+ 字符），截断到 4000 字符后，它和 RAG chunk 的差异就不大了，Path A 的核心价值被削弱。

#### 改进方案：分层存储 + 运行时按需组装

**数据模型扩展**：

```prisma
model DomainDocument {
  // ... existing fields ...
  
  // NEW: 子分块支持
  chunkCount      Int      @default(1)   // 该 domain 被拆成了几个子块
  fullContent     String?                // 完整内容（当 chunkCount > 1 时存储）
}
```

**Phase 2 处理逻辑**：

```typescript
const DOMAIN_DOC_CHUNK_THRESHOLD = 4000;  // 超过此长度触发子分块
const DOMAIN_DOC_CHUNK_SIZE = 3500;       // 每个子块目标长度

function maybeChunkDomainContent(content: string): { chunks: string[]; fullContent: string } {
  if (content.length <= DOMAIN_DOC_CHUNK_THRESHOLD) {
    return { chunks: [content], fullContent: content };
  }
  
  // 按段落边界智能分块（优先在换行处切割）
  const chunks: string[] = [];
  let remaining = content;
  
  while (remaining.length > 0) {
    let cutPoint = DOMAIN_DOC_CHUNK_SIZE;
    
    // 寻找最近的段落边界（双换行）
    const nextBreak = remaining.indexOf("\n\n", cutPoint * 0.8);
    if (nextBreak !== -1 && nextBreak < DOMAIN_DOC_CHUNK_SIZE * 1.2) {
      cutPoint = nextBreak;
    }
    
    chunks.push(remaining.slice(0, cutPoint).trim());
    remaining = remaining.slice(cutPoint).trim();
  }
  
  return { chunks, fullContent: content };
}
```

**Phase 4 运行时组装逻辑**：

```typescript
function buildDomainDocumentsSection(
  domainDocs: DomainDocumentMeta[],
  totalCharBudget: number = 8000,
): string {
  if (domainDocs.length === 0) return "";
  
  const perDocBudget = Math.floor(totalCharBudget / domainDocs.length);
  const lines: string[] = [
    "## Domain Knowledge Base",
    "",
    "The following domain-specific documents are the PRIMARY reference for this section.",
    "Use them before consulting the RAG references below.",
    "",
  ];
  
  let totalUsed = 0;
  
  for (const doc of domainDocs) {
    const budget = Math.min(perDocBudget, totalCharBudget - totalUsed);
    if (budget <= 0) break;
    
    // 如果 domain 有子分块，只取第一个子块（最重要的部分）
    // 未来可扩展为根据 section topic 选择最相关的子块
    const content = doc.content.slice(0, budget);
    totalUsed += content.length;
    
    lines.push(`### ${doc.domainLabel} — ${doc.title}`);
    lines.push(`> Source: ${doc.documentName}`);
    if (doc.chunkCount > 1) {
      lines.push(`> Note: This domain has ${doc.chunkCount} sub-sections. Only the first is shown due to context limits.`);
    }
    lines.push("");
    lines.push(content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  
  return lines.join("\n");
}
```

**效果**：
- 超长 domain 的内容**完整保留在 DB** 中（`fullContent`）
- 运行时根据预算**智能截取**（优先取第一个子块）
- 为未来扩展留空间：可根据 section topic 的相似度，选择最相关的子块而非固定取第一个

---

### 2.7 改进七：Fallback 可见性（用户通知）

#### 原设计的问题
原设计中，Docling fallback 到 MarkItDown 是**静默**的（只有 `console.warn`）。用户不知道自己的文档没有享受到结构化解析，可能长期误以为 domain 拆分质量不佳。

#### 改进方案

**数据模型**：

```prisma
model Document {
  // ... existing fields ...
  conversionMethod   String?  // "docling" | "markitdown" | "markitdown-fallback"
  conversionWarning  String?  // 可读的用户提示，如 "PDF 结构复杂，使用备用转换器"
}
```

**UI 展示**：
- Library 文档列表中，fallback 的文档显示 **⚠️ 图标 + tooltip**
- Domain tab 中，如果 `conversionMethod === "markitdown-fallback"`，显示提示："该文档使用备用转换器解析，Domain 拆分可能不够精确。"

**Python 端**：

```python
result = {
    "markdown": md_path,
    "structure": struct_path,
    "imageCount": image_count,
    "format": os.path.splitext(input_path)[1].lower(),
    "conversionMethod": "docling",
}

# fallback 时
result["conversionMethod"] = "markitdown-fallback"
result["conversionWarning"] = f"文档结构解析使用备用模式。原因：{str(e)[:100]}"
```

---

## 3. 完整数据模型

### 3.1 新增/修改的 Prisma Schema

```prisma
// ============================================
// DomainDocument（Path A 核心表）
// ============================================
model DomainDocument {
  id              String   @id @default(cuid())
  stableDomainId  String   // 稳定标识，用于跨处理周期关联
  documentId      String
  userId          String
  domain          String   // snake_case key
  domainLabel     String   // 用户语言标签
  title           String
  content         String   // 实际注入 prompt 的内容（可能截断/子分块）
  fullContent     String?  // 完整原始内容（chunkCount > 1 时存储）
  summary         String?
  headingPath     String?
  tokenCount      Int      @default(0)
  index           Int      @default(0)
  sourcePages     String?
  chunkCount      Int      @default(1)
  isUserEdited    Boolean  @default(false)
  editCount       Int      @default(0)

  document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user            User     @relation(fields: [userId], references: [id])

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([documentId])
  @@index([userId, stableDomainId])
  @@index([documentId, stableDomainId])
  @@index([documentId, domain])
}

// ============================================
// Document（Path A 状态扩展）
// ============================================
model Document {
  // ... existing fields ...
  domainDocuments   DomainDocument[]
  
  // NEW: 转换元数据
  conversionMethod  String?   // "docling" | "markitdown" | "markitdown-fallback"
  conversionWarning String?   // 用户可读警告
  domainCount       Int       @default(0)  // Path A 生成的 domain 数量
}

// ============================================
// User（关系扩展）
// ============================================
model User {
  // ... existing fields ...
  domainDocuments DomainDocument[]
}
```

### 3.2 TypeScript 类型

```typescript
// src/types/documents.ts

export interface DomainDocumentMeta {
  id: string;
  stableDomainId: string;
  documentId: string;
  domain: string;
  domainLabel: string;
  title: string;
  content: string;
  fullContent: string | null;
  summary: string | null;
  headingPath: string | null;
  tokenCount: number;
  index: number;
  sourcePages: string | null;
  chunkCount: number;
  isUserEdited: boolean;
  editCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DomainClassification {
  domains: {
    key: string;
    label: string;
    sectionIndices: number[];
    summary: string;
  }[];
}

export interface DomainSplitResult {
  domainDocs: DomainDocumentMeta[];
  error?: string;
}

export interface ImageManifest {
  images: {
    ref: string;
    filename: string;
    path: string;
    page: number | null;
    caption: string | null;
    size: number;
  }[];
  count: number;
}
```

---

## 4. 详细实施路径

### 4.1 Phase 0: Docling 集成（3h → 3.5h）

| 子任务 | 文件 | 变更 | 备注 |
|---|---|---|---|
| 0.1 | `workers/python/convert.py` | 重写 | Docling 主路径 + MarkItDown fallback + image manifest |
| 0.2 | `workers/python/requirements.txt` | 编辑 | 添加 `docling>=2.15.0`，移除旧依赖 |
| 0.3 | `src/lib/documents/converter.ts` | 重写 | `ConversionResult` 返回 `conversionMethod` / `conversionWarning` |
| 0.4 | `src/lib/documents/pipeline.ts` | 编辑 | `ProcessingContext` 加 `structurePath`，`convertDocument()` 解析新返回 |
| 0.5 | `prisma/schema.prisma` | 编辑 | `Document` 表加 `conversionMethod`, `conversionWarning`, `domainCount` |

**关键代码片段（`converter.ts`）**：

```typescript
export interface ConversionResult {
  markdown: string;
  structure: string | null;
  imageCount: number;
  format: string;
  conversionMethod: "docling" | "markitdown" | "markitdown-fallback";
  conversionWarning?: string;
  fallbackReason?: string;
}
```

### 4.2 Phase 1: 数据模型（0.5h → 1h）

| 子任务 | 文件 | 变更 |
|---|---|---|
| 1.1 | `prisma/schema.prisma` | 添加 `DomainDocument` 模型 |
| 1.2 | `src/types/documents.ts` | 添加 `DomainDocumentMeta` 等类型 |
| 1.3 | `prisma/migrations/` | 生成迁移 `npx prisma migrate dev --name add-domain-document-v2` |

### 4.3 Phase 2: Domain 拆分器（2.5h → 3h）

| 子任务 | 文件 | 变更 | 备注 |
|---|---|---|---|
| 2.1 | `src/lib/documents/docling-parser.ts` | 新建 | 解析 structure.json + manifest.json |
| 2.2 | `src/lib/documents/domain-splitter.ts` | 新建 | 单次 LLM 分类+摘要，含 stableId 生成 |
| 2.3 | `src/lib/prompts/locales/en-prompts.ts` | 编辑 | 添加 `domainClassifyAndSummarize` |
| 2.4 | `src/lib/prompts/locales/zh-CN-prompts.ts` | 编辑 | 添加 `domainClassifyAndSummarize` |
| 2.5 | `src/lib/documents/__tests__/docling-parser.test.ts` | 新建 | 覆盖所有 parser 边界条件 |
| 2.6 | `src/lib/documents/__tests__/domain-splitter.test.ts` | 新建 | 覆盖短路、降级、错误处理 |

### 4.4 Phase 3: 并行流水线（1.5h → 1.5h，不变）

| 子任务 | 文件 | 变更 |
|---|---|---|
| 3.1 | `src/lib/queue/workers/document-worker.ts` | 编辑 | `Promise.allSettled` 分叉，Path A 失败不阻塞 |

**进度更新逻辑**：

```typescript
// Path A 完成后更新 document.domainCount
if (pathAResult.status === "fulfilled" && pathAResult.value.ok) {
  await prisma.document.update({
    where: { id: ctx.docId },
    data: { domainCount: pathAResult.value.domainCount },
  });
}
```

### 4.5 Phase 4: 生成上下文（3h → 4h）

| 子任务 | 文件 | 变更 | 备注 |
|---|---|---|---|
| 4.1 | `src/lib/writing/generator.ts` | 编辑 | 添加 `selectDomainDocuments()` 调用 |
| 4.2 | `src/lib/writing/context.ts` | 编辑 | `buildDomainDocumentsSection()` + prompt 位置调整 |
| 4.3 | `src/lib/writing/select-domain.ts` | 新建 | 粗筛 + 细选两阶段逻辑 |
| 4.4 | `src/lib/prompts/locales/en-prompts.ts` | 编辑 | 添加 `domainSelect` prompt |
| 4.5 | `src/lib/prompts/locales/zh-CN-prompts.ts` | 编辑 | 添加 `domainSelect` prompt |
| 4.6 | `src/lib/writing/__tests__/select-domain.test.ts` | 新建 | 粗筛精度、细选边界条件 |

### 4.6 Phase 5: Library UI（3h → 3.5h）

| 子任务 | 文件 | 变更 | 备注 |
|---|---|---|---|
| 5.1 | `src/app/api/v1/library/domains/route.ts` | 新建 | GET 列表 |
| 5.2 | `src/app/api/v1/library/domains/[id]/route.ts` | 新建 | GET 单条 + PUT 更新 |
| 5.3 | `src/app/api/v1/library/domains/index/route.ts` | 新建 | GET distinct domains |
| 5.4 | `src/components/library/domain-document-list.tsx` | 新建 | 分组列表 + 过滤 |
| 5.5 | `src/components/library/domain-document-edit-modal.tsx` | 新建 | 编辑模态框 |
| 5.6 | `src/app/(dashboard)/library/page.tsx` | 编辑 | 添加 Tab + fallback 提示 |

**新增 UI 元素**：
- 文档卡片上的 conversion method badge（docling = 🟢, fallback = 🟡）
- Domain tab 中的 `isUserEdited` 标记（已编辑 = ✏️ 图标）

### 4.7 Phase 6: 引用展示（1h → 1h，不变）

| 子任务 | 文件 | 变更 |
|---|---|---|
| 6.1 | `src/lib/writing/generator.ts` | 编辑 | 保存 `SectionReference` 时区分 Domain vs RAG |

### 4.8 Phase 7: 测试（3h → 4h）

| 测试类型 | 覆盖点 | 文件 |
|---|---|---|
| Unit | Docling parser 所有边界条件 | `docling-parser.test.ts` |
| Unit | Domain splitter 短路、降级、错误 | `domain-splitter.test.ts` |
| Unit | selectDomain 粗筛 + 细选 | `select-domain.test.ts` |
| Unit | stableId 生成一致性 | `domain-stable-id.test.ts` |
| Integration | 完整 pipeline（含 fallback） | `document-worker.integration.test.ts` |
| Integration | 生成时 Domain 注入 | `generator.integration.test.ts` |
| E2E | Library UI Tab 切换、编辑、保存 | Playwright / 手动 |

---

## 5. 风险缓解矩阵

| 风险 | 概率 | 影响 | 缓解措施 | 监控指标 |
|---|---|---|---|---|
| Docling 模型下载失败 | 中 | 高 | MarkItDown fallback + 用户可见提示 | `conversionMethod = markitdown-fallback` 比例 |
| LLM 分类结果不稳定 | 中 | 中 | `temperature=0.2` + stableId 继承编辑 | 同一文档 re-process 后 domain key 变化率 |
| selectDomainDocuments 延迟过高 | 低 | 中 | 粗筛减少 90% LLM 输入 | P95 生成延迟（含 domain 选择） |
| Domain content 截断导致信息丢失 | 中 | 高 | 子分块 + `fullContent` 存储 | 平均 domain content / chunkCount 比率 |
| Image manifest 解析失败 | 低 | 低 | 防御性解析 + 可选字段 | `hasImage=true` 但无 manifest entry 的数量 |
| SQLite 性能瓶颈（100+ domain docs） | 低 | 低 | `take: 100` 限制 + `stableDomainId` 索引 | DB query P95 延迟 |
| Prompt budget 超限 | 低 | 中 | Domain 先截断、RAG 后截断 | 实际 prompt 长度分布 |

---

## 6. 验收标准（按 Phase）

### Phase 0
- [ ] PDF 多栏布局 → `structure.json` 阅读顺序正确
- [ ] DOCX 有标题样式 → `section_header` level 正确
- [ ] Docling 失败 → fallback 到 MarkItDown，`conversionMethod` = `markitdown-fallback`
- [ ] 图像提取 → `images/manifest.json` 包含 ref/filename/page 映射
- [ ] Path B 管道不受 Docling 影响

### Phase 1-2
- [ ] 10-section 文档 → 单次 LLM 调用返回 2-6 domain（含 summary）
- [ ] 2-section 文档 → 单 domain，无 LLM 调用
- [ ] 无 writingModel → 按 H1 分组
- [ ] Re-process 后，用户编辑过的 domain **内容保留**
- [ ] 无效 JSON / 越界 index → 优雅降级，不抛异常

### Phase 3
- [ ] Path A + Path B 并行执行
- [ ] Path A 失败 → Path B 完成，文档状态 = `ready`
- [ ] Path B 失败 → 文档状态 = `failed`
- [ ] `document.domainCount` 正确更新

### Phase 4
- [ ] Domain docs 在 prompt 中位于 RAG **之前**
- [ ] `selectDomainDocuments` 粗筛后候选 <= 20 个
- [ ] 无关 section → 选中 0 个 domain
- [ ] `ragMode=manual` → 只从指定文档选 domain
- [ ] `ragMode=off` → domain 选择仍执行

### Phase 5
- [ ] Library 显示 conversion method badge
- [ ] Domain tab 显示用户编辑标记
- [ ] 编辑保存后 `isUserEdited=true`，re-process 后保留

### Phase 6
- [ ] 生成后 `SectionReference` 包含 `[Domain]` 前缀
- [ ] `relevanceScore=1.0` for domain refs

---

## 7. 工作量估算

| Phase | 原估算 | 改进后估算 | 增量原因 |
|---|---|---|---|
| 0. Docling 集成 | 3h | 3.5h | Image manifest + conversion metadata |
| 1. 数据模型 | 0.5h | 1h | stableId + chunkCount + isUserEdited |
| 2. Domain 拆分器 | 2.5h | 3h | 单次 LLM 合并 + stableId 逻辑 |
| 3. 并行流水线 | 1.5h | 1.5h | 不变 |
| 4. 生成上下文 | 3h | 4h | 粗筛+细选 + prompt 位置调整 |
| 5. Library UI | 3h | 3.5h | Fallback badge + 编辑标记 |
| 6. 引用展示 | 1h | 1h | 不变 |
| 7. 测试 | 3h | 4h | 新增 stableId + 粗筛测试 |
| **Total** | **~17h** | **~21.5h** | **+4.5h（改进成本）** |

**关键路径**：Phase 0 → 1 → 2 → 3 → 4 → 6 → 7  
**并行机会**：Phase 5 (UI) 可在 Phase 1 后开始，独立于 Phase 2-4。

---

## 8. 与原设计的对比决策表

| 决策点 | 原设计 | 本设计 | 理由 |
|---|---|---|---|
| Domain 分类 + 摘要 | 2 次 LLM 调用（1 分类 + N 摘要） | **1 次 LLM 调用** | 边际成本更低，延迟减半 |
| Domain 标识 | 每次 re-process 新生成 CUID | **`stableDomainId` 内容哈希** | 用户编辑可跨处理周期保留 |
| Domain 在 prompt 中的位置 | RAG 之后 | **RAG 之前** | 与"优先使用"的逻辑一致 |
| Domain 选择策略 | 全量喂给 LLM | **粗筛（关键词 Top-20）→ 细选（LLM Top-4）** | 减少噪音，提升选择质量 |
| 图像关联 | 依赖文件名约定 | **`manifest.json` 显式映射** | TS 端可精确关联 |
| 超长 domain 处理 | 硬截断到 4000 字符 | **子分块 + 运行时动态组装** | 完整内容保留，按需注入 |
| Fallback 可见性 | `console.warn` 静默 | **`conversionMethod` + UI badge** | 用户知情，信任度更高 |

---

## 9. 附录：Prompt 完整模板

### `domainClassifyAndSummarize`（EN）

```
You are a document domain analyst. Given a list of document sections with their 
headings and content previews, classify them into 2-6 thematic domains and generate 
a concise summary for each domain.

Rules:
- Produce 2-6 domains (no more, no less)
- Domain keys must be lowercase snake_case English (e.g. "financial_analysis")
- Domain labels must be in the SAME LANGUAGE as the document content
- Adjacent sections about related topics should share a domain
- Each section must appear in exactly one domain
- A domain should ideally contain 2+ sections unless the document is short
- Summaries must be 100-200 characters, capturing key topics and methodologies
- Do NOT add information not present in the source

Output JSON:
{
  "domains": [
    {
      "key": "snake_case_key",
      "label": "Human Readable Label",
      "sectionIndices": [0, 1, 2],
      "summary": "Concise summary of what this domain covers."
    }
  ]
}
```

### `domainClassifyAndSummarize`（ZH）

```
你是一个文档领域分析专家。给定文档的章节列表（包含标题和内容预览），
请将它们分类到 2-6 个主题领域中，并为每个领域生成摘要。

规则:
- 产生 2-6 个领域（不要多也不要少）
- 领域键名必须是小写英文字母+下划线（如 "financial_analysis"）
- 领域标签必须与文档内容使用相同语言
- 相邻且主题相关的章节应归入同一领域
- 每个章节只能出现在一个领域中
- 一个领域最好包含 2 个以上章节，除非文档很短
- 摘要长度 100-200 字，概括关键主题和方法论
- 不要添加原文中没有的信息

输出 JSON:
{
  "domains": [
    {
      "key": "snake_case_key",
      "label": "人类可读的标签",
      "sectionIndices": [0, 1, 2],
      "summary": "该领域所涵盖内容的简洁摘要。"
    }
  ]
}
```

### `domainSelect`（EN）

```
You are selecting the most relevant domain knowledge documents for writing a specific 
section of a document.

Given:
1. The draft title and section being written
2. A list of available domain documents (with ID, domain label, title, and summary)

Select 0-4 domain document IDs that are most relevant to the section being written. 
Prioritize:
- Directly related topics (same domain)
- Foundational/contextual knowledge the section depends on
- Methodologies or frameworks mentioned in the section description

Do NOT select documents that are tangentially related. It's better to select 0-2 
highly relevant ones than 4 marginally related ones.

Output JSON:
{ "selectedIds": ["id1", "id2"] }

If no domain documents are relevant, output: { "selectedIds": [] }
```

### `domainSelect`（ZH）

```
你正在为撰写文档的特定章节选择最相关的领域知识文档。

给定:
1. 草稿标题和正在撰写的章节信息
2. 可用的领域文档列表（含ID、领域标签、标题和摘要）

请选择 0-4 个与当前章节最相关的领域文档ID。优先选择:
- 直接相关的主题（同领域）
- 章节依赖的基础/背景知识
- 章节描述中提到的方法论或框架

不要选择仅有边缘关联的文档。选择 0-2 个高度相关的比选 4 个勉强相关的更好。

输出 JSON:
{ "selectedIds": ["id1", "id2"] }

如果没有相关文档，输出: { "selectedIds": [] }
```

---

## 10. 后续可扩展方向（不在本次范围）

1. **Domain 依赖图**：允许 LLM 在分类时输出 `dependencies`，生成时自动带入依赖 domain 的 summary
2. **子分块智能选择**：根据 section topic 的向量相似度，从 domain 的多个子块中选择最相关的注入
3. **Domain 质量评分**：根据生成后用户的编辑/采纳率，反向评估 domain 分类质量，用于 prompt 迭代
4. **跨文档 Domain 合并**：如果多个文档都有 "Financial Analysis" domain，自动合并为全局知识库
5. **图像理解增强**：将提取的图像通过 VLM（如 GPT-4V）生成描述文本，注入 domain content

---

*文档版本: v2.0*  
*基于: dual-path-document-system-design.md (cross-analysis)*  
*作者: Engineering Review (OpenCode)*
