"""Cross-document source isolation test for the aggregate purge adapter.

This is the PRIMARY correctness test for the cross-document data-loss bug.
It verifies that purging document B's LightRAG contributions:
- Removes B-only entities and relations.
- Preserves A-only and C-only entities and relations.
- Preserves shared entities (A+B, B+C) with their non-B sources intact.

The test uses a FakeLightRAG that simulates the key storage operations
(_purge_doc_chunks_and_kg, doc_status, full_entities, full_relations)
so we can verify the adapter's behavior without a real LightRAG instance
(which requires LLM calls for entity rebuild).

The FakeLightRAG._purge_doc_chunks_and_kg simulates source-aware cleanup:
it reads the aggregate metadata key's entity_names/relation_pairs, then
for each item checks whether it still has sources from OTHER documents.
"""
import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
from contextlib import asynccontextmanager

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class FakeStorage:
    """Simple in-memory dict-based storage simulating JsonKVStorage."""

    def __init__(self):
        self._data = {}

    async def get_by_id(self, key):
        return self._data.get(key)

    async def delete(self, keys):
        for k in keys:
            self._data.pop(k, None)

    async def upsert(self, data):
        self._data.update(data)

    async def get_all(self):
        return dict(self._data)

    async def get_docs_by_statuses(self, statuses):
        return dict(self._data)

    def snapshot(self):
        return dict(self._data)


class FakeLightRAG:
    """Simulates enough of LightRAG 1.5.4 to test the purge adapter.

    The key simulation is _purge_doc_chunks_and_kg: it reads the aggregate
    metadata to find affected entities/relations, then removes the purged
    chunk IDs from their source tracking. Items with no remaining sources
    are conceptually deleted (we mark them); items with other-doc sources
    survive.
    """

    def __init__(self):
        self.workspace = "test"
        self.doc_status = FakeStorage()
        self.full_docs = FakeStorage()
        self.full_entities = FakeStorage()
        self.full_relations = FakeStorage()
        # entity_chunks: { entity_name: { "chunk_ids": [...] } }
        self._entity_chunks = {}
        # relation_chunks: { "src|tgt": { "chunk_ids": [...] } }
        self._relation_chunks = {}

    async def _purge_doc_chunks_and_kg(self, doc_id, chunk_ids, *, pipeline_status, pipeline_status_lock):
        """Simulate source-aware purge: remove chunk_ids from entity/relation
        source tracking. Entities/relations with no remaining sources are
        removed; others survive with reduced sources."""
        chunk_set = set(chunk_ids)

        # Read aggregate metadata to find affected items.
        ent_data = await self.full_entities.get_by_id(doc_id)
        rel_data = await self.full_relations.get_by_id(doc_id)

        affected_entities = ent_data.get("entity_names", []) if ent_data else []
        affected_relations = [tuple(p) for p in (rel_data.get("relation_pairs", []) if rel_data else [])]

        # Remove purged chunk IDs from entity source tracking.
        for ent in affected_entities:
            if ent in self._entity_chunks:
                remaining = [c for c in self._entity_chunks[ent]["chunk_ids"] if c not in chunk_set]
                if remaining:
                    self._entity_chunks[ent]["chunk_ids"] = remaining
                else:
                    del self._entity_chunks[ent]  # no sources left → deleted

        # Remove purged chunk IDs from relation source tracking.
        for rel in affected_relations:
            key = f"{rel[0]}|{rel[1]}"
            if key in self._relation_chunks:
                remaining = [c for c in self._relation_chunks[key]["chunk_ids"] if c not in chunk_set]
                if remaining:
                    self._relation_chunks[key]["chunk_ids"] = remaining
                else:
                    del self._relation_chunks[key]

    async def _insert_done(self, **kw):
        pass  # no-op in memory


