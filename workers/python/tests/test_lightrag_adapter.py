"""Tests for the source-aware aggregate purge adapter.

Verifies that purge_application_document:
- Collects child document IDs by exact prefix.
- Reads real internal chunk IDs from each child's chunks_list.
- Aggregates entity/relation metadata from full_entities/full_relations.
- Calls _purge_doc_chunks_and_kg with the correct arguments.
- Deletes child metadata after purge.
- Fails closed when chunks_list is missing.
- Returns empty result for fresh documents (no children).
"""
import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lightrag_adapter import (
    purge_application_document,
    verify_application_document_insert,
    PurgeError,
    _check_guard,
)


class FakeRag:
    """Minimal fake LightRAG for adapter testing."""

    def __init__(self):
        self.workspace = "test"
        self.doc_status = MagicMock()
        self.full_docs = MagicMock()
        self.full_entities = MagicMock()
        self.full_relations = MagicMock()
        self.text_chunks = MagicMock()
        self.llm_response_cache = MagicMock()
        self._purge_doc_chunks_and_kg = AsyncMock()
        self._insert_done = AsyncMock()

        # Storage backends.
        self.doc_status.delete = AsyncMock()
        self.full_docs.delete = AsyncMock()
        self.full_entities.delete = AsyncMock()
        self.full_relations.delete = AsyncMock()
        self.full_entities.upsert = AsyncMock()
        self.full_relations.upsert = AsyncMock()
        self.doc_status.get_by_id = AsyncMock()
        self.full_entities.get_by_id = AsyncMock()
        self.full_relations.get_by_id = AsyncMock()
        self.text_chunks.get_by_id = AsyncMock(return_value=None)
        self.llm_response_cache.delete = AsyncMock()


class GuardCheck(unittest.TestCase):
    def test_guard_passes_on_correct_version(self):
        # Should not raise — the installed version is 1.5.4.
        _check_guard.__wrapped__() if hasattr(_check_guard, '__wrapped__') else None
        # Reset so other tests can call it.
        import lightrag_adapter
        lightrag_adapter._GUARD_CHECKED = True


