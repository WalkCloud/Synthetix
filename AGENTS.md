<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

```bash
pnpm dev               # dev server (port 3000)
pnpm build             # production build (also catches TS errors — no separate typecheck)
pnpm lint              # ESLint (next/core-web-vitals + typescript)
pnpm test              # Vitest in watch mode
pnpm test:run          # Vitest single run
```

- **Run a single test**: `pnpm vitest run src/__tests__/auth/jwt.test.ts`
- **Tests are in `src/__tests__/`**, mirroring `src/lib/` structure
- **No typecheck command** — `pnpm build` catches TS errors; vitest config pre-sets `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`

## Database (SQLite + Prisma 7)

- **Client output**: `src/generated/prisma/` (gitignored — **must `npx prisma generate` after schema changes**)
- **Create migration**: `npx prisma migrate dev --name <name>`
- **Browse data**: `npx prisma studio`
- Schema uses `snake_case` column mapping (`@@map()`) — Prisma client fields are camelCase
- All models use UUID PKs, `created_at`/`updated_at` timestamps, cascade deletes from User
- **16 models** in `prisma/schema.prisma`

## Architecture

Two route groups in `src/app/`:
- `(auth)/` — login, setup wizard (no sidebar, centered layout)
- `(dashboard)/` — all authenticated pages (sidebar + header)

**Proxy** (`src/proxy.ts`): JWT auth guard (formerly `middleware.ts`, renamed for Next.js 16). Public paths: `/login`, `/setup`, `/api/v1/auth`, `/api/v1/system`. Token rotation (access 15m + refresh 7d) happens entirely in proxy — no API call needed.

**API envelope**: All routes return `{ success: boolean, data?: T, error?: string }`.

**Task queue** (`src/lib/queue/`): in-process async queue (no Redis). Initialized via `src/instrumentation.ts` on Node.js runtime startup. Default concurrency: 3, timeout: 5 min.

## Python workers

Document conversion, RAG indexing/querying/management, and PDF export run via `child_process.spawn` calling Python scripts in `workers/python/` (`convert.py`, `rag_index.py`, `rag_query.py`, `rag_manage.py`, `export.py`). Python path configurable via `PYTHON_PATH` env var (defaults to `python3`).

## Key libraries & conventions

- **Tailwind CSS 4** — CSS-first config in `src/app/globals.css`, no `tailwind.config.ts`
- **shadcn/ui v4** (`components.json`): `base-nova` style, RSC enabled, lucide icons. Components in `src/components/ui/`
- **LLM adapter** (`src/lib/llm/`): `OpenAICompatibleAdapter` implementing `LLMProvider` — supports Ollama, OpenAI, DeepSeek, any `/v1/chat/completions` API
- **Auth** (`src/lib/auth/`): JWT via `jose` (HS256), passwords via `bcryptjs` (rounds=12)
- **API keys encrypted** with AES-256-GCM (`src/lib/crypto.ts`), key from `ENCRYPTION_KEY` env var
- **Validation**: Zod 4
- **Chinese tokenization**: `@node-rs/jieba` for FTS and search
- **pnpm** required — `better-sqlite3` is a native module listed in `pnpm.onlyBuiltDependencies`
- **Path alias**: `@/` maps to `src/`

## Environment variables

Required: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` (32 chars for AES-256-GCM).
Optional: `PYTHON_PATH`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_URL`, LightRAG storage backend vars (see `.env.example`).

## Reference material

- Detailed architecture: `CLAUDE.md`
- Full docs + design specs: `docs/superpowers/specs/`
- Visual UI spec: `prototype/` (static HTML/CSS mockups)
- Design tokens: primary `#7C3AED`, CTA `#F97316`, Plus Jakarta Sans font
- Product requirements (Chinese): `docs/requirements-analysis.md`
