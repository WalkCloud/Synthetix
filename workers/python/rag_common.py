"""Synthetix shared RAG utilities — common functions used by all three RAG workers.

Eliminates code duplication across rag_index.py, rag_query.py, rag_manage.py.
"""
import sys
import json
import os
import glob as glob_mod


def fix_corrupted_json_files(working_dir: str) -> None:
    """Scan working directory for empty or corrupted JSON files and reset them."""
    for fp in glob_mod.glob(os.path.join(working_dir, "**", "*.json"), recursive=True):
        if os.path.getsize(fp) == 0:
            with open(fp, "w", encoding="utf-8") as f:
                f.write("{}")
            continue
        try:
            with open(fp, "r", encoding="utf-8") as f:
                json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError):
            print(f"Resetting corrupted JSON file: {fp}", file=sys.stderr)
            with open(fp, "w", encoding="utf-8") as f:
                f.write("{}")


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

    if os.getenv("LIGHTRAG_PG_DATABASE_URL"):
        kv_storage = "PGKVStorage"
        vector_storage = "PGVectorStorage"
        storage_kwargs["pg_database_url"] = os.environ["LIGHTRAG_PG_DATABASE_URL"]
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

    if os.getenv("NEO4J_URI"):
        graph_storage = "Neo4JStorage"
        storage_kwargs.update({
            k: os.environ[k]
            for k in ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD"]
            if k in os.environ
        })

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

    if os.getenv("QDRANT_URL"):
        vector_storage = "QdrantVectorDBStorage"
        storage_kwargs.update({
            k: os.environ[k]
            for k in ["QDRANT_URL", "QDRANT_API_KEY"]
            if k in os.environ
        })

    return kv_storage, vector_storage, graph_storage, doc_status_storage, storage_kwargs


def build_rerank_func(rerank_api_base: str, rerank_api_key: str, rerank_model: str):
    """Build a rerank function for LightRAG, or return None if not configured."""
    if not rerank_api_base or not rerank_model:
        return None

    import httpx

    async def rerank_func(query: str, documents: list[str], top_n: int = None, **kwargs):
        payload = {"model": rerank_model, "query": query, "documents": documents}
        if top_n:
            payload["top_n"] = top_n
        headers = {"Content-Type": "application/json"}
        if rerank_api_key:
            headers["Authorization"] = f"Bearer {rerank_api_key}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{rerank_api_base.rstrip('/')}/rerank",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
        results = data.get("results", [])
        return [{"index": r["index"], "relevance_score": r["relevance_score"]} for r in results]

    return rerank_func


def resolve_embed_dim(embed_model: str, embed_dim: int = 0) -> int:
    """Resolve embedding dimension from explicit value or model name heuristics."""
    if embed_dim and embed_dim > 0:
        return embed_dim

    model_lower = embed_model.lower()
    if any(x in model_lower for x in ("bge-m3", "bge-large", "text-embedding-3-large", "text-embedding-ada")):
        return 1536
    elif any(x in model_lower for x in ("bge", "gte", "e5")):
        return 1024
    elif "text-embedding-3-small" in model_lower:
        return 1536
    elif "text-embedding-v4" in model_lower:
        return 1024
    elif any(x in model_lower for x in ("mxbai", "nomic")):
        return 768
    else:
        return 768
