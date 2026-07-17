"""Source-aware aggregate purge adapter for LightRAG.

This module provides a single entry point — ``purge_application_document`` —
that correctly removes ALL of an application document's contributions from the
shared per-user LightRAG workspace while preserving entities/relations that
other application documents still reference.

Background: the application inserts each Markdown chunk as a separate LightRAG
document with ID ``<appDocId>/chunk_NNN``. LightRAG then generates internal
chunk IDs like ``<appDocId>/chunk_NNN-chunk-000``. The old cleanup code in
rag_index.py confused these ID levels and deleted doc_status BEFORE calling
the source-aware delete, disabling it entirely.

This adapter:

1. Discovers all child LightRAG documents for the parent app doc ID.
2. Reads each child's full status (including ``chunks_list``).
3. Aggregates real internal chunk IDs across all children.
4. Aggregates entity_names and relation_pairs from each child's
   ``full_entities``/``full_relations`` metadata.
5. Writes a single temporary aggregate metadata key.
6. Calls LightRAG's private ``_purge_doc_chunks_and_kg`` ONCE on the
   aggregate — this does the source-aware graph cleanup in a single pass.
7. Deletes all child metadata (doc_status, full_docs, full_entities,
   full_relations).
8. Flushes via ``_insert_done``.
9. Returns a structured result.

Version pin: this adapter uses LightRAG 1.5.4's private ``_purge_doc_chunks_and_kg``
method. If the installed version or method signature changes, it fails closed
rather than guessing. The project pins ``lightrag-hku==1.5.4`` in requirements.txt.
"""
from __future__ import annotations

import asyncio
import hashlib
import inspect
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Optional

import lightrag


# ── Version/signature guard ──────────────────────────────────────────────────

_GUARD_CHECKED = False


def _check_guard() -> None:
    """Verify LightRAG version and _purge_doc_chunks_and_kg signature.

    Fails closed if the installed version doesn't match what this adapter
    was written against. This prevents silent semantic drift on upgrade.
    """
    global _GUARD_CHECKED
    if _GUARD_CHECKED:
        return

    version = getattr(lightrag, "__version__", "")
    if version != "1.5.4":
        raise RuntimeError(
            f"lightrag_adapter requires lightrag-hku==1.5.4, but installed "
            f"version is {version!r}. The _purge_doc_chunks_and_kg private "
            f"API may have changed; refusing to guess."
        )

    purge_fn = getattr(lightrag.LightRAG, "_purge_doc_chunks_and_kg", None)
    if purge_fn is None:
        raise RuntimeError(
            "lightrag_adapter: LightRAG._purge_doc_chunks_and_kg does not "
            "exist in the installed version. Cannot perform source-aware purge."
        )

    sig = inspect.signature(purge_fn)
    params = list(sig.parameters.keys())
    # Expected: (self, doc_id, chunk_ids, *, pipeline_status, pipeline_status_lock)
    if params != ["self", "doc_id", "chunk_ids", "pipeline_status", "pipeline_status_lock"]:
        raise RuntimeError(
            f"lightrag_adapter: _purge_doc_chunks_and_kg signature changed to "
            f"{params}. Adapter needs updating."
        )

    _GUARD_CHECKED = True


# ── Result type ──────────────────────────────────────────────────────────────


@dataclass
class PurgeResult:
    parent_doc_id: str
    child_doc_ids: list[str] = field(default_factory=list)
    duplicate_record_ids: list[str] = field(default_factory=list)
    chunk_ids: list[str] = field(default_factory=list)
    affected_entities: int = 0
    affected_relations: int = 0
    purged: bool = False


@dataclass
class InsertVerificationResult:
    parent_doc_id: str
    expected_child_ids: list[str] = field(default_factory=list)
    committed_child_ids: list[str] = field(default_factory=list)
    missing_child_ids: list[str] = field(default_factory=list)
    failed_children: list[dict[str, Any]] = field(default_factory=list)
    duplicate_records: list[dict[str, Any]] = field(default_factory=list)


class PurgeError(Exception):
    """Raised when purge cannot proceed safely."""

    def __init__(self, code: str, message: str, **extra: Any):
        self.code = code
        self.message = message
        self.extra = extra
        super().__init__(message)


# ── Pipeline reservation ─────────────────────────────────────────────────────


