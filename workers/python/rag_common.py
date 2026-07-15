"""Synthetix shared RAG utilities — common functions used by all three RAG workers.

Eliminates code duplication across rag_index.py, rag_query.py, rag_manage.py.
"""
import sys
import json
import os
import re
import glob as glob_mod


def normalize_api_base(url: str) -> str:
    """Normalize an API base URL to match Node's ``normalizeProviderBaseUrl``.

    The adaptive limiter persists per-provider capacity keyed by
    ``f"{provider_type}:{normalized_url}"``. Node (src/lib/llm/provider-endpoints.ts)
    strips trailing slashes, version segments (/v1, /v2), and endpoint suffixes
    (/embeddings, /chat/completions) before constructing the key. Python must
    produce the SAME key for the two processes to share a single budget record;
    otherwise they maintain independent AIMD budgets for the same provider and
    double-count load against the shared API quota.
    """
    url = re.sub(r"/+$", "", url)                                   # strip trailing slash(es)
    url = re.sub(r"/embeddings(/\w+)?$", "", url)                   # strip /embeddings or /embeddings/<dim>
    url = re.sub(r"/chat/completions$", "", url)                    # strip /chat/completions
    url = re.sub(r"/v\d+/(chat/completions|embeddings)(/\w+)?$", "", url)  # strip /vN/<endpoint>
    url = re.sub(r"/v\d+$", "", url)                                # strip trailing /vN
    return url

# ── JSON safety ──────────────────────────────────────────────────────────────

DEFAULT_STRUCTURES: dict[str, dict] = {
    # LightRAG KV storage files — empty structures that won't crash LightRAG on load
    "kv_store_full_docs.json": {},
    "kv_store_doc_status.json": {},
    "kv_store_text_chunks.json": {},
    "kv_store_full_entities.json": {},
    "kv_store_full_relations.json": {},
    "kv_store_entity_chunks.json": {},
    "kv_store_relation_chunks.json": {},
    "kv_store_llm_response_cache.json": {},
}


def safe_json_dump(filepath: str, data: object) -> None:
    """Atomically write JSON via tmp + rename to prevent partial-write corruption."""
    tmp = filepath + ".tmp." + os.urandom(4).hex()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, filepath)


def validate_json_structure(filepath: str, required_top_keys: list[str]) -> None:
    """Verify JSON file has expected top-level keys before LightRAG loads it."""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(
            f"{filepath}: expected dict, got {type(data).__name__}"
        )
    missing = [k for k in required_top_keys if k not in data]
    if missing:
        raise ValueError(
            f"{filepath}: missing required keys {missing}"
        )


def fix_corrupted_json_files(working_dir: str) -> None:
    """Scan working directory for empty or corrupted JSON files and reset them
    to the correct empty structure for each file type."""
    # Clean orphaned .tmp files left by failed atomic writes (Windows file locks)
    for fp in glob_mod.glob(os.path.join(working_dir, "**", "*.tmp.*"), recursive=True):
        try:
            os.remove(fp)
        except OSError:
            pass

    for fp in glob_mod.glob(os.path.join(working_dir, "**", "*.json"), recursive=True):
        if os.path.getsize(fp) == 0:
            _reset_json(fp)
            continue
        try:
            with open(fp, "r", encoding="utf-8") as f:
                json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError):
            print(f"Resetting corrupted JSON file: {fp}", file=sys.stderr)
            _reset_json(fp)


def _reset_json(filepath: str) -> None:
    """Replace a corrupted JSON file with the correct empty structure."""
    basename = os.path.basename(filepath)
    empty_data = DEFAULT_STRUCTURES.get(basename, {})
    try:
        safe_json_dump(filepath, empty_data)
    except PermissionError:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(empty_data, f, ensure_ascii=False)


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
    """Return the embedding dimension. The caller must provide --embed-dim."""
    if embed_dim and embed_dim > 0:
        return embed_dim
    raise ValueError(
        f"No embedding dimension for model '{embed_model}'. "
        "Click 'Test Connection' in Model Management to auto-detect it."
    )
