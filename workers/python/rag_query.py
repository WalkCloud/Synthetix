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
import argparse
import asyncio


def load_storage_config():
    """Build LightRAG storage configuration matching rag_index.py."""
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


async def query_rag(
    user_id: str,
    query_text: str,
    mode: str = "hybrid",
    limit: int = 20,
    return_entities: bool = False,
    return_relations: bool = False,
    embed_api_base: str = "http://localhost:11434/v1",
    embed_api_key: str = "ollama",
    embed_model: str = "nomic-embed-text",
    embed_dim: int = 0,
    llm_api_base: str = "http://localhost:11434/v1",
    llm_api_key: str = "ollama",
    llm_model: str = "llama3.2",
) -> dict:
    """Query LightRAG and return structured results: chunks, optional entities/relations."""
    working_dir = os.path.join("data", "rag", user_id)

    if not os.path.exists(working_dir):
        print(json.dumps({"chunks": [], "mode": mode}))
        return

    from lightrag import LightRAG, QueryParam
    from lightrag.llm.openai import openai_embed
    from lightrag.utils import EmbeddingFunc
    from openai import AsyncOpenAI

    kv_storage, vector_storage, graph_storage, doc_status_storage, storage_kwargs = load_storage_config()

    def embedding_func(texts: list[str]):
        return openai_embed(
            texts,
            model=embed_model,
            base_url=embed_api_base,
            api_key=embed_api_key,
        )

    _ignored_llm_kwargs = {"hashing_kv", "openai_client_configs", "token_tracker"}
    _llm_response_format_keys = {"response_format", "keyword_extraction"}

    async def llm_func(
        prompt: str,
        system_prompt: str | None = None,
        history_messages: list = [],
        **kwargs,
    ) -> str:
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
        clean_kwargs.pop("timeout", None)

        import asyncio
        client = AsyncOpenAI(base_url=llm_api_base, api_key=llm_api_key)
        use_structured = response_format is not None

        for attempt in range(3):
            try:
                if use_structured and attempt == 0:
                    try:
                        response = await client.beta.chat.completions.parse(
                            model=llm_model,
                            messages=messages,
                            response_format=response_format,
                        )
                        parsed = getattr(response.choices[0].message, "parsed", None)
                        if parsed is not None:
                            return parsed.model_dump_json()
                        return response.choices[0].message.content or ""
                    except Exception:
                        use_structured = False

                response = await client.chat.completions.create(
                    model=llm_model,
                    messages=messages,
                    **clean_kwargs,
                )
                content = response.choices[0].message.content or ""
                if not content.strip():
                    raise ValueError("Empty response from LLM")
                return content
            except Exception:
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise
        await client.close()
        return ""

    # Resolve effective embedding dimension
    eff_dim = embed_dim
    if not eff_dim:
        model_lower = embed_model.lower()
        if any(x in model_lower for x in ("bge-m3", "bge-large", "text-embedding-3-large", "text-embedding-ada")):
            eff_dim = 1536
        elif any(x in model_lower for x in ("bge", "gte", "e5")):
            eff_dim = 1024
        elif "text-embedding-3-small" in model_lower:
            eff_dim = 1536
        elif any(x in model_lower for x in ("mxbai", "nomic")):
            eff_dim = 768
        else:
            eff_dim = 768

    rag = LightRAG(
        working_dir=working_dir,
        llm_model_func=llm_func,
        embedding_func=EmbeddingFunc(
            embedding_dim=eff_dim,
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

    # Resolve mode aliases
    valid_modes = {"local", "global", "hybrid", "mix", "naive", "bypass"}
    if mode not in valid_modes:
        mode = "hybrid"

    param = QueryParam(
        mode=mode,
        chunk_top_k=limit,
        only_need_context=True,
    )

    try:
        result = await rag.aquery_data(query_text, param=param)
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

            raw_score = cosine_map.get(chunk_id)
            if raw_score is not None:
                score = max(0.0, min(1.0, raw_score))
            elif len(chunks) > 1:
                t = i / (len(chunks) - 1)
                score = 1.0 - t * t * 0.3
            else:
                score = 1.0

            output_chunks.append({
                "chunk_id": chunk_id,
                "content": content_text[:4000],
                "title": title,
                "score": round(score, 4),
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
        print(json.dumps({"error": str(e), "mode": mode}))


def main() -> None:
    parser = argparse.ArgumentParser(description="LightRAG semantic query")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--mode", default="hybrid",
                        choices=["local", "global", "hybrid", "mix", "naive", "bypass"])
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--return-entities", action="store_true")
    parser.add_argument("--return-relations", action="store_true")
    parser.add_argument("--embed-api-base", default="http://localhost:11434/v1")
    parser.add_argument("--embed-api-key", default="ollama")
    parser.add_argument("--embed-model", default="nomic-embed-text")
    parser.add_argument("--embed-dim", type=int, default=0,
                        help="Embedding vector dimension (0=auto-detect)")
    parser.add_argument("--llm-api-base", default="http://localhost:11434/v1")
    parser.add_argument("--llm-api-key", default="ollama")
    parser.add_argument("--llm-model", default="llama3.2")
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
        )
    )


if __name__ == "__main__":
    main()
