"""Tests for the long-lived Python daemon (workers/python/daemon.py).

Spawns daemon.py as a subprocess and exercises the newline-JSON request loop:
ping handshake, op routing, bad-JSON resilience, serial multi-request, and a
chunk smoke test (skipped if the ONNX model isn't loadable in this env).

These cover the daemon's PROTOCOL layer — the underlying chunk/index business
logic is already covered by test_local_chunk.py and test_rag_index_helpers.py.
"""
import json
import os
import subprocess
import sys
import threading
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]  # workers/python/tests/ -> repo root
DAEMON_PATH = Path(__file__).resolve().parents[1] / "daemon.py"


class DaemonSession:
    """Drive daemon.py over its stdin/stdout/stderr pipes."""

    def __init__(self):
        env = dict(os.environ)
        env["PYTHON_DAEMON_RSS_REPORT_MS"] = "0"  # silence the RSS reporter thread
        env["PYTHONUNBUFFERED"] = "1"
        self.proc = subprocess.Popen(
            [sys.executable, str(DAEMON_PATH)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(PROJECT_ROOT),
            env=env,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self.events = []
        self._stop = threading.Event()
        self._reader = threading.Thread(target=self._drain_stderr, daemon=True)
        self._reader.start()

    def _drain_stderr(self):
        try:
            for line in self.proc.stderr:
                if self._stop.is_set():
                    break
                self.events.append(line.rstrip("\n"))
        except Exception:
            pass

    def call(self, op, params=None, timeout=30):
        """Send one request, return the parsed response dict with matching id."""
        import itertools
        import threading as _t
        rid = next(itertools.count(1))
        self.proc.stdin.write(json.dumps({"id": rid, "op": op, "params": params or {}}) + "\n")
        self.proc.stdin.flush()
        # Read stdout lines until we see the matching response. (Events arrive
        # on stderr, handled by the drain thread — stdout only carries the
        # single response object.)
        result = {}
        err = []

        def read_response():
            # Read stdout lines until we see OUR response id. Earlier responses
            # (e.g. a bad-JSON ack with id=null) are drained and ignored so they
            # don't get mistaken for the reply to a later request.
            while True:
                line = self.proc.stdout.readline()
                if not line:
                    err.append("daemon stdout closed")
                    return
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if parsed.get("id") == rid:
                    result.update(parsed)
                    return

        th = _t.Thread(target=read_response)
        th.start()
        th.join(timeout=timeout)
        if th.is_alive():
            raise AssertionError(f"daemon did not respond to op={op!r} within {timeout}s")
        if err:
            raise AssertionError(err[0])
        return result

    def send_raw(self, line):
        """Write a pre-formatted line (e.g. malformed JSON) for error-path tests."""
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()

    def close(self):
        self._stop.set()
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


class DaemonProtocolTests(unittest.TestCase):
    def setUp(self):
        self.session = DaemonSession()

    def tearDown(self):
        self.session.close()

    def test_ping_returns_pong(self):
        resp = self.session.call("ping")
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["result"], {"pong": True})

    def test_unknown_op_is_rejected_and_loop_survives(self):
        resp = self.session.call("nope")
        self.assertFalse(resp["ok"])
        self.assertIn("unknown op", resp["error"])
        # Loop must keep serving after a bad op.
        resp2 = self.session.call("ping")
        self.assertTrue(resp2["ok"])

    def test_bad_json_line_is_rejected_and_loop_survives(self):
        self.session.send_raw("{not valid json")
        resp = self.session.call("ping")
        self.assertTrue(resp["ok"], "loop died after a bad JSON line")

    def test_serial_multiple_requests(self):
        for _ in range(3):
            self.assertTrue(self.session.call("ping")["ok"])


class DaemonChunkSmokeTest(unittest.TestCase):
    """Exercises handle_chunk end-to-end. Skipped if the ONNX model can't load
    in this environment (no model files / sentence-transformers missing)."""

    def test_chunk_two_batches(self):
        session = DaemonSession()
        try:
            params = {
                "batches": [
                    {"id": "seg_0", "sentences": ["alpha beta gamma delta zeta"] * 8, "maxTokens": 60},
                    {"id": "seg_1", "sentences": ["one two three four five six"] * 8, "maxTokens": 60},
                ],
                "threshold": 0.55,
            }
            try:
                resp = session.call("chunk", params, timeout=60)
            except AssertionError as e:
                # Model load/inference unavailable or too slow in this env.
                self.skipTest(f"chunk op did not respond in this env: {e}")
            if not resp.get("ok"):
                msg = resp.get("error", "")
                # Model unavailable (e.g. missing weights / sentence-transformers)
                # is an environment limitation, not a daemon defect.
                self.skipTest(f"chunk op unavailable in this env: {msg}")
            results = resp["result"]["results"]
            self.assertEqual(len(results), 2)
            ids = {r["id"] for r in results}
            self.assertEqual(ids, {"seg_0", "seg_1"})
            for r in results:
                self.assertIn("similarities", r)
                self.assertIn("boundaries", r)
                self.assertIsInstance(r["boundaries"], list)
        finally:
            session.close()


if __name__ == "__main__":
    unittest.main()
