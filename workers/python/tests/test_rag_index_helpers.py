import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adaptive_limiter import _is_rate_limit_error
from rag_index import (
    _call_graph_llm_with_connection_retry,
    _heartbeat_loop,
    _is_transient_llm_connection_error,
    build_lightrag_source_name,
    emit_progress,
    get_insert_batch_size,
    insert_chunks,
    should_bulk_insert_graph,
    sort_chunk_files,
)


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

    def test_graph_bulk_insert_is_default_on_with_opt_out(self):
        # Default is now ON (parallel bulk extraction). Opt out with =false.
        self.assertTrue(should_bulk_insert_graph({}))
        self.assertFalse(should_bulk_insert_graph({"LIGHTRAG_GRAPH_BULK_INSERT": "false"}))
        self.assertFalse(should_bulk_insert_graph({"LIGHTRAG_GRAPH_BULK_INSERT": "0"}))
        self.assertTrue(should_bulk_insert_graph({"LIGHTRAG_GRAPH_BULK_INSERT": "true"}))
        self.assertTrue(should_bulk_insert_graph({"LIGHTRAG_GRAPH_BULK_INSERT": "1"}))

    def test_sort_chunk_files_uses_numeric_chunk_index(self):
        files = ["chunk_999.md", "chunk_1000.md", "chunk_101.md", "chunk_010.md", "full.md"]

        self.assertEqual(
            sort_chunk_files(files),
            ["chunk_010.md", "chunk_101.md", "chunk_999.md", "chunk_1000.md"],
        )

    def test_lightrag_source_name_is_stable_and_document_unique(self):
        self.assertEqual(
            build_lightrag_source_name("doc-A", "chunk_000.md"),
            "doc-A__chunk_000.md",
        )
        self.assertEqual(
            build_lightrag_source_name("doc-A", os.path.join("nested", "chunk_000.md")),
            "doc-A__chunk_000.md",
        )
        self.assertNotEqual(
            build_lightrag_source_name("doc-A", "chunk_000.md"),
            build_lightrag_source_name("doc-B", "chunk_000.md"),
        )

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

    def test_connection_errors_are_treated_as_transient_graph_errors(self):
        errors = [
            RuntimeError("APIConnectionError: Connection error."),
            RuntimeError("httpcore.ConnectError: [Errno 11001] getaddrinfo failed"),
            RuntimeError("Temporary failure in name resolution"),
        ]

        for error in errors:
            self.assertTrue(_is_transient_llm_connection_error(error))
            self.assertTrue(_is_rate_limit_error(error))

    def test_graph_llm_connection_retry_succeeds_after_transient_error(self):
        calls = []
        sleeps = []

        async def call():
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("APIConnectionError: Connection error.")
            return "ok"

        async def sleep(seconds):
            sleeps.append(seconds)

        result = asyncio.run(_call_graph_llm_with_connection_retry(call, sleep_fn=sleep))

        self.assertEqual(result, "ok")
        self.assertEqual(len(calls), 2)
        self.assertEqual(sleeps, [2.0])

    def test_graph_llm_connection_retry_does_not_retry_permanent_errors(self):
        calls = []

        async def call():
            calls.append(1)
            raise RuntimeError("401 invalid api key")

        async def sleep(seconds):
            raise AssertionError("sleep should not be called")

        with self.assertRaises(RuntimeError):
            asyncio.run(_call_graph_llm_with_connection_retry(call, sleep_fn=sleep))

        self.assertEqual(len(calls), 1)


class HeartbeatLoopTests(unittest.TestCase):
    """The time-driven heartbeat emits progress every N seconds during indexing,
    so a single slow LLM call can't freeze lastHeartbeatAt past the Node-side
    stall threshold (queue.ts, 5 min)."""

    def test_emits_at_interval_with_latest_progress_state(self):
        # Use a fake sleep that yields once (so the event loop can run the
        # cancellation timer) and advances the shared state to simulate batches.
        emits = []
        state = {"done": 0, "total": 10}

        async def fake_sleep(seconds):
            # Advance the shared state on each "tick" to simulate batches completing.
            state["done"] = min(state["total"], state["done"] + 3)
            # Yield once so the outer cancellation timer can fire. Without this
            # the loop would busy-spin and OOM.
            await asyncio.sleep(0)

        def fake_emit(stage, progress, message, **extra):
            emits.append({"stage": stage, "progress": progress, "message": message, **extra})

        async def run():
            task = asyncio.create_task(_heartbeat_loop(state, 0.01, "Extracting", emit=fake_emit, sleep=fake_sleep))
            # Let it tick a few times, then cancel. Cap iterations via a timer.
            await asyncio.sleep(0.05)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        asyncio.run(run())
        # At least one heartbeat emitted (likely several with the fast fake sleep).
        self.assertGreaterEqual(len(emits), 1)
        # Every emit carries the indexing stage and current done/total.
        for e in emits:
            self.assertEqual(e["stage"], "indexing")
            self.assertEqual(e["message"], "Extracting")
            self.assertEqual(e["total"], 10)
            self.assertGreaterEqual(e["progress"], 40)
            self.assertLessEqual(e["progress"], 90)

    def test_progress_reflects_latest_state_not_initial(self):
        emits = []
        state = {"done": 0, "total": 4}
        tick = {"n": 0}

        async def fake_sleep(seconds):
            tick["n"] += 1
            state["done"] = min(state["total"], tick["n"])
            await asyncio.sleep(0)  # yield so cancellation timer can fire

        def fake_emit(stage, progress, message, **extra):
            emits.append(extra.get("processed", 0))

        async def run():
            task = asyncio.create_task(_heartbeat_loop(state, 0.01, "idx", emit=fake_emit, sleep=fake_sleep))
            await asyncio.sleep(0.05)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        asyncio.run(run())
        self.assertEqual(emits, sorted(emits))
        self.assertGreater(max(emits), 0)

    def test_cancellation_is_clean(self):
        state = {"done": 0, "total": 10}

        async def run():
            task = asyncio.create_task(_heartbeat_loop(state, 100.0, "idx"))
            await asyncio.sleep(0.01)  # let it start
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
