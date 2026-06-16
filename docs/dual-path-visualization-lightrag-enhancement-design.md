# Dual-Path Document Visualization & LightRAG Enhancement Design

## Overview

### Problem

The dual-path document processing system (Path A Domain Enhancement + Path B RAG/LightRAG) is fully operational on the backend, but its outputs are invisible to users. This creates three critical UX gaps:

1. **Path A is a black box** — After document upload completes, users see "ready" status but have no idea whether domain analysis succeeded, how many domains were identified, or what thematic structure was extracted.
2. **Reference sources are indistinguishable** — In the writing reference panel, domain references, RAG chunk references, and LightRAG entity references are all rendered identically. Users cannot tell whether a reference came from structured domain knowledge, semantic chunk retrieval, or knowledge graph traversal.
3. **LightRAG entities are stranded in the search page** — The knowledge graph topology visualizer exists at `/search`, but there is no bridge from graph entities back to writing context. Entities discovered during LightRAG indexing never surface as structured references during generation.

### Solution

Introduce **three coordinated frontend enhancements** that surface Path A results, distinguish reference provenance, and bridge LightRAG entities into the writing flow:

| Enhancement | Target Page | Path | User Value |
|-------------|-------------|------|------------|
| Domain Knowledge Card | `/library/[id]` | Path A | See thematic domains, summaries, and segment counts extracted from the document |
| Stratified Reference Panel | `/writing/[id]` | Path A + B | Visually distinguish domain, RAG, and graph references; filter by source type |
| Entity-Document Bridge | `/search` + `/writing/[id]` | Path B | Click a graph entity to see related document chunks; optionally insert entity context into writing |

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Domain card placement | Document detail sidebar (`/library/[id]`) | Natural extension of existing doc metadata; avoids cluttering the chunk view |
| Reference stratification | Source-type pills + optional grouping toggle | Minimal friction for existing users; power users can toggle full grouping |
| Graph bridge direction | Search → Writing (one-way insert) | Avoids circular dependencies; entity context is read-only reference material |
| Color coding | Domain = violet, RAG = blue, Graph = amber | Consistent with existing topic color palette in document detail page |
| Failure handling | Graceful degradation (hide card / show "not analyzed") | Path A is non-blocking; UI must not break if domain indexing failed |

---

## Part 1: Domain Knowledge Card (`/library/[id]`)

### Current State

The document detail page (`src/app/(dashboard)/library/[id]/page.tsx`) has:
- Left column: structured chunk view grouped by top-level heading (topic groups with color bars)
- Right sidebar: document metadata card (format, size, status, word count, token count, chunk count)

### Proposed Addition

Add a **"Domain Knowledge" card** below the existing metadata card in the right sidebar.

#### Visual Design (Status: Running)

```
┌─────────────────────────────┐
│  Domain Knowledge            │
│                              │
│  [Analyzing...]              │
│  ████████████░░░░  65%       │  ← thin progress bar
│                              │
│  Analyzing document structure│
│  and thematic domains.       │
└─────────────────────────────┘
```

- **Progress bar**: `h-1.5 bg-secondary rounded-full overflow-hidden` with inner `bg-primary-600`
- **Spinner**: same orange spinner used for document processing state
- **Copy**: "Analyzing document structure and thematic domains" (EN) / "正在分析文档结构和主题领域" (zh-CN)

#### Visual Design (Status: Completed with Domains)

```
┌─────────────────────────────┐
│  Domain Knowledge            │
│  5 domains identified        │
│                              │
│  ┌────────┐ ┌────────┐      │
│  │Product │ │Tech    │      │  ← pill tags
│  │Arch    │ │Stack   │      │
│  └────────┘ └────────┘      │
│  ┌────────┐ ┌────────┐      │
│  │Business│ │User    │      │
│  │Model   │ │Research│      │
│  └────────┘ └────────┘      │
│  ┌────────┐                 │
│  │Operations               │
│  └────────┘                 │
│                              │
│  ──────────────────────────  │
│  ▼ Product Architecture      │  ← expandable section
│    3 segments · 1,240 tokens │
│    Summary: This domain      │
│    covers the product's      │
│    modular design...         │
│                              │
│  ▶ Tech Stack                │
│    5 segments · 2,860 tokens │
│                              │
│  ▶ Business Model            │
│    2 segments · 890 tokens   │
└─────────────────────────────┘
```

#### Design Tokens

