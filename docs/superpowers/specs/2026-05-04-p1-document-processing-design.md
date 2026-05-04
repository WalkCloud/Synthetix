# Synthetix P1 文档处理设计文档

**日期**: 2026-05-04
**阶段**: P1 — 文档处理
**状态**: 已确认
**前置**: P0 基础框架（已完成）

---

## 1. 概述

P1 实现文档从上传到可检索的完整生命周期：文件上传 → MarkItDown 格式转换 → 本地存储 → 大文档智能拆分 → Embedding 向量化 → 文档库浏览与搜索。

### 1.1 P1 范围

| 模块 | 功能 | 对应需求 |
|------|------|----------|
| F1 文档初始化 | 多格式上传、MarkItDown 转换、存储、拆分、Embedding | F1-US1 ~ F1-US4 |
| F1 嵌入模型配置 | Ollama/云端嵌入模型选择 | F1-US5 |
| F2 文档库 | 浏览、关键词搜索(FTS5)、语义搜索、标签管理 | F2-US1 ~ F2-US5 |

### 1.2 不在 P1 范围

- LightRAG 完整索引服务（P2）
- Reranker 重排序（P2）
- Markdown 渲染预览（P2，F2-US6）
- OCR 图片文字识别（P2）

### 1.3 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 文档转换 | Python MarkItDown via child_process | 格式支持最全，离线友好 |
| 文件存储 | 本地文件系统（可切换 S3） | 离线优先，路径可配置 |
| 关键词搜索 | SQLite FTS5 全文索引 | 零外部依赖，中文可用 |
| Embedding | 复用现有 LLM Adapter 的 embed() | 统一接口，Ollama/云端均可 |
| 向量存储 | SQLite BLOB 列存储 Float32Array | P1 规模足够，P2 迁移 LightRAG |
| 异步处理 | 复用 P0 进程内队列 | 无额外依赖 |

---

## 2. 项目目录变更

```
synthetix/
├── data/                          # NEW: 本地文档存储根目录
│   ├── documents/                 # 原始文件
│   ├── markdown/                  # 转换后的 Markdown
│   └── chunks/                    # 拆分后的子文档
├── workers/
│   └── python/                    # NEW: Python Worker
│       ├── requirements.txt       # markitdown, etc.
│       └── convert.py             # MarkItDown 转换脚本
├── prisma/
│   ├── schema.prisma              # UPDATE: 新增 Document, DocumentChunk, Tag 模型
│   └── migrations/                # NEW MIGRATION
├── src/
│   ├── app/
│   │   ├── (dashboard)/
│   │   │   ├── documents/         # NEW: F1 文档初始化页
│   │   │   │   └── page.tsx
│   │   │   └── library/           # NEW: F2 文档库页
│   │   │       ├── page.tsx
│   │   │       └── [id]/
│   │   │           └── page.tsx   # 文档详情页
│   │   └── api/v1/
│   │       ├── documents/         # NEW: F1 API
│   │       │   ├── upload/route.ts
│   │       │   ├── route.ts
│   │       │   └── [id]/
│   │       │       ├── route.ts
│   │       │       ├── status/route.ts
│   │       │       └── reprocess/route.ts
│   │       └── library/           # NEW: F2 API
│   │           ├── documents/
│   │           │   ├── route.ts
│   │           │   └── [id]/
│   │           │       ├── route.ts
│   │           │       ├── content/route.ts
│   │           │       └── tags/
│   │           │           ├── route.ts
│   │           │           └── [tag]/route.ts
│   │           └── search/
│   │               ├── keyword/route.ts
│   │               └── semantic/route.ts
│   ├── components/
│   │   ├── documents/             # NEW: 文档相关组件
│   │   │   ├── upload-zone.tsx    # 拖拽上传区
│   │   │   ├── upload-progress.tsx # 上传进度
│   │   │   └── split-editor.tsx   # 拆分结果编辑
│   │   └── library/               # NEW: 文档库组件
│   │       ├── document-list.tsx   # 文档列表
│   │       ├── document-card.tsx   # 文档卡片
│   │       ├── search-bar.tsx     # 搜索栏
│   │       ├── filter-bar.tsx     # 筛选栏
│   │       └── tag-editor.tsx     # 标签编辑器
│   ├── lib/
│   │   ├── documents/             # NEW: 文档处理逻辑
│   │   │   ├── storage.ts         # 文件存储抽象层
│   │   │   ├── converter.ts       # Python 子进程调用
│   │   │   ├── splitter.ts        # 文档拆分逻辑
│   │   │   └── embedder.ts        # Embedding 调用
│   │   ├── search/                # NEW: 搜索逻辑
│   │   │   ├── fts.ts             # FTS5 全文索引
│   │   │   └── semantic.ts        # 向量语义搜索
│   │   └── queue/
│   │       └── workers/           # NEW: Worker 实现
│   │           └── document-worker.ts  # 文档转换 Worker
│   └── __tests__/
│       ├── documents/             # NEW: 文档处理测试
│       │   ├── storage.test.ts
│       │   ├── converter.test.ts
│       │   ├── splitter.test.ts
│       │   └── embedder.test.ts
│       └── search/                # NEW: 搜索测试
│           ├── fts.test.ts
│           └── semantic.test.ts
```

