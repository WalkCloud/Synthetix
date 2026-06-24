"""Synthetix LightRAG indexing — stores chunks into LightRAG knowledge graph.

Supports two index modes:
  - basic: chunk storage + embedding only (no entity extraction, fast)
  - graph: chunk storage + entity/relation extraction → knowledge graph (requires LLM)

Storage is determined by environment variables — defaults to local file-based storage.
For enterprise deployments, set LIGHTRAG_* env vars for pgvector/Milvus/Qdrant/Neo4j.

Usage:
  python rag_index.py --doc-id <id> --user-id <uid> --chunks-dir <dir>
         --index-mode [basic|graph]
         [--embeddings-file <path>]          # pre-computed embeddings (avoids API calls)
         [--embed-api-base <url>] [--embed-api-key <key>] [--embed-model <name>]
         [--llm-api-base <url>] [--llm-api-key <key>] [--llm-model <name>]

Output: JSON to stdout
"""
import sys
import json
import os
import struct
import argparse
import asyncio
from contextlib import contextmanager

from lightrag import LightRAG
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc
from rag_common import fix_corrupted_json_files, load_storage_config, build_rerank_func, resolve_embed_dim


def emit_progress(stage: str, progress: int, message: str, **extra) -> None:
    event = {
        "type": "progress",
        "stage": stage,
        "progress": max(0, min(100, int(progress))),
        "message": message,
    }
    event.update({k: v for k, v in extra.items() if v is not None})
    print(json.dumps(event, ensure_ascii=False), file=sys.stderr, flush=True)


def emit_usage(module: str, input_tokens: int, output_tokens: int) -> None:
    """Emit a token-usage event line on stderr (parsed by Node's spawnPython).

    LightRAG's `token_tracker` interface gives us per-call counts during graph
    extraction; we forward them here so the Token Usage Analytics page can
    attribute the spend back to the LLM model. Without this hook the entire
    knowledge-graph extraction stage was invisible to billing.
    """
    if input_tokens <= 0 and output_tokens <= 0:
        return
    event = {
        "type": "usage",
        "module": module,
        "input_tokens": int(input_tokens),
        "output_tokens": int(output_tokens),
    }
    print(json.dumps(event, ensure_ascii=False), file=sys.stderr, flush=True)


class StdoutTokenTracker:
    """Implements LightRAG's token_tracker contract (`add_usage(dict)`).

    LightRAG calls `tracker.add_usage({"prompt_tokens": ..., "completion_tokens": ...})`
    after each LLM round-trip; we re-emit those numbers as stderr `usage` events
    so the Node side can record them via `recordTokenUsage`.
    """

    def __init__(self, module: str) -> None:
        self._module = module

    def add_usage(self, counts: dict) -> None:
        try:
            prompt = int(counts.get("prompt_tokens", 0) or 0)
            completion = int(counts.get("completion_tokens", 0) or 0)
        except (TypeError, ValueError):
            return
        emit_usage(self._module, prompt, completion)


def get_insert_batch_size(index_mode: str, env: dict | None = None) -> int:
    source = env if env is not None else os.environ
    if index_mode == "graph":
        return int(source.get("LIGHTRAG_GRAPH_INSERT_BATCH_SIZE", source.get("LIGHTRAG_INSERT_BATCH_SIZE", "5")))
    return int(source.get("LIGHTRAG_INSERT_BATCH_SIZE", "20"))


def sort_chunk_files(files: list[str]) -> list[str]:
    def chunk_index(name: str) -> int:
        stem = os.path.splitext(name)[0]
        try:
            return int(stem.rsplit("_", 1)[1])
        except (IndexError, ValueError):
            return sys.maxsize

    chunk_files = [f for f in files if f.startswith("chunk_") and f.endswith(".md")]
    return sorted(chunk_files, key=lambda f: (chunk_index(f), f))


