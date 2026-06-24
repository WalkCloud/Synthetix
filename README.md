# Synthetix

Self-hostable AI writing workbench for traceable long-form documents.

Synthetix helps you turn reference material into structured, source-grounded drafts. Upload documents, build a RAG knowledge base, brainstorm with AI, create recursive outlines, write section by section, compare model outputs, and export long-form documents with references preserved.

> **Status**
>
> - Current version: see the `version` field in `package.json`
> - Synthetix is an early open-source release.
> - Local self-hosting is the primary deployment target today.
> - APIs, UI flows, and deployment options may change as the project evolves.

## Why Synthetix?

Long-form writing often depends on scattered source material: PDFs, reports, policy documents, meeting notes, technical references, and internal knowledge bases. Synthetix gives you a local-first workspace for turning those sources into traceable drafts without losing the connection between generated text and the documents that informed it.

Use Synthetix for:

- Research reports that need source-grounded claims
- Technical proposals that draw from internal documentation
- Policy and compliance documents where provenance matters
- Knowledge-base-driven drafts for teams or organizations
- Long-form business, academic, or analytical writing

The goal is not just to generate text. The goal is to help you organize evidence, explore ideas, write incrementally, compare outputs, revise safely, and preserve references through export.

## Core Workflow

```text
Upload references → Convert to Markdown → Split and index into RAG → Brainstorm with AI → Generate and edit an outline → Write section by section → Compare model outputs → Humanize, revise, and export
```

## Features

### Document Library

Upload reference documents and manage them in a searchable library. Synthetix converts documents to Markdown, stores document metadata, supports tags, and prepares content for downstream search and writing workflows.

Search combines SQLite FTS5 with `@node-rs/jieba` Chinese tokenization for keyword search and semantic retrieval for meaning-based discovery.

### RAG and Knowledge Graph

Synthetix integrates with LightRAG through Python workers to index document chunks, retrieve relevant context, and manage knowledge graph data. The knowledge layer supports entity and relationship extraction, graph retrieval, and reference-aware writing workflows.

Local storage works out of the box. Advanced storage backends such as PostgreSQL/pgvector, Neo4j, Milvus, and Qdrant are supported through optional LightRAG configuration.

### Brainstorming, Chat, and Outlines

Use brainstorm/chat sessions to explore topics before drafting, ask questions against your project context, and turn useful conversations into document structure. Generate outlines from conversations and edit them recursively with N-level outline support, so long documents can be planned at the depth they need.

### Section Writing

Write drafts section by section instead of generating an entire document at once. Synthetix retrieves relevant context for each section, preserves section references, supports A/B model comparison, stores section versions, and lets you roll back when needed.

The writing workflow also includes a draft topology view for understanding document structure and section relationships, plus a humanizer for revising AI-generated text and reducing repetitive or machine-like phrasing.

### Export

Export assembled drafts through the built-in export pipeline so generated long-form documents can leave the workspace with their reference-aware structure preserved.

### Model Management

Configure Ollama, OpenAI, DeepSeek, or any OpenAI-compatible `/v1/chat/completions` provider. Synthetix supports capability-based model resolution, provider testing, encrypted API key storage, token usage recording, and usage trends.

### Settings Management

Manage application settings in the UI, including RAG configuration, storage options, and database settings for local or advanced deployments.

### Self-Hosted by Default

Synthetix is designed for local self-hosting first. SQLite and the local filesystem are the default storage foundation, while Python workers handle document conversion, RAG indexing/querying, graph management, and export tasks.

Docker deployment, cloud deployment, team collaboration modes, and plugin-style extension points are roadmap or advanced targets.

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.10+
- pnpm
- An LLM provider, such as Ollama, OpenAI, DeepSeek, or another OpenAI-compatible service

### Run locally

```bash
git clone https://github.com/WalkCloud/Synthetix.git
cd Synthetix
pnpm install
cp .env.example .env
npx prisma migrate dev
npx prisma generate
pnpm dev
```

Open http://localhost:3000. On first launch, the login page will ask you to create the local admin account. After that, use the same page to sign in and configure your first LLM provider.

## Configuration

Create a local `.env` file from `.env.example` before starting the app.

### Required environment variables

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Database connection string. For local SQLite, use a file-based URL such as `file:./dev.db`. |
| `JWT_SECRET` | Secret used to sign JWT access and refresh tokens. |
| `ENCRYPTION_KEY` | 32-character AES-256-GCM key used to encrypt provider API keys. |

### Optional application variables

| Variable | Description |
| --- | --- |
| `JWT_ACCESS_EXPIRES` | Access token lifetime. |
| `JWT_REFRESH_EXPIRES` | Refresh token lifetime. |
| `PYTHON_PATH` | Python interpreter path. Defaults to `python3`. |
| `NEXT_PUBLIC_APP_NAME` | Public application name shown in the UI. |
| `NEXT_PUBLIC_APP_URL` | Public application URL, such as `http://localhost:3000`. |

