"""Synthetix long-lived Python daemon.

Hosts the per-document hot paths that previously cold-started Python on every
call — `local_chunk.find_boundaries` (ONNX semantic chunking),
`rag_index.index_document` (LightRAG basic/graph indexing), and
`rag_query.query_rag` (semantic search). Docling conversion is NOT hosted here
(its torch footprint ~1.5-2.5GB is too heavy to keep resident; it stays a
cache-backed one-shot spawn).

The query handler caches LightRAG instances per working_dir so the SECOND and
later searches for a user skip the Python cold-start (interpreter + lightrag
import), the full-directory JSON/GraphML integrity scan, and the
`rag.initialize_storages()` load. First query pays it once; the daemon then
stays resident (5min idle reaper releases RSS) and rebuilds lazily on reheat.

Wire protocol (newline-delimited JSON):
  Node -> daemon  (stdin):  {"id": <int>, "op": "chunk"|"index"|"query"|"ping", "params": {...}}
  daemon -> Node  (stdout): {"id": <int>, "ok": true, "result": {...}}
                             {"id": <int>, "ok": false, "error": "<msg>", "exc_type": "<type>"}
  daemon -> Node  (stderr): one JSON object per line, dispatched by Node on `type`:
                             {"type":"progress",...}  {"type":"usage",...}  {"type":"rss","rss_mb":<int>}
                             {"type":"timing","stage":"load|query|llm","ms":<int>}
                             (non-`{`-prefixed lines are library warnings and ignored)

The daemon serves ONE request at a time (Node serializes via a mutex), so every
stderr event emitted while a request is open belongs to that request — no id tag
needed on events.
"""
import sys
import json
import os
import asyncio
import threading
import traceback

# --- event sink ---------------------------------------------------------------
# Set per-request (serialized, so a single slot is safe). Routes the rag_index
# event sources (emit_progress / emit_usage / StdoutTokenTracker) onto the
# stderr JSON line channel Node already knows how to parse.
_sink = None  # callable(str) | None


def _set_sink(sink):
    global _sink
    _sink = sink


def _emit_line(line):
    if _sink is not None:
        try:
            _sink(line)
        except Exception:
            # A sink failure must never kill a document pipeline mid-run.
            pass


def daemon_emit_progress(stage, progress, message, **extra):
    event = {
        "type": "progress",
        "stage": stage,
        "progress": max(0, min(100, int(progress))),
        "message": message,
    }
    event.update({k: v for k, v in extra.items() if v is not None})
    _emit_line(json.dumps(event, ensure_ascii=False))


def daemon_emit_usage(module, input_tokens, output_tokens):
    if input_tokens <= 0 and output_tokens <= 0:
        return
    _emit_line(json.dumps({
        "type": "usage",
        "module": module,
        "input_tokens": int(input_tokens),
        "output_tokens": int(output_tokens),
    }, ensure_ascii=False))


class DaemonTokenTracker:
    """Drop-in for rag_index.StdoutTokenTracker — forwards LightRAG per-call
    token counts to the daemon's stderr usage channel."""

    def __init__(self, module):
        self._module = module

    def add_usage(self, counts):
        try:
            prompt = int(counts.get("prompt_tokens", 0) or 0)
            completion = int(counts.get("completion_tokens", 0) or 0)
        except (TypeError, ValueError):
            return
        daemon_emit_usage(self._module, prompt, completion)


def _install_rag_sinks(rag_index_module):
    """Redirect rag_index's three event sources onto the daemon channel.

    index_document() resolves emit_progress / emit_usage / StdoutTokenTracker by
    module-global name at call time, so reassigning the attributes here reroutes
    every emit without editing rag_index.py (which stays runnable standalone)."""
    rag_index_module.emit_progress = daemon_emit_progress
    rag_index_module.emit_usage = daemon_emit_usage
    rag_index_module.StdoutTokenTracker = DaemonTokenTracker


# --- output helpers -----------------------------------------------------------
def _write_stdout(obj):
    # Block-buffered when redirected — MUST flush or Node times out reading.
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _stderr_sink(line):
    sys.stderr.write(line + "\n")
    sys.stderr.flush()