| Element | Tailwind Classes |
|---------|-----------------|
| Card container | `bg-card border rounded-[16px] p-5` (same as existing metadata card) |
| Domain pills | `px-2.5 py-1 rounded-full text-xs font-semibold` + color variants |
| Pill colors | `bg-violet-100 text-violet-700`, `bg-blue-100 text-blue-700`, `bg-emerald-100 text-emerald-700`, `bg-orange-100 text-orange-700`, `bg-amber-100 text-amber-700` |
| Expandable header | `flex items-center justify-between py-2 cursor-pointer hover:bg-secondary/50 rounded-lg px-2 -mx-2` |
| Summary text | `text-xs text-muted-foreground leading-relaxed mt-1 line-clamp-3` |
| Segment count | `text-[11px] text-muted-foreground font-medium` |

#### API Contract

Extend the existing document detail API (`GET /api/v1/library/documents/[id]`) to include:

```typescript
interface DocumentMeta {
  // ... existing fields ...
  domainStatus: "not_requested" | "running" | "completed" | "failed";
  domainCount: number | null;
  domainWarning: string | null;
  domains?: DomainView[];
}

interface DomainView {
  id: string;
  domainLabel: string;
  domain: string; // snake_case key
  title: string;
  summary: string | null;
  segmentCount: number;
  tokenCount: number;
}
```

**Implementation note**: The `domains` array should only be populated when `domainStatus === "completed"` and `domainCount > 0`. For running state, return `domainStatus` and `domainCount: null`.

---

## Part 2: Stratified Reference Panel (`/writing/[id]`)

### Current State

The `ReferencePanel` component (`src/components/writing/reference-panel.tsx`) displays references as a flat list grouped by `documentName`. Each reference card shows:
- Document name (group header)
- Title / source info
- Relevance score (percentage)
- Content excerpt (160 chars, expandable)

There is no indication of whether a reference came from:
- `retrieveDomainReferences()` (Path A)
- `fetchRagReferences()` semantic search (Path B, direct embedding)
- `searchViaLightRAG()` graph traversal (Path B, entity-based)

### Proposed Enhancement

Add a **source-type stratification layer** with two modes: **compact** (default, minimal change) and **grouped** (power user view).

#### Compact Mode (Default)

Keep the existing grouped-by-document layout, but add a **source-type micro-badge** to each reference card:

