# Synthetix

English | [简体中文](#简体中文)

<p align="center">
  <img src="./public/logo.png" alt="Synthetix logo" width="112" />
</p>

<p align="center">
  <strong>A self-hosted AI workbench that turns large document collections into a knowledge base — and writes traceable long-form documents from it.</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-1.0.1-7c3aed">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.13%2B-3776ab">
  <img alt="Offline-first" src="https://img.shields.io/badge/offline--first-self--hosted-16a34a">
</p>

## Why does this exist?

General-purpose AI chat tools are great — until you need to write something serious from a large pile of source material. Then three problems show up that they can't solve:

- **📦 Source material doesn't fit in a conversation.** Thousand-page reports and private knowledge bases blow past any single model's context window.
- **🔍 Generated text can't be traced to its sources.** When the AI writes a paragraph, you can't tell which document, page, or claim it came from. For professional work, that's a trust problem.
- **♻️ Every retrieval starts from scratch.** Traditional RAG re-discovers the same knowledge on every query — nothing accumulates, so retrieval quality never improves no matter how much you use it.

Synthetix is a self-hosted workbench built to solve exactly these three problems. It turns your documents into a **three-layer knowledge architecture**, powers writing through a **knowledge flywheel**, and keeps every generated paragraph **fully traceable** back to its sources.

![Synthetix dashboard](./synthetix-dashboard.png)

## ✨ Core capabilities

### 🧠 Three-layer knowledge architecture

Most tools just chunk documents and do vector similarity. Synthetix builds three layers, each with a job the others can't do:

| Layer | What it is | What it uniquely provides |
| --- | --- | --- |
| **Raw chunks** | Document segments + embeddings | The verbatim, traceable evidence behind every claim |
| **Entity graph** | [LightRAG](https://github.com/HKUDS/LightRAG) (from HKU) extracts entities & relationships into a knowledge graph | Retrieval that understands *concepts and connections*, not just keyword similarity — six modes including graph + vector + reranker |
| **Knowledge Wiki** | An LLM-synthesized, human-readable knowledge layer (inspired by Karpathy's LLM-Wiki and Google's OKF spec) | Document summaries, topics, concepts, and claims you can **inspect, edit, and trust** — each with sources and confidence scores |

### ♻️ The knowledge flywheel — it gets smarter as you use it

Traditional RAG re-discovers knowledge from scratch on every query. Synthetix breaks that cycle:

1. **Write-time retrieval queries the Wiki first** — pure database lookup, no extra LLM call, no embedding round-trip.
2. **When the Wiki has good coverage, raw retrieval is automatically scaled back** to save tokens.
3. **Every section you generate writes back to the Wiki** — new claims are extracted and merged, and entries you cited get their confidence bumped.

The result: your knowledge base compounds. The more you write, the more accurate and cheaper retrieval becomes. Export the whole Wiki as portable, Obsidian-compatible Markdown.

### ✍️ Traceable, stateful long-form writing

This isn't a single chat turn. It's a guided multi-stage workbench that keeps a long document coherent end to end:

- **Brainstorm → clarify requirements.** A multi-turn interview (eight document archetypes: proposals, technical solutions, assessments, and more) helps nail down scope before any writing starts.
- **Recursive outline.** A STORM-style decomposition generates a deep, hierarchical outline part-by-part — not a shallow one-shot — which you can fully edit and restructure.
- **Section-by-section generation, grounded in your corpus.** Each section independently retrieves from your knowledge base (Wiki first, then RAG, then graph entities), and the prompt is aware of its parent, siblings, and children to avoid repetition and keep continuity.
- **A/B model comparison.** Run two models on the identical section context, side by side, and pick the better one.
- **Full traceability.** Every section's supporting sources are persisted — raw chunks, graph entities, and Wiki entries — and visualized in a force-directed **topology view** showing which documents back which sections.

### 🔌 Offline-first, cloud-ready

Runs entirely on your own machine today — no cloud dependency required, and you can point it at your own LLM endpoint. The data layer is designed to be pluggable: PostgreSQL, S3-compatible object storage, and managed vector databases (pgvector, Milvus, Qdrant, Neo4j) are on the roadmap as optional remote backends for team collaboration and multi-device sync.

## 📸 Screenshots

<details>
<summary>Knowledge graph</summary>

![Knowledge graph](./knowledge-graph-verification.png)

Force-directed graph view for entities and relationships extracted from the document corpus.
</details>

<details>
<summary>Document topology</summary>

![Document topology](./topology-screenshot.png)

Topology view for generated sections, source documents, and their relationships.
</details>

## 🚀 Quick start

### Option A: Windows installer

Download the latest `.exe` installer from [GitHub Releases](https://github.com/WalkCloud/Synthetix/releases), install it, and launch Synthetix from the Start Menu.

### Option B: run from source

Prerequisites:

- Node.js 20+
- Python 3.13+
- An OpenAI-compatible, Anthropic, DeepSeek-compatible, or Ollama endpoint

```bash
git clone https://github.com/WalkCloud/Synthetix.git
cd Synthetix

npm install
copy .env.example .env

npx prisma migrate dev
npx prisma generate

npm run dev
```

Open `http://localhost:3000`, create the first admin account, add a model provider in Settings, then upload a document.

Prefer pnpm? This repo ships a `pnpm-lock.yaml` — `pnpm install` works too.

## ⚙️ Configuration

Copy `.env.example` to `.env` and set at least these:

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Signs access and refresh tokens. Use a strong random value. |
| `NEXT_PUBLIC_APP_URL` | Public app URL, usually `http://localhost:3000` for local use. |

If your Python interpreter isn't picked up automatically, point to it with `PYTHON_PATH`.

Everything else — database path, processing concurrency, optional LightRAG backends (PostgreSQL/pgvector, Neo4j, Milvus, Qdrant) — is documented with comments in [`.env.example`](./.env.example).

<details>
<summary>🧩 Architecture & project layout</summary>

**Knowledge architecture**

```text
Uploaded documents
  → Convert to Markdown → Segment → Embed & index
  → Layer 1: Raw chunks (traceable evidence)
  → Layer 2: LightRAG entity graph (concepts & relationships)
  → Layer 3: LLM Knowledge Wiki (synthesized, editable, cheap to retrieve)
        ↓
  Writing retrieves: Wiki first (cheap) → RAG chunks → graph entities
  Each generation writes back to enrich the Wiki (the flywheel)
```

**System stack**

```text
Browser
  React, Tailwind CSS, shadcn/ui, d3-force
        |
Next.js App Router
  pages, API routes, auth, settings, task queue
        |
Prisma + SQLite
        |
Python workers
  conversion, semantic chunking, LightRAG indexing, Wiki synthesis, export
        |
LLM providers
  OpenAI-compatible, Anthropic, DeepSeek-compatible, Ollama, local services
```

Key directories:

| Path | Purpose |
| --- | --- |
| `src/app` | Next.js pages and API routes. |
| `src/lib/documents` | Document lifecycle, segmentation, chunks, indexing, and storage. |
| `src/lib/rag`, `src/lib/wiki`, `src/lib/search` | LightRAG integration, Wiki synthesis, and retrieval. |
| `src/lib/writing` | Brainstorm, outline, context assembly, section generation, review, and export. |
| `workers/python` | Conversion, chunking, LightRAG indexing, and export workers. |
| `electron`, `packaging` | Desktop shell and Windows installer build scripts. |
</details>

## 🧑‍💻 Development

```bash
npm run dev
npm run build
npm run lint
npm test
npm run test:run
npm run e2e
```

Prisma:

```bash
npx prisma generate
npx prisma migrate dev --name <change>
npx prisma studio
```

## 📚 Documentation

- [Release workflow](docs/release-workflow.md)
- [Desktop packaging plan](docs/desktop-packaging-distribution-plan-2026-06-29.md)
- [Wiki synthesis layer design](docs/wiki-synthesis-layer-design-2026-06-22.md)
- [Domain segmentation, graph & Wiki optimization](docs/domain-segmentation-graph-wiki-optimization-final-2026-06-28.md)

## 🤝 Contributing

Issues and pull requests are welcome. For large changes, open an issue first so the design can be discussed before implementation.

Good first areas: setup and deployment docs, provider compatibility fixes, tests (API, worker, writing flow, export), accessibility and UI polish.

## 📄 License

Synthetix is licensed under the [Apache License 2.0](LICENSE). Third-party notices can be viewed in the app under **About → Third-party notices**.

---

# 简体中文

[English](#synthetix) | 简体中文

<p align="center">
  <img src="./public/logo.png" alt="Synthetix logo" width="112" />
</p>

<p align="center">
  <strong>把大批量文档沉淀为知识库，再基于它撰写可溯源长篇文档的自托管 AI 工作台。</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-1.0.1-7c3aed">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.13%2B-3776ab">
  <img alt="Offline-first" src="https://img.shields.io/badge/offline--first-self--hosted-16a34a">
</p>

## 为什么需要它？

通用 AI 对话工具很好用——直到你需要基于一大堆源材料写一份严肃文档。这时候有三个它们解决不了的问题会冒出来：

- **📦 源材料塞不进一次对话。** 上千页的报告、私有知识库，会撑爆任何单个模型的上下文窗口。
- **🔍 生成的内容无法追溯到来源。** AI 写出一段话，你却说不清它来自哪份文档、哪一页、哪个论断。对专业工作来说，这是个信任问题。
- **♻️ 每次检索都从零开始。** 传统 RAG 每次查询都重新发现一遍同样的知识——没有任何积累，所以检索质量永远不会因为你用得多而变好。

Synthetix 正是为解决这三个问题而构建的自托管工作台。它把文档转成**三层知识架构**，通过**知识飞轮**驱动写作，并让每一个生成的段落都能**完整追溯**到它的来源。

![Synthetix 工作台](./synthetix-dashboard-zh.png)

## ✨ 核心能力

### 🧠 三层知识架构

大多数工具只是把文档切块后做向量相似度检索。Synthetix 构建了三层，每一层都承担别的层无法替代的职责：

| 层 | 是什么 | 独特价值 |
| --- | --- | --- |
| **原始文档块** | 文档分段 + embedding | 每个论断背后逐字可查的证据来源 |
| **实体图谱** | 集成港大开源 [LightRAG](https://github.com/HKUDS/LightRAG)，抽取实体与关系构建知识图谱 | 检索能理解**概念与关联**，而不只是关键词相似度——六种模式含图+向量+reranker |
| **知识 Wiki** | LLM 综合生成、人类可读的知识层（灵感来自 Karpathy 的 LLM-Wiki 和 Google OKF 规范） | 文档摘要、主题、概念和论断，你可以**检查、编辑、信任**——每条带来源和置信度 |

### ♻️ 知识飞轮——越用越聪明

传统 RAG 每次查询都从零重新发现知识。Synthetix 打破了这个循环：

1. **写作时的检索优先查 Wiki**——纯数据库查询，无额外 LLM 调用，无 embedding 往返。
2. **当 Wiki 覆盖良好时，原始检索自动减量**，节省 token。
3. **你生成的每个章节都会回写 Wiki**——抽取新论断并合并，被引用的条目置信度也会提升。

结果是：你的知识库会不断积累。写得越多，检索越准、成本越低。整个 Wiki 还能导出为 Obsidian 兼容的可移植 Markdown。

### ✍️ 全程可追溯的有状态写作

这不是一轮聊天。它是一个引导式的多阶段工作台，让长文档从头到尾保持连贯：

- **头脑风暴 → 澄清需求。** 多轮访谈（八种文档原型：方案、技术方案、评估报告等）在任何写作开始前帮你把范围敲定。
- **递归大纲。** STORM 式分解，分部分逐个生成深层级的大纲——而非浅薄的一次性生成，你可完全编辑和重组。
- **逐章节生成，扎根于你的知识库。** 每个章节独立从知识库检索（先 Wiki，再 RAG，再图谱实体），且 prompt 感知自身的父节点、兄弟节点和子节点，避免重复、保持连贯。
- **A/B 双模型对比。** 同一章节的相同上下文，两个模型并行生成，并排对比择优。
- **完整溯源。** 每个章节的支撑来源都被持久化——原始文档块、图谱实体、Wiki 条目——并以力导向**拓扑视图**可视化"哪些文档支撑了哪些章节"。

### 🔌 离线优先，兼容云端

今天可以完全在自己的机器上运行，无需依赖云服务，还能指向你自己的 LLM 端点。数据层被设计为可插拔：PostgreSQL、S3 兼容对象存储，以及托管向量数据库（pgvector、Milvus、Qdrant、Neo4j）已在规划中，作为可选的远端后端，用于团队协作和多端同步。

## 📸 截图

<details>
<summary>知识图谱</summary>

![知识图谱](./knowledge-graph-verification-zh.png)

力导向图展示从文档集合中抽取出的实体和关系。
</details>

<details>
<summary>文档拓扑</summary>

![文档拓扑](./topology-screenshot-zh.png)

文档拓扑展示生成章节、来源文档和它们之间的关系。
</details>

## 🚀 快速开始

### 方式 A：Windows 安装包

从 [GitHub Releases](https://github.com/WalkCloud/Synthetix/releases) 下载最新 `.exe` 安装包，安装后从开始菜单启动 Synthetix。

### 方式 B：从源码运行

前置要求：

- Node.js 20+
- Python 3.13+
- OpenAI 兼容、Anthropic、DeepSeek 兼容或 Ollama 端点

```bash
git clone https://github.com/WalkCloud/Synthetix.git
cd Synthetix

npm install
copy .env.example .env

npx prisma migrate dev
npx prisma generate

npm run dev
```

打开 `http://localhost:3000`，创建第一个管理员账号，在设置里添加模型 Provider，然后上传文档。

偏好 pnpm？仓库自带 `pnpm-lock.yaml`，`pnpm install` 同样可用。

## ⚙️ 配置

把 `.env.example` 复制为 `.env`，至少设置：

| 变量 | 用途 |
| --- | --- |
| `JWT_SECRET` | 签发访问令牌和刷新令牌，建议使用强随机值。 |
| `NEXT_PUBLIC_APP_URL` | 应用访问地址，本地通常是 `http://localhost:3000`。 |

如果 Python 解释器没有被自动识别，用 `PYTHON_PATH` 指定。

其余配置——数据库路径、处理并发、可选的 LightRAG 后端（PostgreSQL/pgvector、Neo4j、Milvus、Qdrant）——都在 [`.env.example`](./.env.example) 中有注释说明。

<details>
<summary>🧩 架构与项目结构</summary>

**知识架构**

```text
上传的文档
  → 转换为 Markdown → 分段 → embedding 与索引
  → 第 1 层：原始文档块（可追溯的证据）
  → 第 2 层：LightRAG 实体图谱（概念与关系）
  → 第 3 层：LLM 知识 Wiki（综合、可编辑、廉价检索）
        ↓
  写作检索：先 Wiki（廉价）→ 再 RAG 文档块 → 再图谱实体
  每次生成回写反哺 Wiki（飞轮）
```

**系统栈**

```text
Browser
  React, Tailwind CSS, shadcn/ui, d3-force
        |
Next.js App Router
  页面、API、认证、设置、任务队列
        |
Prisma + SQLite
        |
Python workers
  转换、语义分块、LightRAG 索引、Wiki 综合、导出
        |
LLM providers
  OpenAI 兼容、Anthropic、DeepSeek 兼容、Ollama、本地服务
```

关键目录：

| 路径 | 用途 |
| --- | --- |
| `src/app` | Next.js 页面和 API 路由。 |
| `src/lib/documents` | 文档生命周期、分段、分块、索引和存储。 |
| `src/lib/rag`, `src/lib/wiki`, `src/lib/search` | LightRAG 集成、Wiki 综合和检索。 |
| `src/lib/writing` | 头脑风暴、大纲、上下文组装、章节生成、审阅和导出。 |
| `workers/python` | 转换、分块、LightRAG 索引和导出 worker。 |
| `electron`, `packaging` | 桌面端外壳和 Windows 安装包脚本。 |
</details>

## 🧑‍💻 开发

```bash
npm run dev
npm run build
npm run lint
npm test
npm run test:run
npm run e2e
```

Prisma：

```bash
npx prisma generate
npx prisma migrate dev --name <change>
npx prisma studio
```

## 📚 文档

- [发版流程](docs/release-workflow.md)
- [桌面端打包方案](docs/desktop-packaging-distribution-plan-2026-06-29.md)
- [Wiki 综合层设计](docs/wiki-synthesis-layer-design-2026-06-22.md)
- [领域分段、图谱与 Wiki 优化](docs/domain-segmentation-graph-wiki-optimization-final-2026-06-28.md)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。较大的改动建议先开 Issue 讨论方案，再开始实现。

适合首次贡献的方向：安装和部署文档、Provider 兼容性修复、测试（API、worker、写作流程、导出）、无障碍和 UI 打磨。

## 📄 许可证

Synthetix 使用 [Apache License 2.0](LICENSE)。第三方开源声明可在应用内通过 **About → Third-party notices** 查看。
