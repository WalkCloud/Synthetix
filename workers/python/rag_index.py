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
from contextlib import contextmanager, suppress
from typing import Optional

# Patch atomic_write BEFORE importing LightRAG storage classes so the retry
# logic covers the high-frequency graphml flushes during entity extraction.
from win_atomic_patch import apply_patch
apply_patch()

from lightrag import LightRAG
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc
from rag_common import fix_corrupted_json_files, load_storage_config, build_rerank_func, resolve_embed_dim
from adaptive_limiter import wrap_llm_func


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


async def _heartbeat_loop(
    progress_state: dict,
    interval_s: float,
    message: str,
    emit=emit_progress,
    sleep=None,
) -> None:
    """Emit a progress event every `interval_s` seconds, reading the latest
    done/total from `progress_state` (a shared dict). Guarantees lastHeartbeatAt
    stays fresh during slow LLM extraction — a single hung provider call would
    otherwise freeze progress for 15+ min, tripping the Node-side heartbeat-stall
    detector (queue.ts, 5 min threshold).

    Designed to run as an asyncio.Task alongside insert_chunks; the caller
    cancels it when insertion completes. `emit` and `sleep` are injectable for
    testing (sleep defaults to asyncio.sleep).
    """
    _sleep = sleep if sleep is not None else asyncio.sleep
    while True:
        await _sleep(interval_s)
        done = progress_state.get("done", 0)
        total = progress_state.get("total", 0)
        progress = 40 + int((done / max(total, 1)) * 50)
        emit("indexing", progress, message, processed=done, total=total)


def get_insert_batch_size(index_mode: str, env: dict | None = None) -> int:
    source = env if env is not None else os.environ
    if index_mode == "graph":
        return int(source.get("LIGHTRAG_GRAPH_INSERT_BATCH_SIZE", source.get("LIGHTRAG_INSERT_BATCH_SIZE", "5")))
    return int(source.get("LIGHTRAG_INSERT_BATCH_SIZE", "20"))


def should_bulk_insert_graph(env: dict | None = None) -> bool:
    """Whether graph mode submits chunks to LightRAG in batches (parallel entity
    extraction across chunks) or one at a time (serial).

    DEFAULT IS NOW TRUE. The serial path was a conservative default left over
    from early LightRAG versions where bulk ainsert would skip entity/relation
    extraction. On lightrag-hku>=1.5.4 (our pinned version, requirements.txt),
    `rag.ainsert(list_of_strings, ids=list, file_paths=list)` extracts entities
    for ALL chunks in the batch and runs them through the entity/relation merge
    phase together — and LightRAG's internal llm_model_max_async (auto-aligned
    to LLM_LIMITER_MAX_REQUESTS_GRAPH, default 8) parallelizes the per-chunk
    extraction LLM calls within the batch.

    The serial default under-used the provider: with MAX_ASYNC_LLM=8 and an
    adaptive limiter that allows 8-way concurrency, the serial ainsert loop
    still only fed chunks to LightRAG one at a time, so the chunk-to-chunk
    critical path was fully sequential even though the LLM provider had
    headroom for 8 concurrent extractions. Bulk mode lets LightRAG schedule
    extractions across the whole batch in parallel.

    Set LIGHTRAG_GRAPH_BULK_INSERT=false to opt back out if a LightRAG upgrade
    regresses bulk-extraction quality.
    """
    source = env if env is not None else os.environ
    return str(source.get("LIGHTRAG_GRAPH_BULK_INSERT", "true")).lower() in {"1", "true", "yes", "on"}


def _read_positive_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


def _get_llm_max_async() -> int:
    """LightRAG's internal LLM concurrency for entity/relation extraction.

    AUTO-ALIGNED to the adaptive limiter's hard cap
    (LLM_LIMITER_MAX_REQUESTS_GRAPH, default 8) so the limiter is always the
    binding bottleneck: LightRAG opens `cap` internal slots, the limiter then
    dynamically admits 1..cap based on the AIMD-learned budget. This eliminates
    the two-layer mismatch where LightRAG's static value could be tighter (and
    starve the limiter) or looser (and pile up coroutines waiting in acquire).

    MAX_ASYNC_LLM is kept as a deprecated escape hatch for backward compat — if
    set, it still wins, but prefer setting LLM_LIMITER_MAX_REQUESTS_GRAPH so
    both layers stay aligned. LightRAG's upstream default of 4 made graph builds
    2× slower than necessary and is never used here.
    """
    cap = _read_positive_int("LLM_LIMITER_MAX_REQUESTS_GRAPH", 8)
    legacy = os.environ.get("MAX_ASYNC_LLM")
    if legacy:
        try:
            legacy_val = int(legacy)
            if legacy_val > 0:
                return legacy_val
        except (TypeError, ValueError):
            pass
    return cap


