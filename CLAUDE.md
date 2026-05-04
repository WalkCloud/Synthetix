# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Synthetix** is an AI-powered document authoring tool for producing long-form, reference-traceable documents. The core workflow is: upload reference documents → convert to Markdown → RAG-index → brainstorm with AI → generate outline → write chapter-by-chapter → export.

The product is in early requirements/prototyping phase. The codebase currently contains:
- `docs/requirements-analysis.md` — Full product requirements (in Chinese), API designs, data models, and architecture decisions
- `prototype/` — Static HTML/CSS prototypes for all UI screens (no framework, no JS logic yet)

## Architecture & Design Decisions

### Tech Stack (Planned)
- **Frontend**: Next.js 15 (App Router) + Tailwind CSS + shadcn/ui
- **Backend API**: Next.js API Routes / Server Actions
- **Database**: PostgreSQL (Prisma ORM); SQLite for offline MVP
- **Document Processing**: Python workers (MarkItDown for format conversion, LightRAG for RAG)
- **LLM Orchestration**: Python or Node.js workers for chapter generation, summarization, dual-model comparison
- **Task Queue**: Redis + BullMQ or Celery for async document processing
- **Storage**: Pluggable — local filesystem, S3, or MinIO
- **Auth**: Local auth (offline) + Appwrite (cloud)
- **Topology Visualization**: D3.js or React Flow

### Service Architecture
The system is split into lightweight services, not a monolith:
- **Web App** — pages, API routes, auth
- **Document Worker** — file conversion, OCR, splitting (Python)
- **RAG Service** — LightRAG indexing, retrieval, reranking
- **LLM Orchestrator** — brainstorming, chapter generation, dual-model comparison, summarization
- **Storage Adapter** — abstracts local/S3/MinIO
- **Model Adapter** — abstracts Ollama/OpenAI-compatible/cloud providers

Key rule: Next.js API routes should **never** execute long-running tasks directly. They create a task and return a task ID; background workers process async; frontend polls or subscribes for updates.

### Deployment Modes
1. **Offline local service** (priority) — browser-based, no Docker/Electron required
2. **Docker Compose** (optional) — for teams/servers
3. **Cloud** (future) — Vercel/AWS, managed services

### Core Feature Modules
| ID | Module | Purpose |
|----|--------|---------|
| F0 | Dashboard | Stats, recent docs, quick actions |
| F1 | Document Init | Upload → Markdown conversion → vectorization |
| F2 | Library | Browse, keyword/semantic search, tags |
| F3 | Brainstorm | Socratic dialogue → structured outline |
| F4 | Writing | Chapter-by-chapter generation with state machine |
| F5 | Topology | Visual reference graph (draft ↔ source docs) |
| F6 | Models | LLM provider config, token usage tracking |
| F7 | Users | Auth, profile, system settings (storage/DB config) |

### Chapter State Machine (F4)
Each chapter is an independent state unit: `pending → retrieving → generating | comparing → reviewing → accepted → summarized → locked`. Failed chapters support retry with same or different model. Context for each chapter includes: global outline, user constraints, RAG-retrieved fragments, and summaries of prior accepted chapters (not full text).

## Prototype Structure

All prototypes are in `prototype/` as standalone HTML files with a shared design system:
- `shared-styles.css` — Design system: CSS custom properties, sidebar, cards, buttons, forms, tables, modals, toasts, tags/badges, utility classes
- `index.html` — Login page (entry point)
- `dashboard.html` — F0 dashboard
- `f1-init.html` — Document initialization/upload
- `f2-library.html` — Document library
- `f3-brainstorm.html` — Brainstorming/outlining
- `f4-writing.html` — Document writing (3-panel layout: outline | editor | references)
- `f5-topology.html` — Document topology graph
- `f6-models.html` — Model management
- `f7-users.html` — User management

Design system uses: `--color-primary: #7C3AED` (purple), `--color-cta: #F97316` (orange accent), Plus Jakarta Sans font.

To preview prototypes: open any HTML file directly in a browser, or serve the `prototype/` directory with any static file server.

## Development Commands

This project has not been initialized with a framework yet. When starting implementation:

```bash
# Initialize Next.js project (planned)
pnpm create next-app@latest .

# Run dev server
pnpm dev

# Build
pnpm build

# Lint
pnpm lint
```

## Key Reference Documents

- `docs/requirements-analysis.md` — Authoritative source for feature requirements, API contracts, data models, business rules, and milestone plan
