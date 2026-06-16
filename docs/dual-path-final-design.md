# Dual-Path Reference Panel Final Design

## Overview

Make Path A (Domain Knowledge) and Path B (RAG/LightRAG) independently visible and controllable in the writing workspace.

### scopeType Values

| Value | Source | Frontend Tab | Badge |
|---|---|---|---|
| `domain_document` | Path A domain refs | Domain Knowledge | violet |
| `rag_chunk` | Path B direct embedding / keyword | RAG | blue |
| `rag_graph` | Path B LightRAG graph traversal | RAG | amber |

DB `SectionReference.sourceType` is `String` type -- no enum migration needed.

---

## Phase 1: Foundation -- Source Type Tagging + Independent Domain Mode

### 1.1 DB Schema

**File**: `prisma/schema.prisma` -- Section model

Add two fields after `ragDocumentIds`:

```prisma
  domainMode        String   @default("auto") @map("domain_mode")
  domainDocumentIds String?  @map("domain_document_ids")
```

Run: `npx prisma migrate dev --name add-domain-mode`

### 1.2 generator.ts -- preserve source + independent domain mode

**File**: `src/lib/writing/generator.ts`

`fetchRagReferences` (line 119-128): preserve `result.source`:

```typescript
sourceType: result.source === "lightrag" ? "rag_graph" as const : "rag_chunk" as const,
```

`fetchDomainRefs` (line 180-199): read `domainMode` instead of `ragMode`:

```typescript
const domainConfig = parseDomainConfig(section);
if (domainConfig.mode === "off") return [];
```

New helper `parseDomainConfig` (next to existing `parseRagConfig`):

```typescript
function parseDomainConfig(section: { domainMode?: string; domainDocumentIds?: string | null }) {
  return {
    mode: (section.domainMode || "auto") as "auto" | "manual" | "off",
    documentIds: section.domainDocumentIds ? JSON.parse(section.domainDocumentIds) : [],
  };
}
```

Pass `domainConfig` to `retrieveDomainReferences` instead of `ragConfig`.

### 1.3 context.ts -- extend type

**File**: `src/lib/writing/context.ts`

`ragReferences` element type: add `sourceType?: "rag_chunk" | "rag_graph"`.

### 1.4 persist-references.ts -- rag_graph branch

**File**: `src/lib/writing/persist-references.ts`

Add third branch in discriminated union + createMany map:

```typescript
} else if ("sourceType" in ref && ref.sourceType === "rag_graph") {
  return { ..., sourceType: "rag_graph", domainDocumentId: null, domainSegmentId: null, domainLabel: null };
}
```

### 1.5 Draft API -- select new fields

**File**: `src/app/api/v1/drafts/[id]/route.ts`

references select add: `sourceType: true`, `domainLabel: true`.
sections select add: `domainMode: true`, `domainDocumentIds: true`.

### 1.6 Section PUT API -- accept domain config

**File**: `src/app/api/v1/drafts/[id]/sections/[secId]/route.ts`

PUT handler: accept `domainMode` and `domainDocumentIds` alongside existing `ragMode` / `ragDocumentIds`.

### 1.7 SSE -- domain_references event

**File**: `src/app/api/v1/drafts/[id]/sections/[secId]/generate/route.ts`

After line 67 (existing references event):

```typescript
controller.enqueue(encoder.encode(sseEvent("domain_references", { references: result.domainReferences || [] })));
```

**File**: `src/app/api/v1/drafts/[id]/sections/[secId]/compare/route.ts`

Same pattern in `onDone` callback.

### 1.8 domain-references.ts -- accept domain config

**File**: `src/lib/writing/domain-references.ts`

`retrieveDomainReferences` params: replace `ragMode`/`ragDocumentIds` with `domainMode`/`domainDocumentIds`.

Use `domainMode === "manual"` to filter by `domainDocumentIds`.

---

## Phase 2: Reference Panel Dual Tab UI

### 2.1 use-generation.ts

**File**: `src/hooks/writing/use-generation.ts`

- Extend `Reference` interface: add `sourceType?`, `domainLabel?`
- New state: `const [domainReferences, setDomainReferences] = useState<Reference[]>([]);`
- SSE handler: `else if (data.type === "domain_references") setDomainReferences(data.references);`
- Return `domainReferences` + `setDomainReferences`

### 2.2 use-section-actions.ts

**File**: `src/hooks/writing/use-section-actions.ts`

Add `handleDomainConfigChange` (mirrors existing `handleRagConfigChange`):

```typescript
const handleDomainConfigChange = useCallback(async (domainMode: string, domainDocumentIds: string[]) => {
  await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domainMode, domainDocumentIds }),
  });
  await loadDraft();
}, [id, activeSectionId, loadDraft]);
```

### 2.3 writing/[id]/page.tsx

**File**: `src/app/(dashboard)/writing/[id]/page.tsx`

- New state: `const [domainReferences, setDomainReferences] = useState<Reference[]>([]);`
- Reference mapping: split by `sourceType` -- `domain_document` goes to `domainReferences`, rest to `references`
- Pass to `<ReferencePanel>`: `domainReferences`, `sectionDomainMode`, `sectionDomainDocumentIds`, `onDomainConfigChange`

### 2.4 reference-panel.tsx -- Dual Tab

**New Props**:

```typescript
domainReferences: Reference[];
sectionDomainMode: string;
sectionDomainDocumentIds: string[];
onDomainConfigChange: (mode: string, documentIds: string[]) => void;
onDomainReferencesChange: (refs: Reference[]) => void;
```

