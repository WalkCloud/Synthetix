"""Synthetix LightRAG knowledge graph management — CRUD for entities/relations, graph export.

Usage:
  python rag_manage.py --user-id <uid> --action <action> [options...]

Actions:
  entities          List/search entities by keyword
  entity-detail      Get entity with relations (--entity-name)
  graph              Export subgraph (--entity-name, --depth)
  core-graph        Core graph from highest-degree entity (single-center, may bias to one doc)
  overview-graph    Cross-document overview — samples entities from ALL documents evenly
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


def _get_llm_max_async() -> int:
    """LightRAG's internal LLM concurrency for entity/relation rebuild during
    delete-by-doc. AUTO-ALIGNED to the adaptive limiter's hard cap
    (LLM_LIMITER_MAX_REQUESTS_GRAPH, default 8) so soft-delete rebuilds run at
    the same throughput as the original indexing AND the limiter stays the
    binding bottleneck. MAX_ASYNC_LLM is a deprecated escape hatch — see
    rag_index._get_llm_max_async for the full rationale.
    """
    try:
        cap = int(os.environ.get("LLM_LIMITER_MAX_REQUESTS_GRAPH", "8"))
        if cap <= 0:
            cap = 8
    except (TypeError, ValueError):
        cap = 8
    legacy = os.environ.get("MAX_ASYNC_LLM")
    if legacy:
        try:
            legacy_val = int(legacy)
            if legacy_val > 0:
                return legacy_val
        except (TypeError, ValueError):
            pass
    return cap


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
            # Fallback if the storage backend lacks get_docs_by_statuses.
            # NOTE: get_all() was removed in lightrag-hku 1.5.4; guard so this
            # still degrades gracefully on older/newer versions alike.
            getter = getattr(rag.doc_status, "get_all", None)
            all_docs = await getter() if getter else {}

        for key, value in (all_docs or {}).items():
            if key == doc_id or key.startswith(doc_id + "/"):
                target_ids.add(key)
                continue

            # LightRAG >=1.5.4 returns DocProcessingStatus dataclass objects
            # (not dicts) from get_docs_by_statuses; support both shapes.
            if isinstance(value, dict):
                metadata = (value or {}).get("metadata", {}) or {}
                original_doc_id = metadata.get("original_doc_id", "") if isinstance(metadata, dict) else ""
                file_path = (value or {}).get("file_path", "")
            else:
                metadata = getattr(value, "metadata", None) or {}
                original_doc_id = metadata.get("original_doc_id", "") if isinstance(metadata, dict) else ""
                file_path = getattr(value, "file_path", "")
            if original_doc_id == doc_id or original_doc_id.startswith(doc_id + "/") or f"{doc_id}" in file_path:
                target_ids.add(key)

        soft_delete_failed = False
        for target_id in sorted(target_ids):
            try:
                await rag.adelete_by_doc_id(target_id)
                deleted_ids.append(target_id)
            except Exception as delete_err:
                # adelete_by_doc_id triggers per-chunk LLM entity rebuilds, which
                # are unstable on large graphs (3000+ nodes): a single rebuild
                # failure aborts the whole call and leaves the graph half-deleted.
                # Record the failure; we'll fall through to the hard-delete path
                # below rather than returning a half-finished result that leaves
                # orphan chunks/entities in the knowledge graph.
                soft_delete_failed = True
                print(f"Warning deleting LightRAG doc {target_id}: {delete_err}", file=sys.stderr)

        # Check if any documents are left. If not, wipe the graph entirely to remove orphaned entities.
        # lightrag-hku 1.5.4 replaced get_all() with is_empty() / get_status_counts();
        # fall back to get_all() on older versions that still expose it.
        is_empty_fn = getattr(rag.doc_status, "is_empty", None)
        if is_empty_fn:
            remaining_empty = await is_empty_fn()
        else:
            getter = getattr(rag.doc_status, "get_all", None)
            remaining_empty = not bool(await getter() if getter else False)
        if remaining_empty:
            import shutil
            shutil.rmtree(rag.working_dir, ignore_errors=True)
            os.makedirs(rag.working_dir, exist_ok=True)
            return {"status": "deleted", "doc_id": doc_id, "deleted_ids": deleted_ids, "wiped_all": True}

        # HARD DELETE FALLBACK: when LightRAG's soft delete (adelete_by_doc_id,
        # which rebuilds entities via LLM) failed mid-way on a large graph, the
        # doc's chunks/entities/relations remain as orphans. Rather than leaving
        # stale data in the knowledge graph (user sees deleted-doc entities in
        # the graph view), directly purge every trace of doc_id from the JSON
        # KV stores + vector DBs. This bypasses LightRAG's rebuild entirely —
        # entities/relations owned SOLELY by this doc are removed; shared ones
        # keep their other sources. No LLM calls, no rebuild, fully deterministic.
        if soft_delete_failed:
            hard_result = _hard_delete_doc_from_storage(rag.working_dir, doc_id)
            return {
                "status": "deleted",
                "doc_id": doc_id,
                "deleted_ids": deleted_ids,
                "hard_delete_used": True,
                "hard_deleted_chunks": hard_result["chunks_removed"],
                "hard_deleted_entities": hard_result["entities_removed"],
                "hard_deleted_relations": hard_result["relations_removed"],
            }

        return {"status": "deleted", "doc_id": doc_id, "deleted_ids": deleted_ids}
    except Exception as e:
        return {"error": str(e), "doc_id": doc_id}


def _hard_delete_doc_from_storage(working_dir: str, doc_id: str) -> dict:
    """Purge every trace of doc_id from LightRAG's file-based KV stores + vector DBs.

    Operates directly on the JSON files in working_dir, bypassing LightRAG's
    in-memory state (which may be inconsistent after a failed soft delete). Safe
    because the process is exiting right after — the next process re-reads these
    files fresh.

    Removes:
    - doc_status / full_docs / text_chunks entries keyed "{doc_id}/chunk_*"
    - entities whose chunk_ids ALL reference this doc (orphan entity)
    - relations whose chunk_ids ALL reference this doc (orphan relation)
    - corresponding rows from vdb_*.json (nano-vectordb files keyed by the same
      id, with a parallel __vector_store__ array)
    """
    import json

    prefix = doc_id + "/"

    def load(name):
        p = os.path.join(working_dir, name)
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def save(name, data):
        p = os.path.join(working_dir, name)
        try:
            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
        except Exception as e:
            print(f"Warning writing {name}: {e}", file=sys.stderr)

    chunks_removed = 0
    entities_removed = 0
    relations_removed = 0

    # 1. Purge chunk-level stores: doc_status, full_docs, text_chunks
    for store_name in ["kv_store_doc_status.json", "kv_store_full_docs.json", "kv_store_text_chunks.json"]:
        store = load(store_name)
        if not isinstance(store, dict):
            continue
        before = len(store)
        for key in list(store.keys()):
            if key == doc_id or key.startswith(prefix):
                del store[key]
                chunks_removed = max(chunks_removed, before - len(store))
        save(store_name, store)

    # 2. Purge entities owned solely by this doc.
    #    entity_chunks[entity] = { "chunk_ids": ["{docId}/chunk_NNN-chunk-XXX", ...], ... }
    #    An entity is an orphan (safe to delete) iff every chunk_id references
    #    doc_id. Entities also sourced from OTHER docs are left intact.
    ec = load("kv_store_entity_chunks.json")
    if isinstance(ec, dict):
        orphan_entities = []
        for entity, meta in list(ec.items()):
            chunk_ids = meta.get("chunk_ids", []) if isinstance(meta, dict) else []
            if not chunk_ids:
                continue
            if all(cid.startswith(prefix) or cid == doc_id for cid in chunk_ids):
                orphan_entities.append(entity)
        for entity in orphan_entities:
            del ec[entity]
            entities_removed += 1
        save("kv_store_entity_chunks.json", ec)

        # Also remove from full_entities + vdb_entities
        fe = load("kv_store_full_entities.json")
        if isinstance(fe, dict):
            for entity in orphan_entities:
                fe.pop(entity, None)
            save("kv_store_full_entities.json", fe)

        _purge_vdb(working_dir, "vdb_entities.json", orphan_entities)

    # 3. Purge relations owned solely by this doc (same logic as entities).
    rc = load("kv_store_relation_chunks.json")
    if isinstance(rc, dict):
        orphan_rels = []
        for rel, meta in list(rc.items()):
            chunk_ids = meta.get("chunk_ids", []) if isinstance(meta, dict) else []
            if not chunk_ids:
                continue
            if all(cid.startswith(prefix) or cid == doc_id for cid in chunk_ids):
                orphan_rels.append(rel)
        for rel in orphan_rels:
            del rc[rel]
            relations_removed += 1
        save("kv_store_relation_chunks.json", rc)

        fr = load("kv_store_full_relations.json")
        if isinstance(fr, dict):
            for rel in orphan_rels:
                fr.pop(rel, None)
            save("kv_store_full_relations.json", fr)

        _purge_vdb(working_dir, "vdb_relationships.json", orphan_rels)

    # 4. Purge chunk-level vector DB (vdb_chunks.json) entries for this doc.
    _purge_vdb_prefix(working_dir, "vdb_chunks.json", prefix)

    # 5. Purge LLM response cache entries that reference this doc's chunks.
    lc = load("kv_store_llm_response_cache.json")
    if isinstance(lc, dict):
        for key in list(lc.keys()):
            if doc_id in key:
                del lc[key]
        save("kv_store_llm_response_cache.json", lc)

    # 6. Purge orphan nodes + edges from the NetworkX GraphML file.
    #    Without this, the next LightRAG process reloads the stale graph from
    #    GraphML and re-populates the KV stores with the deleted doc's entities.
    #    Node/edge "source_id" attribute holds a comma-separated list of chunk
    #    ids ("{docId}/chunk_NNN-chunk-XXX"); if EVERY id references doc_id,
    #    the node/edge is an orphan and is removed. Multi-source nodes (shared
    #    with other docs) are preserved.
    try:
        import networkx as nx
        graphml_path = os.path.join(working_dir, "graph_chunk_entity_relation.graphml")
        if os.path.exists(graphml_path):
            G = nx.read_graphml(graphml_path)

            def all_sources_orphan(source_id_str: str) -> bool:
                """True iff every source chunk id in the GRAPHML source_id field
                belongs to the deleted doc."""
                if not source_id_str:
                    return False
                # GraphML stores long strings with truncation markers (e.g.
                # "<SEP>...<SENTENCE_LENGTH>..."). Split on common delimiters
                # and check if any token is a non-orphan chunk id.
                import re
                tokens = re.split(r"[<SEP>,\s]+", str(source_id_str))
                # If NONE of the tokens look like a chunk id from another doc,
                # treat as orphan. A token "belongs" to doc_id if it starts
                # with the doc_id prefix.
                has_other_doc_source = False
                for tok in tokens:
                    tok = tok.strip()
                    if not tok:
                        continue
                    if tok.startswith(prefix) or tok == doc_id:
                        continue  # this source is the deleted doc
                    # Looks like a chunk id from a different doc (UUID prefix)
                    if "/" in tok and len(tok.split("/")[0]) >= 32:
                        has_other_doc_source = True
                        break
                return not has_other_doc_source

            nodes_before = G.number_of_nodes()
            edges_before = G.number_of_edges()
            orphan_nodes = [
                n for n, data in G.nodes(data=True)
                if all_sources_orphan(data.get("source_id", ""))
            ]
            G.remove_nodes_from(orphan_nodes)
            orphan_edges = [
                (u, v) for u, v, data in G.edges(data=True)
                if all_sources_orphan(data.get("source_id", ""))
            ]
            G.remove_edges_from(orphan_edges)
            nx.write_graphml(G, graphml_path)
            print(
                f"[hard-delete] GraphML: removed {len(orphan_nodes)} orphan nodes "
                f"({nodes_before}->{G.number_of_nodes()}), "
                f"{len(orphan_edges)} orphan edges ({edges_before}->{G.number_of_edges()})",
                file=sys.stderr,
            )
    except Exception as e:
        print(f"[hard-delete] GraphML cleanup skipped: {e}", file=sys.stderr)

    return {
        "chunks_removed": chunks_removed,
        "entities_removed": entities_removed,
        "relations_removed": relations_removed,
    }


def _purge_vdb(working_dir: str, vdb_name: str, ids_to_remove: list) -> None:
    """Remove entries by exact id from a nano-vectordb JSON file.

    nano-vectordb stores data as:
      { "__data__": [ {"__id__": "...", ...}, ... ], "__metadata__": {...} }
    or a flat dict of {id: {__vector__: [...]}} depending on version. Handle both.
    """
    import json
    p = os.path.join(working_dir, vdb_name)
    try:
        with open(p, "r", encoding="utf-8") as f:
            vdb = json.load(f)
    except Exception:
        return
    if isinstance(vdb, dict) and "__data__" in vdb and isinstance(vdb["__data__"], list):
        remove_set = set(ids_to_remove)
        vdb["__data__"] = [row for row in vdb["__data__"] if row.get("__id__") not in remove_set]
    elif isinstance(vdb, dict):
        for rid in ids_to_remove:
            vdb.pop(rid, None)
    try:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(vdb, f, ensure_ascii=False)
    except Exception as e:
        print(f"Warning writing {vdb_name}: {e}", file=sys.stderr)


def _purge_vdb_prefix(working_dir: str, vdb_name: str, prefix: str) -> None:
    """Remove entries whose id starts with prefix from a nano-vectordb JSON file."""
    import json
    p = os.path.join(working_dir, vdb_name)
    try:
        with open(p, "r", encoding="utf-8") as f:
            vdb = json.load(f)
    except Exception:
        return
    if isinstance(vdb, dict) and "__data__" in vdb and isinstance(vdb["__data__"], list):
        vdb["__data__"] = [row for row in vdb["__data__"] if not str(row.get("__id__", "")).startswith(prefix)]
    elif isinstance(vdb, dict):
        for key in list(vdb.keys()):
            if key.startswith(prefix):
                del vdb[key]
    try:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(vdb, f, ensure_ascii=False)
    except Exception as e:
        print(f"Warning writing {vdb_name}: {e}", file=sys.stderr)



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


async def _top_labels_by_degree(rag, labels: list[str], limit: int) -> list[tuple[str, int]]:
    """Return [(label, degree), ...] sorted by degree desc.

    Prefers the storage backend's get_popular_labels (a single degree sweep over
    the whole graph) and resolves each label's degree in one batch. Falls back to
    the per-label get_knowledge_graph fan-out when the backend predates that API.
    """
    graph_store = getattr(rag, "chunk_entity_relation_graph", None)
    get_popular = getattr(graph_store, "get_popular_labels", None)
    if callable(get_popular):
        try:
            popular = await get_popular(limit)
            if popular:
                # popular is degree-sorted names; resolve degrees in one pass via
                # node_degree (O(1) per node on NetworkX) for the score we return.
                degree_fn = getattr(graph_store, "node_degree", None)
                pairs: list[tuple[str, int]] = []
                for name in popular:
                    deg = 0
                    if callable(degree_fn):
                        try:
                            deg = int(await degree_fn(name) or 0)
                        except Exception:
                            deg = 0
                    pairs.append((name, deg))
                return pairs
        except Exception:
            pass  # fall through to the legacy fan-out below

    # Legacy fan-out (old LightRAG without get_popular_labels). Throttled to 2
    # concurrent traversals; identical to the original implementation.
    sem = asyncio.Semaphore(2)

    async def _get_degree_pair(label: str) -> tuple[str, int]:
        try:
            async with sem:
                kg = await rag.get_knowledge_graph(label, max_depth=1, max_nodes=1000)
            return (label, len(kg.edges or []))
        except Exception:
            return (label, 0)

    candidates = labels[: min(len(labels), limit)]
    pairs = await asyncio.gather(*[_get_degree_pair(label) for label in candidates])
    return sorted(pairs, key=lambda x: x[1], reverse=True)


async def _pick_top_label(rag, labels: list[str], limit: int) -> str:
    """Return the highest-degree label, or the first label as a last resort."""
    pairs = await _top_labels_by_degree(rag, labels, limit)
    return pairs[0][0] if pairs else labels[0]


async def action_graph_summary(rag) -> dict:
    """Return graph statistics: total entities, relations, and top entities by degree."""
    try:
        labels = await rag.get_graph_labels()
        if not labels:
            return {"entities": [], "total_entities": 0, "total_relations": 0, "top": []}

        # Single degree sweep via the storage backend (falls back to fan-out on
        # old LightRAG) replaces the former 30-call get_knowledge_graph loop.
        pairs = await _top_labels_by_degree(rag, labels, 30)
        top_entities = [{"name": name, "degree": deg} for name, deg in pairs if deg > 0]
        return {
            "total_entities": len(labels),
            "top": top_entities[:20],
        }
    except Exception as e:
        return {"error": str(e), "entities": [], "top": []}


async def action_overview_graph(rag, max_nodes: int = 80, min_degree: int = 2) -> dict:
    """Return a cross-document overview graph that includes entities from ALL documents.

    Unlike ``action_core_graph`` (which expands from a single highest-degree entity
    and thus biases toward one document), this function samples high-degree entities
    from every document proportionally, plus all cross-document shared entities,
    to form a representative overview of the entire knowledge base.

    Algorithm:
      1. Read the full NetworkX graph directly (no per-entity fan-out).
      2. Classify each node by its source document (from the ``source_id`` property).
      3. Identify cross-document nodes (source_id spans >1 doc) — these are the
         natural bridges between document sub-graphs.
      4. For each document, pick its top-N highest-degree entities.
      5. Combine cross-document nodes + per-document samples into the result set.
      6. Include edges where both endpoints are in the result set.
    """
    try:
        graph_store = getattr(rag, "chunk_entity_relation_graph", None)
        if graph_store is None:
            return {"entity": "", "graph": {"nodes": [], "edges": []}, "total_entities": 0}

        # Access the underlying NetworkX graph. _get_graph() returns the live graph
        # (reloading from disk if another process committed). We read it once.
        graph = await graph_store._get_graph()
        if graph is None or graph.number_of_nodes() == 0:
            return {"entity": "", "graph": {"nodes": [], "edges": []}, "total_entities": 0}

        total_nodes = graph.number_of_nodes()
        total_edges = graph.number_of_edges()

        # ── Step 1: classify nodes by document and compute degrees ──
        node_degree_map = dict(graph.degree())
        # source_id property key in GraphML is "source_id" (LightRAG convention)
        doc_nodes: dict[str, list[str]] = {}   # docId → [node_id, ...]
        cross_doc_nodes: list[str] = []
        node_source_ids: dict[str, set] = {}   # node_id → set of docId prefixes

        for node_id in graph.nodes():
            props = graph.nodes[node_id]
            source_id = props.get("source_id", "") or ""
            chunks = source_id.split("<SEP>")
            doc_ids = set()
            for c in chunks:
                c = c.strip()
                if "/" in c:
                    doc_ids.add(c.split("/")[0][:8])
            node_source_ids[node_id] = doc_ids
            if len(doc_ids) > 1:
                cross_doc_nodes.append(node_id)
            for did in doc_ids:
                doc_nodes.setdefault(did, []).append(node_id)

        # ── Step 2: budget allocation ──
        # Reserve slots for cross-document nodes first, then distribute the rest
        # evenly across documents.
        cross_budget = min(len(cross_doc_nodes), max_nodes // 3)
        remaining = max_nodes - cross_budget
        num_docs = max(len(doc_nodes), 1)
        per_doc = max(remaining // num_docs, 5)

        selected: set[str] = set()

        # Cross-document nodes: sort by degree, take top cross_budget.
        cross_sorted = sorted(cross_doc_nodes, key=lambda n: node_degree_map.get(n, 0), reverse=True)
        selected.update(cross_sorted[:cross_budget])

        # Per-document nodes: sort by degree, take top per_doc from each.
        for did, nodes in doc_nodes.items():
            doc_sorted = sorted(nodes, key=lambda n: node_degree_map.get(n, 0), reverse=True)
            selected.update(doc_sorted[:per_doc])

        # If we're under max_nodes, fill remaining slots with the highest-degree
        # nodes not yet selected (regardless of document).
        if len(selected) < max_nodes:
            all_sorted = sorted(graph.nodes(), key=lambda n: node_degree_map.get(n, 0), reverse=True)
            for nid in all_sorted:
                if len(selected) >= max_nodes:
                    break
                selected.add(nid)

        # ── Step 3: filter by min_degree (relaxed if it removes too many) ──
        if min_degree > 1:
            degree_filtered = {n for n in selected if node_degree_map.get(n, 0) >= min_degree}
            # Keep at least 60% of selected; otherwise relax threshold.
            if len(degree_filtered) < len(selected) * 0.6:
                degree_filtered = {n for n in selected if node_degree_map.get(n, 0) >= 1}
            selected = degree_filtered

        # ── Step 4: build node and edge lists ──
        # Sort selected nodes by degree for consistent display ordering.
        selected_sorted = sorted(selected, key=lambda n: node_degree_map.get(n, 0), reverse=True)

        result_nodes = []
        for nid in selected_sorted:
            props = graph.nodes[nid]
            source_id = props.get("source_id", "") or ""
            # Determine doc membership for the frontend to color/label.
            doc_ids = node_source_ids.get(nid, set())
            result_nodes.append({
                "id": nid,
                "label": nid,
                "type": props.get("entity_type", "") or props.get("type", "") or "entity",
                "description": (props.get("description", "") or "").split("<SEP>")[0].strip()[:200],
                "source_id": source_id.split("<SEP>")[0].strip(),
                "file_path": (props.get("file_path", "") or "").split("<SEP>")[0].strip(),
                "degree": node_degree_map.get(nid, 0),
                "doc_ids": sorted(doc_ids),
            })

        result_edges = []
        for u, v in graph.edges():
            if u in selected and v in selected:
                props = graph.edges[u, v]
                desc = (props.get("description", "") or "").split("<SEP>")[0].strip()
                result_edges.append({
                    "source": u,
                    "target": v,
                    "label": desc,
                    "description": desc,
                    "weight": props.get("weight", 1) or 1,
                    "keywords": props.get("keywords", "") or "",
                    "source_id": (props.get("source_id", "") or "").split("<SEP>")[0].strip(),
                })

        return {
            "entity": "",
            "graph": {
                "nodes": result_nodes,
                "edges": result_edges,
            },
            "total_entities": total_nodes,
            "total_edges": total_edges,
            "cross_doc_entities": len(cross_doc_nodes),
            "documents": sorted(doc_nodes.keys()),
            "leaf_count": total_nodes - len(result_nodes),
        }
    except Exception as e:
        print(f"action_overview_graph error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"error": str(e), "entity": "", "graph": {"nodes": [], "edges": []}}


async def action_core_graph(rag, max_nodes: int = 50, min_degree: int = 2) -> dict:
    """Return a clean core graph: only nodes with degree >= min_degree, hiding leaf nodes."""
    try:
        labels = await rag.get_graph_labels()
        if not labels:
            return {"entity": "", "graph": {"nodes": [], "edges": []}}

        # Pick the highest-degree node as the graph center. The storage backend's
        # get_popular_labels does this in a single degree sweep; fall back to the
        # per-label fan-out only if the method is unavailable on older LightRAG.
        best_label = await _pick_top_label(rag, labels, max(max_nodes, 100))

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



def _index_busy_result(working_dir: str, doc_id: str) -> dict | None:
    lock_path = os.path.join(working_dir, ".indexing.lock")
    if not os.path.exists(lock_path):
        return None
    indexing_doc_id = ""
    try:
        with open(lock_path, "r", encoding="utf-8") as lock_file:
            indexing_doc_id = lock_file.read().strip()
    except OSError:
        pass
    return {
        "status": "busy",
        "code": "RAG_INDEX_BUSY",
        "retryable": True,
        "doc_id": doc_id,
        "indexing_doc_id": indexing_doc_id,
    }


async def main_async(args) -> None:
    working_dir = os.path.join("data", "rag", args.user_id)
    os.makedirs(working_dir, exist_ok=True)

    if args.action == "delete-by-doc":
        busy = _index_busy_result(working_dir, args.doc_id)
        if busy:
            print(json.dumps(busy, ensure_ascii=False))
            return

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
                llm_model_max_async=_get_llm_max_async(),
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
    elif action == "overview-graph":
        result = await action_overview_graph(rag, args.max_nodes or 80, args.min_degree or 1)
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
        busy = _index_busy_result(working_dir, args.doc_id)
        result = busy if busy else await action_delete_by_doc(rag, args.doc_id)
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
                        choices=["entities", "entity-detail", "graph", "core-graph", "overview-graph", "graph-summary", "delete-by-doc",
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