def _llm_error_message(error: Exception) -> str:
    return f"{type(error).__name__}: {error}".lower()


def _is_transient_llm_connection_error(error: Exception) -> bool:
    msg = _llm_error_message(error)
    markers = (
        "apiconnectionerror",
        "connection error",
        "connecterror",
        "connect error",
        "getaddrinfo failed",
        "name resolution",
        "temporary failure in name resolution",
        "timeout",
        "timed out",
        "etimedout",
        "econnreset",
        "connection reset",
        "connection refused",
        "remote protocol error",
    )
    return any(marker in msg for marker in markers)


def _graph_llm_retry_delay_ms(base_ms: int, attempt: int) -> int:
    factors = (1, 2.5, 5)
    if attempt <= len(factors):
        return int(base_ms * factors[attempt - 1])
    return int(base_ms * factors[-1] * (2 ** (attempt - len(factors))))


async def _call_graph_llm_with_connection_retry(call, sleep_fn=asyncio.sleep) -> str:
    retries = _read_positive_int("GRAPH_LLM_CONNECTION_RETRIES", 3)
    base_ms = _read_positive_int("GRAPH_LLM_CONNECTION_BACKOFF_MS", 2000)
    for attempt in range(retries + 1):
        try:
            return await call()
        except Exception as error:
            if attempt >= retries or not _is_transient_llm_connection_error(error):
                raise
            delay_ms = _graph_llm_retry_delay_ms(base_ms, attempt + 1)
            print(
                f"WARNING: Graph LLM connection error, retrying in {delay_ms / 1000:.1f}s "
                f"(attempt {attempt + 1}/{retries}): {error}",
                file=sys.stderr,
                flush=True,
            )
            await sleep_fn(delay_ms / 1000)
    raise RuntimeError("Graph LLM connection retry exhausted")


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

    When force_serial is True, inserts one chunk at a time. Otherwise (the
    default for BOTH basic AND graph modes now), submits chunks in batches of
    `batch_size` to `rag.ainsert(contents_list, ids=list, file_paths=list)`,
    letting LightRAG parallelize entity/relation extraction across the batch.
    On TypeError (older LightRAG without list-ainsert support) the batch is
    re-tried serially so the insert still completes.
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
            # Older LightRAG versions don't accept a list of strings as the
            # first arg — fall back to serial within this batch.
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
        # The raw LLM call (no concurrency control here — that's delegated to
        # the adaptive limiter via wrap_llm_func below). Concurrency is now
        # self-tuning: the limiter slow-starts to probe the provider's true
        # capacity and paces every extraction round-trip against it, replacing
        # the old hardcoded Semaphore(2). See adaptive_limiter.py + the design
        # doc docs/llm-concurrency-adaptive-limiter-2026-06-26.md.
        async def raw_llm_func(
            prompt: str,
            system_prompt: str | None = None,
            history_messages: list | None = None,
            **kwargs,
        ) -> str:
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

            async def call_openai():
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

            try:
                return await _call_graph_llm_with_connection_retry(call_openai)
            except Exception as e:
                err_msg = str(e).lower()
                if "response_format" in err_msg or "invalid_request" in err_msg:
                    for bad_key in ("response_format", "keyword_extraction"):
                        clean_kwargs.pop(bad_key, None)
                    return await _call_graph_llm_with_connection_retry(call_openai)
                raise

        # Per-provider limiter key. Must match the Node-side key format
        # (openai_compatible:<normalized_url>) so both processes share a single
        # AIMD budget record in provider-capacity.json. Without this alignment,
        # graph extraction and interactive requests (brainstorm/wiki/chat) each
        # probe the provider independently and double-count load, causing 429s
        # and unresponsiveness during indexing.
        from rag_common import normalize_api_base
        provider_key = f"openai_compatible:{normalize_api_base(llm_api_base)}"
        llm_func = wrap_llm_func(raw_llm_func, provider_key)
    else:
        async def llm_func(*args, **kwargs) -> str:
            return ""

    rerank_fn = build_rerank_func(rerank_api_base, rerank_api_key, rerank_model)
    rerank_kwargs = {"rerank_model_func": rerank_fn} if rerank_fn else {}

    # NOTE: fix_corrupted_json_files + integrity scan moved INSIDE
    # indexing_lock below. Running it unlocked here races the read side
    # (rag_query.py) which may be loading the same files — the scan mutates
    # the filesystem (deletes/resets corrupt files) and can truncate a file
    # the writer is about to use, or one the reader is loading. Inside the
    # lock, the read side never repairs (it reuses a cached snapshot), so
    # the two sides no longer contend on file repair.

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
                    # LightRAG defaults llm_model_max_async to 4, which caps the
                    # chunk-level entity-extraction concurrency AND the entity/
                    # relation merge phase (which uses 2× this value). We feed
                    # LLM_LIMITER_MAX_REQUESTS_GRAPH (default 8) so the adaptive
                    # limiter is always the binding bottleneck — LightRAG opens
                    # `cap` internal slots and the limiter dynamically admits
                    # 1..cap based on the AIMD-learned provider budget. This
                    # replaces the old two-layer mismatch (static LightRAG value
                    # vs dynamic limiter value). See _get_llm_max_async + the
                    # design doc docs/llm-concurrency-adaptive-limiter-2026-06-26.md.
                    llm_model_max_async=_get_llm_max_async(),
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
        # File integrity repair — runs INSIDE the lock so it never races
        # the read side. The read side (rag_query.py) no longer repairs
        # files; it reuses a cached snapshot during indexing and only
        # rebuilds (loading, not repairing) after the lock is released.
        fix_corrupted_json_files(working_dir)
        import glob as _glob
        for _fp in _glob.glob(os.path.join(working_dir, "**", "*.json"), recursive=True):
            try:
                with open(_fp, "r", encoding="utf-8") as _f:
                    json.load(_f)
            except (json.JSONDecodeError, UnicodeDecodeError, OSError):
                os.remove(_fp)
        for _fp in _glob.glob(os.path.join(working_dir, "**", "*.graphml"), recursive=True):
            try:
                import xml.etree.ElementTree as ET
                ET.parse(_fp)
            except (ET.ParseError, UnicodeDecodeError, OSError):
                os.remove(_fp)

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
            # BATCH DELETE: instead of calling adelete_by_doc_id() per chunk
            # (which reads/writes all JSON storage files N times = O(N) disk
            # I/O), we directly access the storage backends and delete all
            # chunk IDs in a single batch per storage. This reduces 597×
            # serial JSON read-modify-write cycles to ~5 batch operations.
            print(f"Cleaning existing RAG chunks for document {doc_id} to enable graph extraction...", file=sys.stderr)
            emit_progress("cleanup", 28, "Cleaning previous document index")
            try:
                all_docs = await rag.doc_status.get_docs_by_statuses(list(DocStatus))
                to_delete = [k for k in all_docs.keys() if k == doc_id or k.startswith(doc_id + "/")]
                if to_delete:
                    print(f"Batch-deleting {len(to_delete)} chunks for graph re-extraction...", file=sys.stderr)

                    # 1. Batch delete from doc_status (JsonKVStorage.delete takes a list)
                    await rag.doc_status.delete(to_delete)
                    emit_progress("cleanup", 29, f"Cleaned doc_status ({len(to_delete)} entries)")

                    # 2. Batch delete from full_docs
                    await rag.full_docs.delete(to_delete)
                    emit_progress("cleanup", 30, f"Cleaned full_docs ({len(to_delete)} entries)")

                    # 3. Batch delete from text_chunks
                    await rag.text_chunks.delete(to_delete)
                    emit_progress("cleanup", 31, f"Cleaned text_chunks ({len(to_delete)} entries)")

                    # 4. Batch delete chunk vectors from chunks_vdb
                    await rag.chunks_vdb.delete(to_delete)
                    emit_progress("cleanup", 32, f"Cleaned chunk vectors ({len(to_delete)} entries)")

                    # 5. Remove entities/relations sourced from these chunks.
                    # On the basic→graph path, entities don't exist yet (basic
                    # mode skips extraction), so this is typically a no-op.
                    # On a re-index (graph→graph), entities exist and must be
                    # cleaned. We use adelete_by_doc_id on the DOC-LEVEL id
                    # (not chunk-level) — LightRAG's doc-level delete handles
                    # entity/relation cleanup internally via full_entities/
                    # full_relations indexes. This is ONE call, not N.
                    try:
                        await rag.adelete_by_doc_id(doc_id)
                    except Exception:
                        # If doc-level delete fails (e.g. entities already
                        # gone from basic mode), it's non-fatal — graph
                        # extraction will proceed on clean chunk storage.
                        pass

                    print(f"Batch cleanup complete: {len(to_delete)} chunks removed.", file=sys.stderr)
                    emit_progress("cleanup", 33, f"Cleaned previous document index ({len(to_delete)} chunks)")
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
        indexing_message = "Extracting entities and relationships" if index_mode == "graph" else "Indexing chunks"
        emit_progress("indexing", 40, indexing_message, processed=0, total=len(chunk_records))

        # Shared progress state read by BOTH the batch-completion callback and
        # the time-driven heartbeat task below. The batch callback updates it
        # when a batch finishes; the heartbeat reads it to emit a fresh
        # lastHeartbeatAt even while a single slow LLM call is in flight (which
        # otherwise freezes progress for minutes → triggers the Node-side
        # heartbeat-stall detector in queue.ts).
        progress_state = {"done": 0, "total": len(chunk_records)}

        def _report_index_progress(done, total):
            progress_state["done"] = done
            progress_state["total"] = total
            progress = 40 + int((done / max(total, 1)) * 50)
            emit_progress("indexing", progress, indexing_message, processed=done, total=total)

        # Time-driven heartbeat: emit a progress event every N seconds even if
        # no batch has completed. This guarantees lastHeartbeatAt stays fresh
        # during slow LLM extraction (a single hung provider call used to freeze
        # the heartbeat for 15+ min, well past the 5-min stall threshold). The
        # task self-cancels when insert_chunks returns.
        heartbeat_interval_s = _read_positive_int("GRAPH_HEARTBEAT_INTERVAL_S", 15)
        heartbeat_task: Optional[asyncio.Task] = None
        if heartbeat_interval_s > 0:
            heartbeat_task = asyncio.create_task(
                _heartbeat_loop(progress_state, heartbeat_interval_s, indexing_message)
            )

        try:
            force_serial = index_mode == "graph" and not should_bulk_insert_graph()
            indexed = await insert_chunks(rag, chunk_records, batch_size=batch_size, force_serial=force_serial, on_progress=_report_index_progress)
        finally:
            if heartbeat_task is not None:
                heartbeat_task.cancel()
                with suppress(asyncio.CancelledError):
                    await heartbeat_task
        emit_progress("indexing", 90, "Finished chunk indexing", processed=indexed, total=len(chunk_records))

    # The indexing_lock has been released (the `with` block just exited).
    # Invalidate the read-side cache so the next query rebuilds with the
    # freshly-written data. During indexing, queries reused the old cached
    # snapshot (fast, no rebuild); now that the write is committed, we want
    # subsequent queries to see the new entities/relations.
    #
    # Best-effort: in the daemon process this drops the resident LightRAG
    # instance so the next query reloads. In a spawn (one-shot) process
    # there is no shared cache to invalidate — the call is a harmless no-op.
    try:
        import rag_query
        rag_query._invalidate_rag_cache(working_dir)
    except Exception:
        pass

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
    parser.add_argument("--embed-api-key", default=os.environ.get("RAG_EMBED_API_KEY", ""),
                        help="Embedding API key (prefer RAG_EMBED_API_KEY env var)")
    parser.add_argument("--embed-model", default="")
    parser.add_argument("--embed-dim", type=int, default=0,
                        help="Embedding vector dimension (0=auto-detect from model name)")
    parser.add_argument("--llm-api-base", default="")
    parser.add_argument("--llm-api-key", default=os.environ.get("RAG_LLM_API_KEY", ""),
                        help="LLM API key (prefer RAG_LLM_API_KEY env var)")
    parser.add_argument("--llm-model", default="")
    parser.add_argument("--rerank-api-base", default="")
    parser.add_argument("--rerank-api-key", default=os.environ.get("RAG_RERANK_API_KEY", ""),
                        help="Rerank API key (prefer RAG_RERANK_API_KEY env var)")
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
