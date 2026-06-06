import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rag_index import indexing_lock, insert_chunks


class FakeRag:
    def __init__(self, reject_bulk=False):
        self.reject_bulk = reject_bulk
        self.calls = []

    async def ainsert(self, contents, ids=None, file_paths=None):
        if self.reject_bulk and isinstance(contents, list):
            raise TypeError("bulk input unsupported")
        self.calls.append((contents, ids, file_paths))


class RagIndexHelperTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
