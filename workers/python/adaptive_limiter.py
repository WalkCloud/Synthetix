"""Adaptive per-provider concurrency limiter for the Python graph worker.

Mirrors src/lib/llm/adaptive-limiter.ts so the Node side (wiki/embed/draft) and
the Python side (graph extraction in rag_index.py) share the SAME learned
capacity for a provider, persisted to provider-capacity/provider-capacity.json.

Why this exists (see docs/llm-concurrency-adaptive-limiter-2026-06-26.md):
providers don't publish concurrency limits and differ wildly. A static value
is always wrong. This probes the true ceiling via slow-start + AIMD and paces
graph extraction against it — and crucially, it coordinates with the Node side
so the two processes don't independently over-send the same provider.

Design parity with the TS limiter:
  - weighted token window (not request count) — TPM is the real limit
  - slow-start (doubling) to find the ceiling fast
  - additive increase / multiplicative decrease (×0.75, gentler than ×0.5)
  - single-flight cooldown on 429 (anti-thundering-herd / anti-ban)
  - persisted ceiling so the "tuition" is paid once per provider
  - floor + acquire-timeout so the worker can never deadlock

The Python graph worker issues LLM calls via LightRAG's llm_model_func. We wrap
that func so every extraction round-trip acquires/releases through here.
"""

import asyncio
import json
import os
import time
from typing import Any, Optional

# ── Tunables (mirror the TS defaults; overridable via env) ───────────────────

FLOOR_TOKENS = int(os.environ.get("LLM_LIMITER_FLOOR_TOKENS", "4000"))
SLOW_START_SUCCESSES = int(os.environ.get("LLM_LIMITER_SLOW_START_K", "8"))
AI_SUCCESSES = int(os.environ.get("LLM_LIMITER_AI_K", "20"))
MD_FACTOR = float(os.environ.get("LLM_LIMITER_MD_FACTOR", "0.75"))
HEADROOM = float(os.environ.get("LLM_LIMITER_HEADROOM", "0.8"))
AI_STEP_TOKENS = int(os.environ.get("LLM_LIMITER_AI_STEP_TOKENS", "4000"))
CEILING_CAP_TOKENS = int(os.environ.get("LLM_LIMITER_CEILING_CAP_TOKENS", "500000"))
ACQUIRE_TIMEOUT_S = 300  # fail-open after 5 min rather than deadlock
PERSIST_INTERVAL_S = 30


def _capacity_dir() -> str:
    root = os.environ.get("DB_PATH") or os.path.join(os.path.expanduser("~"), "synthetix-data")
    return os.path.join(root, "provider-capacity")


def _capacity_file() -> str:
    return os.path.join(_capacity_dir(), "provider-capacity.json")


