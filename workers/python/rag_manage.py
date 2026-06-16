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

from rag_common import fix_corrupted_json_files, load_storage_config, build_rerank_func, resolve_embed_dim


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


def _flatten_node(n) -> dict:
    labels = getattr(n, "labels", None) or []
    props = getattr(n, "properties", None) or {}
    return {
        "id": getattr(n, "id", ""),
        "label": labels[0] if labels else getattr(n, "id", ""),
        "type": props.get("entity_type", "") or "entity",
        "description": (props.get("description", "") or "").split("<SEP>")[0].strip(),
        "source_id": props.get("source_id", ""),
        "file_path": props.get("file_path", ""),
    }


def _flatten_edge(e) -> dict:
    props = getattr(e, "properties", None) or {}
    desc = props.get("description", "") or ""
    return {
        "source": getattr(e, "source", ""),
        "target": getattr(e, "target", ""),
        "label": (desc.split("<SEP>")[0].strip()) if desc else "",
        "description": (desc.split("<SEP>")[0].strip()) if desc else "",
        "weight": props.get("weight", 1) or 1,
        "keywords": (props.get("keywords", "") or ""),
        "source_id": props.get("source_id", ""),
    }


async def action_entity_detail(rag, entity_name: str, max_depth: int = 2, max_nodes: int = 100) -> dict:
    try:
        kg = await rag.get_knowledge_graph(
            entity_name,
            max_depth=max_depth,
            max_nodes=max_nodes,
        )
        nodes_raw = getattr(kg, "nodes", []) or []
        edges_raw = getattr(kg, "edges", []) or []
        return {
            "entity": entity_name,
            "graph": {
                "nodes": [_flatten_node(n) for n in nodes_raw],
                "edges": [_flatten_edge(e) for e in edges_raw],
            },
        }
    except Exception as e:
        return {"error": str(e), "entity": entity_name}


async def action_delete_by_doc(rag, doc_id: str) -> dict:
    try:
        deleted_ids = []
        target_ids = {doc_id}

        try:
            from lightrag.base import DocStatus
            all_docs = await rag.doc_status.get_docs_by_statuses(list(DocStatus))
        except Exception:
            all_docs = await rag.doc_status.get_all()

        for key, value in (all_docs or {}).items():
            if key == doc_id or key.startswith(doc_id + "/"):
                target_ids.add(key)
                continue

            metadata = (value or {}).get("metadata", {}) if isinstance(value, dict) else {}
            original_doc_id = metadata.get("original_doc_id", "") if isinstance(metadata, dict) else ""
            file_path = (value or {}).get("file_path", "") if isinstance(value, dict) else ""
            if original_doc_id == doc_id or original_doc_id.startswith(doc_id + "/") or f"{doc_id}" in file_path:
                target_ids.add(key)

        for target_id in sorted(target_ids):
            try:
                await rag.adelete_by_doc_id(target_id)
                deleted_ids.append(target_id)
            except Exception as delete_err:
                print(f"Warning deleting LightRAG doc {target_id}: {delete_err}", file=sys.stderr)
        
        # Check if any documents are left. If not, wipe the graph entirely to remove orphaned entities.
        remaining = await rag.doc_status.get_all()
        if not remaining:
            import shutil
            shutil.rmtree(rag.working_dir, ignore_errors=True)
            os.makedirs(rag.working_dir, exist_ok=True)
            return {"status": "deleted", "doc_id": doc_id, "deleted_ids": deleted_ids, "wiped_all": True}
             
        return {"status": "deleted", "doc_id": doc_id, "deleted_ids": deleted_ids}
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


async def action_graph_summary(rag) -> dict:
    """Return graph statistics: total entities, relations, and top entities by degree."""
    try:
        labels = await rag.get_graph_labels()
        if not labels:
            return {"entities": [], "total_entities": 0, "total_relations": 0, "top": []}

        # Count degrees from the subgraph of each major entity (concurrent)
        sem = asyncio.Semaphore(2)

        async def _get_degree(label: str) -> dict | None:
            try:
                async with sem:
                    kg = await rag.get_knowledge_graph(label, max_depth=1, max_nodes=1000)
                degree = len(kg.edges or [])
                return {"name": label, "degree": degree} if degree > 0 else None
            except Exception:
                return None

        results = await asyncio.gather(*[_get_degree(label) for label in labels[:30]])
        top_entities = sorted(
            [r for r in results if r is not None],
            key=lambda x: -x["degree"],
        )
        return {
            "total_entities": len(labels),
            "top": top_entities[:20],
        }
    except Exception as e:
        return {"error": str(e), "entities": [], "top": []}


