"""Fail-closed regression tests for RAG storage safety.

These tests verify that routine Python workers (rag_index, rag_manage,
rag_query) no longer perform implicit destructive recovery on shared
per-user LightRAG storage:

  - Embedding dimension mismatch must NOT rmtree the user workspace.
  - Corrupt JSON/GraphML must NOT be deleted or reset to {}.
  - Query must NOT delete a writer's .indexing.lock marker.
  - delete-by-doc must NOT wipe the entire working directory when
    doc_status reports empty.

The tests construct synthetic workspaces with sentinel files, invoke the
relevant code path, and assert that every pre-existing file remains
byte-for-byte unchanged.

Run:
    python -m unittest workers.python.tests.test_rag_failure_safety -v
"""
import asyncio
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _file_hashes(directory: str) -> dict[str, str]:
    """Return {relative_path: sha256} for every file under directory."""
    result = {}
    for dirpath, _, filenames in os.walk(directory):
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, directory)
            with open(full, "rb") as f:
                result[rel.replace(os.sep, "/")] = hashlib.sha256(f.read()).hexdigest()
    return result


class EmbeddingMismatchPreservesWorkspace(unittest.TestCase):
    """rag_index must not rmtree working_dir on embedding dim mismatch."""

    def test_mismatch_returns_error_without_destroying_workspace(self):
        from rag_index import index_document

        with tempfile.TemporaryDirectory() as tmp:
            working_dir = os.path.join(tmp, "data", "rag", "user-1")
            os.makedirs(working_dir)

            # Sentinel files representing OTHER documents' data.
            sentinel_content = json.dumps({"doc-A/chunk_000": {"content": "A"}})
            sentinel_path = os.path.join(working_dir, "kv_store_full_docs.json")
            with open(sentinel_path, "w", encoding="utf-8") as f:
                f.write(sentinel_content)

            before = _file_hashes(tmp)

            # Simulate LightRAG() raising an embedding dim mismatch.
            mismatch_err = Exception(
                "Embedding dim mismatch: expected: 1024, got: 2048"
            )

            with patch("rag_index.LightRAG", side_effect=mismatch_err):
                with patch("rag_index.load_storage_config", return_value=(
                    "JsonKVStorage", "NanoVectorDBStorage",
                    "NetworkXStorage", "JsonDocStatusStorage", {}
                )):
                    with patch("rag_index.resolve_embed_dim", return_value=2048):
                        with patch("rag_index.build_rerank_func", return_value=None):
                            result = asyncio.run(index_document(
                                doc_id="doc-B",
                                user_id="user-1",
                                chunks_dir=os.path.join(tmp, "chunks"),
                                index_mode="basic",
                                embed_dim=2048,
                            ))

            # Must return a stable error, not auto-reset.
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["code"], "EMBEDDING_DIMENSION_MISMATCH")
            self.assertTrue(result.get("requires_reset"))

            # Every file must be unchanged — the workspace was NOT wiped.
            after = _file_hashes(tmp)
            self.assertEqual(before, after, "Workspace files changed on mismatch")

    def test_generic_expected_substring_does_not_trigger_wipe(self):
        """The old code used a broad 'expected:' substring match. A generic
        error containing 'expected:' but unrelated to embeddings must NOT
        destroy the workspace either."""
        from rag_index import index_document

        with tempfile.TemporaryDirectory() as tmp:
            working_dir = os.path.join(tmp, "data", "rag", "user-1")
            os.makedirs(working_dir)
            with open(os.path.join(working_dir, "kv_store_doc_status.json"), "w") as f:
                json.dump({"doc-A": {"status": "processed"}}, f)

            before = _file_hashes(tmp)

            # Error contains 'expected:' but is NOT an embedding mismatch.
            generic_err = Exception("expected: 2 arguments but got 1")

            with patch("rag_index.LightRAG", side_effect=generic_err):
                with patch("rag_index.load_storage_config", return_value=(
                    "JsonKVStorage", "NanoVectorDBStorage",
                    "NetworkXStorage", "JsonDocStatusStorage", {}
                )):
                    with patch("rag_index.resolve_embed_dim", return_value=1024):
                        with patch("rag_index.build_rerank_func", return_value=None):
                            with self.assertRaises(Exception):
                                asyncio.run(index_document(
                                    doc_id="doc-B",
                                    user_id="user-1",
                                    chunks_dir=os.path.join(tmp, "chunks"),
                                    index_mode="basic",
                                    embed_dim=1024,
                                ))

            after = _file_hashes(tmp)
            self.assertEqual(before, after, "Workspace changed on generic error")


