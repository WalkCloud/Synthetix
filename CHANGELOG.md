# Changelog

All notable changes to Synthetix are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.2] — 2026-07-15

### Added

- **Knowledge graph management**: entity CRUD and merge operations in `rag_manage.py` — create, edit, delete, and merge entities directly from the knowledge graph.
- **Adaptive LLM concurrency**: new capacity tracking and adaptive limiter (`adaptive-limiter.ts`, `provider-capacity-store.ts`) for smarter request throttling under load.
- **Knowledge graph screenshots**: bilingual force-directed graph views added to README product tour.
- **Screenshot capture tool**: `scripts/capture-sanitized-screenshots.mjs` for reproducible, sensitive-info-masked product screenshots.

### Changed

- **README overhaul**: rewritten with pain-point narrative, three-layer knowledge architecture, knowledge flywheel, traceable writing workbench, full product tour (10 bilingual screenshots), first-run workflow, current limitations, and security/privacy sections.
- **Screenshot sanitization**: all 20 product screenshots re-captured with usernames, model provider names, and model identifiers masked.
- **Version badge**: updated to 1.0.2.
- RAG client and graph route minor fixes.

### Removed

- Cleaned up dev-only diagnostic scripts (`check-activity.mts`, `dev-watchdog.mjs`, `diag-*.mts`, `fix-default-slots.mts`, etc.) and build artifacts not intended for the public repo.
- Removed stale root-level screenshots (replaced by `docs/screenshots/`).

### Fixed

- `rag_index.py` and `rag_query.py` robustness improvements.
- `rag_common.py` storage configuration refinements.

---

## [1.0.1] — 2026-07-10

### Added

- **Auto-update system**: `electron/updater.ts` with Ed25519-signed manifest (`latest.json`/`stable.json`) for secure in-app update checks.
- **Manifest signing**: permanent Ed25519 signing key baked into the build.
- **Third-party notices**: auto-generated open-source license notices (`scripts/generate-third-party-notices.mjs`), viewable in-app under About → Third-party notices.
- **About dialog**: version info, update status, and legal links.
- **Release tooling**: `scripts/publish-release.mjs` for one-command GitHub Releases publishing.
- **App metadata generation**: `scripts/generate-app-metadata.mjs`.
- **Bilingual screenshots**: Chinese and English product screenshots for the README.

### Changed

- **Code quality optimization** (from `optimize/v1.0.0-code-quality` branch): refactored core modules for maintainability.
- **README rewrite**: first comprehensive README with architecture, workflows, and deployment docs.

### Fixed

- **Daemon fast-fail**: query calls now fast-fail when the Python daemon is busy with indexing, preventing hangs.
- **RAG query/write contention**: snapshot-read + locked-repair eliminates query/write contention in the knowledge graph.
- **Test assertion fix**: branch order assertion corrected to match implementation (graph before wiki).

---

## [1.0.0] — 2026-06-29

### Added

- **Initial public release** of Synthetix.
- **Document knowledge base**: upload PDF, DOCX, PPTX, HTML, EPUB, TXT, Markdown; Docling-based conversion; structure-aware segmentation; embedding and full-text indexing.
- **Three-layer knowledge architecture**:
  - Layer 1 — raw document chunks with embeddings and FTS.
  - Layer 2 — LightRAG entity-relationship knowledge graph (HKU LightRAG integration) with six retrieval modes (`local`, `global`, `hybrid`, `mix`, `naive`, `bypass`).
  - Layer 3 — LLM-synthesized Knowledge Wiki (inspired by Karpathy's LLM-Wiki and Google OKF) with document summaries, topics, concepts, claims, confidence scores, links/backlinks, change history, and Obsidian-compatible export.
- **Knowledge flywheel**: Wiki-first retrieval (cheap, no LLM call) with automatic RAG reduction on good coverage; generation writeback enriches the Wiki and bumps confidence on cited entries.
- **Long-form writing workbench**:
  - Multi-turn brainstorm with document archetype scaffolding and length gating.
  - STORM-style recursive outline generation (part-by-part concurrent decomposition).
  - Section-by-section generation with per-section Wiki → RAG → graph retrieval cascade and parent/sibling/child context awareness.
  - A/B model comparison on identical section context.
  - Section versioning and rollback.
  - Markdown / PDF / DOCX export.
- **Source traceability**: per-section references (`rag_chunk`, `rag_graph`, `wiki`) with relevance scores, and a force-directed document topology view mapping sections to source documents.
- **Model flexibility**: OpenAI-compatible, Anthropic, DeepSeek-compatible, and Ollama endpoints; configurable embedding and rerank providers.
- **Offline-first deployment**: SQLite + local file/vector storage by default; optional PostgreSQL, pgvector, Neo4j, Milvus, Qdrant backends.
- **Windows desktop installer**: Electron + NSIS per-user installer bundling Node.js runtime, CPython, and local ONNX embedding model.
- **Authentication**: local-first JWT auth with first-run admin setup.
