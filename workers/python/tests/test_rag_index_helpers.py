import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rag_index import emit_progress, get_insert_batch_size, indexing_lock, insert_chunks, sort_chunk_files


class FakeRag:
    def __init__(self, reject_bulk=False):
        self.reject_bulk = reject_bulk
        self.calls = []

    async def ainsert(self, contents, ids=None, file_paths=None):
        if self.reject_bulk and isinstance(contents, list):
            raise TypeError("bulk input unsupported")
        self.calls.append((contents, ids, file_paths))


class RagIndexHelperTests(unittest.TestCase):
    def test_emit_progress_writes_json_progress_event(self):
        import io
        from unittest.mock import patch

        stderr = io.StringIO()
        with patch("sys.stderr", stderr):
            emit_progress("indexing", 50, "Extracting entities", processed=3, total=10)

        self.assertEqual(
            stderr.getvalue().strip(),
            '{"type": "progress", "stage": "indexing", "progress": 50, "message": "Extracting entities", "processed": 3, "total": 10}',
        )

    def test_graph_mode_uses_smaller_default_insert_batch(self):
        self.assertEqual(get_insert_batch_size("graph", {}), 5)
        self.assertEqual(get_insert_batch_size("basic", {}), 20)
        self.assertEqual(get_insert_batch_size("graph", {"LIGHTRAG_GRAPH_INSERT_BATCH_SIZE": "8"}), 8)

    def test_sort_chunk_files_uses_numeric_chunk_index(self):
        files = ["chunk_999.md", "chunk_1000.md", "chunk_101.md", "chunk_010.md", "full.md"]

        self.assertEqual(
            sort_chunk_files(files),
            ["chunk_010.md", "chunk_101.md", "chunk_999.md", "chunk_1000.md"],
        )

    def test_indexing_lock_is_removed_after_exception(self):
        with tempfile.TemporaryDirectory() as tmp:
            lock_path = os.path.join(tmp, ".indexing.lock")
            with self.assertRaises(RuntimeError):
                with indexing_lock(tmp, "doc-1"):
                    self.assertTrue(os.path.exists(lock_path))
                    raise RuntimeError("boom")

            self.assertFalse(os.path.exists(lock_path))

    def test_insert_chunks_uses_bulk_batches_when_supported(self):
        rag = FakeRag()
        chunks = [
            {"content": "a", "id": "doc/chunk_000", "path": "chunk_000.md"},
            {"content": "b", "id": "doc/chunk_001", "path": "chunk_001.md"},
            {"content": "c", "id": "doc/chunk_002", "path": "chunk_002.md"},
        ]

        indexed = asyncio.run(insert_chunks(rag, chunks, batch_size=2))

        self.assertEqual(indexed, 3)
        self.assertEqual(len(rag.calls), 2)
        self.assertEqual(rag.calls[0], (["a", "b"], ["doc/chunk_000", "doc/chunk_001"], ["chunk_000.md", "chunk_001.md"]))
        self.assertEqual(rag.calls[1], (["c"], ["doc/chunk_002"], ["chunk_002.md"]))

    def test_insert_chunks_reports_progress_after_each_batch(self):
        rag = FakeRag()
        chunks = [
            {"content": "a", "id": "doc/chunk_000", "path": "chunk_000.md"},
            {"content": "b", "id": "doc/chunk_001", "path": "chunk_001.md"},
            {"content": "c", "id": "doc/chunk_002", "path": "chunk_002.md"},
        ]
        progress = []

        indexed = asyncio.run(insert_chunks(rag, chunks, batch_size=2, on_progress=lambda done, total: progress.append((done, total))))

        self.assertEqual(indexed, 3)
        self.assertEqual(progress, [(2, 3), (3, 3)])

    def test_insert_chunks_falls_back_to_serial_when_bulk_is_unsupported(self):
        rag = FakeRag(reject_bulk=True)
        chunks = [
            {"content": "a", "id": "doc/chunk_000", "path": "chunk_000.md"},
            {"content": "b", "id": "doc/chunk_001", "path": "chunk_001.md"},
        ]

        indexed = asyncio.run(insert_chunks(rag, chunks, batch_size=2))

        self.assertEqual(indexed, 2)
        self.assertEqual(rag.calls, [
            ("a", "doc/chunk_000", "chunk_000.md"),
            ("b", "doc/chunk_001", "chunk_001.md"),
        ])

    def test_insert_chunks_uses_serial_when_force_serial_is_true(self):
        rag = FakeRag()
        chunks = [
            {"content": "a", "id": "doc/chunk_000", "path": "chunk_000.md"},
            {"content": "b", "id": "doc/chunk_001", "path": "chunk_001.md"},
        ]

        indexed = asyncio.run(insert_chunks(rag, chunks, batch_size=2, force_serial=True))

        self.assertEqual(indexed, 2)
        self.assertEqual(rag.calls, [
            ("a", "doc/chunk_000", "chunk_000.md"),
            ("b", "doc/chunk_001", "chunk_001.md"),
        ])


if __name__ == "__main__":
    unittest.main()
