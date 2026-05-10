"""Synthetix LightRAG knowledge graph management — CRUD for entities/relations, graph export.

Usage:
  python rag_manage.py --user-id <uid> --action <action> [options...]

Actions:
  entities          List/search entities by keyword
  entity-detail      Get entity with relations (--entity-name)
  graph              Export subgraph (--entity-name, --depth)
  delete-by-doc      Delete all indexed data for a document (--doc-id)
  create-entity      Create entity (--entity-name, --entity-type, --description)
  edit-entity        Edit entity (--entity-name, --field, --value)
  merge-entities     Merge entities (--sources, --target)
  delete-entity      Delete entity (--entity-name)

Output: JSON to stdout
"""
import sys
import json
import os
import argparse
import asyncio


def load_storage_config():
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


async def action_list_entities(rag, keyword: str = "", limit: int = 50) -> dict:
    from lightrag import QueryParam
    if keyword:
        result = await rag.aquery_data(
            f"List all entities matching: {keyword}",
            param=QueryParam(mode="local", chunk_top_k=0, only_need_context=True),
        )
    else:
        try:
            labels = await rag.get_graph_labels()
            return {"entities": labels, "count": len(labels)}
        except Exception:
            pass

    data = result.get("data", {}) if isinstance(result, dict) else {}
    entities = data.get("entities", [])
    return {"entities": entities[:limit], "count": len(entities[:limit])}


async def action_entity_detail(rag, entity_name: str, max_depth: int = 2, max_nodes: int = 100) -> dict:
    try:
        kg = await rag.get_knowledge_graph(
            entity_name,
            max_depth=max_depth,
            max_nodes=max_nodes,
        )
        return {"entity": entity_name, "graph": kg}
    except Exception as e:
        return {"error": str(e), "entity": entity_name}


async def action_delete_by_doc(rag, doc_id: str) -> dict:
    try:
        await rag.adelete_by_doc_id(doc_id)
        return {"status": "deleted", "doc_id": doc_id}
    except Exception as e:
        return {"error": str(e), "doc_id": doc_id}


async def action_create_entity(rag, entity_name: str, entity_type: str, description: str) -> dict:
    try:
        await rag.acreate_entity(
            entity_name,
            {"description": description, "entity_type": entity_type},
        )
        return {"status": "created", "entity_name": entity_name, "entity_type": entity_type}
    except Exception as e:
        return {"error": str(e)}


async def action_edit_entity(rag, entity_name: str, field: str, value: str) -> dict:
    try:
        await rag.aedit_entity(entity_name, {field: value})
        return {"status": "edited", "entity_name": entity_name, "field": field, "value": value}
    except Exception as e:
        return {"error": str(e)}


async def action_merge_entities(rag, sources: list[str], target: str) -> dict:
    try:
        await rag.amerge_entities(sources, target_entity_name=target)
        return {"status": "merged", "sources": sources, "target": target}
    except Exception as e:
        return {"error": str(e)}


async def action_delete_entity(rag, entity_name: str) -> dict:
    try:
        await rag.adelete_by_entity(entity_name)
        return {"status": "deleted", "entity_name": entity_name}
    except Exception as e:
        return {"error": str(e)}


async def main_async(args) -> None:
    working_dir = os.path.join("data", "rag", args.user_id)
    os.makedirs(working_dir, exist_ok=True)

    from lightrag import LightRAG
    from lightrag.llm.openai import openai_complete_if_cache, openai_embed
    from lightrag.utils import EmbeddingFunc

    kv_storage, vector_storage, graph_storage, doc_status_storage, storage_kwargs = load_storage_config()

    def embedding_func(texts: list[str]):
        return openai_embed(
            texts,
            model=args.embed_model,
            base_url=args.embed_api_base,
            api_key=args.embed_api_key,
        )

    async def llm_func(
        prompt: str,
        system_prompt: str | None = None,
        history_messages: list = [],
        **kwargs,
    ) -> str:
        return await openai_complete_if_cache(
            model=args.llm_model,
            prompt=prompt,
            system_prompt=system_prompt,
            history_messages=history_messages,
            base_url=args.llm_api_base,
            api_key=args.llm_api_key,
            **kwargs,
        )

    # Resolve effective embedding dimension
    embed_model = args.embed_model
    eff_dim = args.embed_dim
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

    action = args.action

    if action == "entities":
        result = await action_list_entities(rag, args.keyword or "", args.limit)
    elif action == "entity-detail":
        result = await action_entity_detail(rag, args.entity_name, args.depth, args.max_nodes)
    elif action == "graph":
        result = await action_entity_detail(rag, args.entity_name or "", args.depth, args.max_nodes)
    elif action == "delete-by-doc":
        result = await action_delete_by_doc(rag, args.doc_id)
    elif action == "create-entity":
        result = await action_create_entity(rag, args.entity_name, args.entity_type, args.description)
    elif action == "edit-entity":
        result = await action_edit_entity(rag, args.entity_name, args.field, args.value)
    elif action == "merge-entities":
        sources = [s.strip() for s in args.sources.split(",") if s.strip()]
        result = await action_merge_entities(rag, sources, args.target)
    elif action == "delete-entity":
        result = await action_delete_entity(rag, args.entity_name)
    else:
        result = {"error": f"Unknown action: {action}"}

    print(json.dumps(result, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description="LightRAG knowledge graph management")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--action", required=True,
                        choices=["entities", "entity-detail", "graph", "delete-by-doc",
                                 "create-entity", "edit-entity", "merge-entities", "delete-entity"])
    parser.add_argument("--keyword", default="")
    parser.add_argument("--entity-name", default="")
    parser.add_argument("--entity-type", default="")
    parser.add_argument("--description", default="")
    parser.add_argument("--field", default="")
    parser.add_argument("--value", default="")
    parser.add_argument("--sources", default="")
    parser.add_argument("--target", default="")
    parser.add_argument("--doc-id", default="")
    parser.add_argument("--depth", type=int, default=2)
    parser.add_argument("--max-nodes", type=int, default=100)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--embed-api-base", default="http://localhost:11434/v1")
    parser.add_argument("--embed-api-key", default="ollama")
    parser.add_argument("--embed-model", default="nomic-embed-text")
    parser.add_argument("--embed-dim", type=int, default=0,
                        help="Embedding vector dimension (0=auto-detect)")
    parser.add_argument("--llm-api-base", default="http://localhost:11434/v1")
    parser.add_argument("--llm-api-key", default="ollama")
    parser.add_argument("--llm-model", default="llama3.2")
    args = parser.parse_args()

    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
