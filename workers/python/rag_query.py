"""Synthetix LightRAG semantic query — returns structured chunk results with scores.

Supports all LightRAG query modes:
  - local    : entity-level retrieval (specific facts/entities)
  - global   : theme-level retrieval (summarization, broad context)
  - hybrid   : balanced local + global (default)
  - mix      : graph + vector + optional reranker
  - naive    : pure vector similarity (no graph)
  - bypass   : LLM-only, no retrieval

Usage:
  CLI mode:
    python rag_query.py --user-id <uid> --query "<text>" --mode hybrid --limit 20
           [--return-entities] [--return-relations]
           [--embed-api-base <url>] [--embed-api-key <key>] [--embed-model <name>]
           [--llm-api-base <url>] [--llm-api-key <key>] [--llm-model <name>]

  Daemon mode (via workers/python/daemon.py, op="query"):
    handle_query(params) calls query_rag(**params) and returns the dict directly.
    LightRAG instances are cached per working_dir so daemon-resident queries
    skip the cold-start (import + storage load + JSON integrity scan) after the
    first query for each user.

Output: JSON to stdout (CLI mode) or returned dict (daemon mode).
"""
import sys
import json
import os
import re
import time
import argparse
import asyncio

# Patch atomic_write before importing LightRAG (covers spawn-mode query path).
from win_atomic_patch import apply_patch
apply_patch()

from rag_common import load_storage_config, build_rerank_func, resolve_embed_dim, resolve_user_rag_dir

# Per-call timeout for the query-time LLM (keyword extraction etc.). The OpenAI
# client default is 600s; without this cap a single slow/hanging call waited up
# to 600s x retries and was killed by the Node-side timeout — which is what made
# hybrid/mix appear to "time out" even though the index loaded fine at 2048-dim.
LLM_CALL_TIMEOUT_S = 25.0
LLM_MAX_ATTEMPTS = 2


def normalize_vector_score(value):
    if value is None:
        return None
    if not isinstance(value, (int, float)):
        return None
    return max(0.0, min(1.0, float(value)))


def build_rank_score(rank: int, total: int) -> float:
    if total <= 1:
        return 0.75
    t = rank / max(total - 1, 1)
    return max(0.25, 0.75 - t * 0.35)


# ── Daemon-resident LightRAG instance cache ──────────────────────────────────
# Keyed by working_dir so each user gets one resident LightRAG. When the daemon
# is enabled, the second and later queries for a user skip:
#   - Python interpreter start + heavy imports (daemon stays resident)
#   - fix_corrupted_json_files + JSON/GraphML integrity scan
#   - rag.initialize_storages() (already loaded into memory)
# The cache is invalidated if embedding dimension or model changes, or if the
# index lock is freshly held (data was re-indexed since the instance was built).
_rag_cache: dict[str, dict] = {}


def _cache_key(working_dir: str, embed_model: str, embed_dim: int) -> str:
    return f"{working_dir}|{embed_model}|{embed_dim}"


def _invalidate_rag_cache(working_dir: str | None = None) -> None:
    """Drop cached LightRAG instances. If working_dir is given, drop only that
    user's; otherwise drop everything (used on dimension/model change)."""
    global _rag_cache
    if working_dir is None:
        _rag_cache = {}
        return
    keys_to_drop = [k for k in _rag_cache if k.startswith(f"{working_dir}|")]
    for k in keys_to_drop:
        # Best-effort close of any async storages the instance holds.
        entry = _rag_cache.pop(k, None)
        inst = entry.get("rag") if entry else None
        _close_rag_safely(inst)


def _close_rag_safely(rag) -> None:
    if rag is None:
        return
    try:
        # LightRAG storages expose finalize in >=1.2; older versions ignore it.
        fin = getattr(rag, "finalize_storages", None)
        if callable(fin):
            asyncio.run(fin())
    except Exception:
        pass