@asynccontextmanager
async def _pipeline_reservation(rag, job_name: str):
    """Acquire LightRAG's internal pipeline_status reservation.

    _purge_doc_chunks_and_kg requires the caller to hold the pipeline. This
    context manager acquires and releases it using the same shared-storage
    namespace utilities that adelete_by_doc_id uses internally.
    """
    from lightrag.kg.shared_storage import get_namespace_data, get_namespace_lock

    pipeline_status = await get_namespace_data("pipeline_status", workspace=rag.workspace)
    pipeline_status_lock = get_namespace_lock("pipeline_status", workspace=rag.workspace)

    async with pipeline_status_lock:
        if pipeline_status.get("busy", False):
            current_job = pipeline_status.get("job_name", "")
            raise PurgeError(
                "PIPELINE_BUSY",
                f"LightRAG pipeline is busy with '{current_job}'. Cannot purge.",
            )
        pipeline_status["busy"] = True
        pipeline_status["job_name"] = job_name
        pipeline_status["latest_message"] = f"Starting {job_name}"

    try:
        yield pipeline_status, pipeline_status_lock
    finally:
        async with pipeline_status_lock:
            pipeline_status["busy"] = False
            pipeline_status["job_name"] = ""
            pipeline_status["latest_message"] = f"Completed {job_name}"


# ── Insert verification ──────────────────────────────────────────────────────


def _status_value(record: dict[str, Any]) -> str:
    status = record.get("status", "")
    return str(getattr(status, "value", status)).lower()


def _duplicate_details(record_id: str, record: dict[str, Any]) -> Optional[dict[str, Any]]:
    metadata = record.get("metadata")
    if not isinstance(metadata, dict) or metadata.get("is_duplicate") is not True:
        return None
    return {
        "record_id": record_id,
        "duplicate_kind": metadata.get("duplicate_kind"),
        "original_doc_id": metadata.get("original_doc_id"),
        "file_path": record.get("file_path"),
        "error": record.get("error_msg") or record.get("content_summary"),
    }


async def verify_application_document_insert(
    rag,
    parent_doc_id: str,
    expected_child_ids: list[str],
) -> InsertVerificationResult:
    """Verify that LightRAG committed every requested child document.

    LightRAG records filename/content duplicates as failed ``dup-*`` status rows
    and returns normally from ``ainsert``. Callers therefore cannot treat a
    successful coroutine return as a committed insert.
    """
    from lightrag.base import DocStatus

    expected = list(dict.fromkeys(expected_child_ids))
    expected_set = set(expected)
    all_docs = await rag.doc_status.get_docs_by_statuses(list(DocStatus))
    result = InsertVerificationResult(
        parent_doc_id=parent_doc_id,
        expected_child_ids=expected,
    )

    for child_id in expected:
        record = all_docs.get(child_id)
        if not isinstance(record, dict):
            result.missing_child_ids.append(child_id)
            continue
        if _status_value(record) != "processed" or not record.get("chunks_list"):
            result.failed_children.append({
                "child_id": child_id,
                "status": _status_value(record),
                "file_path": record.get("file_path"),
                "error": record.get("error_msg"),
                "chunks_count": len(record.get("chunks_list") or []),
            })
            continue
        result.committed_child_ids.append(child_id)

    for record_id, record in all_docs.items():
        if not record_id.startswith("dup-") or not isinstance(record, dict):
            continue
        details = _duplicate_details(record_id, record)
        if details and details.get("original_doc_id") not in expected_set:
            # A missing requested child may have been redirected to an existing
            # document. Match the document-specific logical filename as a second,
            # structured signal so the diagnostic identifies that duplicate.
            file_path = str(details.get("file_path") or "")
            if not file_path.startswith(parent_doc_id + "__"):
                continue
        if details:
            result.duplicate_records.append(details)

    if (
        len(result.committed_child_ids) != len(expected)
        or result.missing_child_ids
        or result.failed_children
    ):
        raise PurgeError(
            "LIGHTRAG_INSERT_NOT_COMMITTED",
            f"LightRAG committed {len(result.committed_child_ids)}/{len(expected)} "
            f"children for document {parent_doc_id}.",
            verification={
                "expected_child_ids": result.expected_child_ids,
                "committed_child_ids": result.committed_child_ids,
                "missing_child_ids": result.missing_child_ids,
                "failed_children": result.failed_children,
                "duplicate_records": result.duplicate_records,
            },
        )

    return result


# ── Main entry point ─────────────────────────────────────────────────────────