---

## 3. 数据库 Schema 变更

### 3.1 新增模型

```prisma
model Document {
  id             String   @id @default(uuid())
  userId         String   @map("user_id")
  originalName   String   @map("original_name")
  originalFormat String   @map("original_format")
  originalSize   Int      @map("original_size")
  originalHash   String?  @map("original_hash")
  originalPath   String   @map("original_path")
  markdownPath   String?  @map("markdown_path")
  markdownSize   Int?     @map("markdown_size")
  status         String   @default("uploading")
  parentId       String?  @map("parent_id")
  tokenEstimate  Int?     @map("token_estimate")
  wordCount      Int?     @map("word_count")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  user     User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  children Document[]       @relation("DocumentSplit")
  parent   Document?        @relation("DocumentSplit", fields: [parentId], references: [id])
  chunks   DocumentChunk[]
  tags     DocumentTag[]

  @@index([userId, status])
  @@index([originalHash])
  @@map("documents")
}

model DocumentChunk {
  id            String   @id @default(uuid())
  documentId    String   @map("document_id")
  index         Int
  title         String?
  content        String
  tokenCount    Int?     @map("token_count")
  startPage     Int?     @map("start_page")
  endPage       Int?     @map("end_page")
  headingPath   String?  @map("heading_path")
  embedding     Bytes?   // Float32Array 序列化
  embedModel    String?  @map("embed_model")
  createdAt     DateTime @default(now()) @map("created_at")

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@map("document_chunks")
}

model Tag {
  id    String @id @default(uuid())
  name  String @unique

  documents DocumentTag[]

  @@map("tags")
}

model DocumentTag {
  documentId String @map("document_id")
  tagId      String @map("tag_id")

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  tag      Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([documentId, tagId])
  @@map("document_tags")
}
```

### 3.2 Document.status 状态机

```
uploading → converting → splitting → embedding → ready
                ↓           ↓           ↓
              failed      failed      failed
```

- `uploading`: 文件已接收，等待转换
- `converting`: MarkItDown 转换中
- `splitting`: 大文档拆分中（小文档跳过）
- `embedding`: 向量化中（chunk 级别）
- `failed`: 处理失败，可重试

### 3.3 实体关系

```
User 1──N Document
Document 1──N DocumentChunk
Document 1──N DocumentTag N──1 Tag
Document 1──N Document (self-referential: parent → children 拆分关系)
```

---

## 4. 文件存储层

### 4.1 目录结构

```
data/                            # $DOCUMENT_ROOT (env 可配)
├── documents/                   # 原始文件
│   └── {userId}/
│       └── {docId}/
│           └── original.pdf
├── markdown/                    # 转换输出
│   └── {userId}/
│       └── {docId}/
│           ├── full.md
│           └── chunk_001.md
└── .meta/                       # 处理中间状态
```

### 4.2 StorageAdapter 接口

