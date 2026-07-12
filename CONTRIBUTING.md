# Contributing to Synthetix

Thank you for your interest in contributing! Synthetix is a local-first AI writing workbench, and we welcome contributions of all kinds — bug reports, feature ideas, documentation improvements, and code.

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **Python** ≥ 3.13 (for RAG/embedding workers)
- **pnpm** (package manager)

### Setup

```bash
git clone https://github.com/WalkCloud/Synthetix.git
cd Synthetix
pnpm install

# Generate metadata + secrets for local dev
cp .env.example .env
# Edit .env: set JWT_SECRET and ENCRYPTION_KEY to random 32-char strings

# Initialize the database
npx prisma migrate deploy

# Start the dev server
pnpm dev
```

Open http://localhost:3000 in your browser.

### Architecture Overview

- **Frontend**: Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn/ui
- **Backend**: Next.js API routes + Prisma ORM (SQLite default, PostgreSQL optional)
- **AI workers**: Python sidecar (`workers/python/`) for document conversion, RAG indexing, and embedding
- **Desktop**: Electron 33 shell wrapping the Next.js standalone server
- **i18n**: Custom bilingual (English / Simplified Chinese) — no external i18n library

See `README.md` for the full architecture diagram.

## Development Workflow

1. **Fork & branch**: Create a branch from `main` (e.g. `feat/my-feature` or `fix/my-bugfix`).
2. **Write code**: Follow existing patterns. TypeScript strict mode is enforced.
3. **Write tests**: Add unit tests under `src/__tests__/` for new functionality. Run `pnpm test:run`.
4. **Check types**: `npx tsc --noEmit` must pass with zero errors.
5. **Lint**: `pnpm lint` must pass.
6. **Commit**: Use [conventional commits](https://www.conventionalcommits.org/):
   ```
   feat: add knowledge graph export
   fix: resolve sqlite WAL checkpoint deadlock
   docs: update installation guide
   chore: upgrade dependencies
   ```
7. **Open a PR**: Fill out the PR template, link any related issues.

## Code Style

- **TypeScript**: strict mode, no `any` without justification.
- **Naming**: `camelCase` for functions/variables, `PascalCase` for types/components.
- **i18n**: All user-facing strings go through the locale system (`src/lib/i18n/locales/en.ts` + `zh-CN.ts`). Never hardcode UI text.
- **Python workers**: Follow PEP 8. Keep `PYTHON_PATH` abstraction in `src/lib/python.ts`.

## Testing

- **Unit tests**: `pnpm test:run` (Vitest)
- **E2E tests**: `pnpm e2e:smoke` (Playwright, ~2.5 min) — requires a running dev server
- E2E test fixtures: set `E2E_TEST_DIR` to a directory with your test documents. See `e2e/README.md`.

## Reporting Issues

- **Bug reports**: Use the GitHub issue template. Include steps to reproduce, expected vs actual behavior, and your OS/Node version.
- **Feature requests**: Describe the use case, not just the solution.
- **Security vulnerabilities**: See `SECURITY.md` — do NOT open a public issue.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).

## Questions?

Open a GitHub Discussion or reach out in issues. We're a small team but will respond.