def _setup_three_doc_workspace(rag):
    """Set up a workspace with documents A, B, C.

    Entity topology:
      A_ONLY — only in doc A
      B_ONLY — only in doc B
      C_ONLY — only in doc C
      SHARED_AB — in docs A and B
      SHARED_BC — in docs B and C

    Relations:
      A_ONLY → SHARED_AB (sources: A, B)
      B_ONLY → SHARED_BC (sources: B, C)
    """
    docs = {
        "docA/chunk_000": {
            "status": "PROCESSED",
            "chunks_list": ["docA/chunk_000-chunk-000"],
        },
        "docB/chunk_000": {
            "status": "PROCESSED",
            "chunks_list": ["docB/chunk_000-chunk-000"],
        },
        "docC/chunk_000": {
            "status": "PROCESSED",
            "chunks_list": ["docC/chunk_000-chunk-000"],
        },
    }
    rag.doc_status._data = docs

    full_entities = {
        "docA/chunk_000": {"entity_names": ["A_ONLY", "SHARED_AB"]},
        "docB/chunk_000": {"entity_names": ["B_ONLY", "SHARED_AB", "SHARED_BC"]},
        "docC/chunk_000": {"entity_names": ["C_ONLY", "SHARED_BC"]},
    }
    rag.full_entities._data = full_entities

    full_relations = {
        "docA/chunk_000": {"relation_pairs": [("A_ONLY", "SHARED_AB")]},
        "docB/chunk_000": {"relation_pairs": [("B_ONLY", "SHARED_BC")]},
        "docC/chunk_000": {"relation_pairs": []},
    }
    rag.full_relations._data = full_relations

    # Entity source tracking (what _purge modifies).
    rag._entity_chunks = {
        "A_ONLY": {"chunk_ids": ["docA/chunk_000-chunk-000"]},
        "B_ONLY": {"chunk_ids": ["docB/chunk_000-chunk-000"]},
        "C_ONLY": {"chunk_ids": ["docC/chunk_000-chunk-000"]},
        "SHARED_AB": {"chunk_ids": ["docA/chunk_000-chunk-000", "docB/chunk_000-chunk-000"]},
        "SHARED_BC": {"chunk_ids": ["docB/chunk_000-chunk-000", "docC/chunk_000-chunk-000"]},
    }

    # Relation source tracking.
    rag._relation_chunks = {
        "A_ONLY|SHARED_AB": {"chunk_ids": ["docA/chunk_000-chunk-000", "docB/chunk_000-chunk-000"]},
        "B_ONLY|SHARED_BC": {"chunk_ids": ["docB/chunk_000-chunk-000", "docC/chunk_000-chunk-000"]},
    }