```typescript
interface StorageAdapter {
  saveOriginal(docId: string, file: File, userId: string): Promise<string>;
  saveMarkdown(docId: string, content: string, userId: string): Promise<string>;
  saveChunk(docId: string, chunkIndex: number, content: string, userId: string): Promise<string>;
  readMarkdown(docId: string, userId: string): Promise<string>;
  readChunk(docId: string, chunkIndex: number, userId: string): Promise<string>;
  deleteDocument(docId: string, userId: string): Promise<void>;
  getAbsolutePath(type: "documents" | "markdown", docId: string, userId: string): string;
}
```

P1 实现 `LocalStorageAdapter`。接口预留 S3 扩展点。

---

## 5. Python Worker 集成

### 5.1 convert.py

```python
"""Usage: python convert.py <input_file> <output_dir>"""
import sys
from markitdown import MarkItDown

md = MarkItDown()
result = md.convert(sys.argv[1])
output = f"{sys.argv[2]}/full.md"
with open(output, "w") as f:
    f.write(result.text_content)
print(output)  # stdout → Node.js 捕获
```

### 5.2 Node.js 调用

```typescript
// src/lib/documents/converter.ts
import { spawn } from "child_process";

function convertWithMarkitdown(inputPath: string, outputDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", ["workers/python/convert.py", inputPath, outputDir]);
    let stdout = "";
    proc.stdout.on("data", (d) => stdout += d);
    proc.on("close", (code) => {
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`Exit ${code}`));
    });
  });
}
```

### 5.3 依赖安装

```bash
pip3 install markitdown
# requirements.txt 固定版本
```

---

## 6. 文档拆分逻辑

### 6.1 拆分触发条件

- 文档 token 估算 > 用户选定模型 context_window × 50%（阈值可配置 40-60%）
- Token 估算：字符数 ÷ 2（中英文混合估算）

### 6.2 拆分策略

1. **结构优先**: 按 Markdown 标题层级（#, ##, ###）切分，尝试在自然段落边界断开
2. **容量约束**: 每段不超过 context_window × 50%
3. **LLM 优化** (可选): 对结构拆分结果调用 LLM 评估合并/重切建议
4. **元数据保留**: 每个 chunk 记录标题路径、页码范围、来源文档

### 6.3 拆分配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| splitThreshold | 0.5 | context_window 百分比 |
| minChunkTokens | 256 | 最小 chunk 大小 |
| maxChunkTokens | model context × 0.5 | 最大 chunk 大小 |
| preserveHeadings | true | 保留标题层级信息 |

---

## 7. Embedding 集成

### 7.1 调用流程

```
Document 转换完成
    │
    ▼
对每个 Chunk 内容:
    │
    ▼
调用 LLM Adapter.embed(chunkContent)
    │
    ▼
Float32Array → Buffer → DB BLOB 存储
    │
    ▼
Document.status → ready
```

### 7.2 嵌入模型选择

- 复用 ModelProvider/ModelConfig 表
- 新增 capability: `embedding`
- 设置 `default_for: "embedding"` 标记默认嵌入模型
- 用现有的 `createLLMProvider()` 工厂创建适配器

### 7.3 语义搜索（P1 简化版）

```typescript
// 余弦相似度计算（TypeScript 内联，无需外部库）
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

P1 阶段对所有 chunks 暴力计算相似度（数据量小时可行），P2 替换为 LightRAG 向量索引。

---

## 8. FTS5 全文搜索

### 8.1 索引创建

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
  title, content, content=document_chunks, content_rowid=rowid
);
```

### 8.2 搜索接口

```typescript
// src/lib/search/fts.ts
function searchDocuments(query: string, limit = 20, offset = 0): Promise<SearchResult[]>
```

中文搜索使用 FTS5 默认分词器（simple tokenizer），对 CJK 按字符级逐字索引。

---

## 9. API 路由

### 9.1 F1 文档初始化

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | /api/v1/documents/upload | 上传文档（multipart） |
| GET | /api/v1/documents | 查询当前用户的文档列表 |
| GET | /api/v1/documents/:id | 文档详情 |
| DELETE | /api/v1/documents/:id | 删除文档及关联文件 |
| GET | /api/v1/documents/:id/status | 查询处理状态 |
| POST | /api/v1/documents/:id/reprocess | 重新处理 |

