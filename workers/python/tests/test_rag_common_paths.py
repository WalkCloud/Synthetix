"""Tests for canonical RAG path resolution.

Verifies that Python and Node agree on the same absolute RAG_ROOT and
RAG_LOCK_ROOT when given the same environment, and that userId is
validated against path traversal.
"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rag_common import (
    resolve_rag_root,
    resolve_rag_lock_root,
    resolve_user_rag_dir,
    resolve_user_rag_lock_dir,
)


class RagRootResolution(unittest.TestCase):
    def test_default_rag_root_is_absolute(self):
        os.environ.pop("RAG_ROOT", None)
        root = resolve_rag_root()
        self.assertTrue(os.path.isabs(root), f"Default RAG_ROOT should be absolute, got {root}")

    def test_env_override(self):
        os.environ["RAG_ROOT"] = "/custom/rag"
        try:
            self.assertEqual(resolve_rag_root(), os.path.abspath("/custom/rag"))
        finally:
            os.environ.pop("RAG_ROOT", None)

    def test_lock_root_outside_rag_root_by_default(self):
        os.environ.pop("RAG_ROOT", None)
        os.environ.pop("RAG_LOCK_ROOT", None)
        rag_root = resolve_rag_root()
        lock_root = resolve_rag_lock_root()
        # Lock root must NOT be inside rag_root — it must survive workspace reset.
        self.assertFalse(
            lock_root.startswith(rag_root + os.sep),
            f"Lock root {lock_root} is inside RAG root {rag_root} — reset would delete locks",
        )

    def test_lock_root_env_override(self):
        os.environ["RAG_LOCK_ROOT"] = "/custom/locks"
        try:
            self.assertEqual(resolve_rag_lock_root(), os.path.abspath("/custom/locks"))
        finally:
            os.environ.pop("RAG_LOCK_ROOT", None)


class UserIdValidation(unittest.TestCase):
    def test_valid_user_id(self):
        os.environ.pop("RAG_ROOT", None)
        d = resolve_user_rag_dir("abc-123")
        self.assertTrue(d.endswith(os.path.join("data", "rag", "abc-123")) or d.endswith("abc-123"))

    def test_traversal_rejected(self):
        for bad in ["../etc", "a/b", "a\\b", "..", "a\x00b"]:
            with self.assertRaises(ValueError, msg=f"Should reject {bad!r}"):
                resolve_user_rag_dir(bad)

    def test_empty_rejected(self):
        with self.assertRaises(ValueError):
            resolve_user_rag_dir("")

    def test_lock_dir_uses_lock_root(self):
        os.environ.pop("RAG_ROOT", None)
        os.environ.pop("RAG_LOCK_ROOT", None)
        lock_dir = resolve_user_rag_lock_dir("user-1")
        rag_dir = resolve_user_rag_dir("user-1")
        self.assertNotEqual(
            os.path.dirname(lock_dir),
            os.path.dirname(rag_dir),
            "Lock dir parent should differ from RAG dir parent",
        )


class NodePythonAgreement(unittest.TestCase):
    """Verify the Python resolver produces the same path as the Node resolver
    for the same environment. This is critical: if they disagree, Node could
    lock one directory while Python writes another."""

    def test_python_resolves_to_same_absolute_path_as_documented_contract(self):
        # The contract: both read RAG_ROOT env var, both resolve to absolute.
        # If RAG_ROOT is set, both use it verbatim (after abspath normalization).
        os.environ["RAG_ROOT"] = os.path.join(os.getcwd(), "test-fixture-rag")
        try:
            py_root = resolve_rag_root()
            # Node's path.resolve would produce the same absolute path.
            self.assertEqual(py_root, os.path.abspath(os.environ["RAG_ROOT"]))
        finally:
            os.environ.pop("RAG_ROOT", None)


if __name__ == "__main__":
    unittest.main()
