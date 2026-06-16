"""Synthetix LightRAG semantic query — returns structured chunk results with scores.

Supports all LightRAG query modes:
  - local    : entity-level retrieval (specific facts/entities)
  - global   : theme-level retrieval (summarization, broad context)
  - hybrid   : balanced local + global (default)
  - mix      : graph + vector + optional reranker
  - naive    : pure vector similarity (no graph)
  - bypass   : LLM-only, no retrieval

Usage:
  python rag_query.py --user-id <uid> --query "<text>" --mode hybrid --limit 20
         [--return-entities] [--return-relations]
         [--embed-api-base <url>] [--embed-api-key <key>] [--embed-model <name>]
         [--llm-api-base <url>] [--llm-api-key <key>] [--llm-model <name>]

Output: JSON to stdout
"""
import sys
import json
import os
import re
import time
import argparse
import asyncio

from rag_common import fix_corrupted_json_files, load_storage_config, build_rerank_func, resolve_embed_dim

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
    """Query LightRAG and return structured results: chunks, optional entities/relations."""
    working_dir = os.path.join("data", "rag", user_id)

    if not os.path.exists(working_dir):
        print(json.dumps({"chunks": [], "mode": mode}))
        return

    # Quick health check — fail fast when data is clearly unusable
    import time as _time

    def _quick_health_check(wd: str) -> tuple:
        lock_file = os.path.join(wd, ".indexing.lock")
        if os.path.exists(lock_file):
            lock_age = _time.time() - os.path.getmtime(lock_file)
            if lock_age < 1800:
                return False, "indexing in progress"
            else:
                os.remove(lock_file)

        kv_file = os.path.join(wd, "kv_store_full_docs.json")
        if not os.path.exists(kv_file):
            return False, "no data indexed yet"
        if os.path.getsize(kv_file) == 0:
            return False, "empty index"

        return True, "ok"

    ok, reason = _quick_health_check(working_dir)
    if not ok:
        print(json.dumps({"chunks": [], "mode": mode, "warning": f"data unavailable: {reason}"}))
        return

    from lightrag import LightRAG, QueryParam
    from lightrag.llm.openai import openai_embed
    from lightrag.utils import EmbeddingFunc
    from openai import AsyncOpenAI

    kv_storage, vector_storage, graph_storage, doc_status_storage, storage_kwargs = load_storage_config()

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

    fix_corrupted_json_files(working_dir)
    import glob as _glob
    for _fp in _glob.glob(os.path.join(working_dir, "**", "*.json"), recursive=True):
        try:
            with open(_fp, "r", encoding="utf-8") as _f:
                json.load(_f)
        except (json.JSONDecodeError, UnicodeDecodeError, OSError):
            os.remove(_fp)
            
    # Also check graphml for corruption
    for _fp in _glob.glob(os.path.join(working_dir, "**", "*.graphml"), recursive=True):
        try:
            import xml.etree.ElementTree as ET
            ET.parse(_fp)
        except (ET.ParseError, UnicodeDecodeError, OSError):
            os.remove(_fp)

    try:
        import time
        max_retries = 5
        rag = None
        for attempt in range(max_retries):
            try:
                rag = LightRAG(
                    working_dir=working_dir,
                    llm_model_func=llm_func,
                    embedding_func=EmbeddingFunc(
                        embedding_dim=eff_dim,
                        max_token_size=8192,
                        func=embedding_func,
                        send_dimensions=True,
                    ),
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
                    time.sleep(1)
                    continue
                raise
    except Exception as e:
        err = str(e)
        if "Embedding dim mismatch" in err or "expected:" in err:
            print(json.dumps({
                "error": err,
                "mode": mode,
                "warning": "Embedding dimension mismatch — the stored index was created with a different embedding model. Re-index documents with the current model to resolve.",
            }))
            return
        raise

    _t_load0 = time.time()
    await rag.initialize_storages()
    print(json.dumps({"type": "timing", "stage": "load", "ms": round((time.time() - _t_load0) * 1000.0)}), file=sys.stderr, flush=True)

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
        print(json.dumps({
            "type": "timing",
            "stage": "query",
            "ms": round((time.time() - _t_q0) * 1000.0),
            "llm_calls": llm_stats["calls"],
            "llm_ms": round(llm_stats["total_ms"]),
        }), file=sys.stderr, flush=True)
        data = result.get("data", {}) if isinstance(result, dict) else {}

        chunks = data.get("chunks", [])
        entities = data.get("entities", [])
        relations = data.get("relationships", []) or data.get("relations", [])

        cosine_map: dict[str, float] = {}
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

            rank_score = build_rank_score(i, len(chunks))
            vector_score = normalize_vector_score(cosine_map.get(chunk_id))
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

        print(json.dumps(output, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "error": str(e),
            "mode": mode,
            "context": {
                "working_dir_exists": os.path.exists(working_dir),
                "has_graphml": os.path.exists(os.path.join(working_dir, "graph_chunk_entity_relation.graphml")),
                "has_kv": os.path.exists(os.path.join(working_dir, "kv_store_full_docs.json")),
                "has_vdb": os.path.exists(os.path.join(working_dir, "vdb_chunks.json")),
                "has_lock": os.path.exists(os.path.join(working_dir, ".indexing.lock")),
            },
        }))


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

    asyncio.run(
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


if __name__ == "__main__":
    main()