async def _get_or_build_rag(
    working_dir: str,
    embed_api_base: str,
    embed_api_key: str,
    embed_model: str,
    embed_dim: int,
    llm_func,
    embedding_func,
    rerank_kwargs: dict,
    emit_timing=None,
) -> tuple[object, bool]:
    """Return (rag, fresh). If a resident instance matches the working_dir +
    embedding config, reuse it; otherwise build a fresh one (running the JSON
    integrity scan + storage load exactly once), cache it, and return fresh=True.

    emit_timing(stage, ms) is called for the load stage on fresh builds.
    """
    key = _cache_key(working_dir, embed_model, embed_dim)
    entry = _rag_cache.get(key)
    if entry is not None:
        cached_rag = entry.get("rag")
        if cached_rag is not None:
            # Snapshot-read: always reuse the cached instance, even when
            # .indexing.lock is present (a write is in progress). The cached
            # instance is a consistent point-in-time view of the store — it
            # merely lacks the entities currently being written, which is
            # acceptable for retrieval (an enhancement layer). This avoids the
            # 5-20s rebuild (JSON/GraphML scan + storage reload) that used to
            # block queries during indexing. After a write completes, the
            # writer calls _invalidate_rag_cache(working_dir) so the next
            # query rebuilds once with the fresh data.
            return cached_rag, False

    from lightrag import LightRAG

    kv_storage, vector_storage, graph_storage, doc_status_storage, storage_kwargs = load_storage_config()

    # NOTE: file integrity repair (fix_corrupted_json_files + JSON/GraphML
    # scan) is deliberately NOT run on the read side. That logic mutates the
    # filesystem (deletes/resets files) and races the writer when indexing is
    # in progress. Repair is the write side's responsibility — rag_index.py
    # runs it inside indexing_lock before writing. The read side only loads;
    # a corrupt file surfaces as an error here and degrades gracefully via
    # the fail-soft contract in semantic.ts (fallback to direct embedding).

    try:
        max_retries = 5
        rag = None
        for attempt in range(max_retries):
            try:
                rag = LightRAG(
                    working_dir=working_dir,
                    llm_model_func=llm_func,
                    embedding_func=embedding_func,
                    kv_storage=kv_storage,
                    vector_storage=vector_storage,
                    graph_storage=graph_storage,
                    doc_status_storage=doc_status_storage,
                    **storage_kwargs,
                    **rerank_kwargs,
                )
                break
            except Exception as e:
                if "no element found" in str(e) and attempt < max_retries - 1:
                    await asyncio.sleep(1)
                    continue
                raise
    except Exception as e:
        err = str(e)
        if "Embedding dim mismatch" in err or "expected:" in err:
            raise _EmbeddingMismatchError(err)
        raise

    _t_load0 = time.time()
    await rag.initialize_storages()
    if emit_timing is not None:
        emit_timing("load", round((time.time() - _t_load0) * 1000.0))

    _rag_cache[key] = {"rag": rag}
    return rag, True


class _EmbeddingMismatchError(Exception):
    """Raised when the stored index was built with a different embedding dim."""


