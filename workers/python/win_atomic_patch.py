"""Monkey-patch LightRAG's ``atomic_write`` with Windows-safe retry logic.

On Windows, ``os.replace(tmp, target)`` fails with ``PermissionError``
(``WinError 5`` — access denied) when another process or system service is
briefly holding a read handle on the target file. The most common cause is
Windows Defender's real-time protection scanning a freshly written file, but
NTFS delayed handle release, file-indexing services, and backup tools exhibit
the same behavior.

The failure is **intermittent** (observed ~0.2% of writes during graph
extraction loops) but **destructive**: LightRAG's ``_flush_one`` raises an
``IndexFlushError`` that corrupts the in-memory/disk consistency state.

This module replaces ``lightrag.file_atomic.atomic_write`` with a version that
retries ``os.replace`` on ``PermissionError`` with short backoff sleeps, giving
the handle holder time to release. The retry is Windows-only — on POSIX the
original behavior is unchanged (``os.replace`` never blocks there).

Usage: import this module **before** any LightRAG storage class is
instantiated (i.e. before ``from lightrag import LightRAG``). It patches the
function in-place in ``lightrag.file_atomic`` and re-binds the name in every
kg/* module that already imported it, so both new and existing references use
the patched version.
"""
from __future__ import annotations

import os
import sys
import time
import logging

logger = logging.getLogger("lightrag")

# Retry configuration. The defaults are conservative: total worst-case delay
# is ~0.6s (0.05 + 0.10 + 0.15 + 0.20 + 0.10), after which the original
# exception propagates. In practice the first retry (50ms) almost always
# succeeds — Defender releases its scan handle well within that window.
MAX_RETRIES = 5
INITIAL_BACKOFF_S = 0.05
BACKOFF_STEP_S = 0.05
MAX_BACKOFF_S = 0.20

_IS_WINDOWS = sys.platform == "win32"


def _replace_with_retry(tmp: str, target: str, workspace: str = "_") -> None:
    """``os.replace`` with PermissionError retry on Windows."""
    if not _IS_WINDOWS:
        os.replace(tmp, target)
        return

    last_exc: PermissionError | None = None
    for attempt in range(MAX_RETRIES):
        try:
            os.replace(tmp, target)
            return
        except PermissionError:
            last_exc = PermissionError  # type: ignore[assignment]
            if attempt < MAX_RETRIES - 1:
                backoff = min(
                    INITIAL_BACKOFF_S + BACKOFF_STEP_S * attempt,
                    MAX_BACKOFF_S,
                )
                logger.debug(
                    f"[{workspace}] os.replace retry {attempt + 1}/{MAX_RETRIES} "
                    f"after {backoff:.2f}s (PermissionError on {target})"
                )
                time.sleep(backoff)

    # All retries exhausted — raise the original exception so callers see the
    # real failure, not a wrapper.
    raise last_exc  # type: ignore[misc]


def apply_patch() -> None:
    """Patch ``lightrag.file_atomic.atomic_write`` with the retry-enhanced version.

    Idempotent: calling twice is safe (the second call re-wraps the already-
    patched function, but the inner logic is identical so behavior is unchanged).

    After patching, re-binds the function name in every ``lightrag.kg.*`` module
    that already imported ``atomic_write`` via ``from lightrag.file_atomic import
    atomic_write``. Without this re-bind, modules imported BEFORE this patch
    would still reference the original function (Python imports create a module-
    level name binding, not a live reference).
    """
    import lightrag.file_atomic as fa

    if getattr(fa.atomic_write, "_win_retry_patched", False):
        return  # already patched

    _original_atomic_write = fa.atomic_write

    def patched_atomic_write(file_name, write_fn, workspace="_"):
        """atomic_write with Windows os.replace PermissionError retry."""
        tmp = fa.tmp_path_for(file_name)
        try:
            write_fn(tmp)
            fa._preserve_mode(tmp, file_name, workspace)
            _replace_with_retry(tmp, file_name, workspace)
        except BaseException:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except OSError as exc:
                logger.warning(
                    f"[{workspace}] Failed to remove tmp after failed atomic write: {exc}"
                )
            raise

    # Mark as patched for idempotency.
    patched_atomic_write._win_retry_patched = True  # type: ignore[attr-defined]
    patched_atomic_write._original = _original_atomic_write  # type: ignore[attr-defined]

    # Patch the source module.
    fa.atomic_write = patched_atomic_write

    # Re-bind in all kg/* modules that did `from lightrag.file_atomic import atomic_write`.
    # These modules captured the original function reference at import time; we
    # need to update their module-level name so existing LightRAG instances (e.g.
    # a warm daemon) use the patched version too.
    _MODULES_TO_REBIND = (
        "lightrag.kg.networkx_impl",
        "lightrag.kg.nano_vector_db_impl",
        "lightrag.kg.faiss_impl",
        "lightrag.kg.postgres_impl",
        "lightrag.kg.neo4j_impl",
        "lightrag.kg.qdrant_impl",
        "lightrag.kg.chroma_impl",
        "lightrag.kg.redis_impl",
        "lightrag.kg.memgraph_impl",
        "lightrag.kg.mongo_impl",
        "lightrag.kg.opensearch_impl",
        "lightrag.kg.milvus_impl",
    )
    for mod_name in _MODULES_TO_REBIND:
        mod = sys.modules.get(mod_name)
        if mod is not None and hasattr(mod, "atomic_write"):
            mod.atomic_write = patched_atomic_write