def _read_store() -> dict:
    """Read the shared capacity store. Returns {} on any error (fresh deploy)."""
    try:
        with open(_capacity_file(), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_store(store: dict) -> None:
    """Atomic-ish write: temp + rename. Best-effort; never raises to caller."""
    try:
        os.makedirs(_capacity_dir(), exist_ok=True)
        path = _capacity_file()
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(store, f, indent=2)
        os.replace(tmp, path)
    except Exception as e:  # persistence is best-effort
        print(f"[adaptive_limiter] failed to persist capacity: {e}", flush=True)


def _estimate_tokens(text: str) -> int:
    """Rough token estimate mirroring the TS estimateTokens (chars / 1.5)."""
    return max(1, int(len(text) / 1.5) + 1)


class AdaptiveLimiter:
    """Async weighted-concurrency limiter, AIMD-controlled.

    A singleton per provider_key. Use get_limiter(provider_key) — it bootstraps
    the budget from the persisted record so a fresh process starts near the
    known ceiling instead of probing from floor.
    """

    _registry: dict[str, "AdaptiveLimiter"] = {}

    def __init__(
        self,
        provider_key: str,
        initial_budget: int = FLOOR_TOKENS,
        initial_ceiling: int = FLOOR_TOKENS,
    ) -> None:
        self.provider_key = provider_key
        self._budget = initial_budget
        self._ceiling = initial_ceiling
        self._inflight = 0
        self._inflight_requests = 0
        self._consecutive_successes = 0
        self._phase = "additive" if initial_budget > FLOOR_TOKENS else "slow-start"
        self._cooldown_until = 0.0
        self._last_persist_at = 0.0
        # Hard CAP on in-flight request COUNT — the load-bearing safety rail.
        # The token-budget path can be bypassed for large single requests, so
        # without a request cap N callers with large requests all sail through
        # and overwhelm the provider (which then holds connections open without
        # replying).
        #
        # The ACTUAL allowed concurrency is derived dynamically in acquire() from
        # the AIMD-adaptive token budget (see _dynamic_max_requests), so it
        # scales with the provider's real capacity. This env var is only a hard
        # upper bound (ceiling) on that derivation — it prevents runaway
        # concurrency even if the budget grows very large. Default 8: generous
        # enough that the budget-derived value is the real limiter, while still
        # capping total parallelism against provider RPM limits.
        self._max_requests_cap = int(os.environ.get("LLM_LIMITER_MAX_REQUESTS_GRAPH", "8"))
        # Token-budget condition: notified when inflight drops so waiters wake.
        self._cond = asyncio.Condition()

    # ── public API ──────────────────────────────────────────────────────────

    async def acquire(self, estimated_tokens: int) -> int:
        """Reserve capacity. Returns the estimated charge to pass to release().
        Blocks until cooldown clears, a request slot is free, and budget is
        available. Fail-opens on timeout (never deadlocks the worker)."""
        want = max(estimated_tokens, 1)
        deadline = time.monotonic() + ACQUIRE_TIMEOUT_S

        async with self._cond:
            # 1. wait out single-flight cooldown
            while True:
                remaining = self._cooldown_until - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    await asyncio.wait_for(self._cond.wait(), timeout=remaining)
                except asyncio.TimeoutError:
                    pass
                if time.monotonic() >= deadline:
                    return want  # fail-open

            # 2. wait for a request slot (DYNAMIC concurrency cap).
            # The allowed concurrency derives from the AIMD-adaptive token budget
            # (see _dynamic_max_requests), so it scales with provider capacity
            # instead of being a fixed throttle. The budget already encodes 429
            # back-pressure, so when the provider is congested the budget
            # shrinks and concurrency drops automatically.
            while self._inflight_requests >= self._dynamic_max_requests:
                if time.monotonic() >= deadline:
                    return want  # fail-open rather than deadlock the worker
                try:
                    await asyncio.wait_for(self._cond.wait(), timeout=0.05)
                except asyncio.TimeoutError:
                    pass

            # 3. wait for token budget
            # If THIS single call exceeds the whole budget, don't block — it's
            # atomic and can't be split; waiting would just deadlock to timeout.
            # (The request-slot gate above already bounds concurrency.)
            if want >= self._budget:
                self._inflight += want
                self._inflight_requests += 1
                return want
            while self._inflight + want > self._budget:
                if time.monotonic() >= deadline:
                    self._inflight_requests += 1
                    return want  # fail-open rather than deadlock the worker
                try:
                    await asyncio.wait_for(self._cond.wait(), timeout=0.05)
                except asyncio.TimeoutError:
                    pass
            self._inflight += want
            self._inflight_requests += 1
            return want

    async def release(
        self,
        estimated: int,
        status: int = 200,
        actual_tokens: Optional[int] = None,
    ) -> None:
        """Free the reservation and feed the outcome to the AIMD loop."""
        actual = actual_tokens if actual_tokens is not None else estimated
        async with self._cond:
            self._inflight = max(0, self._inflight - estimated)
            self._inflight_requests = max(0, self._inflight_requests - 1)
            self._cond.notify_all()

        if status == 429 or status == 503:
            await self._on_rate_limited()
        elif 200 <= status < 300:
            self._record_success(actual)
        await self._maybe_persist()

    async def notify_rate_limited(self) -> None:
        """Report a 429 the instant it's seen (anti-thundering-herd). Idempotent
        within a cooldown window — no double multiplicative-decrease."""
        await self._on_rate_limited()

    # ── AIMD internals ──────────────────────────────────────────────────────

    def _record_success(self, actual_tokens: int) -> None:
        self._consecutive_successes += 1
        if self._budget > self._ceiling:
            self._ceiling = min(self._budget, CEILING_CAP_TOKENS)

        if self._phase == "slow-start":
            if self._consecutive_successes >= SLOW_START_SUCCESSES:
                self._consecutive_successes = 0
                self._budget = min(self._budget * 2, CEILING_CAP_TOKENS)
        elif self._phase == "additive":
            if self._consecutive_successes >= AI_SUCCESSES:
                self._consecutive_successes = 0
                self._budget = min(self._budget + AI_STEP_TOKENS, CEILING_CAP_TOKENS)

    async def _on_rate_limited(self) -> None:
        already_in_cooldown = time.monotonic() < self._cooldown_until
        self._consecutive_successes = 0
        if not already_in_cooldown:
            self._budget = max(FLOOR_TOKENS, round(self._budget * MD_FACTOR))
        # cooldown: 30s at floor, else 2s
        cooldown_s = 30.0 if self._budget <= FLOOR_TOKENS else 2.0
        proposed_end = time.monotonic() + cooldown_s
        async with self._cond:
            if proposed_end > self._cooldown_until:
                self._cooldown_until = proposed_end
            self._phase = "cooldown"
            self._cond.notify_all()
        await self._persist()

    async def _maybe_persist(self) -> None:
        now = time.monotonic()
        if now - self._last_persist_at < PERSIST_INTERVAL_S:
            return
        await self._persist()

    async def _persist(self) -> None:
        self._last_persist_at = time.monotonic()
        store = _read_store()
        store[self.provider_key] = {
            "budgetTokens": self._budget,
            "discoveredCeiling": self._ceiling,
            "discoveredFloor": FLOOR_TOKENS,
            "emitsRateLimitHeaders": False,
            "last429At": (time.time() * 1000 if self._phase == "cooldown" else None),
            "lastUpdated": time.time() * 1000,
        }
        _write_store(store)

    # ── introspection ───────────────────────────────────────────────────────

    # Typical token cost of a single graph-extraction LLM call (prompt +
    # completion). Used to derive how many calls the current budget can sustain
    # in parallel. Overridable via env for providers with very different costs.
    _TOKENS_PER_GRAPH_REQUEST = int(os.environ.get("LLM_LIMITER_TOKENS_PER_GRAPH_REQUEST", "4000"))

    @property
    def budget(self) -> int:
        return self._budget

    @property
    def phase(self) -> str:
        return self._phase

    @property
    def _dynamic_max_requests(self) -> int:
        """Derive the allowed in-flight concurrency from the AIMD-adaptive
        token budget, capped by the env hard limit.

        This is the key change: instead of a fixed _max_requests=1 that
        throttles even when the budget is large, the concurrency scales with
        the provider's discovered capacity:
          - budget 4000 (floor)   → 1 concurrent request
          - budget 16000          → 4 concurrent requests
          - budget 32000+         → 8 (capped by _max_requests_cap)

        When 429s shrink the budget, concurrency drops automatically — no
        separate MD logic needed, the AIMD budget already encodes it.
        """
        derived = max(1, self._budget // self._TOKENS_PER_GRAPH_REQUEST)
        return min(derived, self._max_requests_cap)


def get_limiter(provider_key: str) -> "AdaptiveLimiter":
    """Get or create the shared limiter for a provider, bootstrapped from the
    persisted record (paid-once tuition)."""
    if provider_key in AdaptiveLimiter._registry:
        return AdaptiveLimiter._registry[provider_key]

    initial_budget = FLOOR_TOKENS
    initial_ceiling = FLOOR_TOKENS
    rec = _read_store().get(provider_key)
    if rec:
        ceiling = int(rec.get("discoveredCeiling", 0) or 0)
        if ceiling > FLOOR_TOKENS:
            initial_ceiling = ceiling
            initial_budget = max(FLOOR_TOKENS, round(ceiling * HEADROOM))

    lim = AdaptiveLimiter(
        provider_key,
        initial_budget=initial_budget,
        initial_ceiling=initial_ceiling,
    )
    AdaptiveLimiter._registry[provider_key] = lim
    return lim


def reset_registry_for_tests() -> None:
    """Clear the singleton registry (test helper)."""
    AdaptiveLimiter._registry.clear()


def _is_rate_limit_error(error: Exception) -> bool:
    msg = f"{type(error).__name__}: {error}".lower()
    markers = (
        "429",
        "rate limit",
        "too many requests",
        "503",
        "overload",
        "timeout",
        "timed out",
        "etimedout",
        "apiconnectionerror",
        "connection error",
        "connecterror",
        "connect error",
        "getaddrinfo failed",
        "name resolution",
        "temporary failure in name resolution",
        "econnreset",
        "connection reset",
        "connection refused",
        "remote protocol error",
    )
    return any(marker in msg for marker in markers)


def wrap_llm_func(llm_func: Any, provider_key: str) -> Any:
    """Wrap a LightRAG llm_model_func so every call is paced by the limiter.

    LightRAG calls llm_func(prompt=..., system_prompt=..., **kwargs) and expects
    a string back. We acquire before the call, release after, and feed the
    HTTP-ish status (success=200; the wrapped func raises on 429, which we catch
    to notify the limiter then re-raise). Token counts come from LightRAG's
    token_tracker side-channel where available, else estimated from the prompt.
    """
    limiter = get_limiter(provider_key)

    async def wrapped(prompt: str, system_prompt: Any = None, history_messages: Any = None, **kwargs: Any) -> str:
        est = _estimate_tokens(prompt) + int(kwargs.get("max_tokens", 1024) or 1024)
        charge = await limiter.acquire(est)
        try:
            result = await llm_func(prompt=prompt, system_prompt=system_prompt, history_messages=history_messages, **kwargs)
            await limiter.release(charge, status=200, actual_tokens=_estimate_tokens(result))
            return result
        except Exception as error:
            # Only capacity/congestion failures should shrink the learned window.
            # Auth/model/schema errors are real failures, but treating them as
            # 429s would incorrectly slow down every later graph extraction.
            if _is_rate_limit_error(error):
                await limiter.notify_rate_limited()
                await limiter.release(charge, status=429)
            else:
                await limiter.release(charge, status=500)
            raise

    return wrapped