```
┌─────────────────────────────────────┐
│ 参考资料  [Auto ▼]       [≡]        │  ← [≡] toggles grouped mode
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 📄 Product Whitepaper           │ │
│ │                                 │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │ Product Architecture    [领域]│ │ │  ← violet pill, top-right
│ │ │ 85%                         │ │ │
│ │ │ The platform adopts a       │ │ │
│ │ │ microservices architecture... │ │ │
│ │ └─────────────────────────────┘ │ │
│ │                                 │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │ API Gateway Design    [RAG] │ │ │  ← blue pill
│ │ │ 72%                         │ │ │
│ │ │ The gateway handles...      │ │ │
│ │ └─────────────────────────────┘ │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 🕸️ Knowledge Graph              │ │
│ │                                 │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │ Microservice → Gateway [图谱]│ │ │  ← amber pill
│ │ │ 68%                         │ │ │
│ │ │ Entity relation: depends_on │ │ │
│ │ └─────────────────────────────┘ │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

#### Grouped Mode (Toggle via [≡])

When toggled, references are reorganized into **three source-type buckets**:

```
┌─────────────────────────────────────┐
│ 参考资料  [Auto ▼]       [≡]        │
│                                     │
│ ┌─ Domain Knowledge (3) ─────────┐ │
│ │ ┌────────────────────────────┐ │ │
│ │ │ Product Architecture   85% │ │ │
│ │ │ The platform adopts...     │ │ │
│ │ └────────────────────────────┘ │ │
│ │ ┌────────────────────────────┐ │ │
│ │ │ User Personas          78% │ │ │
│ │ │ Our primary users are...   │ │ │
│ │ └────────────────────────────┘ │ │
│ └──────────────────────────────────┘ │
│                                     │
│ ┌─ Semantic Retrieval (5) ───────┐ │
│ │ ┌────────────────────────────┐ │ │
│ │ │ API Gateway Design     72% │ │ │
│ │ │ The gateway handles...     │ │ │
│ │ └────────────────────────────┘ │ │
│ └──────────────────────────────────┘ │
│                                     │
│ ┌─ Knowledge Graph (2) ──────────┐ │
│ │ ┌────────────────────────────┐ │ │
│ │ │ Microservice → Gateway 68% │ │ │
│ │ │ Relation: depends_on       │ │ │
│ │ └────────────────────────────┘ │ │
│ └──────────────────────────────────┘ │
└─────────────────────────────────────┘
```

#### Design Tokens

| Element | Tailwind Classes |
|---------|-----------------|
| Source pill (compact) | `text-[10px] px-1.5 py-0.5 rounded-full font-bold` |
| Domain pill | `bg-violet-50 text-violet-600 border border-violet-100` |
| RAG pill | `bg-blue-50 text-blue-600 border border-blue-100` |
| Graph pill | `bg-amber-50 text-amber-600 border border-amber-100` |
| Group header (grouped mode) | `text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 px-1` |
| Group container | `border border-border rounded-xl bg-muted/30 overflow-hidden p-3` |
| Toggle button [≡] | `p-1.5 rounded-lg hover:bg-secondary text-muted-foreground transition-colors` |

#### Data Model Extension

Extend the `Reference` interface used by `ReferencePanel`:

```typescript
interface Reference {
  documentName: string;
  content: string;
  score: number;
  title?: string | null;
  sourceInfo?: string;
  images?: RefImage[];
  // NEW:
  sourceType: "domain" | "rag" | "graph" | "unknown";
  domainLabel?: string | null;      // for domain references
  entityName?: string | null;       // for graph references
  relationType?: string | null;     // for graph references
  chunkId?: string | null;          // for RAG references
}
```

**Backend wiring**: The generation pipeline (`generator.ts`, `compareSectionStream`, etc.) already produces `domainReferences`, `ragReferences`, and (indirectly via LightRAG) graph-derived chunks. The SSE stream and persistence layer (`persist-references.ts`) need to tag each reference with its source type.

---

## Part 3: LightRAG Entity Bridge (`/search` → `/writing/[id]`)

### Current State

The search page has two tabs:
- **Document Search**: keyword / semantic results with chunk cards
- **Knowledge Graph**: topology canvas showing entities and relations

These are isolated. Clicking a graph entity shows its local subgraph, but there is no way to:
1. See which document chunks are related to that entity
2. Use entity context as a writing reference

### Proposed Enhancement

Add an **"Entity Evidence" drawer/panel** to the knowledge graph view, and a **"Insert as Reference"** action that bridges to the writing page.

#### Knowledge Graph Tab Enhancement

```
┌─────────────────────────────────────────────────────────┐
│ Knowledge Graph                                          │
│                                                          │
│ [🔍 Search entities...]    [Query Mode ▼] [Refresh]     │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │                                                     │ │
│ │              [Topology Canvas]                      │ │
│ │                                                     │ │
│ │         ┌─────────┐                                │ │
│ │         │Microsvc │◄────── click selects          │ │
│ │         └────┬────┘                                │ │
│ │              │ depends_on                         │ │
│ │         ┌────┴────┐                                │ │
│ │         │ Gateway │                                │ │
│ │         └─────────┘                                │ │
│ │                                                     │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ Selected Entity: Microservice ─────────────────────┐ │
│ │ Type: concept    Relations: 12    Documents: 3      │ │
│ │                                                      │ │
│ │ [Insert into Writing ▼]  ← dropdown selects draft   │ │
│ │                                                      │ │
│ │ Related Document Chunks:                            │ │
│ │ • tech-whitepaper.md  [Chunk 5]  Relevance: 82%    │ │
│ │ • architecture-v2.md  [Chunk 2]  Relevance: 75%    │ │
│ │ • api-design.md       [Chunk 8]  Relevance: 68%    │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

#### Writing Page: Receiving Entity Context

When a user inserts an entity from the search page, the writing page's active section receives a **special graph reference**:

```typescript
// In ReferencePanel, graph references look like:
{
  sourceType: "graph",
  documentName: "Knowledge Graph",
  entityName: "Microservice",
  relationType: "depends_on",
  content: "Microservice depends_on Gateway (weight: 0.85). The gateway acts as...",
  score: 0.82,
  sourceInfo: "Entity: Microservice → Gateway"
}
```

This renders with the **amber "图谱" pill** and appears in the "Knowledge Graph" group when grouped mode is active.

#### API Contract

**New endpoint**: `GET /api/v1/knowledge/entity-evidence`

```typescript
// Query params: entity, userId (from session)
interface EntityEvidenceResponse {
  entity: string;
  entityType: string;
  relations: Array<{
    target: string;
    relationType: string;
    description: string;
    weight: number;
  }>;
  documentChunks: Array<{
    documentId: string;
    documentName: string;
    chunkId: string;
    title: string | null;
    content: string;
    relevanceScore: number;
  }>;
}
```

