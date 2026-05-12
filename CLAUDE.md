# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Synthetix** is an AI-powered document authoring tool for producing long-form, reference-traceable documents. Core workflow: upload reference documents → convert to Markdown → RAG-index → brainstorm with AI → generate outline → write chapter-by-chapter → export.

**Current phase**: v0.5.3 — document management, RAG pipeline (LightRAG), knowledge graph, brainstorm/chat, outline editing, section writing with A/B model comparison, humanizer, semantic search, topology view, usage trends, settings management all implemented.

## Development Commands

```bash
pnpm dev                          # Start Next.js dev server (port 3000)
pnpm build                        # Production build
pnpm lint                         # Run ESLint (next/core-web-vitals + typescript)
pnpm test                         # Run Vitest in watch mode
pnpm test:run                     # Run Vitest once
pnpm vitest run src/__tests__/auth/jwt.test.ts  # Run a single test file
```

### Database

```bash
npx prisma studio                 # Visual DB browser
npx prisma generate               # Generate client after schema changes (outputs to src/generated/prisma/)
npx prisma migrate dev --name <name>  # Create and apply a migration
```

## Tech Stack

- **Framework**: Next.js 16 (App Router) — see AGENTS.md for breaking changes vs older Next.js
- **Language**: TypeScript 5 (strict)
- **Styling**: Tailwind CSS 4 (CSS-first config in `src/app/globals.css`, no `tailwind.config.ts`) + `tw-animate-css`
- **Components**: shadcn/ui v4 (`base-nova` style, `@base-ui/react`, lucide icons). Config in `components.json`.
- **Database**: SQLite via Prisma 7 + `@prisma/adapter-better-sqlite3`
- **Auth**: Custom JWT (jose, HS256) — access token (15min) + refresh token (7d) in HttpOnly cookies, bcryptjs password hashing
- **Validation**: Zod 4
- **Testing**: Vitest 4 (node environment, `@/` path alias, env vars pre-configured in `vitest.config.ts`)
- **Chinese tokenization**: `@node-rs/jieba` for search/FTS
- **Python workers**: Document conversion, RAG indexing/querying/management, and PDF export via child_process spawning Python scripts
- **Package manager**: pnpm (required — `better-sqlite3` native module in `pnpm.onlyBuiltDependencies`)

## Architecture

### Route Groups

Two layout groups in `src/app/`:
- `(auth)/` — login, setup wizard (no sidebar, centered layout)
- `(dashboard)/` — all authenticated pages (sidebar + header layout)

### Proxy (`src/proxy.ts`)

JWT-based auth guard (formerly `middleware.ts`, renamed for Next.js 16). Public paths: `/login`, `/setup`, `/api/v1/auth`, `/api/v1/system`. On every request: validates access token → if expired, rotates both tokens using refresh token → if both invalid, returns 401 JSON for API routes or redirects to `/login` for pages. Token rotation happens entirely in proxy (no API call needed).

### Database (`src/lib/db.ts`)

Prisma client singleton with global caching for dev (prevents connection exhaustion in hot reload). Uses `PrismaBetterSqlite3` adapter. Schema has 16 models — see `prisma/schema.prisma` for full schema.

### Model Resolution (`src/lib/llm/resolve-model.ts`)

`resolveModel(capability)` looks up a model by capability string (e.g. `"writing"`, `"embedding"`). First checks `isDefaultFor` field, then falls back to scanning `capabilities` JSON array on all `ModelConfig` rows. Returns the model with its provider (decrypted API key, base URL).

### LLM Adapter (`src/lib/llm/`)

OpenAI-compatible unified interface supporting Ollama, OpenAI, DeepSeek, and any `/v1/chat/completions` API:
- `types.ts` — `LLMProvider` interface (chat, embed, testConnection, getModels)
- `adapter.ts` — `OpenAICompatibleAdapter` implementation
- `factory.ts` — `createLLMProvider(provider)` factory
- `resolve-model.ts` — capability-based model resolution
- `usage.ts` — token usage recording to `TokenUsage` table

### Document Pipeline (`src/lib/documents/`)

Full pipeline: upload → store → convert to Markdown (Python `convert.py`) → split (structure or semantic) → embed chunks → index in RAG. The `document-worker.ts` in `src/lib/queue/workers/` orchestrates this. Documents support parent/child splits, tag-based organization, and FTS + semantic search.