async def query_rag(
    user_id: str,
    query_text: str,
    mode: str = "hybrid",
    limit: int = 20,
    return_entities: bool = False,
    return_relations: bool = False,
    embed_api_base: str = "",
    embed_api_key: str = "",
    embed_model: str = "",
    embed_dim: int = 0,
    llm_api_base: str = "",
    llm_api_key: str = "",
    llm_model: str = "",
    rerank_api_base: str = "",
    rerank_api_key: str = "",
    rerank_model: str = "",
) -> dict:
    """Query LightRAG and return structured results: chunks, optional entities/relations.

    Returns a dict (never prints). CLI main() prints it; daemon handle_query()
    returns it over the wire so the resident process can reuse cached state.
    """
    working_dir = resolve_user_rag_dir(user_id)

    if not os.path.exists(working_dir):
        return {"chunks": [], "mode": mode}

    # Quick health check — fail fast when data is clearly unusable
    def _quick_health_check(wd: str) -> tuple:
        # NOTE: The previous code deleted .indexing.lock files older than 30
        # minutes. That was unsafe: graph index tasks are allowed to run for
        # hours, so a legitimate long-running writer's marker could be deleted
        # mid-operation by a query, breaking the writer's concurrency contract.
        # The read side must NEVER delete writer locks. When a marker exists,
        # the query reuses a cached snapshot or returns "indexing in progress".
        lock_file = os.path.join(wd, ".indexing.lock")
        if os.path.exists(lock_file):
            return False, "indexing in progress"

        kv_file = os.path.join(wd, "kv_store_full_docs.json")
        if not os.path.exists(kv_file):
            return False, "no data indexed yet"
        if os.path.getsize(kv_file) == 0:
            return False, "empty index"

        return True, "ok"

    ok, reason = _quick_health_check(working_dir)
    if not ok:
        return {"chunks": [], "mode": mode, "warning": f"data unavailable: {reason}"}

    from lightrag.llm.openai import openai_embed
    from lightrag.utils import EmbeddingFunc
    from openai import AsyncOpenAI

    import numpy as np

    async def embedding_func(texts: list[str], **kwargs):
        # IMPORTANT: openai_embed is decorated with @wrap_embedding_func_with_attrs
        # which hardcodes embedding_dim=1536. Calling it directly makes LightRAG
        # validate our 2048-dim (text-embedding-v4) vectors against 1536, producing
        # "total elements (2048) cannot be evenly divided by expected dimension (1536)".
        # Invoke the unwrapped function via `.func` to bypass the inner decorator.
        # Same fix as rag_index.py — the query path was the only place still calling
        # it directly, which is why semantic search failed while indexing worked.
        unwrapped = getattr(openai_embed, "func", openai_embed)
        result = await unwrapped(
            texts,
            model=embed_model,
            base_url=embed_api_base,
            api_key=embed_api_key,
            **kwargs,
        )
        if isinstance(result, list) and len(result) > 0:
            return np.array([list(v) if hasattr(v, '__iter__') and not isinstance(v, list) else v for v in result], dtype=np.float32)
        return result

    _ignored_llm_kwargs = {"hashing_kv", "openai_client_configs", "token_tracker"}

    # Closure-shared observability: counts query-time LLM round-trips and their
    # cumulative wall time, emitted as a stderr "timing" event after the query.
    llm_stats = {"calls": 0, "total_ms": 0.0}

    async def llm_func(
        prompt: str,
        system_prompt: str | None = None,
        history_messages: list | None = None,
        **kwargs,
    ) -> str:
        if history_messages is None:
            history_messages = []
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        for msg in history_messages:
            messages.append(msg)
        messages.append({"role": "user", "content": prompt})

        clean_kwargs = {k: v for k, v in kwargs.items() if k not in _ignored_llm_kwargs}
        response_format = clean_kwargs.pop("response_format", None)
        clean_kwargs.pop("keyword_extraction", None)
        clean_kwargs.pop("stream", None)
        # LightRAG passes a per-call `timeout` that is a different concept from the
        # HTTP timeout; drop it and rely on the client-level LLM_CALL_TIMEOUT_S.
        clean_kwargs.pop("timeout", None)

        client = AsyncOpenAI(
            base_url=llm_api_base,
            api_key=llm_api_key,
            timeout=LLM_CALL_TIMEOUT_S,
        )
        use_structured = response_format is not None

        try:
            for attempt in range(LLM_MAX_ATTEMPTS):
                try:
                    if use_structured and attempt == 0:
                        try:
                            _t0 = time.time()
                            response = await client.beta.chat.completions.parse(
                                model=llm_model,
                                messages=messages,
                                response_format=response_format,
                            )
                            llm_stats["total_ms"] += (time.time() - _t0) * 1000.0
                            llm_stats["calls"] += 1
                            parsed = getattr(response.choices[0].message, "parsed", None)
                            if parsed is not None:
                                return parsed.model_dump_json()
                            return response.choices[0].message.content or ""
                        except Exception:
                            use_structured = False

                    _t0 = time.time()
                    response = await client.chat.completions.create(
                        model=llm_model,
                        messages=messages,
                        **clean_kwargs,
                    )
                    llm_stats["total_ms"] += (time.time() - _t0) * 1000.0
                    llm_stats["calls"] += 1
                    content = response.choices[0].message.content or ""
                    if not content.strip():
                        raise ValueError("Empty response from LLM")
                    return content
                except Exception:
                    if attempt < LLM_MAX_ATTEMPTS - 1:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        raise
        finally:
            await client.close()

    eff_dim = resolve_embed_dim(embed_model, embed_dim)

    rerank_fn = build_rerank_func(rerank_api_base, rerank_api_key, rerank_model)
    rerank_kwargs = {"rerank_model_func": rerank_fn} if rerank_fn else {}

    from lightrag import QueryParam

    def _emit_timing(stage, ms):
        # Daemon routes stderr lines to Node; standalone CLI also prints them.
        print(json.dumps({"type": "timing", "stage": stage, "ms": ms}), file=sys.stderr, flush=True)

    try:
        rag, _fresh = await _get_or_build_rag(
            working_dir,
            embed_api_base,
            embed_api_key,
            embed_model,
            eff_dim,
            llm_func,
            EmbeddingFunc(
                embedding_dim=eff_dim,
                max_token_size=8192,
                func=embedding_func,
                send_dimensions=True,
            ),
            rerank_kwargs,
            emit_timing=_emit_timing,
        )
    except _EmbeddingMismatchError as e:
        return {
            "error": str(e),
            "mode": mode,
            "warning": "Embedding dimension mismatch — the stored index was created with a different embedding model. Re-index documents with the current model to resolve.",
        }

    # Resolve mode aliases
    valid_modes = {"local", "global", "hybrid", "mix", "naive", "bypass"}
    if mode not in valid_modes:
        mode = "hybrid"

    param = QueryParam(
        mode=mode,
        top_k=60,
        chunk_top_k=max(limit * 5, 80),
        only_need_context=True,
        enable_rerank=True,
    )

    try:
        _t_q0 = time.time()
        result = await rag.aquery_data(query_text, param=param)
        _emit_timing("query", round((time.time() - _t_q0) * 1000.0))
        _emit_timing("llm", round(llm_stats["total_ms"]))
        data = result.get("data", {}) if isinstance(result, dict) else {}

        chunks = data.get("chunks", [])
        entities = data.get("entities", [])
        relations = data.get("relationships", []) or data.get("relations", [])

        # Recover per-chunk cosine distance. LightRAG's aquery_data already runs a
        # vector search internally; we only do a SECOND vdb query to attach scores
        # to chunk ids. On daemon-resident instances the vdb is in memory, so this
        # is cheap — but we skip it entirely when aquery already exposed distances
        # on the chunks (newer LightRAG builds include a `distance` field).
        cosine_map: dict[str, float] = {}
        pre_exposed = any(isinstance(c, dict) and c.get("distance") is not None for c in chunks)
        if not pre_exposed:
            try:
                vdb_results = await rag.chunks_vdb.query(
                    query_text, top_k=max(limit, len(chunks)) * 2
                )
                for vr in vdb_results:
                    cid = vr.get("id", "")
                    dist = vr.get("distance", 0.0)
                    if cid and isinstance(dist, (int, float)):
                        cosine_map[cid] = float(dist)
            except Exception:
                pass

        output_chunks = []
        for i, chunk in enumerate(chunks):
            chunk_id = chunk.get("chunk_id", "")
            content_text = chunk.get("content", "")

            title = ""
            for line in content_text.split("\n"):
                line = line.strip()
                if line.startswith("#"):
                    m = re.match(r"^(#{1,6})\s+(.+)", line)
                    if m:
                        title = m.group(2)
                        break

            # Prefer the distance aquery already attached (newer builds), then
            # the secondary vdb query map, then fall back to a rank-based score.
            vector_score = None
            if isinstance(chunk, dict) and chunk.get("distance") is not None:
                vector_score = normalize_vector_score(chunk.get("distance"))
            if vector_score is None:
                vector_score = normalize_vector_score(cosine_map.get(chunk_id))
            rank_score = build_rank_score(i, len(chunks))
            score = vector_score if vector_score is not None else rank_score

            output_chunks.append({
                "chunk_id": chunk_id,
                "content": content_text,
                "title": title,
                "rank": i + 1,
                "score": round(score, 4),
                "vector_score": round(vector_score, 4) if vector_score is not None else None,
            })

        output: dict = {
            "chunks": output_chunks,
            "mode": mode,
            "total_chunks": len(output_chunks),
        }

        if return_entities:
            output["entities"] = entities[:limit] if entities else []

        if return_relations:
            output["relations"] = relations[:limit] if relations else []

        return output
    except Exception as e:
        return {
            "error": str(e),
            "mode": mode,
            "context": {
                "working_dir_exists": os.path.exists(working_dir),
                "has_graphml": os.path.exists(os.path.join(working_dir, "graph_chunk_entity_relation.graphml")),
                "has_kv": os.path.exists(os.path.join(working_dir, "kv_store_full_docs.json")),
                "has_vdb": os.path.exists(os.path.join(working_dir, "vdb_chunks.json")),
                "has_lock": os.path.exists(os.path.join(working_dir, ".indexing.lock")),
            },
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="LightRAG semantic query")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--mode", default="hybrid",
                        choices=["local", "global", "hybrid", "mix", "naive", "bypass"])
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--return-entities", action="store_true")
    parser.add_argument("--return-relations", action="store_true")
    parser.add_argument("--embed-api-base", default="")
    parser.add_argument("--embed-api-key", default="")
    parser.add_argument("--embed-model", default="")
    parser.add_argument("--embed-dim", type=int, default=0,
                        help="Embedding vector dimension (0=auto-detect)")
    parser.add_argument("--llm-api-base", default="")
    parser.add_argument("--llm-api-key", default="")
    parser.add_argument("--llm-model", default="")
    parser.add_argument("--rerank-api-base", default="")
    parser.add_argument("--rerank-api-key", default="")
    parser.add_argument("--rerank-model", default="")
    args = parser.parse_args()

    result = asyncio.run(
        query_rag(
            user_id=args.user_id,
            query_text=args.query,
            mode=args.mode,
            limit=args.limit,
            return_entities=args.return_entities,
            return_relations=args.return_relations,
            embed_api_base=args.embed_api_base,
            embed_api_key=args.embed_api_key,
            embed_model=args.embed_model,
            embed_dim=args.embed_dim,
            llm_api_base=args.llm_api_base,
            llm_api_key=args.llm_api_key,
            llm_model=args.llm_model,
            rerank_api_base=args.rerank_api_base,
            rerank_api_key=args.rerank_api_key,
            rerank_model=args.rerank_model,
        )
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