**Layout**:

```
+------------------------------------------+
| References                                |
| +----------------+---------------------+  |
| | RAG (5)        | Domain Knowledge (3)|  |
| +----------------+---------------------+  |
|                                           |
| [Auto] [Manual] [Off]   <- current tab's |
|                           mode toggle     |
|                                           |
| Tab Content:                              |
|   RAG: grouped by documentName +          |
|        blue [RAG] / amber [graph] badge   |
|   Domain: grouped by domainLabel +        |
|        purple dot + document name         |
+------------------------------------------+
```

**Key behavior**:
- Each tab has its own Auto/Manual/Off toggle
- Mode changes call independent handlers (onRagConfigChange vs onDomainConfigChange)
- Manual mode shows document selector per-tab
- RAG Off does NOT affect Domain and vice versa

**RAG Tab badges**:

| sourceType | Text | Style |
|---|---|---|
| `rag_chunk` | RAG | `bg-blue-50 text-blue-600 border border-blue-100` |
| `rag_graph` | Graph | `bg-amber-50 text-amber-600 border border-amber-100` |

**Domain Tab cards**:

| Element | Style |
|---|---|
| Group header | Purple dot + `text-violet-700 font-semibold text-[11px]` |
| Card | `p-2 border border-border rounded-lg bg-card hover:border-violet-300` |
| Document name | `text-xs text-foreground` + file icon |
| Heading path | `text-[10px] text-muted-foreground truncate` |

---

## Phase 3: Domain Knowledge Card (/library/[id])

### 3.1 Library API

**File**: `src/app/api/v1/library/documents/[id]/route.ts`

Add `domainDocuments: { include: { segments: true }, orderBy: { index: "asc" } }` to include.

### 3.2 DomainKnowledgeCard component

**New file**: `src/components/library/domain-knowledge-card.tsx`

Props: `{ domainStatus, domainCount, domainWarning, domains }`

Three states:
- **running**: progress bar + spinner + "Analyzing..."
- **completed + domains**: domain pills + expandable sections
- **failed/not_requested**: "Not analyzed" hint

### 3.3 library/[id]/page.tsx

Add `<DomainKnowledgeCard>` below existing metadata card in sidebar.

---

## Phase 4: Entity Bridge (/search -> /writing/[id])

### 4.1 entity-evidence API

**New file**: `src/app/api/v1/knowledge/entity-evidence/route.ts`

```
GET /api/v1/knowledge/entity-evidence?entity=Microservice
-> { entity, entityType, relations[], documentChunks[] }
```

### 4.2 graph-reference insert API

**New file**: `src/app/api/v1/drafts/[id]/sections/[secId]/graph-reference/route.ts`

```
POST /api/v1/drafts/{draftId}/sections/{secId}/graph-reference
Body: { entityName, relationType, content, documentChunks[] }
-> creates SectionReference(sourceType: "rag_graph")
```

### 4.3 EntityEvidencePanel component

**New file**: `src/components/search/entity-evidence-panel.tsx`

Placed below TopologyCanvas in knowledge-graph tab.

Shows: selected entity relations + related chunks + "Insert into Writing" button.

### 4.4 search page integration

**File**: `src/app/(dashboard)/search/page.tsx`

Add `<EntityEvidencePanel>` when entity selected in knowledge-graph tab.

---

## File Change Summary

| # | File | Phase | Type |
|---|------|-------|------|
| 1 | `prisma/schema.prisma` | P1 | Schema |
| 2 | `src/lib/writing/generator.ts` | P1 | Backend |
| 3 | `src/lib/writing/context.ts` | P1 | Backend |
| 4 | `src/lib/writing/persist-references.ts` | P1 | Backend |
| 5 | `src/app/api/v1/drafts/[id]/route.ts` | P1 | API |
| 6 | `src/app/api/v1/drafts/[id]/sections/[secId]/route.ts` | P1 | API |
| 7 | `src/app/api/v1/drafts/[id]/sections/[secId]/generate/route.ts` | P1 | API |
| 8 | `src/app/api/v1/drafts/[id]/sections/[secId]/compare/route.ts` | P1 | API |
| 9 | `src/lib/writing/domain-references.ts` | P1 | Backend |
| 10 | `src/hooks/writing/use-generation.ts` | P2 | Hook |
| 11 | `src/hooks/writing/use-section-actions.ts` | P2 | Hook |
| 12 | `src/app/(dashboard)/writing/[id]/page.tsx` | P2 | Page |
| 13 | `src/components/writing/reference-panel.tsx` | P2 | Component |
| 14 | `src/app/api/v1/library/documents/[id]/route.ts` | P3 | API |
| 15 | `src/components/library/domain-knowledge-card.tsx` | P3 | New |
| 16 | `src/app/(dashboard)/library/[id]/page.tsx` | P3 | Page |
| 17 | `src/app/api/v1/knowledge/entity-evidence/route.ts` | P4 | New API |
| 18 | `src/app/api/v1/drafts/[id]/sections/[secId]/graph-reference/route.ts` | P4 | New API |
| 19 | `src/components/search/entity-evidence-panel.tsx` | P4 | New |
| 20 | `src/app/(dashboard)/search/page.tsx` | P4 | Page |

## Color System

| Semantic | Light | Usage |
|----------|-------|-------|
| Domain | `bg-violet-50 text-violet-600` | Path A references, domain pills |
| RAG | `bg-blue-50 text-blue-600` | Path B chunk references |
| Graph | `bg-amber-50 text-amber-600` | Path B LightRAG references |
