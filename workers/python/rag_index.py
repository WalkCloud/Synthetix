"""Synthetix LightRAG indexing — stores chunks into LightRAG knowledge graph.

Supports two index modes:
  - basic: chunk storage + embedding only (no entity extraction, fast)
  - graph: chunk storage + entity/relation extraction → knowledge graph (requires LLM)

Storage is determined by environment variables — defaults to local file-based storage.
For enterprise deployments, set LIGHTRAG_* env vars for pgvector/Milvus/Qdrant/Neo4j.

Usage:
  python rag_index.py --doc-id <id> --user-id <uid> --chunks-dir <dir>
         --index-mode [basic|graph]
         [--embed-api-base <url>] [--embed-api-key <key>] [--embed-model <name>]
         [--llm-api-base <url>] [--llm-api-key <key>] [--llm-model <name>]

Output: JSON to stdout
"""
import sys
import json
import os
import argparse
import asyncio

from lightrag import LightRAG
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc


def load_storage_config():
    """Build LightRAG storage configuration from environment variables.

    Default: local file-based storage (NanoVectorDB + NetworkX + JsonKVStorage).
    Enterprise: set LIGHTRAG_* env vars to switch to pgvector/Neo4j/Milvus/Qdrant.
    """
    kv_storage = os.getenv("LIGHTRAG_KV_STORAGE", "JsonKVStorage")
    vector_storage = os.getenv("LIGHTRAG_VECTOR_STORAGE", "NanoVectorDBStorage")
    graph_storage = os.getenv("LIGHTRAG_GRAPH_STORAGE", "NetworkXStorage")
    doc_status_storage = os.getenv("LIGHTRAG_DOC_STATUS_STORAGE", "JsonDocStatusStorage")

    storage_kwargs: dict = {}

    # PostgreSQL/pgvector (single backend for KV + Vector + Graph via AGE, or KV + Vector only)
    if os.getenv("LIGHTRAG_PG_DATABASE_URL"):
        pg_url = os.environ["LIGHTRAG_PG_DATABASE_URL"]
        kv_storage = "PGKVStorage"
        vector_storage = "PGVectorStorage"
        storage_kwargs["pg_database_url"] = pg_url
    elif os.getenv("POSTGRES_HOST"):
        kv_storage = "PGKVStorage"
        vector_storage = "PGVectorStorage"
        storage_kwargs.update({
            k: os.environ[k]
            for k in [
                "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER",
                "POSTGRES_PASSWORD", "POSTGRES_DATABASE",
            ]
            if k in os.environ
        })

    # Neo4j graph storage (production graph DB)
    if os.getenv("NEO4J_URI"):
        graph_storage = "Neo4JStorage"
        storage_kwargs.update({
            k: os.environ[k]
            for k in ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD"]
            if k in os.environ
        })

    # Milvus vector storage
    if os.getenv("MILVUS_URI"):
        vector_storage = "MilvusVectorDBStorage"
        storage_kwargs.update({
            k: os.environ[k]
            for k in [
                "MILVUS_URI", "MILVUS_TOKEN", "MILVUS_USER",
                "MILVUS_PASSWORD", "MILVUS_DB_NAME",
            ]
            if k in os.environ
        })

    # Qdrant vector storage
    if os.getenv("QDRANT_URL"):
        vector_storage = "QdrantVectorDBStorage"
        storage_kwargs.update({
            k: os.environ[k]
            for k in ["QDRANT_URL", "QDRANT_API_KEY"]
            if k in os.environ
        })

    return kv_storage, vector_storage, graph_storage, doc_status_storage, storage_kwargs


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
) -> dict:
    """Index chunk files into LightRAG.

    In 'basic' mode: chunk storage + embedding only (fast, no LLM needed).
    In 'graph' mode: also runs entity/relation extraction to build a knowledge graph.
    """
    working_dir = os.path.join("data", "rag", user_id)
    os.makedirs(working_dir, exist_ok=True)

    kv_storage, vector_storage, graph_storage, doc_status_storage, storage_kwargs = load_storage_config()

    def embedding_func(texts: list[str]):
        return openai_embed(
            texts,
            model=embed_model,
            base_url=embed_api_base,
            api_key=embed_api_key,
        )

    entity_stats: dict = {}

    if index_mode == "graph" and llm_api_base and llm_model:
        async def llm_func(
            prompt: str,
            system_prompt: str | None = None,
            history_messages: list = [],
            **kwargs,
        ) -> str:
            return await openai_complete_if_cache(
                model=llm_model,
                prompt=prompt,
                system_prompt=system_prompt,
                history_messages=history_messages,
                base_url=llm_api_base,
                api_key=llm_api_key,
                **kwargs,
            )
    else:
        async def llm_func(*args, **kwargs) -> str:
            return ""

    embed_dim = args.embed_dim or 768

    # Auto-detect dimension from embedding model name
    if not args.embed_dim:
        model_lower = embed_model.lower()
        if any(x in model_lower for x in ("bge-m3", "bge-large", "gte-large", "e5-large", "text-embedding-3-large", "text-embedding-ada")):
            embed_dim = 1536 if "large" in model_lower or "ada" in model_lower or "bge-m3" in model_lower else 1024
        elif "text-embedding-3-small" in model_lower:
            embed_dim = 1536
        elif any(x in model_lower for x in ("mxbai", "nomic")):
            embed_dim = 768

    rag = LightRAG(
        working_dir=working_dir,
        llm_model_func=llm_func,
        embedding_func=EmbeddingFunc(
            embedding_dim=embed_dim,
            max_token_size=8192,
            func=embedding_func,
        ),
        kv_storage=kv_storage,
        vector_storage=vector_storage,
        graph_storage=graph_storage,
        doc_status_storage=doc_status_storage,
        **storage_kwargs,
    )

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
    parser.add_argument("--embed-api-base", default="http://localhost:11434/v1")
    parser.add_argument("--embed-api-key", default="ollama")
    parser.add_argument("--embed-model", default="nomic-embed-text")
    parser.add_argument("--embed-dim", type=int, default=0,
                        help="Embedding vector dimension (0=auto-detect from model name)")
    parser.add_argument("--llm-api-base", default="")
    parser.add_argument("--llm-api-key", default="")
    parser.add_argument("--llm-model", default="")
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
        )
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