class CrossDocumentPurgeIsolation(unittest.TestCase):
    """The PRIMARY test: purging B preserves A and C."""

    def test_purge_B_preserves_A_and_C_sources(self):
        rag = FakeLightRAG()
        _setup_three_doc_workspace(rag)

        # Snapshot before purge.
        ent_before = set(rag._entity_chunks.keys())
        rel_before = set(rag._relation_chunks.keys())

        # Mock pipeline reservation (no real LightRAG shared storage).
        @asynccontextmanager
        async def fake_reservation(rag, job_name):
            yield {"busy": False}, MagicMock()

        from lightrag_adapter import purge_application_document
        with patch("lightrag_adapter._pipeline_reservation", fake_reservation):
            result = asyncio.run(purge_application_document(rag, "docB"))

        # Purge succeeded.
        self.assertTrue(result.purged)
        self.assertEqual(result.child_doc_ids, ["docB/chunk_000"])

        # B_ONLY entity is gone (was only in B).
        self.assertNotIn("B_ONLY", rag._entity_chunks)

        # A_ONLY and C_ONLY survive.
        self.assertIn("A_ONLY", rag._entity_chunks)
        self.assertIn("C_ONLY", rag._entity_chunks)

        # SHARED_AB survives with only A's source.
        self.assertIn("SHARED_AB", rag._entity_chunks)
        self.assertEqual(
            rag._entity_chunks["SHARED_AB"]["chunk_ids"],
            ["docA/chunk_000-chunk-000"],
        )

        # SHARED_BC survives with only C's source.
        self.assertIn("SHARED_BC", rag._entity_chunks)
        self.assertEqual(
            rag._entity_chunks["SHARED_BC"]["chunk_ids"],
            ["docC/chunk_000-chunk-000"],
        )

        # B_ONLY|SHARED_BC relation: B's source removed, C's source survives.
        # The relation itself still exists (it has C's source). The real
        # LightRAG _purge would also check if B_ONLY entity still exists and
        # cascade-delete edges to deleted entities, but our simulation only
        # does source subtraction (which is what the adapter delegates).
        self.assertIn("B_ONLY|SHARED_BC", rag._relation_chunks)
        self.assertEqual(
            rag._relation_chunks["B_ONLY|SHARED_BC"]["chunk_ids"],
            ["docC/chunk_000-chunk-000"],
        )

        # A_ONLY|SHARED_AB relation: B was NOT in B's full_relations, so B's
        # purge does not touch this relation's sources. It retains both sources.
        # (In real LightRAG, if B_ONLY entity is deleted, edges to it cascade,
        # but A_ONLY|SHARED_AB connects A_ONLY and SHARED_AB, neither of which
        # is B_ONLY, so this edge is unaffected.)
        self.assertIn("A_ONLY|SHARED_AB", rag._relation_chunks)
        self.assertEqual(len(rag._relation_chunks["A_ONLY|SHARED_AB"]["chunk_ids"]), 2)

        # doc_status, full_entities, full_relations for B are deleted.
        self.assertNotIn("docB/chunk_000", rag.doc_status._data)
        self.assertNotIn("docB/chunk_000", rag.full_entities._data)
        self.assertNotIn("docB/chunk_000", rag.full_relations._data)

        # A and C metadata survive.
        self.assertIn("docA/chunk_000", rag.doc_status._data)
        self.assertIn("docC/chunk_000", rag.doc_status._data)

    def test_purge_A_preserves_B_and_C(self):
        """Symmetric test: purging A should preserve B and C."""
        rag = FakeLightRAG()
        _setup_three_doc_workspace(rag)

        @asynccontextmanager
        async def fake_reservation(rag, job_name):
            yield {"busy": False}, MagicMock()

        from lightrag_adapter import purge_application_document
        with patch("lightrag_adapter._pipeline_reservation", fake_reservation):
            result = asyncio.run(purge_application_document(rag, "docA"))

        self.assertTrue(result.purged)

        # A_ONLY gone, B_ONLY and C_ONLY survive.
        self.assertNotIn("A_ONLY", rag._entity_chunks)
        self.assertIn("B_ONLY", rag._entity_chunks)
        self.assertIn("C_ONLY", rag._entity_chunks)

        # SHARED_AB survives with B's source only.
        self.assertIn("SHARED_AB", rag._entity_chunks)
        self.assertEqual(
            rag._entity_chunks["SHARED_AB"]["chunk_ids"],
            ["docB/chunk_000-chunk-000"],
        )

        # SHARED_BC unchanged (A had no contribution).
        self.assertIn("SHARED_BC", rag._entity_chunks)
        self.assertEqual(len(rag._entity_chunks["SHARED_BC"]["chunk_ids"]), 2)

    def test_purge_C_preserves_A_and_B(self):
        """Symmetric test: purging C should preserve A and B."""
        rag = FakeLightRAG()
        _setup_three_doc_workspace(rag)

        @asynccontextmanager
        async def fake_reservation(rag, job_name):
            yield {"busy": False}, MagicMock()

        from lightrag_adapter import purge_application_document
        with patch("lightrag_adapter._pipeline_reservation", fake_reservation):
            result = asyncio.run(purge_application_document(rag, "docC"))

        self.assertTrue(result.purged)

        # C_ONLY gone.
        self.assertNotIn("C_ONLY", rag._entity_chunks)
        # A_ONLY, B_ONLY survive.
        self.assertIn("A_ONLY", rag._entity_chunks)
        self.assertIn("B_ONLY", rag._entity_chunks)
        # SHARED_BC survives with B's source.
        self.assertIn("SHARED_BC", rag._entity_chunks)
        self.assertEqual(
            rag._entity_chunks["SHARED_BC"]["chunk_ids"],
            ["docB/chunk_000-chunk-000"],
        )


if __name__ == "__main__":
    unittest.main()