### 9.2 F2 文档库

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | /api/v1/library/documents | 文档列表（分页、排序、筛选） |
| GET | /api/v1/library/documents/:id | 文档详情（含元数据、chunks、标签） |
| GET | /api/v1/library/documents/:id/content | 文档 Markdown 内容 |
| POST | /api/v1/library/search/keyword | FTS5 关键词搜索 |
| POST | /api/v1/library/search/semantic | Embedding 语义搜索 |
| POST | /api/v1/library/documents/:id/tags | 添加标签 |
| DELETE | /api/v1/library/documents/:id/tags/:tag | 移除标签 |

### 9.3 通用约定

- 所有 API 使用 `ApiResponse<T>` 信封（`{ success, data?, error? }`）
- 需要认证的端点通过 P0 JWT 中间件保护
- 上传接口返回 `{ taskId }` 用于轮询处理进度
- 分页参数 `?page=1&limit=20&sort=createdAt&order=desc`

---

## 10. UI 页面设计

### 10.1 F1 文档初始化页 (/documents)

- **上传区域**: 拖拽/点击上传，显示格式支持提示
- **上传进度**: 文件名、大小、进度条
- **处理状态**: 转换中 → 拆分中 → 向量化 → 完成
- **拆分结果编辑** (可选): 展示拆分后的子文档树，支持调整合并

### 10.2 F2 文档库页 (/library)

- **工具栏**: 搜索框 + 排序下拉 + 视图切换
- **文档列表**: 卡片/表格视图，显示标题、格式、大小、状态标签、时间
- **筛选侧栏**: 格式、时间范围、标签
- **文档详情**: Markdown 内容预览、元信息、chunk 列表、标签编辑

### 10.3 路由规划

| 路由 | 页面 | 组件 |
|------|------|------|
| /documents | F1 文档初始化 | UploadZone, UploadProgress |
| /library | F2 文档库 | DocumentList, SearchBar, FilterBar |
| /library/:id | 文档详情 | DocumentDetail, TagEditor, ChunkList |

---

## 11. Worker & 异步任务

### 11.1 DocumentWorker

复用 P0 进程内队列，新增 `document_convert` 任务类型：

```typescript
// src/lib/queue/workers/document-worker.ts
async function handleDocumentConvert(task: AsyncTask): Promise<void> {
  // 1. 更新 task → running
  // 2. 调用 convertWithMarkitdown()
  // 3. 检查是否需要拆分 → splitter.split()
  // 4. 写入存储 → storage.saveMarkdown()
  // 5. 生成 embedding → embedder.embedChunks()
  // 6. 更新 task → completed + Document.status → ready
}
```

### 11.2 前端进度通知

- 上传后前端轮询 `GET /api/v1/documents/:id/status`（间隔 2s）
- 状态变更时 Toast 通知
- 处理完成/失败时在活动任务区显示

---

## 12. 环境变量

```env
# P1 新增
DOCUMENT_ROOT="./data/documents"     # 文档存储根目录
MARKDOWN_ROOT="./data/markdown"      # Markdown 输出目录
MAX_UPLOAD_SIZE=104857600            # 100MB
SPLIT_THRESHOLD=0.5                  # 拆分阈值
PYTHON_PATH=python3                  # Python 解释器路径
```

---

## 13. 测试策略

### 13.1 单元测试
- `storage.test.ts`: 本地存储适配器 CRUD
- `converter.test.ts`: Python 子进程调用（mock spawn）
- `splitter.test.ts`: 按标题/大小/LLM 拆分逻辑
- `embedder.test.ts`: Embedding 调用和余弦相似度
- `fts.test.ts`: FTS5 索引和搜索

### 13.2 集成测试
- 上传 → 转换 → 存储 端到端
- API 路由认证和权限
- 搜索端到端（关键词 + 语义）

### 13.3 目标覆盖率
≥ 80%（遵循项目规定）