**New endpoint**: `POST /api/v1/drafts/[id]/sections/[secId]/graph-reference`

Accepts an entity evidence payload and stores it as a section reference with `sourceType: "graph"`.

---

## Component Architecture

### New Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `DomainKnowledgeCard` | `src/components/library/domain-knowledge-card.tsx` | Renders domain status, pills, expandable summaries |
| `ReferenceSourceBadge` | `src/components/writing/reference-source-badge.tsx` | Renders domain/rag/graph micro-pill |
| `GroupedReferences` | `src/components/writing/grouped-references.tsx` | Alternative reference list grouped by source type |
| `EntityEvidencePanel` | `src/components/search/entity-evidence-panel.tsx` | Shows entity chunks + insert action |

### Modified Components

| Component | Changes |
|-----------|---------|
| `ReferencePanel` | Add `sourceType` to Reference interface; add compact/grouped mode toggle; render source badges |
| `DocumentDetailPage` (`/library/[id]`) | Include `DomainKnowledgeCard` in sidebar |
| `SearchPage` (`/search`) | Add `EntityEvidencePanel` below topology canvas |
| `generator.ts` | Tag `domainReferences` with `sourceType: "domain"`; ensure LightRAG results carry `sourceType: "graph"` |
| `semantic.ts` | Tag direct-embedding results with `sourceType: "rag"` |
| `persist-references.ts` | Persist `sourceType` field to `SectionReference` table |

---

## Database Changes

### `SectionReference` table (Prisma schema)

Add an enum and column:

```prisma
enum ReferenceSourceType {
  domain
  rag
  graph
  keyword
}

model SectionReference {
  // ... existing fields ...
  sourceType ReferenceSourceType? // nullable for backward compatibility
  domainLabel String?
  entityName  String?
  relationType String?
}
```

Migration strategy: Existing rows have `sourceType = null`. The UI treats null as `unknown` and falls back to no badge.

---

## Implementation Phases

### Phase 1: Reference Source Tagging (Foundation)

1. Add `sourceType` to `Reference` interfaces (frontend + backend DTOs)
2. Update `generator.ts` to tag `domainReferences` with `sourceType: "domain"`
3. Update `semantic.ts` / `searchViaLightRAG` to tag results with `sourceType: "rag"` or `"graph"`
4. Update `persist-references.ts` to persist the new field
5. Update `ReferencePanel` to render source-type micro-badges in compact mode

**User-visible change**: References now show tiny "领域 / RAG / 图谱" pills. Minimal layout disruption.

### Phase 2: Domain Knowledge Card

1. Extend document detail API to include `domainStatus`, `domainCount`, and `domains[]`
2. Create `DomainKnowledgeCard` component
3. Add card to `/library/[id]` sidebar
4. Add i18n strings for status labels

**User-visible change**: Document detail page shows domain analysis results.

### Phase 3: Grouped Reference Mode

1. Create `GroupedReferences` component
2. Add [≡] toggle to `ReferencePanel` header
3. Implement local state for compact ↔ grouped mode preference (persist to localStorage)

**User-visible change**: Users can toggle between compact (current) and grouped (new) reference layouts.

### Phase 4: LightRAG Entity Bridge

1. Create `entity-evidence` API endpoint (wrapping LightRAG query)
2. Create `EntityEvidencePanel` component
3. Add panel to search page knowledge graph tab
4. Create `POST /graph-reference` endpoint for inserting entity context into writing
5. Update writing page to accept and render graph references

**User-visible change**: Users can click graph entities, see related chunks, and insert entity context as writing references.

---

## Appendix: Color System Mapping

| Semantic | Light Theme | Dark Theme | Usage |
|----------|------------|-----------|-------|
| Domain | `bg-violet-100` / `text-violet-700` | `bg-violet-950/30` / `text-violet-400` | Path A domain references, domain pills |
| RAG | `bg-blue-100` / `text-blue-700` | `bg-blue-950/30` / `text-blue-400` | Path B semantic chunk references |
| Graph | `bg-amber-100` / `text-amber-700` | `bg-amber-950/30` / `text-amber-400` | Path B LightRAG entity/relation references |
| Processing | `bg-orange-100` / `text-orange-700` | `bg-orange-950/20` / `text-orange-300` | Running / pending states |

These colors align with the existing **Synthetix Design System v2.1** tokens and the topic group colors already used in `/library/[id]`.