async def purge_application_document(
    rag,
    parent_doc_id: str,
    operation_id: str = "",
    *,
    assert_lock_owned=None,
) -> PurgeResult:
    """Purge all LightRAG contributions for an application document.

    This is the SINGLE source of truth for document removal — used by both
    graph reindex (rag_index.py) and permanent deletion (rag_manage.py).

    The caller MUST hold the per-user mutation lock. If ``assert_lock_owned``
    is provided, it is called at critical checkpoints to verify ownership.

    Args:
        rag: An initialized LightRAG instance.
        parent_doc_id: The application document ID (e.g. a UUID).
        operation_id: Unique operation ID for diagnostics/checkpointing.
        assert_lock_owned: Optional callable that raises if the lock is lost.

    Returns:
        PurgeResult with details of what was removed.

    Raises:
        PurgeError: If purge cannot proceed (missing metadata, pipeline busy,
                    version mismatch). The caller must NOT continue to reinsert.
    """
    _check_guard()

    from lightrag.base import DocStatus

    prefix = parent_doc_id + "/"

    # ---- 1. Discover child documents ----
    all_docs = await rag.doc_status.get_docs_by_statuses(list(DocStatus))
    child_doc_ids = sorted(
        key for key in all_docs
        if key == parent_doc_id or key.startswith(prefix)
    )
    child_doc_id_set = set(child_doc_ids)
    duplicate_record_ids = sorted(
        key
        for key, record in all_docs.items()
        if key.startswith("dup-")
        and isinstance(record, dict)
        and (details := _duplicate_details(key, record)) is not None
        and details.get("original_doc_id") in child_doc_id_set
    )

    result = PurgeResult(
        parent_doc_id=parent_doc_id,
        child_doc_ids=child_doc_ids,
        duplicate_record_ids=duplicate_record_ids,
    )

    if not child_doc_ids:
        # Fresh document — nothing to purge.
        result.purged = True
        return result

    if assert_lock_owned:
        assert_lock_owned()

    # ---- 2. Collect real internal chunk IDs and graph metadata ----
    aggregate_chunk_ids: list[str] = []
    aggregate_entity_names: set[str] = set()
    aggregate_relation_pairs: set[tuple[str, str]] = set()

    for child_id in child_doc_ids:
        child_status = await rag.doc_status.get_by_id(child_id)
        if not child_status:
            raise PurgeError(
                "METADATA_MISSING",
                f"doc_status for child {child_id} disappeared during purge. "
                f"Workspace may be inconsistent — use knowledge-base reset.",
                child_id=child_id,
            )

        # Collect real internal chunk IDs from chunks_list.
        chunks_list = child_status.get("chunks_list", [])
        if not chunks_list:
            raise PurgeError(
                "CHUNKS_LIST_MISSING",
                f"Child {child_id} has no chunks_list in doc_status. Cannot "
                f"determine real internal chunk IDs for source-aware purge. "
                f"Use knowledge-base reset to rebuild.",
                child_id=child_id,
            )
        for cid in chunks_list:
            if cid not in aggregate_chunk_ids:
                aggregate_chunk_ids.append(cid)

        # Collect graph metadata from full_entities / full_relations.
        child_entities = await rag.full_entities.get_by_id(child_id)
        if child_entities and "entity_names" in child_entities:
            aggregate_entity_names.update(child_entities["entity_names"])

        child_relations = await rag.full_relations.get_by_id(child_id)
        if child_relations and "relation_pairs" in child_relations:
            for pair in child_relations["relation_pairs"]:
                aggregate_relation_pairs.add(tuple(pair))

    result.chunk_ids = aggregate_chunk_ids
    result.affected_entities = len(aggregate_entity_names)
    result.affected_relations = len(aggregate_relation_pairs)

    if assert_lock_owned:
        assert_lock_owned()

    # ---- 3. Stage aggregate metadata under a temporary key ----
    # _purge_doc_chunks_and_kg reads full_entities[doc_id] and
    # full_relations[doc_id] to find affected graph items. Since our data is
    # spread across multiple child IDs, we aggregate them into one temp key.
    safe_hash = hashlib.sha256(parent_doc_id.encode()).hexdigest()[:16]
    purge_key = f"__synthetix_purge__/{safe_hash}/{operation_id or 'op'}"

    await rag.full_entities.upsert({
        purge_key: {"entity_names": sorted(aggregate_entity_names)},
    })
    await rag.full_relations.upsert({
        purge_key: {"relation_pairs": sorted(aggregate_relation_pairs)},
    })

    try:
        # ---- 4. Run the source-aware purge ONCE ----
        async with _pipeline_reservation(rag, f"Purging document {parent_doc_id}") as (ps, ps_lock):
            await rag._purge_doc_chunks_and_kg(
                purge_key,
                aggregate_chunk_ids,
                pipeline_status=ps,
                pipeline_status_lock=ps_lock,
            )

        if assert_lock_owned:
            assert_lock_owned()

        # ---- 5. Delete child metadata ----
        # Duplicate-attempt records contain no chunks or graph metadata, but they
        # must be removed from doc_status or LightRAG's filename lookup can use a
        # stale failed row to reject the immediate reinsert.
        await rag.doc_status.delete(child_doc_ids + duplicate_record_ids)
        await rag.full_docs.delete(child_doc_ids)
        await rag.full_entities.delete(child_doc_ids)
        await rag.full_relations.delete(child_doc_ids)

        # ---- 6. Flush ----
        await rag._insert_done()

        if assert_lock_owned:
            assert_lock_owned()

        result.purged = True
        return result

    finally:
        # Clean up the temporary aggregate key if it survived (e.g. on error
        # before purge completed). Best-effort.
        try:
            await rag.full_entities.delete([purge_key])
            await rag.full_relations.delete([purge_key])
        except Exception:
            pass