@contextmanager
def indexing_lock(working_dir: str, doc_id: str):
    """Create the lock that rag_query.py already treats as indexing-in-progress."""
    lock_path = os.path.join(working_dir, ".indexing.lock")
    with open(lock_path, "w", encoding="utf-8") as fp:
        fp.write(doc_id)
    try:
        yield lock_path
    finally:
        if os.path.exists(lock_path):
            os.remove(lock_path)


async def insert_chunks(rag, chunk_records: list[dict], batch_size: int = 20, force_serial: bool = False, on_progress=None) -> int:
    """Insert chunks with bounded bulk calls, falling back only for unsupported APIs.

    When force_serial is True (graph mode), always use serial inserts so
    LightRAG's entity/relation extraction processes each chunk individually.
    """
    if force_serial:
        indexed = 0
        for item in chunk_records:
            await rag.ainsert(item["content"], ids=item["id"], file_paths=item["path"])
            indexed += 1
            if on_progress:
                on_progress(indexed, len(chunk_records))
        return indexed

    indexed = 0
    for i in range(0, len(chunk_records), batch_size):
        batch = chunk_records[i:i + batch_size]
        contents = [item["content"] for item in batch]
        ids = [item["id"] for item in batch]
        paths = [item["path"] for item in batch]
        try:
            await rag.ainsert(contents, ids=ids, file_paths=paths)
            indexed += len(batch)
            if on_progress:
                on_progress(indexed, len(chunk_records))
        except TypeError:
            for item in batch:
                await rag.ainsert(item["content"], ids=item["id"], file_paths=item["path"])
                indexed += 1
                if on_progress:
                    on_progress(indexed, len(chunk_records))
    return indexed


def load_cached_embeddings(file_path: str):
    """Load pre-computed embeddings from a binary file.

    File format:
      [num_embeddings: int32 LE][embed_dim: int32 LE][flat float32 LE array]

    Returns (embeddings: list[list[float]], embed_dim: int).
    """
    with open(file_path, "rb") as f:
        num = struct.unpack("<i", f.read(4))[0]
        dim = struct.unpack("<i", f.read(4))[0]
        data = f.read()
    floats = struct.unpack(f"<{num * dim}f", data)
    embeddings = []
    for i in range(num):
        embeddings.append(list(floats[i * dim : (i + 1) * dim]))
    return embeddings, dim