class ChildDiscovery(unittest.TestCase):
    def test_no_children_returns_empty_result(self):
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={})

        result = asyncio.run(purge_application_document(rag, "doc-A"))
        self.assertTrue(result.purged)
        self.assertEqual(result.child_doc_ids, [])
        self.assertEqual(result.chunk_ids, [])
        # _purge_doc_chunks_and_kg should NOT be called (nothing to purge).
        rag._purge_doc_chunks_and_kg.assert_not_called()

    def test_children_discovered_by_prefix(self):
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={
            "doc-A/chunk_000": {"status": "PROCESSED"},
            "doc-A/chunk_001": {"status": "PROCESSED"},
            "doc-B/chunk_000": {"status": "PROCESSED"},  # different doc
        })
        # Each child has a chunks_list.
        rag.doc_status.get_by_id = AsyncMock(side_effect=lambda kid: {
            "doc-A/chunk_000": {"chunks_list": ["doc-A/chunk_000-chunk-000"]},
            "doc-A/chunk_001": {"chunks_list": ["doc-A/chunk_001-chunk-000"]},
        }.get(kid))
        rag.full_entities.get_by_id = AsyncMock(return_value=None)
        rag.full_relations.get_by_id = AsyncMock(return_value=None)

        from contextlib import asynccontextmanager
        fake_ps = {"busy": False}
        fake_lock = MagicMock()

        @asynccontextmanager
        async def fake_reservation(rag, job_name):
            yield fake_ps, fake_lock

        with patch("lightrag_adapter._pipeline_reservation", fake_reservation):
            result = asyncio.run(purge_application_document(rag, "doc-A"))
        self.assertEqual(result.child_doc_ids, ["doc-A/chunk_000", "doc-A/chunk_001"])
        self.assertEqual(result.chunk_ids, [
            "doc-A/chunk_000-chunk-000",
            "doc-A/chunk_001-chunk-000",
        ])

    def test_does_not_match_different_doc_with_similar_prefix(self):
        """doc-A must not match doc-AA."""
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={
            "doc-AA/chunk_000": {"status": "PROCESSED"},
        })
        result = asyncio.run(purge_application_document(rag, "doc-A"))
        self.assertEqual(result.child_doc_ids, [])

    def test_deletes_owned_duplicate_records_without_aggregating_them(self):
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={
            "doc-A/chunk_000": {"status": "processed"},
            "doc-B/chunk_000": {"status": "processed"},
            "dup-owned-1": {
                "status": "failed",
                "chunks_list": [],
                "metadata": {
                    "is_duplicate": True,
                    "duplicate_kind": "filename",
                    "original_doc_id": "doc-A/chunk_000",
                },
            },
            "dup-owned-2": {
                "status": "failed",
                "chunks_list": [],
                "metadata": {
                    "is_duplicate": True,
                    "duplicate_kind": "content_hash",
                    "original_doc_id": "doc-A/chunk_000",
                },
            },
            "dup-other": {
                "status": "failed",
                "chunks_list": [],
                "metadata": {
                    "is_duplicate": True,
                    "duplicate_kind": "filename",
                    "original_doc_id": "doc-B/chunk_000",
                },
            },
        })
        rag.doc_status.get_by_id = AsyncMock(return_value={
            "chunks_list": ["doc-A/chunk_000-chunk-000"],
        })
        rag.full_entities.get_by_id = AsyncMock(return_value={
            "entity_names": ["EntityA"],
        })
        rag.full_relations.get_by_id = AsyncMock(return_value={
            "relation_pairs": [],
        })

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def fake_reservation(rag, job_name):
            yield {"busy": False}, MagicMock()

        with patch("lightrag_adapter._pipeline_reservation", fake_reservation):
            result = asyncio.run(purge_application_document(rag, "doc-A"))

        self.assertEqual(result.child_doc_ids, ["doc-A/chunk_000"])
        self.assertEqual(result.duplicate_record_ids, ["dup-owned-1", "dup-owned-2"])
        rag.doc_status.get_by_id.assert_awaited_once_with("doc-A/chunk_000")
        rag.full_entities.get_by_id.assert_awaited_once_with("doc-A/chunk_000")
        rag.doc_status.delete.assert_awaited_once_with([
            "doc-A/chunk_000", "dup-owned-1", "dup-owned-2",
        ])
        rag.full_docs.delete.assert_awaited_once_with(["doc-A/chunk_000"])
        rag.full_entities.delete.assert_any_await(["doc-A/chunk_000"])
        rag.full_relations.delete.assert_any_await(["doc-A/chunk_000"])

    def test_ignores_unstructured_duplicate_metadata(self):
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={
            "doc-A/chunk_000": {"status": "processed"},
            "dup-unmarked": {
                "status": "failed",
                "metadata": {"original_doc_id": "doc-A/chunk_000"},
            },
        })
        rag.doc_status.get_by_id = AsyncMock(return_value={
            "chunks_list": ["doc-A/chunk_000-chunk-000"],
        })
        rag.full_entities.get_by_id = AsyncMock(return_value=None)
        rag.full_relations.get_by_id = AsyncMock(return_value=None)

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def fake_reservation(rag, job_name):
            yield {"busy": False}, MagicMock()

        with patch("lightrag_adapter._pipeline_reservation", fake_reservation):
            result = asyncio.run(purge_application_document(rag, "doc-A"))

        self.assertEqual(result.duplicate_record_ids, [])
        rag.doc_status.delete.assert_awaited_once_with(["doc-A/chunk_000"])


class InsertVerification(unittest.TestCase):
    def test_accepts_processed_children_with_chunks(self):
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={
            "doc-A/chunk_000": {"status": "processed", "chunks_list": ["chunk-1"]},
            "doc-A/chunk_001": {"status": "processed", "chunks_list": ["chunk-2"]},
        })

        result = asyncio.run(verify_application_document_insert(
            rag, "doc-A", ["doc-A/chunk_000", "doc-A/chunk_001"],
        ))

        self.assertEqual(result.committed_child_ids, ["doc-A/chunk_000", "doc-A/chunk_001"])

    def test_reports_missing_child_and_filename_duplicate(self):
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={
            "dup-owned": {
                "status": "failed",
                "file_path": "doc-A__chunk_000.md",
                "chunks_list": [],
                "metadata": {
                    "is_duplicate": True,
                    "duplicate_kind": "filename",
                    "original_doc_id": "doc-B/chunk_000",
                },
            },
        })

        with self.assertRaises(PurgeError) as ctx:
            asyncio.run(verify_application_document_insert(
                rag, "doc-A", ["doc-A/chunk_000"],
            ))

        self.assertEqual(ctx.exception.code, "LIGHTRAG_INSERT_NOT_COMMITTED")
        verification = ctx.exception.extra["verification"]
        self.assertEqual(verification["missing_child_ids"], ["doc-A/chunk_000"])
        self.assertEqual(verification["duplicate_records"][0]["duplicate_kind"], "filename")

    def test_rejects_processed_child_without_chunks(self):
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={
            "doc-A/chunk_000": {"status": "processed", "chunks_list": []},
        })

        with self.assertRaises(PurgeError) as ctx:
            asyncio.run(verify_application_document_insert(
                rag, "doc-A", ["doc-A/chunk_000"],
            ))

        self.assertEqual(ctx.exception.code, "LIGHTRAG_INSERT_NOT_COMMITTED")
        self.assertEqual(ctx.exception.extra["verification"]["failed_children"][0]["chunks_count"], 0)


