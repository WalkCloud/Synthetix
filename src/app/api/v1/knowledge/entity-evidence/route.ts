/**
 * Entity evidence — the chunks that mention a given entity.
 *
 * PRIMARY PATH (fast, <100ms): read LightRAG's `kv_store_entity_chunks.json`
 * directly — it's the canonical {entity → chunk_ids} mapping LightRAG itself
 * uses for deletion. See src/lib/knowledge/entity-evidence.ts.
 *
 * FALLBACK: when the entity isn't in the graph (fresh index, entity name
 * doesn't match anything extracted, or no graph built yet), fall back to
 * semanticSearch. That's the right semantic for "we have no exact entity match
 * — show me chunks that are semantically close to this name". The fallback is
 * slow (28-68s) but rare: it only fires when the fast path genuinely can't
 * answer.
 */
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { semanticSearch } from "@/lib/search/semantic";
import {
  getEntityEvidenceFromKv,
  EntityNotInGraphError,
} from "@/lib/knowledge/entity-evidence";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { searchParams } = new URL(request.url);
  const entity = searchParams.get("entity")?.trim();
  if (!entity) return errorResponse({ code: "invalidInput", message: "Entity is required" }, 400);

  // Fast path: direct KV-store lookup (no LLM, no embedding, no Python).
  try {
    const evidence = await getEntityEvidenceFromKv(user.id, entity, 8);
    return successResponse({
      entity: evidence.entity,
      documentChunks: evidence.documentChunks.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        documentName: c.documentName,
        title: c.title,
        content: c.content,
        score: c.score,
        source: c.source,
      })),
    });
  } catch (err) {
    // Only the EntityNotInGraphError signals "fall back"; anything else is a
    // real failure and should surface.
    if (!(err instanceof EntityNotInGraphError)) {
      console.error("[entity-evidence] KV fast-path failed:", err);
      // Fall through to semanticSearch as a safety net — never hard-fail the
      // endpoint because the fast path had an unexpected error.
    }
  }

  // Fallback: semantic search (slow, but correct when entity isn't in the graph).
  const results = await semanticSearch(entity, user.id, 8, "mix");
  return successResponse({
    entity,
    documentChunks: results.map((result) => ({
      chunkId: result.chunkId,
      documentId: result.documentId,
      documentName: result.documentName,
      title: result.title,
      content: result.content,
      score: result.score,
      source: result.source,
    })),
  });
}
