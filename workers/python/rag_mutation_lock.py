"""Per-user cross-process RAG mutation lock.

LightRAG storage is shared per-user: all documents for one user live in the
same set of JSON / NanoVectorDB / GraphML files. Therefore the correct
serialization granularity for mutations is the USER, not the document.

This module provides an exclusive lock acquired via atomic directory creation
(os.mkdir). Only one process can create the lock directory; FileExistsError
means another writer holds it. The lock lives OUTSIDE the user RAG workspace
(under RAG_LOCK_ROOT) so a workspace reset cannot erase an active lock.

Acquisition is NOT timeout-based stealing by default — a stale-looking lock is
only reclaimed when we can prove the owner process is dead (PID gone or
process-start-identity mismatch). This prevents stealing from a live but slow
writer (e.g. a 4-hour graph extraction).

Node implements the same protocol in src/lib/rag/mutation-lock.ts so either
runtime can acquire, heartbeat, and release the same lock.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional

from rag_common import resolve_user_rag_lock_dir


# ── Errors ───────────────────────────────────────────────────────────────────


class RagMutationBusyError(Exception):
    """Another writer holds the user lock and the wait budget was exhausted."""

    def __init__(self, user_id: str, owner: Optional[dict] = None):
        self.user_id = user_id
        self.owner = owner
        super().__init__(
            f"RAG workspace for user {user_id} is locked by another writer"
        )


class RagMutationLockLostError(Exception):
    """The current owner's lock was removed or taken over during mutation."""


# ── Process identity ─────────────────────────────────────────────────────────


def _process_start_identity() -> str:
    """Best-effort unique identity for THIS process start.

    PID alone is insufficient on Windows because PIDs are reused. We combine
    PID with process creation time (if obtainable) so a stale lock from a
    dead PID is distinguishable from a recycled PID belonging to a new process.
    """
    pid = os.getpid()
    try:
        # psutil is available in the project's Python env (used by daemon.py).
        import psutil  # type: ignore
        p = psutil.Process(pid)
        create_time = p.create_time()
        return f"{pid}:{create_time}"
    except Exception:
        pass
    # Windows fallback via ctypes.
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            class _FILETIME(ctypes.Structure):
                _fields_ = [("dwLowDateTime", wintypes.DWORD),
                            ("dwHighDateTime", wintypes.DWORD)]

            kernel32 = ctypes.windll.kernel32
            h = kernel32.GetCurrentProcess()
            creation = _FILETIME()
            exit_ft = _FILETIME()
            kernel_ft = _FILETIME()
            user_ft = _FILETIME()
            kernel32.GetProcessTimes(
                h, ctypes.byref(creation), ctypes.byref(exit_ft),
                ctypes.byref(kernel_ft), ctypes.byref(user_ft),
            )
            stamp = (creation.dwHighDateTime << 32) | creation.dwLowDateTime
            return f"{pid}:{stamp}"
        except Exception:
            pass
    # Last resort: PID + start bootstrap time approximation.
    return f"{pid}:unknown"