class QueryDoesNotDeleteWriterLock(unittest.TestCase):
    """rag_query must never delete .indexing.lock, even if it looks stale."""

    def test_old_lock_is_not_removed(self):
        from rag_query import query_rag

        with tempfile.TemporaryDirectory() as tmp:
            # query_rag resolves its workspace via resolve_user_rag_dir, which
            # reads RAG_ROOT. Point RAG_ROOT at the temp tree so the query
            # reads/writes the same dir we seeded the stale lock in.
            rag_root = os.path.join(tmp, "rag")
            rag_dir = os.path.join(rag_root, "user-1")
            os.makedirs(rag_dir)

            # Create a lock file with an OLD mtime (2 hours ago).
            lock_path = os.path.join(rag_dir, ".indexing.lock")
            with open(lock_path, "w") as f:
                f.write("doc-old")
            old_mtime = os.path.getmtime(lock_path) - 7200  # 2 hours ago
            os.utime(lock_path, (old_mtime, old_mtime))

            # Create minimal valid docs file so health check passes the
            # "no data" guard.
            with open(os.path.join(rag_dir, "kv_store_full_docs.json"), "w") as f:
                json.dump({"doc-A": {}}, f)

            old_env = os.environ.get("RAG_ROOT")
            os.environ["RAG_ROOT"] = rag_root
            try:
                # query_rag will fail at LightRAG init, but we only care that
                # the lock file survives the quick health check (which used to
                # delete stale locks by mtime age).
                try:
                    asyncio.run(query_rag(
                        user_id="user-1",
                        query_text="test",
                        mode="local",
                        embed_api_base="",
                        embed_api_key="",
                        embed_model="x",
                        embed_dim=1024,
                        llm_api_base="",
                        llm_api_key="",
                        llm_model="x",
                    ))
                except Exception:
                    pass  # LightRAG init may fail; lock survival is what matters
            finally:
                if old_env is None:
                    os.environ.pop("RAG_ROOT", None)
                else:
                    os.environ["RAG_ROOT"] = old_env

            # The lock file MUST still exist.
            self.assertTrue(
                os.path.exists(lock_path),
                "Query deleted a writer's .indexing.lock — this breaks long graph tasks",
            )


class StorageCorruptionIsFailClosed(unittest.TestCase):
    """rag_common.fix_corrupted_json_files must not be called from routine
    workers. When storage is genuinely corrupt, the error must surface, not
    silently reset files."""

    def test_fix_corrupted_json_files_not_imported_in_index(self):
        """rag_index.py must not import fix_corrupted_json_files."""
        import rag_index
        # The import line was removed; verify the name is not in the module's
        # namespace as a callable from rag_common.
        fn = getattr(rag_index, "fix_corrupted_json_files", None)
        # If it's still imported, it would be the rag_common function.
        if fn is not None:
            import rag_common
            self.assertIsNot(
                fn, rag_common.fix_corrupted_json_files,
                "rag_index still imports fix_corrupted_json_files — destructive repair is reachable",
            )

    def test_fix_corrupted_json_files_not_imported_in_manage(self):
        import rag_manage
        fn = getattr(rag_manage, "fix_corrupted_json_files", None)
        if fn is not None:
            import rag_common
            self.assertIsNot(
                fn, rag_common.fix_corrupted_json_files,
                "rag_manage still imports fix_corrupted_json_files — destructive repair is reachable",
            )


class DeleteByDocDoesNotWipeWorkspace(unittest.TestCase):
    """action_delete_by_doc must not rmtree the entire working directory."""

    def test_delete_succeeds_without_wiping_workspace(self):
        """action_delete_by_doc uses the adapter; it must return 'deleted'
        and must NOT wipe the working directory."""
        from rag_manage import action_delete_by_doc

        with tempfile.TemporaryDirectory() as tmp:
            rag = MagicMock()
            rag.working_dir = tmp

            # Mock the adapter to return a successful purge result.
            from lightrag_adapter import PurgeResult
            from contextlib import asynccontextmanager

            async def fake_purge(rag, doc_id, operation_id="", **kw):
                return PurgeResult(
                    parent_doc_id=doc_id,
                    child_doc_ids=[f"{doc_id}/chunk_000"],
                    chunk_ids=[f"{doc_id}/chunk_000-chunk-000"],
                    affected_entities=0,
                    affected_relations=0,
                    purged=True,
                )

            with patch("lightrag_adapter.purge_application_document", fake_purge):
                result = asyncio.run(action_delete_by_doc(rag, "doc-A"))

            # Must return deleted status, not wipe.
            self.assertEqual(result["status"], "deleted")
            self.assertNotIn("wiped_all", result)
            # working_dir must still exist.
            self.assertTrue(os.path.isdir(tmp))


class SoftDeleteFailureIsFailClosed(unittest.TestCase):
    """When purge fails, action_delete_by_doc must return a failed status
    with requires_reset, NOT silently succeed or hard-delete."""

    def test_purge_failure_returns_failed_not_hard_delete(self):
        from rag_manage import action_delete_by_doc
        from lightrag_adapter import PurgeError

        rag = MagicMock()
        rag.working_dir = "/tmp/nonexistent-test-dir"

        async def fake_purge_fails(rag, doc_id, operation_id="", **kw):
            raise PurgeError("CHUNKS_LIST_MISSING", "metadata broken")

        with patch("lightrag_adapter.purge_application_document", fake_purge_fails):
            result = asyncio.run(action_delete_by_doc(rag, "doc-A"))

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["code"], "CHUNKS_LIST_MISSING")
        self.assertTrue(result.get("requires_reset"))
        # Must NOT claim hard_delete_used.
        self.assertNotIn("hard_delete_used", result)


if __name__ == "__main__":
    unittest.main()
