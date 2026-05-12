# Synthetix

AI-powered long-document authoring workbench — traceable, controllable, segmentable.

Upload reference documents, brainstorm with AI, generate structured outlines, write chapter-by-chapter with A/B model comparison, and export publication-ready documents. Every section tracks its source references for full provenance.

## Features

- **Document Library** — Upload PDF/DOCX/PPTX/EPUB/etc., auto-convert to Markdown, index into RAG knowledge graph. Full-text search (FTS5 + jieba Chinese tokenization) and semantic search with real cosine similarity scores.
- **Mind Organization** — Socratic AI brainstorming sessions. Chat with the AI architect, generate multi-level outlines (unlimited depth), edit recursively, drag-and-drop reorder.
- **Document Writing** — Section-by-section generation with A/B model comparison, humanizer, version history, rollback, and reference tracking.
- **Knowledge Graph** — LightRAG-powered entity/relation extraction, subgraph export, knowledge graph CRUD management.
- **Topology View** — Visual graph of document structure and reference relationships.
- **Model Management** — Pluggable LLM providers (Ollama, OpenAI, DeepSeek, any `/v1/chat/completions` API), capability-based model resolution, usage tracking.
- **Enterprise-Ready Storage** — SQLite by default; pluggable RAG backends (pgvector, Neo4j, Milvus, Qdrant).

## Tech Stack

| Category | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 (strict) |
| Database | SQLite + Prisma 7 |
| Styling | Tailwind CSS 4 + shadcn/ui v4 |
| Auth | JWT (jose HS256) + bcryptjs |
| Search | FTS5 + @node-rs/jieba + LightRAG semantic |
| LLM | OpenAI-compatible adapter |
| RAG | LightRAG (Python workers) |
| Validation | Zod 4 |
| Testing | Vitest 4 |

## Quick Start

```bash
# Prerequisites: Node.js 20+, Python 3.10+, pnpm

# Clone
git clone https://github.com/WalkCloud/Synthetix.git
cd Synthetix

# Install
pnpm install

# Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY

# Database setup
npx prisma migrate dev
npx prisma generate

# Start dev server
pnpm dev
```

Open http://localhost:3000 — the setup wizard will guide you through creating an admin account and configuring your first LLM provider.

## Environment Variables

**Required:**

| Variable | Description |
|---|---|
| `DATABASE_URL` | SQLite connection string, e.g. `file:./dev.db` |
| `JWT_SECRET` | Secret for JWT signing (32 chars recommended) |
| `ENCRYPTION_KEY` | AES-256-GCM key for provider API key encryption (exactly 32 chars) |

**Optional:**

| Variable | Default | Description |
|---|---|---|
| `PYTHON_PATH` | `python3` | Python interpreter path |
| `NEXT_PUBLIC_APP_NAME` | `Synthetix` | Application display name |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Application base URL |

**LightRAG Storage (optional):**

| Variable | Default |
|---|---|
| `LIGHTRAG_KV_STORAGE` | `JsonKVStorage` |
| `LIGHTRAG_VECTOR_STORAGE` | `NanoVectorDBStorage` |
| `LIGHTRAG_GRAPH_STORAGE` | `NetworkXStorage` |
| `LIGHTRAG_PG_DATABASE_URL` | PostgreSQL connection for pgvector |
| `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD` | Neo4j graph database |
| `MILVUS_URI` / `MILVUS_TOKEN` | Milvus vector database |
| `QDRANT_URL` / `QDRANT_API_KEY` | Qdrant vector database |

## Project Structure