# --- handlers (lazy import keeps a chunk-only daemon off lightrag) -----------
def handle_chunk(params):
    from local_chunk import find_boundaries

    # The ONNX model is pre-loaded synchronously in _warm_imports at daemon
    # startup, so find_boundaries → get_model() returns the cached instance
    # immediately without re-triggering InferenceSession creation (which is the
    # operation that deadlocks inside the running asyncio loop on Windows).
    threshold = params.get("threshold", 0.55)
    results = []
    for batch in params.get("batches", []):
        sims, bounds = find_boundaries(
            batch.get("sentences", []),
            batch.get("maxTokens", 1100),
            threshold,
        )
        results.append({
            "id": batch.get("id"),
            "similarities": sims,
            "boundaries": bounds,
        })
    return {"results": results}


async def handle_index(params):
    import rag_index
    # Idempotent: reassigning module globals every call is cheap and harmless.
    _install_rag_sinks(rag_index)
    return await rag_index.index_document(**params)


async def handle_query(params):
    """Semantic search via the resident LightRAG instance cache.

    rag_query.query_rag already:
      - caches LightRAG per working_dir (so storage load + JSON scan run once)
      - returns a plain dict (we serialize it over the wire here)
      - emits {"type":"timing",...} to stderr, which the daemon's sink forwards
        to Node so semantic.ts can surface load/query/llm latencies if desired.

    The daemon process itself stays warm across queries (5min idle reaper), so
    Python interpreter start + lightrag/numpy/openai imports are amortized.

    NOTE: lightrag/numpy/openai are pre-imported at daemon startup (see
    _warm_imports below) rather than lazily inside query_rag. lightrag creates
    module-global asyncio primitives at import time; importing it lazily inside
    the daemon's running event loop deadlocks on those primitives. Pre-importing
    at startup (before the loop starts) avoids this entirely.
    """
    import rag_query
    return await rag_query.query_rag(**params)


def handle_ping(_params):
    return {"pong": True}


HANDLERS = {
    "chunk": handle_chunk,
    "index": handle_index,
    "query": handle_query,
    "ping": handle_ping,
}


# --- request processing -------------------------------------------------------
async def _serve_one(req):
    rid = req.get("id")
    op = req.get("op")
    params = req.get("params") or {}
    _set_sink(_stderr_sink)
    handler = HANDLERS.get(op)
    if handler is None:
        _set_sink(None)
        _write_stdout({"id": rid, "ok": False, "error": "unknown op: %r" % (op,)})
        return
    try:
        result = handler(params)
        if asyncio.iscoroutine(result):
            result = await result
        _write_stdout({"id": rid, "ok": True, "result": result})
    except Exception as exc:  # noqa: BLE001 — surface any failure to Node
        _write_stdout({
            "id": rid,
            "ok": False,
            "error": str(exc),
            "exc_type": type(exc).__name__,
            "trace": traceback.format_exc(),
        })
    finally:
        _set_sink(None)


async def _serve_loop(request_q):
    while True:
        raw = await request_q.get()
        if raw is None:  # stdin EOF sentinel
            return
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            _write_stdout({"id": None, "ok": False, "error": "bad json: %s" % (exc,)})
            continue
        await _serve_one(req)


