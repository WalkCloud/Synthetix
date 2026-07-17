"""Tests for the per-user cross-process RAG mutation lock.

Verifies exclusive acquisition, token-safe release, stale-owner reclaim,
and that the lock survives a workspace reset (it lives outside RAG_ROOT).
"""
import asyncio
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class MutationLockBasics(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._patcher = patch.dict(os.environ, {
            "RAG_LOCK_ROOT": os.path.join(self._tmp, "locks"),
            "RAG_ROOT": os.path.join(self._tmp, "rag"),
        })
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        import shutil
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_acquire_and_release(self):
        from rag_mutation_lock import acquire_user_rag_lock
        async def run():
            lease = await acquire_user_rag_lock("user-1", operation="test")
            try:
                lock_dir = lease.lock_dir
                self.assertTrue(os.path.isdir(lock_dir))
                owner = json.load(open(os.path.join(lock_dir, "owner.json")))
                self.assertEqual(owner["operation"], "test")
                self.assertEqual(owner["userId"], "user-1")
            finally:
                await lease.release()
        asyncio.run(run())

    def test_same_user_cannot_acquire_twice(self):
        from rag_mutation_lock import acquire_user_rag_lock, RagMutationBusyError
        async def run():
            lease1 = await acquire_user_rag_lock("user-1", operation="test1")
            try:
                with self.assertRaises(RagMutationBusyError):
                    await acquire_user_rag_lock(
                        "user-1", operation="test2", wait_timeout_s=0.5
                    )
            finally:
                await lease1.release()
        asyncio.run(run())

    def test_different_users_can_hold_concurrently(self):
        from rag_mutation_lock import acquire_user_rag_lock
        async def run():
            lease1 = await acquire_user_rag_lock("user-A", operation="test")
            # user-B should be able to acquire immediately.
            lease2 = await acquire_user_rag_lock("user-B", operation="test")
            await lease1.release()
            await lease2.release()
        asyncio.run(run())

    def test_release_only_removes_own_lock(self):
        from rag_mutation_lock import acquire_user_rag_lock, RagMutationLease
        async def run():
            lease1 = await acquire_user_rag_lock("user-1", operation="test")
            # Simulate another process taking over by rewriting owner.json.
            owner_path = os.path.join(lease1.lock_dir, "owner.json")
            new_owner = json.load(open(owner_path))
            new_owner["token"] = "different-token"
            with open(owner_path, "w") as f:
                json.dump(new_owner, f)
            # Release should NOT delete the lock (token mismatch).
            await lease1.release()
            self.assertTrue(os.path.isdir(lease1.lock_dir),
                            "Release deleted a lock owned by a different token")
        asyncio.run(run())

    def test_assert_owned_detects_loss(self):
        from rag_mutation_lock import acquire_user_rag_lock, RagMutationLockLostError
        async def run():
            lease = await acquire_user_rag_lock("user-1", operation="test")
            # Tamper with the owner file.
            owner_path = os.path.join(lease.lock_dir, "owner.json")
            owner = json.load(open(owner_path))
            owner["token"] = "stolen"
            with open(owner_path, "w") as f:
                json.dump(owner, f)
            with self.assertRaises(RagMutationLockLostError):
                lease.assert_owned()
            await lease.release()
        asyncio.run(run())

    def test_lock_outside_rag_workspace(self):
        from rag_mutation_lock import acquire_user_rag_lock
        from rag_common import resolve_user_rag_dir
        async def run():
            lease = await acquire_user_rag_lock("user-1", operation="test")
            rag_dir = resolve_user_rag_dir("user-1")
            # Lock dir must NOT be inside the rag workspace.
            self.assertFalse(
                lease.lock_dir.startswith(rag_dir + os.sep),
                f"Lock {lease.lock_dir} is inside RAG workspace {rag_dir}"
            )
            await lease.release()
        asyncio.run(run())


class StaleReclaim(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._patcher = patch.dict(os.environ, {
            "RAG_LOCK_ROOT": os.path.join(self._tmp, "locks"),
            "RAG_ROOT": os.path.join(self._tmp, "rag"),
        })
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        import shutil
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_stale_lock_from_dead_process_can_be_reclaimed(self):
        from rag_mutation_lock import acquire_user_rag_lock
        from rag_common import resolve_user_rag_lock_dir
        # Manually create a stale lock with a dead PID.
        lock_dir = resolve_user_rag_lock_dir("user-1")
        os.makedirs(lock_dir)
        import datetime
        old_time = (datetime.datetime.now(datetime.timezone.utc) -
                     datetime.timedelta(hours=2)).isoformat()
        owner = {
            "version": 1,
            "token": "old-dead-token",
            "userId": "user-1",
            "pid": 999999,  # almost certainly not running
            "processStartIdentity": "999999:unknown",
            "operation": "graph-index",
            "acquiredAt": old_time,
            "heartbeatAt": old_time,
        }
        with open(os.path.join(lock_dir, "owner.json"), "w") as f:
            json.dump(owner, f)

        async def run():
            # Should succeed in reclaiming the stale lock.
            lease = await acquire_user_rag_lock(
                "user-1", operation="test", wait_timeout_s=2, stale_threshold_s=60
            )
            await lease.release()
        asyncio.run(run())

    def test_fresh_lock_is_not_reclaimed(self):
        from rag_mutation_lock import acquire_user_rag_lock, RagMutationBusyError
        from rag_common import resolve_user_rag_lock_dir
        # Create a fresh lock with the CURRENT process's PID.
        lock_dir = resolve_user_rag_lock_dir("user-1")
        os.makedirs(lock_dir)
        import datetime
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        from rag_mutation_lock import _process_start_identity
        owner = {
            "version": 1,
            "token": "fresh-live-token",
            "userId": "user-1",
            "pid": os.getpid(),
            "processStartIdentity": _process_start_identity(),
            "operation": "graph-index",
            "acquiredAt": now,
            "heartbeatAt": now,
        }
        with open(os.path.join(lock_dir, "owner.json"), "w") as f:
            json.dump(owner, f)

        async def run():
            # Current process IS alive, so the lock must NOT be reclaimed.
            with self.assertRaises(RagMutationBusyError):
                await acquire_user_rag_lock(
                    "user-1", operation="test", wait_timeout_s=1, stale_threshold_s=3600
                )
        asyncio.run(run())


class ContextManager(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._patcher = patch.dict(os.environ, {
            "RAG_LOCK_ROOT": os.path.join(self._tmp, "locks"),
            "RAG_ROOT": os.path.join(self._tmp, "rag"),
        })
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        import shutil
        shutil.rmtree(self._tmp, ignore_errors=True)

    async def test_context_manager_acquires_and_releases(self):
        from rag_mutation_lock import user_rag_mutation_lock, acquire_user_rag_lock, RagMutationBusyError
        async with user_rag_mutation_lock("user-1", operation="test") as lease:
            lease.assert_owned()
            # Second acquisition should fail.
            with self.assertRaises(RagMutationBusyError):
                await acquire_user_rag_lock("user-1", operation="test2", wait_timeout_s=0.5)
        # After context exit, lock is released.
        async with user_rag_mutation_lock("user-1", operation="test2"):
            pass


if __name__ == "__main__":
    unittest.main()