```
synthetix/
├── prisma/
│   └── schema.prisma              # 16 models, UUID PKs, snake_case mapping
├── workers/python/
│   ├── convert.py                 # Document → Markdown (MarkItDown)
│   ├── rag_index.py               # LightRAG indexing (basic + graph modes)
│   ├── rag_query.py               # Semantic search (6 query modes)
│   ├── rag_manage.py              # Knowledge graph CRUD
│   └── export.py                  # Markdown → PDF/DOCX export
├── src/
│   ├── app/
│   │   ├── (auth)/                # Login, setup wizard
│   │   ├── (dashboard)/           # Authenticated pages (sidebar + header)
│   │   │   ├── brainstorm/        # Mind Organization
│   │   │   ├── documents/         # Document Init
│   │   │   ├── library/           # Document Library
│   │   │   ├── writing/           # Document Writing
│   │   │   ├── topology/          # Document Topology
│   │   │   ├── models/            # Model Management
│   │   │   └── settings/          # User Management
│   │   └── api/v1/                # REST API (11 route groups)
│   ├── components/
│   │   ├── ui/                    # shadcn/ui components
│   │   ├── layout/                # Sidebar, header
│   │   └── ...                    # Feature-specific components
│   ├── lib/
│   │   ├── auth/                  # JWT, password hashing, session
│   │   ├── crypto.ts              # AES-256-GCM encryption
│   │   ├── db.ts                  # Prisma client singleton
│   │   ├── llm/                   # OpenAI-compatible adapter, factory
│   │   ├── queue/                 # In-process async task queue
│   │   ├── rag/                   # LightRAG integration
│   │   ├── search/                # FTS5 + semantic search + tokenizer
│   │   └── writing/               # Generator, humanizer, context assembly
│   ├── types/                     # Shared TypeScript interfaces
│   ├── __tests__/                 # Vitest tests
│   ├── proxy.ts                   # JWT auth guard
│   └── instrumentation.ts        # Queue initialization on startup
├── docs/                          # Product requirements, design specs
└── prototype/                     # Static HTML/CSS mockups
```

## Architecture

### Core Workflow

```
Upload Documents → Convert to Markdown → RAG Index → Brainstorm with AI → Generate Outline → Write Chapter-by-Chapter → Export
```

### Key Design Decisions

- **Proxy (not middleware)** — `src/proxy.ts` handles JWT auth for Next.js 16. Token rotation (access 15m + refresh 7d) happens in-place, no extra API call.
- **API Envelope** — All routes return `{ success: boolean, data?: T, error?: string }`.
- **In-process Queue** — No Redis. Async tasks (document processing, RAG indexing) run in-process with configurable concurrency (default 3).
- **Recursive Outline** — Unlimited depth outline with path-array CRUD, recursive rendering, and N-level draft creation.
- **A/B Model Comparison** — Each section supports dual-model generation with user selection and version history.
- **Reference Traceability** — Every generated section tracks source references (document, chunk, relevance score).
- **Python Workers** — Document conversion, RAG operations, and export run via `child_process.spawn` with configurable Python path.

### Database

SQLite with 16 Prisma models: `User`, `ModelProvider`, `ModelConfig`, `AsyncTask`, `TokenUsage`, `Document`, `DocumentChunk`, `Tag`, `DocumentTag`, `BrainstormSession`, `Message`, `Draft`, `Section`, `SectionVersion`, `SectionReference`. All use UUID PKs, `created_at`/`updated_at` timestamps, cascade deletes.

## Scripts

```bash
pnpm dev               # Dev server (port 3000)
pnpm build             # Production build (also catches TS errors)
pnpm lint              # ESLint
pnpm test              # Vitest in watch mode
pnpm test:run          # Vitest single run
npx prisma studio      # Browse database
npx prisma migrate dev # Create migration
```

## Deployment Modes

| Mode | Storage | LLM | Use Case |
|---|---|---|---|
| **Offline Local** | SQLite + filesystem | Ollama | Personal, intranet, data-sensitive |
| **Offline Docker** | MinIO + SQLite/PostgreSQL | Ollama | Small teams, server intranet |
| **Cloud** | S3 + PostgreSQL | Cloud LLM APIs | Team collaboration, multi-device |

## License

Private — All rights reserved.