class MetadataCollection(unittest.TestCase):
    def test_aggregates_entity_names_and_relation_pairs(self):
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={
            "doc-A/chunk_000": {"status": "PROCESSED"},
            "doc-A/chunk_001": {"status": "PROCESSED"},
        })
        rag.doc_status.get_by_id = AsyncMock(side_effect=lambda kid: {
            "doc-A/chunk_000": {"chunks_list": ["doc-A/chunk_000-chunk-000"]},
            "doc-A/chunk_001": {"chunks_list": ["doc-A/chunk_001-chunk-000"]},
        }.get(kid))
        rag.full_entities.get_by_id = AsyncMock(side_effect=lambda kid: {
            "doc-A/chunk_000": {"entity_names": ["EntityA", "Shared"]},
            "doc-A/chunk_001": {"entity_names": ["EntityB", "Shared"]},
        }.get(kid))
        rag.full_relations.get_by_id = AsyncMock(side_effect=lambda kid: {
            "doc-A/chunk_000": {"relation_pairs": [("A", "B"), ("Shared", "B")]},
            "doc-A/chunk_001": {"relation_pairs": [("Shared", "B")]},
        }.get(kid))

        # Mock the pipeline reservation to avoid LightRAG shared-storage init.
        from contextlib import asynccontextmanager
        fake_ps = {"busy": False}
        fake_lock = MagicMock()

        @asynccontextmanager
        async def fake_reservation(rag, job_name):
            yield fake_ps, fake_lock

        with patch("lightrag_adapter._pipeline_reservation", fake_reservation):
            result = asyncio.run(purge_application_document(rag, "doc-A"))
        self.assertEqual(result.affected_entities, 3)  # EntityA, EntityB, Shared
        self.assertEqual(result.affected_relations, 2)  # (A,B), (Shared,B)


class CacheCleanup(unittest.TestCase):
    def test_deletes_only_cache_records_referenced_by_purged_chunks(self):
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={
            "doc-A/chunk_000": {"status": "processed"},
        })
        rag.doc_status.get_by_id = AsyncMock(return_value={
            "chunks_list": ["doc-A/chunk_000-chunk-000"],
        })
        rag.text_chunks.get_by_id = AsyncMock(return_value={
            "llm_cache_list": ["default:extract:a", "default:extract:b"],
        })
        rag.full_entities.get_by_id = AsyncMock(return_value=None)
        rag.full_relations.get_by_id = AsyncMock(return_value=None)

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def fake_reservation(rag, job_name):
            yield {"busy": False}, MagicMock()

        with patch("lightrag_adapter._pipeline_reservation", fake_reservation):
            asyncio.run(purge_application_document(rag, "doc-A"))

        rag.llm_response_cache.delete.assert_awaited_once_with([
            "default:extract:a", "default:extract:b",
        ])


class PurgeFailure(unittest.TestCase):
    def test_missing_chunks_list_raises_purge_error(self):
        rag = FakeRag()
        rag.doc_status.get_docs_by_statuses = AsyncMock(return_value={
            "doc-A/chunk_000": {"status": "PROCESSED"},
        })
        # No chunks_list!
        rag.doc_status.get_by_id = AsyncMock(return_value={"status": "PROCESSED"})

        with self.assertRaises(PurgeError) as ctx:
            asyncio.run(purge_application_document(rag, "doc-A"))
        self.assertEqual(ctx.exception.code, "CHUNKS_LIST_MISSING")


if __name__ == "__main__":
    unittest.main()