# --- RSS self-report (best-effort, optional) ---------------------------------
def _get_rss_mb():
    """Return current process RSS in MB, or None if unavailable."""
    # psutil (cross-platform) if installed
    try:
        import psutil  # type: ignore
        return int(psutil.Process(os.getpid()).memory_info().rss // (1024 * 1024))
    except Exception:
        pass
    # Windows via ctypes (no extra dependency)
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            class _PMC(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                    ("PrivateUsage", ctypes.c_size_t),
                ]

            pmc = _PMC()
            pmc.cb = ctypes.sizeof(_PMC)
            kernel32 = ctypes.windll.kernel32
            psapi = ctypes.windll.psapi
            ok = psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
            if ok:
                return int(pmc.WorkingSetSize // (1024 * 1024))
        except Exception:
            pass
        return None
    # POSIX
    try:
        import resource
        # ru_maxrss is KB on Linux, bytes on macOS — normalize to MB.
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if sys.platform == "darwin":
            return int(rss // (1024 * 1024))
        return int(rss // 1024)
    except Exception:
        return None


async def _rss_reporter(interval_ms):
    interval = max(1.0, interval_ms / 1000.0)
    while True:
        await asyncio.sleep(interval)
        mb = _get_rss_mb()
        if mb is not None:
            # Emits as an event line; Node routes type=="rss" to its RSS guard.
            _emit_line(json.dumps({"type": "rss", "rss_mb": mb}))


# --- entry -------------------------------------------------------------------
def _stdin_reader(loop, request_q):
    """Dedicated thread reading stdin blockingly.

    asyncio.connect_read_pipe on sys.stdin is unreliable on Windows
    (NotImplementedError on some console-redirected handles). A plain blocking
    readline() loop on a daemon thread + loop.call_soon_threadsafe is the
    portable choice. EOF (empty readline) pushes a None sentinel to stop the
    serving loop."""
    try:
        while True:
            raw = sys.stdin.readline()
            if not raw:  # EOF / stdin closed by parent
                break
            loop.call_soon_threadsafe(request_q.put_nowait, raw)
    except Exception:
        pass
    try:
        loop.call_soon_threadsafe(request_q.put_nowait, None)
    except RuntimeError:
        # loop already closed — process is shutting down
        pass


def _warm_imports():
    """Pre-import heavy modules BEFORE the asyncio event loop starts.

    lightrag (and its deps numpy/openai) create module-global asyncio primitives
    at import time. If that import happens lazily inside a handler while the
    daemon's event loop is already running, those primitives can bind to / block
    the running loop and deadlock the query. Importing at startup (no loop yet)
    is safe and also amortizes the ~1s import cost across all future queries.

    The same deadlock affects onnxruntime: creating an ONNX InferenceSession
    (via the embedder's first model load) from inside a running asyncio loop
    hangs on Windows. We pre-initialize the ONNX session here synchronously
    (pre-loop, on the main thread) so it's safe AND so handle_chunk can reuse
    it without any wait. The previous background-thread approach silently failed
    to load the model in some daemon environments, leaving `_onnx_ready` unset
    and every chunk op stuck on `.wait()` until the 20-min chunk timeout.

    The ONNX model load is ~7s standalone; python-daemon.ts now allows 120s for
    the ping handshake, so synchronous pre-loop load is well within budget.
    """
    # Apply the Windows atomic_write retry patch BEFORE importing lightrag so
    # the retry covers both the daemon's query path (rag_query) and the index
    # path (rag_index, called via handle_index).
    try:
        from win_atomic_patch import apply_patch
        apply_patch()
    except Exception:
        pass  # non-critical: the patch only adds retry robustness

    try:
        import lightrag  # noqa: F401
        import lightrag.llm.openai  # noqa: F401
        import numpy  # noqa: F401
        import openai  # noqa: F401
    except Exception:
        # Don't crash a chunk-only daemon that doesn't have lightrag installed.
        pass
    try:
        # Eagerly create the ONNX InferenceSession via local_chunk's embedder.
        # This is the operation that deadlocks when first run inside the event
        # loop; doing it here (pre-loop) initializes onnxruntime's session state
        # so later handle_chunk calls — which reuse this exact model instance
        # via local_chunk.get_model()'s module-level cache — never trigger
        # session creation again. Goes through OnnxEmbedder (onnxruntime +
        # tokenizer directly), not sentence_transformers (GTE-multilingual's
        # private architecture isn't loadable via ST).
        from local_chunk import get_model
        get_model()
        print("[daemon] ONNX model pre-warmed successfully", file=sys.stderr, flush=True)
    except Exception as e:
        # Best-effort: a daemon without the ONNX model (or where the path is
        # wrong) should still start — chunk calls will then fail with a clear
        # error and the caller falls back to spawn, same as before.
        print(f"[daemon] ONNX pre-warm skipped: {e}", file=sys.stderr, flush=True)


# Kept for backward compat in case any handler references it. Always None now —
# handle_chunk no longer waits (the model is loaded synchronously above).
_onnx_ready: threading.Event | None = None


def main():
    _warm_imports()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    request_q = asyncio.Queue()

    rss_ms = int(os.environ.get("PYTHON_DAEMON_RSS_REPORT_MS", "10000") or "0")
    if rss_ms > 0:
        loop.create_task(_rss_reporter(rss_ms))

    reader = threading.Thread(target=_stdin_reader, args=(loop, request_q), daemon=True)
    reader.start()

    try:
        loop.run_until_complete(_serve_loop(request_q))
    finally:
        try:
            loop.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