### Optional LightRAG variables

| Variable | Description |
| --- | --- |
| `LIGHTRAG_KV_STORAGE` | LightRAG key-value storage backend. |
| `LIGHTRAG_VECTOR_STORAGE` | LightRAG vector storage backend. |
| `LIGHTRAG_GRAPH_STORAGE` | LightRAG graph storage backend. |
| `LIGHTRAG_DOC_STATUS_STORAGE` | LightRAG document status storage backend. |
| `LIGHTRAG_PG_DATABASE_URL` | PostgreSQL connection string for PostgreSQL/pgvector-backed LightRAG storage. |
| `NEO4J_URI` | Neo4j connection URI. |
| `NEO4J_USERNAME` | Neo4j username. |
| `NEO4J_PASSWORD` | Neo4j password. |
| `MILVUS_URI` | Milvus connection URI. |
| `MILVUS_TOKEN` | Milvus authentication token. |
| `QDRANT_URL` | Qdrant service URL. |
| `QDRANT_API_KEY` | Qdrant API key. |

Do not commit `.env`, provider API keys, local databases, uploaded documents, generated exports, or local RAG artifacts. These files may contain secrets, proprietary documents, or derived source content.

## Architecture

Synthetix is a Next.js 16 App Router application with API routes, local persistence, Python worker processes, and OpenAI-compatible LLM integration.

- **App routes**: `src/app/(auth)` contains login and setup flows. `src/app/(dashboard)` contains authenticated product pages. `src/app/api/v1` contains the REST API.
- **Auth proxy**: `src/proxy.ts` guards authenticated routes, validates JWT access tokens, rotates tokens with refresh tokens, and redirects or returns API errors when sessions are invalid.
- **Database and API shape**: Prisma 7 stores application data in SQLite by default. API routes use a common response envelope: `{ success, data?, error? }`.
- **Task queue**: `src/lib/queue` provides the in-process async queue. `src/instrumentation.ts` initializes workers at runtime.
- **Python workers**: `workers/python/convert.py`, `workers/python/rag_index.py`, `workers/python/rag_query.py`, `workers/python/rag_manage.py`, and `workers/python/export.py` handle conversion, RAG operations, knowledge graph management, and export.
- **LLM integration**: `src/lib/llm` provides provider adapters, model resolution, connection testing, embeddings, chat completions, and usage recording.
- **Writing engine**: `src/lib/writing` assembles retrieved context, generates section content, summarizes sections, and humanizes generated drafts.

## Tech Stack

| Area | Technology |
| --- | --- |
| Framework | Next.js 16 App Router |
| Language | TypeScript 5 |
| UI | React 19, Tailwind CSS 4, shadcn/ui v4, Base UI |
| Database | SQLite, Prisma 7, `better-sqlite3` |
| Auth | JWT with `jose`, password hashing with `bcryptjs` |
| Validation | Zod 4 |
| Search and RAG | SQLite FTS5, `@node-rs/jieba`, LightRAG |
| LLM integration | OpenAI-compatible adapter for Ollama, OpenAI, DeepSeek, and compatible providers |
| Workers | Python workers launched from Node.js |
| Testing | Vitest 4 |

## Project Structure

```text
Synthetix/
├── prisma/
│   └── schema.prisma
├── workers/
│   └── python/
│       ├── convert.py
│       ├── rag_index.py
│       ├── rag_query.py
│       ├── rag_manage.py
│       └── export.py
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   ├── (dashboard)/
│   │   └── api/v1/
│   ├── components/
│   ├── lib/
│   │   ├── auth/
│   │   ├── documents/
│   │   ├── llm/
│   │   ├── queue/
│   │   ├── rag/
│   │   ├── search/
│   │   ├── settings/
│   │   └── writing/
│   ├── types/
│   ├── proxy.ts
│   └── instrumentation.ts
├── docs/
├── prototype/
└── README.md
```

## Development

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm test:run
npx prisma studio
npx prisma generate
npx prisma migrate dev --name init
pnpm vitest run src/__tests__/auth/jwt.test.ts
```

Use `pnpm dev` to start the local development server. Use Prisma commands after schema changes or when you need to inspect the local database.

## Roadmap

- Docker Compose deployment for easier local and server installation
- Team and cloud modes for collaborative writing workflows
- More export formats and richer export customization
- Provider and plugin extension points
- Contributor guide, issue templates, and documentation templates
- More automated test coverage across API routes, workers, and UI workflows

## Contributing

Contributions are welcome. If you want to make a large change, open an issue first so maintainers and contributors can discuss the approach before implementation.

Good first contribution areas include:

- Setup and deployment documentation
- Tests for API routes, workers, and writing flows
- Provider compatibility fixes and examples
- Export pipeline improvements
- UI polish and accessibility improvements

## License

Synthetix is licensed under the [Apache License 2.0](LICENSE).

Apache 2.0 allows use, modification, distribution, and commercial use, and includes an explicit patent grant from contributors.