async def action_core_graph(rag, max_nodes: int = 50, min_degree: int = 2) -> dict:
    """Return a clean core graph: only nodes with degree >= min_degree, hiding leaf nodes."""
    try:
        labels = await rag.get_graph_labels()
        if not labels:
            return {"entity": "", "graph": {"nodes": [], "edges": []}}

        sem = asyncio.Semaphore(2)

        async def _get_degree_pair(label: str) -> tuple[str, int]:
            try:
                async with sem:
                    kg = await rag.get_knowledge_graph(label, max_depth=1, max_nodes=1000)
                return (label, len(kg.edges or []))
            except Exception:
                return (label, 0)

        candidate_labels = labels[: min(len(labels), max(max_nodes, 100))]
        degree_pairs = await asyncio.gather(*[_get_degree_pair(label) for label in candidate_labels])
        best_label, best_degree = max(degree_pairs, key=lambda x: x[1])

        kg = await rag.get_knowledge_graph(best_label, max_depth=2, max_nodes=max_nodes)

        edge_count = {}
        for edge in (kg.edges or []):
            edge_count[edge.source] = edge_count.get(edge.source, 0) + 1
            edge_count[edge.target] = edge_count.get(edge.target, 0) + 1

        core_node_ids = {n.id for n in (kg.nodes or []) if edge_count.get(n.id, 0) >= min_degree}
        core_node_ids.add(best_label)

        filtered_nodes = [n for n in (kg.nodes or []) if n.id in core_node_ids]
        filtered_edges = [
            e for e in (kg.edges or [])
            if e.source in core_node_ids and e.target in core_node_ids
        ]

        if len(filtered_nodes) < min(8, len(kg.nodes or [])):
            relaxed_node_ids = {n.id for n in (kg.nodes or [])[:max_nodes]}
            filtered_nodes = [n for n in (kg.nodes or []) if n.id in relaxed_node_ids]
            filtered_edges = [
                e for e in (kg.edges or [])
                if e.source in relaxed_node_ids and e.target in relaxed_node_ids
            ]

        return {
            "entity": best_label,
            "graph": {
                "nodes": [_flatten_node(n) for n in filtered_nodes],
                "edges": [_flatten_edge(e) for e in filtered_edges],
            },
            "total_entities": len(labels),
            "leaf_count": len(labels) - len(filtered_nodes),
        }
    except Exception as e:
        print(f"action_core_graph error: {e}", file=sys.stderr)
        return {"error": str(e), "entity": "", "graph": {"nodes": [], "edges": []}}


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

    import numpy as np

    async def embedding_func(texts: list[str], **kwargs):
        # IMPORTANT: openai_embed is decorated with @wrap_embedding_func_with_attrs
        # which hardcodes embedding_dim=1536. Calling it directly makes LightRAG
        # validate vectors against 1536 even for 2048-dim (text-embedding-v4) /
        # 2560-dim (qwen3-vl) models. Invoke the unwrapped function via `.func` to
        # bypass the inner decorator. Same fix as rag_index.py / rag_query.py.
        unwrapped = getattr(openai_embed, "func", openai_embed)
        result = await unwrapped(
            texts,
            model=args.embed_model,
            base_url=args.embed_api_base,
            api_key=args.embed_api_key,
            **kwargs,
        )
        if isinstance(result, list) and len(result) > 0:
            return np.array([list(v) if hasattr(v, '__iter__') and not isinstance(v, list) else v for v in result], dtype=np.float32)
        return result

    _ignored_llm_kwargs = {"hashing_kv", "openai_client_configs", "token_tracker"}

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
                model=args.llm_model,
                prompt=prompt,
                system_prompt=system_prompt,
                history_messages=history_messages,
                base_url=args.llm_api_base,
                api_key=args.llm_api_key,
                **clean_kwargs,
            )
        except Exception as e:
            err_msg = str(e).lower()
            if "response_format" in err_msg or "invalid_request" in err_msg:
                for bad_key in ("response_format", "keyword_extraction"):
                    clean_kwargs.pop(bad_key, None)
                return await openai_complete_if_cache(
                    model=args.llm_model,
                    prompt=prompt,
                    system_prompt=system_prompt,
                    history_messages=history_messages,
                    base_url=args.llm_api_base,
                    api_key=args.llm_api_key,
                    **clean_kwargs,
                )
            raise

    # Resolve effective embedding dimension
    eff_dim = resolve_embed_dim(args.embed_model, args.embed_dim)

    # Pre-check for corruption before initializing
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
                addon_params={
                    "entity_types": [
                        "Technology", "Framework", "Architecture", "Protocol",
                        "Pattern", "Concept", "Algorithm", "Component",
                        "Service", "Platform", "Module", "Interface",
                        "Strategy", "Mechanism", "Pipeline", "Workflow",
                    ],
                },
                **storage_kwargs,
            )
            break
        except Exception as e:
            if "no element found" in str(e) and attempt < max_retries - 1:
                time.sleep(1)
                continue
            raise

    # Configure rerank if available
    rerank_fn = build_rerank_func(args.rerank_api_base, args.rerank_api_key, args.rerank_model)
    if rerank_fn:
        rag.rerank_model_func = rerank_fn
    await rag.initialize_storages()

    action = args.action

    if action == "entities":
        result = await action_list_entities(rag, args.keyword or "", args.limit)
    elif action == "graph-summary":
        result = await action_graph_summary(rag)
    elif action == "core-graph":
        result = await action_core_graph(rag, args.max_nodes or 50, args.min_degree or 2)
    elif action == "entity-detail":
        result = await action_entity_detail(rag, args.entity_name, args.depth, args.max_nodes)
    elif action == "graph":
        entity = args.entity_name
        if not entity:
            # Pick the first available entity as default
            all_entities = await action_list_entities(rag, "", 1)
            entity = (all_entities.get("entities") or [None])[0] or ""
        result = await action_entity_detail(rag, entity, args.depth, args.max_nodes)
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
                        choices=["entities", "entity-detail", "graph", "core-graph", "graph-summary", "delete-by-doc",
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
    parser.add_argument("--min-degree", type=int, default=2)
    parser.add_argument("--limit", type=int, default=50)
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

    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