def _is_pid_alive(pid: int, start_identity: str) -> bool:
    """Check if a process with the given PID AND start identity is still running."""
    try:
        import psutil  # type: ignore
        try:
            p = psutil.Process(pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return False
        # If the stored identity has a creation-time component, verify it
        # matches — a recycled PID would have a different creation time.
        if ":" in start_identity:
            stored_ct = start_identity.split(":", 1)[1]
            try:
                actual_ct = str(p.create_time())
                if stored_ct != actual_ct and stored_ct not in ("unknown",):
                    return False  # PID recycled
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                return False
        return True
    except ImportError:
        pass
    # Fallback: os.kill(pid, 0) on POSIX, or just check existence.
    if sys.platform == "win32":
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not h:
                return False
            kernel32.CloseHandle(h)
            return True
        except Exception:
            return True  # can't tell — assume alive to be safe
    else:
        try:
            os.kill(pid, 0)
            return True
        except (OSError, ProcessLookupError):
            return False


# ── Owner metadata ───────────────────────────────────────────────────────────

OWNER_FILE = "owner.json"
SCHEMA_VERSION = 1
DEFAULT_HEARTBEAT_INTERVAL_S = 10.0
DEFAULT_STALE_THRESHOLD_S = 60.0
DEFAULT_WAIT_TIMEOUT_S = 300.0
DEFAULT_WAIT_POLL_MIN_MS = 100
DEFAULT_WAIT_POLL_MAX_MS = 500


def _owner_path(lock_dir: str) -> str:
    return os.path.join(lock_dir, OWNER_FILE)


def _write_owner(lock_dir: str, owner: dict) -> None:
    """Atomically write owner metadata."""
    tmp = _owner_path(lock_dir) + ".tmp." + uuid.uuid4().hex[:8]
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(owner, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, _owner_path(lock_dir))


def _read_owner(lock_dir: str) -> Optional[dict]:
    try:
        with open(_owner_path(lock_dir), "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _now_iso() -> str:
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


# ── Lock lease ───────────────────────────────────────────────────────────────


@dataclass
class RagMutationLease:
    """Handle representing ownership of a user's RAG mutation lock.

    The heartbeat task refreshes ``owner['heartbeatAt']`` periodically so
    other processes can distinguish a live (but slow) writer from a dead one.
    ``assert_owned()`` checks that our token still owns the lock; it should
    be called between long phases to detect theft.
    """
    lock_dir: str
    token: str
    user_id: str
    owner: dict = field(default_factory=dict)
    _heartbeat_task: Optional[asyncio.Task] = None
    _heartbeat_interval: float = DEFAULT_HEARTBEAT_INTERVAL_S

    def _refresh_heartbeat(self) -> None:
        """Update heartbeatAt timestamp. Called from the heartbeat task."""
        self.owner["heartbeatAt"] = _now_iso()
        try:
            _write_owner(self.lock_dir, self.owner)
        except OSError:
            pass  # best-effort; assert_owned will catch real loss

    def assert_owned(self) -> None:
        """Raise RagMutationLockLostError if this lease no longer owns the lock.

        Call between long mutation phases to detect that another process
        reclaimed the lock (e.g. after our process was assumed dead).
        """
        current = _read_owner(self.lock_dir)
        if not current or current.get("token") != self.token:
            raise RagMutationLockLostError(
                f"Lock for user {self.user_id} was lost or taken over"
            )

    async def release(self) -> None:
        """Release the lock. Only succeeds if our token still owns it."""
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._heartbeat_task
            self._heartbeat_task = None

        current = _read_owner(self.lock_dir)
        if not current or current.get("token") != self.token:
            # Lock was already taken over or removed — do NOT delete the new
            # owner's lock.
            return

        # Rename to a unique tombstone first, then delete. This prevents a
        # race where another process creates the lock dir between our rename
        # and our rmtree.
        tombstone = f"{self.lock_dir}.releasing.{self.token}"
        try:
            os.rename(self.lock_dir, tombstone)
        except OSError:
            return  # someone else already moved/removed it
        _rmtree(tombstone)


def _rmtree(path: str) -> None:
    """Best-effort recursive directory removal."""
    import shutil
    shutil.rmtree(path, ignore_errors=True)


# ── Acquisition ──────────────────────────────────────────────────────────────


def _try_create_lock(lock_dir: str, owner: dict) -> bool:
    """Attempt atomic directory creation. Returns True on success."""
    try:
        os.makedirs(os.path.dirname(lock_dir), exist_ok=True)
        os.mkdir(lock_dir)  # atomic; fails if exists
        _write_owner(lock_dir, owner)
        return True
    except FileExistsError:
        return False
    except OSError:
        return False


def _can_reclaim(lock_dir: str, stale_threshold_s: float) -> tuple[bool, Optional[dict]]:
    """Check if the current lock is stale enough to reclaim.

    Returns (can_reclaim, current_owner). Reclaim is allowed ONLY when:
    1. heartbeatAt is older than stale_threshold_s, AND
    2. the owner PID is provably dead (or PID recycled).
    """
    owner = _read_owner(lock_dir)
    if not owner:
        # No readable owner — corrupt lock dir. Safe to reclaim since there's
        # no verifiable live owner.
        return True, None

    heartbeat_str = owner.get("heartbeatAt", "")
    if heartbeat_str:
        try:
            import datetime
            hb = datetime.datetime.fromisoformat(heartbeat_str)
            age = (datetime.datetime.now(datetime.timezone.utc) - hb).total_seconds()
            if age < stale_threshold_s:
                return False, owner  # still fresh — do not reclaim
        except (ValueError, TypeError):
            pass  # unreadable timestamp — treat as suspicious but check PID

    # Heartbeat is stale (or unreadable). Verify PID is actually dead.
    pid = owner.get("pid")
    start_identity = owner.get("processStartIdentity", "")
    if isinstance(pid, int) and pid > 0:
        if _is_pid_alive(pid, start_identity):
            return False, owner  # process is alive — DO NOT reclaim
    return True, owner


def _reclaim(lock_dir: str, old_owner: Optional[dict]) -> bool:
    """Reclaim a stale lock by renaming it to a tombstone, then creating fresh."""
    tombstone = f"{lock_dir}.stale.{uuid.uuid4().hex[:8]}"
    try:
        os.rename(lock_dir, tombstone)
    except OSError:
        return False  # someone else got there first
    _rmtree(tombstone)
    return True


async def acquire_user_rag_lock(
    user_id: str,
    *,
    operation: str,
    task_id: str = "",
    document_id: str = "",
    wait_timeout_s: float = DEFAULT_WAIT_TIMEOUT_S,
    stale_threshold_s: float = DEFAULT_STALE_THRESHOLD_S,
    poll_min_ms: int = DEFAULT_WAIT_POLL_MIN_MS,
    poll_max_ms: int = DEFAULT_WAIT_POLL_MAX_MS,
) -> RagMutationLease:
    """Acquire the per-user RAG mutation lock, waiting up to wait_timeout_s.

    Raises RagMutationBusyError if another writer holds the lock and does not
    release or die within the budget.
    """
    import random
    lock_dir = resolve_user_rag_lock_dir(user_id)
    token = uuid.uuid4().hex
    owner = {
        "version": SCHEMA_VERSION,
        "token": token,
        "userId": user_id,
        "pid": os.getpid(),
        "processStartIdentity": _process_start_identity(),
        "hostname": os.environ.get("COMPUTERNAME") or os.environ.get("HOSTNAME", ""),
        "runtime": "python",
        "operation": operation,
        "taskId": task_id,
        "documentId": document_id,
        "acquiredAt": _now_iso(),
        "heartbeatAt": _now_iso(),
    }

    deadline = time.monotonic() + wait_timeout_s
    last_owner: Optional[dict] = None

    while True:
        if _try_create_lock(lock_dir, owner):
            lease = RagMutationLease(
                lock_dir=lock_dir, token=token, user_id=user_id, owner=owner,
            )
            # Start heartbeat.
            lease._heartbeat_task = asyncio.create_task(_heartbeat_loop(lease))
            return lease

        # Lock exists — check if we can reclaim it.
        can_reclaim, current = _can_reclaim(lock_dir, stale_threshold_s)
        if can_reclaim:
            if _reclaim(lock_dir, current):
                continue  # retry creation
        last_owner = current

        if time.monotonic() >= deadline:
            raise RagMutationBusyError(user_id, last_owner)

        # Wait with jittered backoff before retrying.
        delay_s = random.uniform(poll_min_ms, poll_max_ms) / 1000.0
        await asyncio.sleep(delay_s)


async def _heartbeat_loop(lease: RagMutationLease) -> None:
    """Background task that refreshes heartbeatAt periodically."""
    while True:
        await asyncio.sleep(lease._heartbeat_interval)
        lease._refresh_heartbeat()


@contextlib.asynccontextmanager
async def user_rag_mutation_lock(
    user_id: str,
    *,
    operation: str,
    task_id: str = "",
    document_id: str = "",
    wait_timeout_s: float = DEFAULT_WAIT_TIMEOUT_S,
    stale_threshold_s: float = DEFAULT_STALE_THRESHOLD_S,
) -> AsyncIterator[RagMutationLease]:
    """Async context manager that acquires and releases the user mutation lock.

    Usage::

        async with user_rag_mutation_lock(user_id, operation="graph-index") as lease:
            await rag.initialize_storages()
            await purge(...)
            await rag.ainsert(...)
            await rag._insert_done()
            lease.assert_owned()  # verify we still hold the lock
    """
    lease = await acquire_user_rag_lock(
        user_id,
        operation=operation,
        task_id=task_id,
        document_id=document_id,
        wait_timeout_s=wait_timeout_s,
        stale_threshold_s=stale_threshold_s,
    )
    try:
        yield lease
    finally:
        await lease.release()
