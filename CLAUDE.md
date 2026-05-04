# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Synthetix** is an AI-powered document authoring tool for producing long-form, reference-traceable documents. The core workflow is: upload reference documents → convert to Markdown → RAG-index → brainstorm with AI → generate outline → write chapter-by-chapter → export.

**Current phase**: P0 foundation — project initialized, auth system built, model management implemented, dashboard in progress.

## Development Commands

```bash
pnpm dev          # Start Next.js dev server (port 3000)
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # Run ESLint (next/core-web-vitals + typescript)
pnpm test         # Run Vitest in watch mode
pnpm test:run     # Run Vitest once
```

### Database

```bash
# Prisma studio (visual DB browser)
npx prisma studio

# Generate Prisma client after schema changes
npx prisma generate

# Create and apply a migration
npx prisma migrate dev --name <name>
```

Prisma client outputs to `src/generated/prisma/` (configured in `prisma/schema.prisma`).

## Tech Stack (Current)

- **Framework**: Next.js 16 (App Router) — see AGENTS.md for breaking changes vs older Next.js
- **Language**: TypeScript 5 (strict)
- **Styling**: Tailwind CSS 4 + `tw-animate-css`
- **Components**: shadcn/ui v4 (built on `@base-ui/react`)
- **Database**: SQLite via Prisma 7 + `@prisma/adapter-better-sqlite3`
- **Auth**: Custom JWT (jose library) — access token (15min) + refresh token (7d) in HttpOnly cookies, bcryptjs password hashing
- **Validation**: Zod 4
- **Testing**: Vitest 4 (node environment, `@/` path alias configured)
- **Package manager**: pnpm

## Architecture

### Route Groups

Two layout groups in `src/app/`:
- `(auth)/` — login, setup wizard (no sidebar, centered layout)
- `(dashboard)/` — all authenticated pages (sidebar + header layout)

### Middleware (`src/middleware.ts`)

JWT-based auth guard using Next.js middleware. Public paths: `/login`, `/setup`, `/api/v1/auth`, `/api/v1/system`. On every request: validates access token cookie → if expired, rotates tokens using refresh token → if both invalid, redirects to `/login`. Token rotation happens entirely in middleware (no API call needed).

### Database (`src/lib/db.ts`)

Prisma client singleton with global caching for dev (prevents connection exhaustion in hot reload). Uses `PrismaBetterSqlite3` adapter.

### LLM Adapter (`src/lib/llm/`)

OpenAI-compatible unified interface supporting Ollama, OpenAI, DeepSeek, and any `/v1/chat/completions` API:
- `types.ts` — `LLMProvider` interface (chat, embed, testConnection, getModels)
- `adapter.ts` — `OpenAICompatibleAdapter` implementation
- `factory.ts` — `createLLMProvider(provider)` factory

### Auth (`src/lib/auth/`)

- `jwt.ts` — sign/verify using jose (HS256)
- `password.ts` — bcryptjs hash/verify (rounds=12)
- `session.ts` — getSession from cookies

### Crypto (`src/lib/crypto.ts`)

AES-256-GCM encryption for storing provider API keys. Key from `ENCRYPTION_KEY` env var.

### Task Queue (`src/lib/queue/`)

In-process async task queue (no Redis needed for MVP). Types defined, queue implementation in progress.

### API Routes (`src/app/api/v1/`)

All routes use the `ApiResponse<T>` envelope (`{ success, data?, error? }`). Currently implemented: auth (login/logout/refresh/setup), users (profile, password), models (providers CRUD, test connection), system (status).

## Database Schema

5 models in `prisma/schema.prisma`: User, ModelProvider, ModelConfig, AsyncTask, TokenUsage. All use UUID primary keys, `created_at`/`updated_at` timestamps, snake_case column mapping. Schema uses `@@map()` for table name control. Relations cascade delete from User → providers/tasks/usage.

## Prototype Reference

`prototype/` contains static HTML/CSS mockups for all UI screens. These are the visual spec for implementation. Design tokens: `--color-primary: #7C3AED`, `--color-cta: #F97316`, Plus Jakarta Sans font. The actual app uses Tailwind-equivalent tokens (see spec at `docs/superpowers/specs/2026-05-03-p0-foundation-design.md` §8.1 for mapping).

## Environment Variables

See `.env.example`. Required: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` (32 chars for AES-256-GCM).

## Key Reference Documents

- `docs/requirements-analysis.md` — Full product requirements (Chinese), API designs, data models
- `docs/superpowers/specs/2026-05-03-p0-foundation-design.md` — P0 design spec: architecture decisions, UI design token mappings, API routes, task queue design
- `AGENTS.md` — Next.js 16 agent rules: read `node_modules/next/dist/docs/` before writing framework code
