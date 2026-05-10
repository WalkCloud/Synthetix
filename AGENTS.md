<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

```bash
pnpm dev               # dev server (port 3000)
pnpm build             # production build
pnpm lint              # ESLint (next/core-web-vitals + typescript)
pnpm test              # Vitest in watch mode
pnpm test:run          # Vitest single run
```

- **Run a single test**: `pnpm vitest run path/to/test.test.ts`
- **Tests are in `src/__tests__/`**, mirroring `src/lib/` structure
- **No typecheck command defined** — rely on Next.js build + IDE (strict TS)

## Database (SQLite + Prisma 7)

- **Client output**: `src/generated/prisma/` (gitignored — must `npx prisma generate` after schema changes)
- **Create migration**: `npx prisma migrate dev --name <name>`
- **Browse data**: `npx prisma studio`
- Schema uses `snake_case` column mapping (`@@map()`) — Prisma client fields are camelCase
- All models use UUID PKs, `created_at`/`updated_at` timestamps, cascade deletes from User

## Architecture

Two route groups in `src/app/`:
- `(auth)/` — login, setup wizard (no sidebar, centered layout)
- `(dashboard)/` — all authenticated pages (sidebar + header)

**Middleware** (`src/middleware.ts`): JWT auth guard. Public paths: `/login`, `/setup`, `/api/v1/auth`, `/api/v1/system`. Token rotation (access 15m + refresh 7d) happens entirely in middleware — no API call needed.

**API envelope**: All routes return `{ success: boolean, data?: T, error?: string }`.

## Key libraries & conventions

- **Tailwind CSS 4** — CSS-first config in `src/app/globals.css`, no `tailwind.config.ts`
- **shadcn/ui v4** (`components.json`): `base-nova` style, RSC enabled, lucide icons. Components in `src/components/ui/`
- **LLM adapter** (`src/lib/llm/`): `OpenAICompatibleAdapter` implementing `LLMProvider` interface — supports Ollama, OpenAI, DeepSeek, any `/v1/chat/completions` API
- **Auth** (`src/lib/auth/`): JWT via `jose` (HS256), passwords via `bcryptjs` (rounds=12)
- **API keys encrypted** with AES-256-GCM (`src/lib/crypto.ts`), key from `ENCRYPTION_KEY` env var
- **Task queue** (`src/lib/queue/`): in-process async queue, initialized via `src/instrumentation.ts`
- **pnpm** required — `better-sqlite3` is a native module listed in `pnpm.onlyBuiltDependencies`
- **Path alias**: `@/` maps to `src/`

## Reference material

- Full docs + design specs: `docs/superpowers/specs/`
- Visual UI spec: `prototype/` (static HTML/CSS mockups)
- Design tokens: primary `#7C3AED`, CTA `#F97316`, Plus Jakarta Sans font
- Product requirements (Chinese): `docs/requirements-analysis.md`
- Detailed architecture notes: `CLAUDE.md`