### RAG System (`src/lib/rag/`)

LightRAG integration via Python workers (`workers/python/rag_index.py`, `rag_query.py`, `rag_manage.py`). Supports local file-based storage by default, with optional enterprise backends (pgvector, Neo4j, Milvus, Qdrant) via env vars. The knowledge graph API (`/api/v1/knowledge/`) provides entity management and subgraph retrieval.

### Search (`src/lib/search/`)

- `fts.ts` — Full-text search using SQLite FTS5 with Chinese tokenization (`@node-rs/jieba`)
- `semantic.ts` — Semantic search using embedding similarity via RAG query script
- `tokenizer.ts` — Chinese text tokenization utilities

### Writing Engine (`src/lib/writing/`)

- `generator.ts` — Section content generation using RAG-retrieved context (limit: 20 references)
- `humanizer.ts` — Content humanization to reduce AI-detectable patterns
- `summarizer.ts` — Section summarization
- `context.ts` — Context assembly from search results for generation prompts

### Task Queue (`src/lib/queue/`)

In-process async task queue (no Redis needed). Initialized in `src/instrumentation.ts` on Node.js runtime startup. Default concurrency: 3, timeout: 5 minutes. Workers registered by task type.

### Settings (`src/lib/settings/`)

`store.ts` manages user settings (storage type, database config, quotas). API routes under `/api/v1/settings/` for storage and database configuration, plus RAG settings.

### Auth (`src/lib/auth/`)

- `jwt.ts` — sign/verify using jose (HS256)
- `password.ts` — bcryptjs hash/verify (rounds=12)
- `session.ts` — getSession from cookies

### Crypto (`src/lib/crypto.ts`)

AES-256-GCM encryption for storing provider API keys. Key from `ENCRYPTION_KEY` env var.

### API Routes (`src/app/api/v1/`)

All routes use the `ApiResponse<T>` envelope (`{ success, data?, error? }`). API surface:
- **auth/** — login, logout, refresh, setup
- **users/** — profile, password
- **models/** — providers CRUD, test connection, usage, usage trends
- **documents/** — upload, CRUD, reprocess, status
- **library/** — documents with tags, keyword search, semantic search, preview
- **brainstorm/** — sessions, messages, generate outline, upload
- **drafts/** — CRUD, sections generate/compare/confirm/humanize, topology, assemble, export, versions, rollback
- **knowledge/** — entities, graph, manage
- **tasks/** — list, get by id
- **settings/** — storage, database, RAG
- **system/** — status, migrations

### Types (`src/types/`)

Shared TypeScript interfaces: `api.ts`, `auth.ts`, `documents.ts`, `models.ts`, `writing.ts`, `knowledge.ts`, `topology.ts`.

## Database Schema

16 models in `prisma/schema.prisma`: User, ModelProvider, ModelConfig, AsyncTask, TokenUsage, Document, DocumentChunk, Tag, DocumentTag, BrainstormSession, Message, Draft, Section, SectionVersion, SectionReference. All use UUID primary keys, `created_at`/`updated_at` timestamps, snake_case column mapping via `@map()`. Schema uses `@@map()` for table names. Relations cascade delete from User.

## Key Conventions

- **Path alias**: `@/` maps to `src/`
- **No `tailwind.config.ts`** — Tailwind 4 CSS-first config in `src/app/globals.css`
- **Python workers**: called via `child_process.spawn` from Node.js. Scripts in `workers/python/`. Python path configurable via `PYTHON_PATH` env var (defaults to `python3`).
- **Design tokens**: primary `#7C3AED`, accent `#F97316`, Plus Jakarta Sans font. See `src/app/globals.css` for full theme.
- **Tests**: located in `src/__tests__/`, mirroring `src/lib/` structure. Test env vars (DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY) are set in `vitest.config.ts`.

## Environment Variables

See `.env.example`. Required: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` (32 chars for AES-256-GCM). Optional: `PYTHON_PATH`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_URL`, LightRAG storage backend vars.

## Key Reference Documents

- `docs/requirements-analysis.md` — Full product requirements (Chinese), API designs, data models
- `docs/superpowers/specs/2026-05-03-p0-foundation-design.md` — P0 design spec
- `prototype/` — Static HTML/CSS mockups (visual spec for UI implementation)
- `AGENTS.md` — Next.js 16 agent rules: read `node_modules/next/dist/docs/` before writing framework code