async def index_document(
    doc_id: str,
    user_id: str,
    chunks_dir: str,
    index_mode: str = "basic",
    embed_api_base: str = "",
    embed_api_key: str = "",
    embed_model: str = "",
    embed_dim: int = 0,
    llm_api_base: str = "",
    llm_api_key: str = "",
    llm_model: str = "",
    embeddings_file: str = "",
    rerank_api_base: str = "",
    rerank_api_key: str = "",
    rerank_model: str = "",
) -> dict:
    """Index chunk files into LightRAG.

    In 'basic' mode: chunk storage + embedding only (fast, no LLM needed).
    In 'graph' mode: also runs entity/relation extraction to build a knowledge graph.

    When embeddings_file is provided, cached embeddings are used and no
    embedding API calls are made.
    """
    working_dir = os.path.join("data", "rag", user_id)
    os.makedirs(working_dir, exist_ok=True)
    emit_progress("initializing", 10, "Preparing graph workspace" if index_mode == "graph" else "Preparing RAG workspace")

    kv_storage, vector_storage, graph_storage, doc_status_storage, storage_kwargs = load_storage_config()

    # Load pre-computed embeddings when available
    cached_embeddings = None
    embedding_iter = None
    if embeddings_file and os.path.exists(embeddings_file):
        cached_embeddings, probed_dim = load_cached_embeddings(embeddings_file)
        embed_dim = embed_dim if embed_dim > 0 else probed_dim
        embedding_iter = iter(cached_embeddings)
        print(f"Loaded {len(cached_embeddings)} cached embeddings dim={embed_dim} from {embeddings_file}", file=sys.stderr)
        emit_progress("loading", 20, "Loaded cached embeddings", total=len(cached_embeddings))

    # Auto-probe embedding dimension if not already known
    if not embed_dim or embed_dim <= 0:
        raise ValueError(
            "Cannot determine embedding dimension. "
            "Ensure --embed-dim is provided or an embeddings.bin cache file exists."
        )

    # embedding_func: use cached embeddings when available, otherwise call API
    if embedding_iter is not None:

        async def embedding_func(texts: list[str], **kwargs):
            result = []
            for _ in texts:
                emb = next(embedding_iter, None)
                if emb is not None:
                    result.append(emb)
                else:
                    result.append([0.0] * embed_dim)
            import numpy as np
            return np.array(result, dtype=np.float32)
    else:

        async def embedding_func(texts: list[str], **kwargs):
            # IMPORTANT: openai_embed is decorated with @wrap_embedding_func_with_attrs
            # which has hardcoded embedding_dim=1536. Calling it directly causes our
            # outer EmbeddingFunc(embedding_dim=embed_dim) to clash with that 1536
            # default — LightRAG ends up validating result vectors against 1536 even
            # though the model returns 2048 (text-embedding-v4) or 2560 (qwen3-vl).
            # We must invoke the unwrapped function via `.func` to bypass the inner
            # decorator. See lightrag/utils.py:1115 docstring on double decoration.
            unwrapped = getattr(openai_embed, "func", openai_embed)
            result = await unwrapped(
                texts,
                model=embed_model,
                base_url=embed_api_base,
                api_key=embed_api_key,
                **kwargs,
            )
            import numpy as np
            if isinstance(result, list) and len(result) > 0:
                return np.array([list(v) if hasattr(v, '__iter__') and not isinstance(v, list) else v for v in result], dtype=np.float32)
            return result

    entity_stats: dict = {}

    # `hashing_kv` and `openai_client_configs` are LightRAG internals we don't
    # forward. `token_tracker` is dropped from inbound kwargs because we always
    # inject our own StdoutTokenTracker below — see Fix C in
    # docs/codebase-optimization-roadmap-2026-06-02.md for context.
    _ignored_llm_kwargs = {"hashing_kv", "openai_client_configs", "token_tracker"}
    graph_token_tracker = StdoutTokenTracker(module="graph")

    if index_mode == "graph" and llm_api_base and llm_model:
        import asyncio
        llm_sem = asyncio.Semaphore(2)
        async def llm_func(
            prompt: str,
            system_prompt: str | None = None,
            history_messages: list | None = None,
            **kwargs,
        ) -> str:
            async with llm_sem:
                if history_messages is None:
                    history_messages = []
                # Output language is now controlled via addon_params["language"]
                # (set above to follow the source text), so we do NOT re-inject a
                # competing language instruction here — that would duplicate and
                # potentially contradict the prompt template's own {language} slot.
                # We keep only the description-quality constraint, which the prompt
                # template does not cover.
                quality_instruction = "\n\nIMPORTANT: Entity and relationship descriptions MUST be concise summaries (1-2 sentences). DO NOT output step-by-step processes, raw chunk text, or 'phase1 phase2' style content."
                if system_prompt:
                    system_prompt += quality_instruction
                else:
                    prompt += quality_instruction
                clean_kwargs = {k: v for k, v in kwargs.items() if k not in _ignored_llm_kwargs}
                try:
                    return await openai_complete_if_cache(
                        model=llm_model,
                        prompt=prompt,
                        system_prompt=system_prompt,
                        history_messages=history_messages,
                        base_url=llm_api_base,
                        api_key=llm_api_key,
                        token_tracker=graph_token_tracker,
                        **clean_kwargs,
                    )
                except Exception as e:
                    err_msg = str(e).lower()
                    if "response_format" in err_msg or "invalid_request" in err_msg:
                        for bad_key in ("response_format", "keyword_extraction"):
                            clean_kwargs.pop(bad_key, None)
                        return await openai_complete_if_cache(
                            model=llm_model,
                            prompt=prompt,
                            system_prompt=system_prompt,
                            history_messages=history_messages,
                            base_url=llm_api_base,
                            api_key=llm_api_key,
                            token_tracker=graph_token_tracker,
                            **clean_kwargs,
                        )
                    raise
    else:
        async def llm_func(*args, **kwargs) -> str:
            return ""

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
                        embedding_dim=embed_dim,
                        max_token_size=8192,
                        func=embedding_func,
                        send_dimensions=True,
                    ),
                    kv_storage=kv_storage,
                    vector_storage=vector_storage,
                    graph_storage=graph_storage,
                    doc_status_storage=doc_status_storage,
                    addon_params={
                        # IMPORTANT: entity type strings MUST NOT contain "/", "\",
                        # or any of ["'", "(", ")", "<", ">", "|"] — LightRAG's
                        # _handle_single_entity_extraction rejects any extracted
                        # entity whose type contains these chars (drops it silently).
                        # The previous "Technology/技术" bilingual form caused EVERY
                        # entity to be discarded as "invalid entity type", losing
                        # precision while still paying the LLM cost. Use plain
                        # English type names; the extraction prompt instructs the
                        # model to emit entity *names/descriptions* in the source
                        # language, so bilingual coverage is preserved at the value
                        # level without breaking type validation.
                        "entity_types": [
                            "Technology", "Framework", "Architecture", "Protocol",
                            "Pattern", "Concept", "Algorithm", "Component",
                            "Service", "Platform", "Module", "Interface",
                            "Strategy", "Mechanism", "Pipeline", "Workflow",
                            "Organization", "Person", "Location", "Document",
                        ],
                        # Output language: follow the SOURCE text language instead of
                        # forcing English. Forcing English on a Chinese document both
                        # degrades precision (entity names get lossy-translated, so
                        # later Chinese queries fail to recall them) and slows the
                        # model (extra translation reasoning per entity). Setting this
                        # to an instruction string (rather than a fixed language name)
                        # makes LightRAG's "{language}" prompt slot read naturally:
                        # "...output must be written in `the same language as the
                        # input text`". This is a plain string substitution, so any
                        # phrasing works; proper nouns are still kept in their
                        # original form per the prompt's own rule.
                        "language": "the same language as the input text",
                    },
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
            import shutil
            shutil.rmtree(working_dir, ignore_errors=True)
            os.makedirs(working_dir, exist_ok=True)
            return {
                "error": err,
                "status": "failed",
                "message": "Embedding dimension mismatch — index automatically reset. Please retry the upload."
            }
        raise

    with indexing_lock(working_dir, doc_id):
        await rag.initialize_storages()
        emit_progress("storage", 25, "Initialized graph storage")

        if index_mode == "graph":
            from lightrag.base import DocStatus
            # Clean ALL existing chunks for this document before graph extraction.
            # The rag_embed_index worker runs a basic pass first (chunks stored,
            # marked PROCESSED, but NO entities extracted). Graph mode MUST remove
            # those chunks so LightRAG re-inserts them WITH entity extraction —
            # otherwise ainsert() sees them as "already in storage" and skips,
            # yielding zero entities.
            #
            # The cascade-rebuild cost of adelete_by_doc_id only bites when
            # entities/relations already exist (re-indexing a previously-graphed
            # doc). On the normal basic→graph path there are no entities yet, so
            # deletion is cheap. To keep re-index affordable, we delete in a
            # single batch loop rather than interleaving delete+insert.
            print(f"Cleaning existing RAG chunks for document {doc_id} to enable graph extraction...", file=sys.stderr)
            emit_progress("cleanup", 28, "Cleaning previous document index")
            try:
                all_docs = await rag.doc_status.get_docs_by_statuses(list(DocStatus))
                to_delete = [k for k in all_docs.keys() if k == doc_id or k.startswith(doc_id + "/")]
                if to_delete:
                    for chunk_id in to_delete:
                        await rag.adelete_by_doc_id(chunk_id)
                    print(f"Cleaned {len(to_delete)} existing chunks for graph re-extraction.", file=sys.stderr)
                    emit_progress("cleanup", 32, "Cleaned previous document index", total=len(to_delete))
                else:
                    print("No existing chunks to clean (fresh document).", file=sys.stderr)
            except Exception as cleanup_err:
                print(f"Warning during pre-indexing cleanup: {cleanup_err}", file=sys.stderr)

        chunk_files = sort_chunk_files(os.listdir(chunks_dir))
        if not chunk_files:
            return {"status": "skipped", "reason": "no chunks found", "doc_id": doc_id}
        emit_progress("loading_chunks", 35, "Loaded document chunks", total=len(chunk_files))

        chunk_records = []
        for f in chunk_files:
            chunk_path = os.path.join(chunks_dir, f)
            with open(chunk_path, "r", encoding="utf-8") as fp:
                content = fp.read()
            chunk_records.append({
                "content": content,
                "id": f"{doc_id}/{f.replace('.md', '')}",
                "path": chunk_path,
            })

        batch_size = get_insert_batch_size(index_mode)
        emit_progress("indexing", 40, "Extracting entities and relationships" if index_mode == "graph" else "Indexing chunks", processed=0, total=len(chunk_records))
        def _report_index_progress(done, total):
            progress = 40 + int((done / max(total, 1)) * 50)
            emit_progress("indexing", progress, "Extracting entities and relationships" if index_mode == "graph" else "Indexing chunks", processed=done, total=total)

        indexed = await insert_chunks(rag, chunk_records, batch_size=batch_size, force_serial=(index_mode == "graph"), on_progress=_report_index_progress)
        emit_progress("indexing", 90, "Finished chunk indexing", processed=indexed, total=len(chunk_records))

    if index_mode == "graph" and llm_api_base and llm_model:
        try:
            emit_progress("finalizing", 94, "Collecting graph labels")
            labels = await rag.get_graph_labels()
            entity_stats = {
                "graph_entities": len(labels),
                "index_mode": "graph",
            }
        except Exception:
            entity_stats = {
                "graph_entities": 0,
                "index_mode": "graph",
                "graph_note": "graph labels unavailable (storage backend may not support it)",
            }
    else:
        entity_stats = {"index_mode": "basic"}

    return {
        "status": "indexed",
        "doc_id": doc_id,
        "chunks": indexed,
        "storage": {
            "kv": kv_storage,
            "vector": vector_storage,
            "graph": graph_storage,
        },
        **entity_stats,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="LightRAG document indexer")
    parser.add_argument("--doc-id", required=True)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--chunks-dir", required=True)
    parser.add_argument("--index-mode", choices=["basic", "graph"], default="basic")
    parser.add_argument("--embeddings-file", default="",
                        help="Path to pre-computed embeddings binary file (skips embedding API)")
    parser.add_argument("--embed-api-base", default="")
    parser.add_argument("--embed-api-key", default="")
    parser.add_argument("--embed-model", default="")
    parser.add_argument("--embed-dim", type=int, default=0,
                        help="Embedding vector dimension (0=auto-detect from model name)")
    parser.add_argument("--llm-api-base", default="")
    parser.add_argument("--llm-api-key", default="")
    parser.add_argument("--llm-model", default="")
    parser.add_argument("--rerank-api-base", default="")
    parser.add_argument("--rerank-api-key", default="")
    parser.add_argument("--rerank-model", default="")
    args = parser.parse_args()

    result = asyncio.run(
        index_document(
            doc_id=args.doc_id,
            user_id=args.user_id,
            chunks_dir=args.chunks_dir,
            index_mode=args.index_mode,
            embed_api_base=args.embed_api_base,
            embed_api_key=args.embed_api_key,
            embed_model=args.embed_model,
            embed_dim=args.embed_dim,
            llm_api_base=args.llm_api_base,
            llm_api_key=args.llm_api_key,
            llm_model=args.llm_model,
            embeddings_file=args.embeddings_file,
            rerank_api_base=args.rerank_api_base,
            rerank_api_key=args.rerank_api_key,
            rerank_model=args.rerank_model,
        )
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
