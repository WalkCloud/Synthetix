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

from lightrag import LightRAG
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc
from rag_common import fix_corrupted_json_files, load_storage_config, build_rerank_func, resolve_embed_dim


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
    embed_api_base: str = "http://localhost:11434/v1",
    embed_api_key: str = "ollama",
    embed_model: str = "nomic-embed-text",
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

    kv_storage, vector_storage, graph_storage, doc_status_storage, storage_kwargs = load_storage_config()

    # Load pre-computed embeddings when available
    cached_embeddings = None
    embedding_iter = None
    if embeddings_file and os.path.exists(embeddings_file):
        cached_embeddings, probed_dim = load_cached_embeddings(embeddings_file)
        embed_dim = probed_dim
        embedding_iter = iter(cached_embeddings)
        print(f"Loaded {len(cached_embeddings)} cached embeddings dim={embed_dim} from {embeddings_file}", file=sys.stderr)

    # Auto-probe embedding dimension if not already known
    if (not embed_dim or embed_dim <= 0) and not cached_embeddings:
        try:
            probe_result = openai_embed(
                ["dimension probe"],
                model=embed_model,
                base_url=embed_api_base,
                api_key=embed_api_key,
            )
            if isinstance(probe_result, list) and len(probe_result) > 0:
                if isinstance(probe_result[0], list):
                    embed_dim = len(probe_result[0])
                elif hasattr(probe_result[0], '__len__'):
                    embed_dim = len(probe_result[0])
            print(f"Probed embedding dimension: {embed_dim}", file=sys.stderr)
        except Exception as e:
            print(f"Embedding probe failed: {e}, falling back to heuristics", file=sys.stderr)
            model_lower = embed_model.lower()
            if any(x in model_lower for x in ("bge-m3", "bge-large", "gte-large", "e5-large", "text-embedding-3-large", "text-embedding-ada")):
                embed_dim = 1536 if "bge-m3" in model_lower else 1024
            elif "text-embedding-3-small" in model_lower:
                embed_dim = 1536
            elif "text-embedding-v4" in model_lower:
                embed_dim = 1024
            elif any(x in model_lower for x in ("mxbai", "nomic")):
                embed_dim = 768
            else:
                embed_dim = 768

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
            return result
    else:

        async def embedding_func(texts: list[str], **kwargs):
            result = await openai_embed(
                texts,
                model=embed_model,
                base_url=embed_api_base,
                api_key=embed_api_key,
                **kwargs,
            )
            if isinstance(result, list) and len(result) > 0:
                return [list(v) if hasattr(v, '__iter__') and not isinstance(v, list) else v for v in result]
            return result

    entity_stats: dict = {}

    _ignored_llm_kwargs = {"hashing_kv", "openai_client_configs", "token_tracker"}

    if index_mode == "graph" and llm_api_base and llm_model:
        async def llm_func(
            prompt: str,
            system_prompt: str | None = None,
            history_messages: list | None = None,
            **kwargs,
        ) -> str:
            if history_messages is None:
                history_messages = []
            clean_kwargs = {k: v for k, v in kwargs.items() if k not in _ignored_llm_kwargs}
            try:
                return await openai_complete_if_cache(
                    model=llm_model,
                    prompt=prompt,
                    system_prompt=system_prompt,
                    history_messages=history_messages,
                    base_url=llm_api_base,
                    api_key=llm_api_key,
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
                        **clean_kwargs,
                    )
                raise
    else:
        async def llm_func(*args, **kwargs) -> str:
            return ""

    rerank_fn = build_rerank_func(rerank_api_base, rerank_api_key, rerank_model)
    rerank_kwargs = {"rerank_model_func": rerank_fn} if rerank_fn else {}

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
            "entity_types": [
                "Technology", "Framework", "Architecture", "Protocol",
                "Pattern", "Concept", "Algorithm", "Component",
                "Service", "Platform", "Module", "Interface",
                "Strategy", "Mechanism", "Pipeline", "Workflow",
            ],
        },
        **storage_kwargs,
        **rerank_kwargs,
    )

    fix_corrupted_json_files(working_dir)
    await rag.initialize_storages()

    chunk_files = sorted([f for f in os.listdir(chunks_dir) if f.startswith("chunk_")])
    if not chunk_files:
        return {"status": "skipped", "reason": "no chunks found", "doc_id": doc_id}

    indexed = 0
    for f in chunk_files:
        chunk_path = os.path.join(chunks_dir, f)
        with open(chunk_path, "r", encoding="utf-8") as fp:
            content = fp.read()
        chunk_id = f"{doc_id}/{f.replace('.md', '')}"
        await rag.ainsert(content, ids=chunk_id, file_paths=chunk_path)
        indexed += 1

    if index_mode == "graph" and llm_api_base and llm_model:
        try:
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
    parser.add_argument("--embed-api-base", default="http://localhost:11434/v1")
    parser.add_argument("--embed-api-key", default="ollama")
    parser.add_argument("--embed-model", default="nomic-embed-text")
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
