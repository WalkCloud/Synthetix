# Synthetix CLI Design Document

> Version: 0.1.0 — Draft
> Date: 2026-05-29
> Status: Design Review

## Table of Contents

- [1. Executive Summary](#1-executive-summary)
- [2. Architecture Overview](#2-architecture-overview)
- [3. Command Tree](#3-command-tree)
- [4. Cross-Check Findings](#4-cross-check-findings)
- [5. Impact Analysis](#5-impact-analysis)
- [6. Service Extraction Strategy](#6-service-extraction-strategy)
- [7. CLI Infrastructure](#7-cli-infrastructure)
- [8. Implementation Roadmap](#8-implementation-roadmap)
- [9. Testing Strategy](#9-testing-strategy)
- [10. File Structure](#10-file-structure)

---

## 1. Executive Summary

### Goal

Create a standalone CLI tool (`synthetix`) that exposes **all** current project capabilities as command-line commands, enabling AI coding assistants (Cursor, Claude Code, Copilot, etc.) to invoke Synthetix functionality via shell.

### Target Users

- AI coding assistants — primary consumer. They call shell commands and parse JSON output.
- Developers — secondary consumer. Debug, script automation, CI integration.

### Core Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Implementation | Standalone CLI, direct service calls (no HTTP) | Single process, no server dependency, lower latency for agents |
| Tech stack | `commander` for arg parsing, `tsx` for runtime | Minimal new dependencies; `tsx` handles TS natively |
| Output format | JSON envelope by default; `--pretty` for humans | Agents parse JSON trivially; `--pretty` for debugging |
| Authentication | `--user <username>` or `SYNTHEX_USER` env var, direct DB lookup | CLI runs locally; no JWT round-trip needed |
| SSE streaming | Default: aggregate and return final JSON; `--stream`: JSONL (ndjson) | Agents can choose synchronous or real-time consumption |
| Binary name | `synthetix` (alias: `stx`) | Matches `package.json` name field |

---

## 2. Architecture Overview

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Entry Points                         │
│                                                             │
│  ┌──────────────┐              ┌──────────────────────────┐ │
│  │  Next.js App │              │     CLI (commander)      │ │
│  │  (Web UI +   │              │     synthetix <cmd>      │ │
│  │   API routes)│              │                          │ │
│  └──────┬───────┘              └────────────┬─────────────┘ │
│         │                                   │               │
│  Auth: getAuthUser()              Auth: getCliUser()        │
│  (JWT via cookies)                (DB lookup by username)   │
│         │                                   │               │
├─────────┼───────────────────────────────────┼───────────────┤
│         │       Service Layer (NEW)         │               │
│         │                                   │               │
│  ┌──────▼───────────────────────────────────▼──────────┐    │
│  │                                                     │    │
│  │  doc-service    draft-service    brainstorm-service  │    │
│  │  model-service  task-service     knowledge-service   │    │
│  │  auth-service   settings-service user-service        │    │
│  │                                                     │    │
│  └────────────────────────┬────────────────────────────┘    │
│                           │                                 │
├───────────────────────────┼─────────────────────────────────┤
│                           │   Core Modules (EXISTING)       │
│                           │                                 │
│  ┌────────────────────────▼────────────────────────────┐    │
│  │                                                     │    │
│  │  db (Prisma)     llm/*            queue/*           │    │
│  │  documents/*     writing/*        search/*           │    │
│  │  rag/*           brainstorm/*     crypto             │    │
│  │  settings/store  python.ts        outline-tree       │    │
│  │                                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Python Workers (unchanged)                         │    │
│  │  convert.py · rag_index.py · rag_query.py ·         │    │
│  │  rag_manage.py · export.py                          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow (Example: document upload)

```
CLI:  synthetix doc upload paper.pdf --split-strategy semantic
  │
  ├─ 1. Parse args (commander)
  ├─ 2. Resolve user (getCliUser from DB)
  ├─ 3. Call docService.upload(filePath, userId, options)
  │      ├─ Validate format (SUPPORTED_FORMATS)
  │      ├─ Compute SHA-256 hash
  │      ├─ Check duplicate (db.document.findFirst by hash)
  │      ├─ Create DB record (db.document.create)
  │      ├─ Save file to disk (LocalStorageAdapter.saveOriginal)
  │      ├─ Update DB with file path
  │      └─ Enqueue processing (queue.submit("document_convert", ...))
  ├─ 4. Output JSON: { success: true, data: { document, taskId } }
  └─ 5. Exit 0
```

---

## 3. Command Tree

All 89 API route handlers are covered. Commands are grouped by domain.

### 3.1 `synthetix auth` — Authentication & User Context

| Command | Maps to API | Description |
|---------|------------|-------------|
| `auth setup` | `POST /auth/setup` | First-time admin account creation |
| `auth use --user <name>` | N/A (CLI-specific) | Set active CLI user context |
| `auth whoami` | `GET /users/profile` | Show current user info |

### 3.2 `synthetix user` — User Profile Management

| Command | Maps to API | Description |
|---------|------------|-------------|
| `user profile get` | `GET /users/profile` | Get user profile |
| `user profile update [--display-name NAME] [--email EMAIL]` | `PUT /users/profile` | Update profile |
| `user password change --old PASS --new PASS` | `PUT /users/password` | Change password |
| `user avatar upload <file>` | `PUT /users/avatar` | Upload avatar |
| `user avatar get [--output PATH]` | `GET /users/avatar` | Download avatar |

### 3.3 `synthetix doc` — Document Management

| Command | Maps to API | Description |
|---------|------------|-------------|
| `doc upload <path...>` | `POST /documents/upload` | Upload document(s), supports glob |
| `doc list [--page N] [--limit N] [--status STATUS] [--format FMT]` | `GET /documents` | List documents |
| `doc get <id>` | `GET /documents/[id]` | Document detail |
| `doc delete <id>` | `DELETE /documents/[id]` | Delete single document |
| `doc delete-many --ids ID1,ID2,ID3` | `DELETE /documents/batch` | Batch delete |
| `doc status <id>` | `GET /documents/[id]/status` | Processing status |
| `doc reprocess <id> [--split-strategy STRATEGY]` | `POST /documents/[id]/reprocess` | Reprocess document |
| `doc content <id>` | `GET /library/documents/[id]/content` | Get converted markdown content |
| `doc images <id>` | `GET /documents/[id]/images` | List extracted images |
| `doc image get <id> <filename> --output PATH` | `GET /documents/[id]/images/[filename]` | Download extracted image |

Upload options:

```
--split-strategy <structure-llm|heading-only>
--index-target <full|original|chunks>
--index-mode <basic|graph>
--auto-split <true|false>
--context-usage <number>
--llm-model-id <id>
--embed-model-id <id>
```

### 3.4 `synthetix lib` — Library (Search & Tags)

| Command | Maps to API | Description |
|---------|------------|-------------|
| `lib list [--page N] [--limit N]` | `GET /library/documents` | List library documents |
| `lib get <id>` | `GET /library/documents/[id]` | Document detail + chunks |
| `lib content <id>` | `GET /library/documents/[id]/content` | Document content |
| `lib preview <id>` | `GET /library/documents/[id]/preview` | Document preview |
| `lib search keyword <query> [--limit N] [--offset N]` | `POST /library/search/keyword` | FTS5 keyword search |
| `lib search semantic <query> [--limit N] [--mode MODE]` | `POST /library/search/semantic` | Semantic vector search |
| `lib tags` | `GET /library/tags` | List all tags |
| `lib tag add <id> <tag>` | `POST /library/documents/[id]/tags` | Add tag |
| `lib tag remove <id> <tag>` | `DELETE /library/documents/[id]/tags/[tag]` | Remove tag |

Search mode options: `local | global | hybrid | mix | naive | bypass` (default: `hybrid`)

### 3.5 `synthetix knowledge` — Knowledge Graph / RAG

| Command | Maps to API | Description |
|---------|------------|-------------|
| `knowledge entities [--search QUERY]` | `GET /knowledge/entities` | List/search entities |
| `knowledge entity <name>` | `GET /knowledge/entities/[name]` | Entity detail with relations |
| `knowledge graph` | `GET /knowledge/graph` | Export knowledge graph |
| `knowledge manage --action <create|update|merge|delete|delete-by-doc> --json <file>` | `POST /knowledge/manage` | CRUD on entities/graph |

### 3.6 `synthetix brainstorm` — Brainstorm Sessions

| Command | Maps to API | Description |
|---------|------------|-------------|
| `brainstorm list` | `GET /brainstorm/sessions` | List sessions |
| `brainstorm create [--title TITLE]` | `POST /brainstorm/sessions` | Create session |
| `brainstorm get <id>` | `GET /brainstorm/sessions/[id]` | Session detail |
| `brainstorm delete <id>` | `DELETE /brainstorm/sessions/[id]` | Delete session |
| `brainstorm message <id> --text <text>` | `POST /brainstorm/sessions/[id]/message` | Send message (AI facilitator chat) |
| `brainstorm upload <id> <file>` | `POST /brainstorm/sessions/[id]/upload` | Upload context file |
| `brainstorm outline generate <sessionId>` | `POST /brainstorm/sessions/[id]/generate-outline` | Generate outline from session |
| `brainstorm outline get <sessionId>` | `GET /brainstorm/sessions/[id]` (outline field) | Get generated outline |
| `brainstorm outline update <sessionId> --file <outline.json>` | `PUT /brainstorm/outlines/[id]` | Save/update outline |

### 3.7 `synthetix draft` — Drafts & Writing Engine

#### Draft-level commands

| Command | Maps to API | Description |
|---------|------------|-------------|
| `draft list [--page N] [--limit N]` | `GET /drafts` | List drafts with progress |
| `draft create --session <sessionId>` | `POST /drafts` | Create draft from brainstorm session |
| `draft create --outline <outline.json>` | `POST /drafts` | Create draft from outline JSON |
| `draft get <id>` | `GET /drafts/[id]` | Draft detail with sections + references |
| `draft delete <id>` | `DELETE /drafts/[id]` | Delete draft |
| `draft outline patch <id> --file <outline.json>` | `PATCH /drafts/[id]/outline` | Patch outline structure |
| `draft generate-all <id> [--overwrite] [--stop-on-error] [--model-config-id ID]` | `POST /drafts/[id]/generate-all` | Generate all sections (async task) |
| `draft assemble <id>` | `POST /drafts/[id]/assemble` | Assemble draft sections |
| `draft export <id> --format <md|pdf|docx> --output <path>` | `POST /drafts/[id]/export` | Export draft |
| `draft topology <id>` | `GET /drafts/[id]/topology` | Reference topology |

#### Section commands

| Command | Maps to API | Description |
|---------|------------|-------------|
| `draft section get <draftId> <secId>` | `GET /drafts/[id]/sections/[secId]` | Section detail |
| `draft section update <draftId> <secId> --json <file>` | `PUT /drafts/[id]/sections/[secId]` | Update section |
| `draft section generate <draftId> <secId> [--model-a-config-id ID] [--constraints JSON]` | `POST /drafts/[id]/sections/[secId]/generate` | Generate section content |
| `draft section compare <draftId> <secId> --model-a <id> --model-b <id>` | `POST /drafts/[id]/sections/[secId]/compare` | A/B model comparison |
| `draft section confirm <draftId> <secId> [--selection A|B]` | `POST /drafts/[id]/sections/[secId]/confirm` | Confirm/lock section |
| `draft section unlock <draftId> <secId>` | `POST /drafts/[id]/sections/[secId]/unlock` | Unlock for editing |
| `draft section rollback <draftId> <secId> --version <N>` | `POST /drafts/[id]/sections/[secId]/rollback` | Rollback to version |
| `draft section humanize <draftId> <secId>` | `POST /drafts/[id]/sections/[secId]/humanize` | Humanize AI text |
| `draft section audit <draftId> <secId>` | `POST /drafts/[id]/sections/[secId]/audit` | Quality audit |
| `draft section versions <draftId> <secId>` | `GET /drafts/[id]/sections/[secId]/versions` | Version history |

#### Asset commands

| Command | Maps to API | Description |
|---------|------------|-------------|
| `draft asset list <draftId> <secId>` | `GET /drafts/[id]/sections/[secId]/assets` | List section assets |
| `draft asset create <draftId> <secId> --type <diagram|image|mermaid> --json <file>` | `POST /drafts/[id]/sections/[secId]/assets` | Create asset |
| `draft asset delete <draftId> <secId> <assetId>` | `POST /drafts/[id]/sections/[secId]/assets/[assetId]` | Delete asset |
| `draft asset confirm <draftId> <secId> <assetId>` | `POST .../assets/confirm-asset` | Confirm asset |
| `draft asset serve <draftId> <secId> <assetId> --output <path>` | `GET .../assets/[assetId]/serve` | Download asset file |
| `draft asset generate-diagram <draftId> <secId>` | `POST .../assets/generate-diagram` | Generate SVG diagram |
| `draft asset generate-image <draftId> <secId>` | `POST .../assets/generate-image` | Generate AI image |
| `draft asset batch-generate <draftId> <secId> [--marker-ids ID1,ID2]` | `POST .../assets/batch-generate` | Batch generate pending assets |
| `draft asset suggest-mermaid <draftId> <secId>` | `POST .../assets/suggest-mermaid` | Suggest Mermaid diagram |
| `draft asset mermaid <draftId> <secId>` | `POST .../assets/mermaid` | Generate Mermaid diagram |
| `draft asset mermaid-code <draftId> <secId>` | `POST .../assets/mermaid-generate-code` | Generate Mermaid code only |
| `draft asset upload-image <draftId> <secId> <file>` | `POST .../assets/upload-image` | Upload custom image |

### 3.8 `synthetix model` — Model Provider Management

| Command | Maps to API | Description |
|---------|------------|-------------|
| `model providers list` | `GET /models/providers` | List providers with models |
| `model providers add --json <file>` | `POST /models/providers` | Add provider |
| `model providers get <id>` | `GET /models/providers/[id]` | Provider detail |
| `model providers update <id> --json <file>` | `PUT /models/providers/[id]` | Update provider |
| `model providers delete <id>` | `DELETE /models/providers/[id]` | Delete provider |
| `model providers test <id>` | `POST /models/providers/[id]/test` | Test connectivity |
| `model set-default <configId> --capability <capability>` | `PUT /models/configs/[id]/default` | Set default model for capability |
| `model usage` | `GET /models/usage` | Token usage |
| `model usage trends [--period PERIOD]` | `GET /models/usage/trends` | Usage trends |

Provider JSON schema (for `add`/`update`):

```json
{
  "name": "Ollama Local",
  "providerType": "ollama|openai_compatible|anthropic|custom",
  "apiBaseUrl": "http://localhost:11434/v1",
  "apiKey": "optional",
  "models": [
    {
      "modelId": "qwen3:8b",
      "modelName": "Qwen3 8B",
      "capabilities": ["chat", "writing"],
      "contextWindow": 32768,
      "localOrCloud": "local"
    }
  ]
}
```

### 3.9 `synthetix task` — Async Task Management

| Command | Maps to API | Description |
|---------|------------|-------------|
| `task list [--status STATUS]` | `GET /tasks` | List tasks |
| `task get <id>` | `GET /tasks/[id]` | Task detail |
| `task cancel <id>` | `POST /tasks/[id]` (cancel) | Cancel task |
| `task wait <id> [--timeout SECONDS] [--poll-interval SECONDS]` | N/A (CLI utility) | Poll until task completes, fails, or times out |

### 3.10 `synthetix settings` — Configuration

| Command | Maps to API | Description |
|---------|------------|-------------|
| `settings storage get` | `GET /settings/storage` | Get storage settings |
| `settings storage set --json <file>` | `PUT /settings/storage` | Update storage settings |
| `settings database get` | `GET /settings/database` | Get database settings |
| `settings database set --json <file>` | `PUT /settings/database` | Update database settings |
| `settings rag get` | `GET /settings/rag` | Get RAG settings |
| `settings rag set --json <file>` | `PUT /settings/rag` | Update RAG settings |
| `settings infra` | `GET /settings/infra` | Infrastructure info (read-only) |

### 3.11 `synthetix system` — System Status

| Command | Maps to API | Description |
|---------|------------|-------------|
| `system status` | `GET /system/status` | System health/status (public) |
| `system migrations` | `GET /system/migrations` | Database migration status |

### Global Options

```
Options:
  --user <username>         Operating user (or set SYNTHEX_USER env var)
  --pretty                  Pretty-print JSON output
  --quiet                   Suppress all non-data output
  --stream                  Stream JSONL for SSE-backed commands
  --help                    Display help
  --version                 Display version
```

---

## 4. Cross-Check Findings

These issues were discovered by comparing the initial CLI design against the actual API routes, module structure, and type definitions in the codebase.

### 4.1 Missing Commands (Present in API, Absent from Initial Design)

| # | Missing Command | API Route | Impact |
|---|----------------|-----------|--------|
| 1 | `doc delete-many` | `DELETE /documents/batch` | Cannot bulk-delete documents |
| 2 | `doc images` / `doc image get` | `GET /documents/[id]/images`, `GET /documents/[id]/images/[filename]` | Cannot access extracted images |
| 3 | `lib preview` | `GET /library/documents/[id]/preview` | Cannot preview documents |
| 4 | `user profile/password/avatar` | `GET/PUT /users/profile`, `PUT /users/password`, `PUT /users/avatar` | Full user management gap |
| 5 | `brainstorm outline update` | `PUT /brainstorm/outlines/[id]` | Cannot save edited outlines |
| 6 | `draft outline patch` (was labeled "update") | `PATCH /drafts/[id]/outline` | Method mismatch (PATCH not PUT) |
| 7 | `model usage trends` | `GET /models/usage/trends` | Cannot view usage trends |
| 8 | `system migrations` | `GET /system/migrations` | Cannot check migration status |
| 9 | `draft asset create/delete/confirm/serve` | Multiple asset routes | Asset lifecycle incomplete |
| 10 | `draft asset suggest-mermaid/mermaid-code/batch-generate` | Multiple asset routes | Asset generation incomplete |
| 11 | `settings infra` | `GET /settings/infra` | Missing read-only infra info |

### 4.2 Method Mismatches

| # | Initial Design | Actual API | Correction |
|---|---------------|------------|------------|
| 1 | `draft update <id>` (PUT) | No PUT on `drafts/[id]` | Removed; only GET + DELETE exist |
| 2 | `draft outline <id>` (PUT) | `PATCH /drafts/[id]/outline` | Changed to `draft outline patch` |
| 3 | `lib search keyword` assumed GET | `POST /library/search/keyword` (body: `{query, limit, offset}`) | CLI service uses JSON body |
| 4 | `lib search semantic` assumed GET | `POST /library/search/semantic` (body: `{query, limit, mode}`) | CLI service uses JSON body |

### 4.3 Naming Inconsistencies

| # | Initial Design | Correction | Rationale |
|---|---------------|------------|-----------|
| 1 | Binary: `synthex` | Binary: `synthetix` | Matches `package.json` `"name"` |
| 2 | `auth login` | `auth use --user <name>` | Avoids false JWT session implication |
| 3 | `system settings storage/database/rag` | `settings storage/database/rag` (top-level) | Settings is a separate API domain; reduces nesting |

### 4.4 Coverage Matrix

| API Domain | Routes | CLI Commands | Coverage |
|-----------|--------|-------------|----------|
| Auth (4 routes) | 4 | 3 (login/refresh/logout merged into `auth use`) | 100% capability |
| Users (5 routes) | 5 | 5 | 100% |
| Documents (8 routes) | 8 | 10 (split images/content) | 100% |
| Library (8 routes) | 8 | 9 | 100% |
| Knowledge (4 routes) | 4 | 4 | 100% |
| Brainstorm (7 routes) | 7 | 9 (outline split) | 100% |
| Drafts (17 routes) | 17 | 22 (section/asset split) | 100% |
| Models (6 routes) | 6 | 8 | 100% |
| Tasks (3 routes) | 3 | 4 (+ `wait`) | 100% + utility |
| Settings (4 routes) | 4 | 7 (get/set per domain) | 100% |
| System (2 routes) | 2 | 2 | 100% |
| **Total** | **68** | **~73** | **100%** |

---

## 5. Impact Analysis

### 5.1 What Must Change

#### Route-to-Service Extraction (Medium-High Impact)

**Current state**: 89 API route handlers contain inline business logic with no service layer. Routes directly call `db`, `createLLMProvider`, `getQueue`, etc.

**Required change**: Extract pure business logic functions from routes into `src/cli/services/*`. Both API routes and CLI commands call these shared services.

**Scope**: ~30 route files need extraction. The other ~40 routes are simple CRUD that can be handled by a generic service pattern.

**Complexity breakdown**:

| Complexity | Routes | Example | Effort |
|-----------|--------|---------|--------|
| Simple CRUD | ~40 | `GET /tasks`, `GET /system/status` | Low — generic service handles all |
| Medium logic | ~20 | `POST /documents/upload`, `GET /drafts` with joins | Medium — extract validation + DB logic |
| Complex flows | ~10 | section generate (SSE), brainstorm message (LLM stream), export pipeline | High — state management, streaming, background tasks |

#### CLI Authentication Bypass (Low Impact)

**Current state**: All routes use `getAuthUser()` which calls `cookies()` from `next/headers`.

**Required change**: New `getCliUser(username: string)` function that queries DB directly.

**Scope**: One new file (`src/cli/lib/cli-auth.ts`). Zero changes to existing auth code.

#### Build System Dual Entry (Medium Impact)

**Current state**: Single entry point via `next build` / `next start`. No `bin` field.

**Required change**: Add CLI entry point, `tsx` runtime, `bin` field, handle TypeScript path aliases.

**Scope**: `package.json` + `tsconfig.cli.json` or `tsup.config.ts`. Does not affect Next.js build.

### 5.2 What Does NOT Change

| Component | Impact | Reason |
|-----------|--------|--------|
| `src/lib/db.ts` (Prisma) | **None** | Pure Prisma, no Next.js dependency |
| `src/lib/writing/*` (13 files) | **None** | Already pure logic functions |
| `src/lib/documents/*` (6 files) | **None** | Pipeline, converter, splitter, embedder all pure |
| `src/lib/llm/*` (8 files) | **None** | LLM adapter, factory, client all pure |
| `src/lib/queue/*` (4 files) | **None** | Queue is DB-backed, no HTTP dependency |
| `src/lib/search/*` (3 files) | **None** | FTS + semantic search are pure |
| `src/lib/rag/*` (3 files) | **None** | RAG client/context/dimension are pure |
| `src/lib/brainstorm/*` (2 files) | **None** | Facilitator + outline-prompt are pure |
| `src/lib/crypto.ts` | **None** | AES-256-GCM encrypt/decrypt, no deps |
| `src/lib/python.ts` | **None** | Child process spawner, no deps |
| `src/lib/settings/store.ts` | **None** | JSON file read/write |
| `prisma/schema.prisma` | **None** | Schema unchanged, no migrations |
| `workers/python/*` (5 scripts) | **None** | Python workers unchanged |
| `src/types/*` | **None** | Type definitions unchanged |

**Summary**: ~70% of existing business logic modules require zero changes.

### 5.3 Hidden Risks

#### Queue Initialization Timing

`src/instrumentation.ts` initializes the queue on Next.js server startup. CLI has no `instrumentation.ts`. Must manually call queue init + drain at CLI startup.

**Risk if missed**: `doc upload` creates a pending task that never processes.

**Fix**: 3 lines in CLI entry point:

```ts
import { getQueue } from "@/lib/queue";
getQueue(); // triggers lazy init + drain
```

#### Environment Variable Loading

Next.js auto-loads `.env` files. `tsx` does not.

**Risk if missed**: `JWT_SECRET`, `DATABASE_URL`, `DOCUMENT_ROOT` all `undefined`.

**Fix**: 1 line at CLI entry:

```ts
import "dotenv/config";
```

#### SSE Streaming Adaptation

API routes use `ReadableStream` + `text/event-stream`. CLI needs different consumption patterns.

**Fix**: Service layer exposes async generators. CLI default aggregates to JSON; `--stream` outputs JSONL.

```ts
// Default: collect all chunks, return final result
const result = await generateSectionFull(draft, section, completed, userId);

// --stream: yield ndjson lines
for await (const chunk of generateSectionStream(draft, section, completed, userId)) {
  process.stdout.write(JSON.stringify(chunk) + "\n");
}
```

---

## 6. Service Extraction Strategy

### 6.1 Approach: Incremental, Command-Driven

Do NOT refactor all 89 routes at once. Extract services only as CLI commands are implemented.

**Rule**: For each CLI command, extract the service first, then make both the API route and CLI command call it.

### 6.2 Service Categories

#### Tier 1: Generic CRUD Service (covers ~40 routes)

Many routes follow the same pattern:

```ts
// Pattern: auth check -> DB query -> response
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();
  const data = await db.someModel.findMany({ where: { userId: user.id } });
  return successResponse(data);
}
```

These can be handled by a generic service function:

```ts
// src/cli/services/crud-service.ts
export async function listForUser(model: string, userId: string, options?: object) { ... }
export async function getForUser(model: string, id: string, userId: string) { ... }
export async function deleteForUser(model: string, id: string, userId: string) { ... }
```

#### Tier 2: Domain Services (covers ~20 routes)

| Service | Extracted From | Key Functions |
|---------|---------------|---------------|
| `doc-service.ts` | `documents/upload/route.ts`, `documents/[id]/route.ts` | `upload()`, `delete()`, `batchDelete()` |
| `lib-service.ts` | `library/documents/*`, `library/search/*` | `getContent()`, `preview()`, `keywordSearch()`, `semanticSearch()` |
| `knowledge-service.ts` | `knowledge/*` | `listEntities()`, `getEntity()`, `exportGraph()`, `manage()` |
| `model-service.ts` | `models/*` | `listProviders()`, `addProvider()`, `updateProvider()`, `deleteProvider()`, `testProvider()` |
| `settings-service.ts` | `settings/*` | `getStorage()`, `setStorage()`, `getDatabase()`, etc. |

#### Tier 3: Complex Flow Services (covers ~10 routes)

| Service | Extracted From | Key Functions | Complexity |
|---------|---------------|---------------|------------|
| `draft-service.ts` | `drafts/route.ts`, `drafts/[id]/route.ts` | `create()`, `list()`, `get()`, `delete()` | Medium |
| `section-service.ts` | `drafts/[id]/sections/[secId]/*` | `generate()`, `compare()`, `confirm()`, `rollback()`, `humanize()`, `audit()` | High (SSE, state, refs) |
| `asset-service.ts` | `drafts/[id]/sections/[secId]/assets/*` | `generateDiagram()`, `generateImage()`, `batchGenerate()`, `mermaid()` | High (SVG render, image gen) |
| `brainstorm-service.ts` | `brainstorm/sessions/*` | `create()`, `sendMessage()`, `generateOutline()` | Medium (LLM stream) |
| `task-service.ts` | `tasks/*` | `list()`, `get()`, `cancel()` | Low |
| `user-service.ts` | `users/*` | `getProfile()`, `updateProfile()`, `changePassword()` | Low |

### 6.3 Extraction Priority

Ordered by CLI command implementation sequence:

```
Phase 1.1 — Infrastructure (no routes to extract)
  cli-auth.ts         — new file, no route extraction
  crud-service.ts     — generic CRUD helper

Phase 1.2 — System & Tasks (Tier 1 CRUD)
  system status       — direct read
  system migrations   — direct read
  task list/get/cancel — direct DB queries

Phase 1.3 — Model Management (Tier 2)
  model-service.ts    — extract from models/providers routes
                          (includes Zod schema reuse)

Phase 1.4 — Document Pipeline (Tier 2)
  doc-service.ts      — extract from documents/upload route
                          (upload validation, hash dedup, storage, enqueue)

Phase 1.5 — Library & Search (Tier 2)
  lib-service.ts      — extract from library routes
                          (keyword search, semantic search with mode param)

Phase 1.6 — Draft Core (Tier 3)
  draft-service.ts    — extract from drafts routes
                          (create from session/outline, list with progress)

Phase 2.1 — Brainstorm (Tier 3)
  brainstorm-service.ts — extract from brainstorm routes
                            (LLM chat stream, outline generation)

Phase 2.2 — Section Writing (Tier 3)
  section-service.ts  — extract from section generate/compare/confirm routes
                          (SSE aggregation, state machine, reference persistence)

Phase 2.3 — Assets (Tier 3)
  asset-service.ts    — extract from asset routes
                          (diagram generation, image generation, mermaid)

Phase 2.4 — Knowledge Graph (Tier 2)
  knowledge-service.ts — extract from knowledge routes

Phase 2.5 — Settings & User (Tier 2)
  settings-service.ts — extract from settings routes
  user-service.ts     — extract from user routes
```

---

## 7. CLI Infrastructure

### 7.1 Authentication

```ts
// src/cli/lib/cli-auth.ts

import { db } from "@/lib/db";
import type { AuthUser } from "@/types/auth";

export async function getCliUser(username: string): Promise<AuthUser> {
  const user = await db.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      email: true,
      displayName: true,
      role: true,
    },
  });
  if (!user) {
    throw new Error(`User not found: ${username}`);
  }
  return user;
}

export function resolveUsername(options: { user?: string }): string {
  return (
    options.user ||
    process.env.SYNTHEX_USER ||
    process.env.SYNTHETIX_USER ||
    "admin"
  );
}
```

### 7.2 Environment & Initialization

```ts
// src/cli/index.ts (entry point)

import "dotenv/config";
import { getQueue } from "@/lib/queue";

// Initialize task queue (drains pending tasks from previous runs)
getQueue();

// ... commander setup ...
```

### 7.3 Output Format

```ts
// src/cli/lib/output.ts

export function output(data: unknown, options: { pretty?: boolean }) {
  const json = options.pretty
    ? JSON.stringify({ success: true, data }, null, 2)
    : JSON.stringify({ success: true, data });
  process.stdout.write(json + "\n");
}

export function outputError(error: string, exitCode = 1) {
  process.stderr.write(JSON.stringify({ success: false, error }) + "\n");
  process.exit(exitCode);
}

export function outputStream(chunk: unknown) {
  process.stdout.write(JSON.stringify(chunk) + "\n");
}
```

### 7.4 SSE Command Handling

For commands backed by SSE routes (section generate, brainstorm message, batch-generate assets):

**Default mode** — aggregate all chunks, return final result:

```ts
async function generateSectionCli(draftId: string, secId: string, userId: string) {
  // Uses generateSectionFull() which returns complete result
  const result = await generateSectionFull(draft, section, completed, userId);
  output(result);
}
```

**`--stream` mode** — yield JSONL:

```ts
async function generateSectionStreamCli(draftId: string, secId: string, userId: string) {
  for await (const chunk of generateSectionStream(draft, section, completed, userId)) {
    outputStream(chunk);
  }
}
```

### 7.5 Build Configuration

```jsonc
// package.json additions
{
  "bin": {
    "synthetix": "./dist/cli/index.js",
    "stx": "./dist/cli/index.js"
  },
  "scripts": {
    "cli": "tsx src/cli/index.ts",
    "cli:build": "tsup src/cli/index.ts --format esm --dts --out-dir dist/cli"
  },
  "dependencies": {
    "commander": "^13.0.0"
  }
}
```

```jsonc
// tsup.config.ts (new file)
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist/cli",
  splitting: false,
  sourcemap: true,
  alias: {
    "@": "./src",
  },
});
```

Alternative: skip `tsup` entirely during development and use `tsx src/cli/index.ts` directly. Production builds can be added later.

---

## 8. Implementation Roadmap

### Phase 1: Core Workflow (Priority: High)

Enables agents to: upload documents, build knowledge base, create drafts, generate content, export.

**Estimated effort**: ~3-5 days for service extraction + CLI commands.

| Step | What | Depends On |
|------|------|-----------|
| 1.1 | CLI infrastructure (`index.ts`, `context.ts`, `output.ts`, `cli-auth.ts`) | — |
| 1.2 | `auth setup/use/whoami` | 1.1 |
| 1.3 | `system status/migrations` | 1.1 |
| 1.4 | `task list/get/cancel/wait` | 1.1 |
| 1.5 | `model providers list/add/test/set-default` | 1.2 (model-service extraction) |
| 1.6 | `doc upload/list/get/status/content/reprocess/delete` | 1.4 (doc-service extraction) |
| 1.7 | `lib search keyword/semantic` | 1.6 |
| 1.8 | `draft list/create/get/delete` | 1.7 (draft-service extraction) |
| 1.9 | `draft generate-all` | 1.8 |
| 1.10 | `draft export` | 1.9 |

**Agent workflow after Phase 1**:

```bash
synthetix --user admin doc upload paper.pdf
synthetix task wait <taskId>
synthetix lib search semantic "deep learning NLP applications"
synthetix draft create --outline outline.json
synthetix draft generate-all <draftId>
synthetix task wait <taskId>
synthetix draft export <draftId> --format docx --output report.docx
```

### Phase 2: Full Coverage (Priority: Medium)

**Estimated effort**: ~3-5 days.

| Step | What | Depends On |
|------|------|-----------|
| 2.1 | `brainstorm list/create/get/delete/message/upload/outline/*` | 1.7 (brainstorm-service extraction) |
| 2.2 | `draft section generate/compare/confirm/unlock/rollback/humanize/audit/versions` | 1.9 (section-service extraction) |
| 2.3 | `draft asset list/create/delete/confirm/serve/generate-*/mermaid/*` | 2.2 (asset-service extraction) |
| 2.4 | `knowledge entities/entity/graph/manage` | 1.6 |
| 2.5 | `doc delete-many/images/image get` | 1.6 |
| 2.6 | `lib list/get/content/preview/tags/tag add/tag remove` | 1.7 |
| 2.7 | `settings storage/database/rag/infra` | 1.2 |
| 2.8 | `user profile/password/avatar` | 1.2 |
| 2.9 | `draft outline patch/topology/assemble` | 1.8 |
| 2.10 | `model providers get/update/delete` + `model usage/usage trends` | 1.5 |

---

## 9. Testing Strategy

### Test Framework

Vitest (already configured: `vitest.config.ts`, `"test": "vitest"`).

### Test Categories

#### 9.1 Output Format Tests

```ts
// src/cli/__tests__/output.test.ts

describe("output", () => {
  it("emits JSON envelope on success");
  it("emits error envelope to stderr with non-zero exit");
  it("supports --pretty flag");
  it("supports --quiet flag (supresses non-data output)");
});
```

#### 9.2 Auth Context Tests

```ts
// src/cli/__tests__/cli-auth.test.ts

describe("cli auth", () => {
  it("resolves user from --user flag");
  it("resolves user from SYNTHEX_USER env");
  it("defaults to 'admin'");
  it("throws on non-existent user");
});
```

#### 9.3 Command Integration Tests

```ts
// Per-command test files

describe("doc upload", () => {
  it("accepts supported formats (pdf, docx, pptx, xlsx, html, epub, txt, md)");
  it("rejects unsupported formats");
  it("rejects empty files");
  it("rejects duplicate files (same SHA-256 hash)");
  it("returns { document, taskId } on success");
  it("enqueues document_convert task");
});

describe("task wait", () => {
  it("returns when task completes");
  it("returns when task fails");
  it("exits non-zero on timeout");
  it("exits non-zero on cancelled task");
});

describe("model providers add", () => {
  it("validates provider JSON schema (Zod)");
  it("encrypts API key before storage");
  it("does not leak API key in output");
});

describe("draft create", () => {
  it("creates from brainstorm session ID");
  it("creates from outline JSON file");
  it("rejects when neither sessionId nor outline provided");
});

describe("lib search semantic", () => {
  it("supports all 6 query modes: local, global, hybrid, mix, naive, bypass");
  it("defaults to hybrid mode");
  it("respects --limit parameter");
});
```

#### 9.4 Stream Command Tests

```ts
describe("section generate --stream", () => {
  it("outputs JSONL lines");
  it("outputs final JSON without --stream");
});

describe("brainstorm message --stream", () => {
  it("streams AI response chunks");
});
```

#### 9.5 File Output Tests

```ts
describe("file output commands", () => {
  it("draft export writes to --output path");
  it("doc image get writes to --output path");
  it("asset serve writes to --output path");
  it("handles output path directory not existing");
  it("handles output path already exists");
});
```

### 9.6 Service Layer Tests

As services are extracted from routes, existing route tests should be adapted to test the service directly. New CLI tests then test the command → service path.

```
Before:  Route Test → HTTP → Route Handler → DB
After:   Service Test → Service Function → DB
         CLI Test → Command → Service Function → DB
         Route Test → Route Handler → Service Function → DB (thin wrapper)
```

---

## 10. File Structure

```
src/
  cli/
    index.ts                        # CLI entry point (commander root)
    lib/
      cli-auth.ts                   # CLI authentication (DB lookup, no JWT)
      output.ts                     # JSON output formatting
      errors.ts                     # Error handling and exit codes
      json-input.ts                 # Read JSON from --json flag or stdin
      context.ts                    # CLI context (user, db, options)
    commands/
      auth.ts                       # auth setup/use/whoami
      user.ts                       # user profile/password/avatar
      doc.ts                        # doc upload/list/get/delete/...
      lib.ts                        # lib list/get/search/tags
      knowledge.ts                  # knowledge entities/entity/graph/manage
      brainstorm.ts                 # brainstorm sessions + outline
      draft.ts                      # draft CRUD + section + asset subcommands
      model.ts                      # model providers + usage
      task.ts                       # task list/get/cancel/wait
      settings.ts                   # settings storage/database/rag/infra
      system.ts                     # system status/migrations
    services/
      crud-service.ts               # Generic CRUD (covers ~40 simple routes)
      doc-service.ts                # Document upload, delete, batch
      lib-service.ts                # Library search, content, tags
      knowledge-service.ts          # Knowledge graph CRUD
      brainstorm-service.ts         # Brainstorm chat + outline generation
      draft-service.ts              # Draft create, list, get
      section-service.ts            # Section generate, compare, confirm, etc.
      asset-service.ts              # Asset generation (diagram, image, mermaid)
      model-service.ts              # Provider CRUD + test
      task-service.ts               # Task list, get, cancel
      settings-service.ts           # Settings get/set
      user-service.ts               # User profile + password + avatar
```

### New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `commander` | CLI argument parsing | ~50KB |
| `dotenv` | `.env` loading (already in deps) | 0 (existing) |

No other new dependencies needed. All business logic reuses existing modules.
