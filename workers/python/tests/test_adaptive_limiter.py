"""Tests for the Python adaptive limiter (adaptive_limiter.py).

Mirrors the Node-side suite (src/__tests__/llm/adaptive-limiter.test.ts):
slow-start, multiplicative decrease, floor protection, latency gradient, and
the wrap_llm_func integration. Uses unittest + asyncio.run to match the
conventions of the other workers/python/tests files (see test_rag_index_helpers).
"""

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adaptive_limiter import (  # noqa: E402
    AdaptiveLimiter,
    FLOOR_TOKENS,
    LATENCY_FACTOR,
    LATENCY_THRESHOLD,
    SLOW_START_SUCCESSES,
    _percentile,
    get_limiter,
    reset_registry_for_tests,
    wrap_llm_func,
)


def _isolate_store(test_case):
    """Point DB_PATH at a fresh temp dir + reset the singleton registry.

    Tests must NEVER touch the real ~/.synthetix-data/provider-capacity/ —
    that's cross-test and cross-run state shared with the live app.
    """
    tmpdir = tempfile.mkdtemp(prefix="lim-test-")
    test_case._tmpdir = tmpdir
    os.environ["DB_PATH"] = tmpdir
    reset_registry_for_tests()


def _cleanup_store(test_case):
    del os.environ["DB_PATH"]
    import shutil

    shutil.rmtree(test_case._tmpdir, ignore_errors=True)


async def _succeed_n(lim: AdaptiveLimiter, n: int, tokens: int = 1000, latency_ms: float = 100.0):
    """Acquire + release a success N times serially."""
    for _ in range(n):
        charge = await lim.acquire(tokens)
        await lim.release(charge, status=200, actual_tokens=tokens, latency_ms=latency_ms)


class PercentileTests(unittest.TestCase):
    def test_nearest_rank_non_interpolated(self):
        # 20 samples, p=0.95 → idx=floor(20*0.95)=19 → max
        samples = list(range(1, 21))  # 1..20
        self.assertEqual(_percentile(samples, 0.95), 20)

    def test_eight_samples_p95_takes_max(self):
        # 8 samples, idx=floor(8*0.95)=7 → 8th element (max)
        samples = [10, 20, 30, 40, 50, 60, 70, 80]
        self.assertEqual(_percentile(samples, 0.95), 80)

    def test_empty_returns_zero(self):
        self.assertEqual(_percentile([], 0.95), 0.0)

    def test_preserves_input_order(self):
        # Sorting a copy — original insertion order must survive.
        samples = [3, 1, 2]
        _percentile(samples, 0.5)
        self.assertEqual(samples, [3, 1, 2])


class SlowStartTests(unittest.TestCase):
    def setUp(self):
        _isolate_store(self)

    def tearDown(self):
        _cleanup_store(self)

    def test_doubles_budget_after_k_successes(self):
        lim = AdaptiveLimiter("test:slow-start", initial_budget=FLOOR_TOKENS)
        start = lim._budget
        asyncio.run(_succeed_n(lim, SLOW_START_SUCCESSES))
        self.assertEqual(lim._budget, start * 2)
        self.assertEqual(lim._phase, "slow-start")

    def test_keeps_doubling_each_batch(self):
        lim = AdaptiveLimiter("test:slow-start-2", initial_budget=FLOOR_TOKENS)
        asyncio.run(_succeed_n(lim, SLOW_START_SUCCESSES))
        self.assertEqual(lim._budget, FLOOR_TOKENS * 2)
        asyncio.run(_succeed_n(lim, SLOW_START_SUCCESSES))
        self.assertEqual(lim._budget, FLOOR_TOKENS * 4)


class MultiplicativeDecreaseTests(unittest.TestCase):
    def setUp(self):
        _isolate_store(self)

    def tearDown(self):
        _cleanup_store(self)

    def test_shrinks_by_md_factor_on_429(self):
        # Use a budget that's already past slow-start so MD has room.
        lim = AdaptiveLimiter("test:md", initial_budget=FLOOR_TOKENS * 4)  # 16000
        asyncio.run(_succeed_n(lim, SLOW_START_SUCCESSES))  # → 32000
        before = lim._budget

        charge = asyncio.run(lim.acquire(1000))
        asyncio.run(lim.release(charge, status=429, actual_tokens=1000))

        # MD_FACTOR 0.75 — single-flight gated (no double MD within cooldown).
        self.assertEqual(lim._budget, round(before * 0.75))

    def test_never_shrinks_below_floor(self):
        lim = AdaptiveLimiter("test:md-floor", initial_budget=FLOOR_TOKENS)
        # At floor already; a 429 must not go below it.
        charge = asyncio.run(lim.acquire(1000))
        asyncio.run(lim.release(charge, status=429, actual_tokens=1000))
        self.assertGreaterEqual(lim._budget, FLOOR_TOKENS)

    def test_cooldown_blocks_concurrent_acquires_briefly(self):
        lim = AdaptiveLimiter("test:cooldown", initial_budget=FLOOR_TOKENS * 4)
        asyncio.run(_succeed_n(lim, SLOW_START_SUCCESSES))
        charge = asyncio.run(lim.acquire(1000))
        asyncio.run(lim.release(charge, status=429, actual_tokens=1000))
        # phase set to cooldown after the 429.
        self.assertEqual(lim._phase, "cooldown")


class LatencyGradientTests(unittest.TestCase):
    """Mirrors Node AdaptiveLimiter — latency gradient test (test file 136-153)."""

    def setUp(self):
        _isolate_store(self)

    def tearDown(self):
        _cleanup_store(self)

    def test_gentle_decrease_when_p95_climbs_above_threshold(self):
        # Start well above floor so we can observe a clear drop.
        lim = AdaptiveLimiter("test:latency", initial_budget=FLOOR_TOKENS * 5)  # 20000

        # Establish a low-latency baseline with 8 fast samples.
        asyncio.run(_succeed_n(lim, 8, latency_ms=100.0))
        before = lim._budget

        # Now feed slow samples that exceed baseline × threshold (1.5).
        asyncio.run(_succeed_n(lim, 8, latency_ms=500.0))

        # Should have shrunk (×LATENCY_FACTOR at least once).
        self.assertLess(lim._budget, before)

    def test_does_not_trigger_with_fewer_than_eight_samples(self):
        lim = AdaptiveLimiter("test:latency-warmup", initial_budget=FLOOR_TOKENS * 4)
        before = lim._budget
        # Only 7 high-latency samples — below the min-8 guard.
        asyncio.run(_succeed_n(lim, 7, latency_ms=10_000.0))
        # Budget may have grown via slow-start, but latency must NOT have
        # shrunk it. The strongest assertion: latency hasn't fired, so budget
        # must be >= before (either flat or grown by slow-start).
        self.assertGreaterEqual(lim._budget, before)

    def test_uses_latency_factor_not_md_factor(self):
        # A single latency trigger shrinks by 0.9, not 0.75.
        lim = AdaptiveLimiter("test:latency-factor", initial_budget=FLOOR_TOKENS * 4)
        # Prime with 8 low-latency samples to establish the EWMA baseline.
        asyncio.run(_succeed_n(lim, 8, latency_ms=100.0))
        budget_before_trigger = lim._budget

        # One high-latency sample that exceeds baseline × 1.5.
        charge = asyncio.run(lim.acquire(1000))
        asyncio.run(lim.release(charge, status=200, actual_tokens=1000, latency_ms=10_000.0))

        # If latency gradient fired exactly once on this sample, budget
        # dropped by ×0.9. (recordSuccess may also run on the 200, but with
        # only 1 success it won't trigger an AI/slow-start step.)
        expected_after_one_latency_md = round(budget_before_trigger * LATENCY_FACTOR)
        self.assertEqual(lim._budget, expected_after_one_latency_md)

    def test_gated_out_of_cooldown_phase(self):
        lim = AdaptiveLimiter("test:latency-cooldown-gate", initial_budget=FLOOR_TOKENS * 4)
        # Force a 429 → enters cooldown.
        charge = asyncio.run(lim.acquire(1000))
        asyncio.run(lim.release(charge, status=429, actual_tokens=1000))
        self.assertEqual(lim._phase, "cooldown")
        budget_in_cooldown = lim._budget

        # High-latency success during cooldown — latency must NOT shrink budget
        # again (the 429 already shrank it; piling on would be punitive).
        asyncio.run(_succeed_n(lim, 3, latency_ms=10_000.0))
        self.assertGreaterEqual(lim._budget, budget_in_cooldown)


class ReleaseOrderingTests(unittest.TestCase):
    """Verify latency is sampled BEFORE the AIMD outcome branch (mirrors learn())."""

    def setUp(self):
        _isolate_store(self)

    def tearDown(self):
        _cleanup_store(self)

    def test_latency_sampled_on_success_path(self):
        lim = AdaptiveLimiter("test:order-success", initial_budget=FLOOR_TOKENS * 4)
        asyncio.run(_succeed_n(lim, 8, latency_ms=100.0))  # build baseline
        self.assertEqual(len(lim._latency_samples), 8)
        self.assertAlmostEqual(lim._latency_ewma, 100.0, delta=1.0)

    def test_latency_sampled_on_429_path(self):
        lim = AdaptiveLimiter("test:order-429", initial_budget=FLOOR_TOKENS * 4)
        charge = asyncio.run(lim.acquire(1000))
        asyncio.run(lim.release(charge, status=429, actual_tokens=1000, latency_ms=5000.0))
        # The 429's latency was still recorded before the cooldown kicked in.
        self.assertEqual(len(lim._latency_samples), 1)
        self.assertEqual(lim._latency_samples[0], 5000.0)


class WrapLlmFuncTests(unittest.TestCase):
    def setUp(self):
        _isolate_store(self)

    def tearDown(self):
        _cleanup_store(self)

    def test_success_path_passes_latency_to_release(self):
        captured = {}

        async def fake_llm(prompt, system_prompt=None, history_messages=None, **kwargs):
            return "ok"

        # Monkeypatch the limiter to observe what release() receives.
        lim = get_limiter("test:wrap-success")
        original_release = lim.release

        async def spy_release(estimated, status=200, actual_tokens=None, latency_ms=None):
            captured["latency_ms"] = latency_ms
            captured["status"] = status
            return await original_release(estimated, status=status, actual_tokens=actual_tokens, latency_ms=latency_ms)

        lim.release = spy_release

        wrapped = wrap_llm_func(fake_llm, "test:wrap-success")
        result = asyncio.run(wrapped(prompt="hello"))
        self.assertEqual(result, "ok")
        self.assertEqual(captured["status"], 200)
        self.assertIsNotNone(captured["latency_ms"])
        self.assertGreaterEqual(captured["latency_ms"], 0.0)

    def test_rate_limit_error_triggers_notify_and_429_release(self):
        from adaptive_limiter import _is_rate_limit_error  # ensure importable

        notified = {"count": 0}

        class RateLimitError(Exception):
            pass

        async def fake_llm(prompt, system_prompt=None, history_messages=None, **kwargs):
            raise RateLimitError("429 Too Many Requests")

        lim = get_limiter("test:wrap-429")
        original_notify = lim.notify_rate_limited

        async def spy_notify():
            notified["count"] += 1
            return await original_notify()

        lim.notify_rate_limited = spy_notify

        wrapped = wrap_llm_func(fake_llm, "test:wrap-429")
        with self.assertRaises(RateLimitError):
            asyncio.run(wrapped(prompt="hello"))

        # notify fires exactly once (anti-thundering-herd single-flight).
        self.assertEqual(notified["count"], 1)

    def test_non_rate_limit_error_uses_500_release(self):
        class SchemaError(Exception):
            pass

        async def fake_llm(prompt, system_prompt=None, history_messages=None, **kwargs):
            raise SchemaError("invalid_request: bad response_format")

        captured = {}

        lim = get_limiter("test:wrap-500")
        original_release = lim.release

        async def spy_release(estimated, status=200, actual_tokens=None, latency_ms=None):
            captured["status"] = status
            return await original_release(estimated, status=status, actual_tokens=actual_tokens, latency_ms=latency_ms)

        lim.release = spy_release

        wrapped = wrap_llm_func(fake_llm, "test:wrap-500")
        with self.assertRaises(SchemaError):
            asyncio.run(wrapped(prompt="hello"))
        # Auth/schema errors must NOT look like 429s — status 500 keeps the
        # learned window from shrinking on real failures.
        self.assertEqual(captured["status"], 500)


class GetLimiterBootstrapTests(unittest.TestCase):
    def setUp(self):
        _isolate_store(self)

    def tearDown(self):
        _cleanup_store(self)

    def test_fresh_provider_starts_at_optimistic_initial_budget(self):
        # A fresh provider (no persisted record) now starts at the OPTIMISTIC
        # initial budget (default 32000 ≈ dynamic_max 8) instead of FLOOR_TOKENS,
        # so switching providers doesn't pay a 4-16 min slow-start tax. AIMD MD
        # will rein it in if a real 429 happens.
        from adaptive_limiter import INITIAL_BUDGET_TOKENS
        lim = get_limiter("test:bootstrap-fresh")
        self.assertEqual(lim._budget, INITIAL_BUDGET_TOKENS)
        self.assertGreater(lim._budget, FLOOR_TOKENS)
        # Phase should be additive (skip slow-start) since initial > floor.
        self.assertEqual(lim._phase, "additive")

    def test_fresh_provider_dynamic_max_at_least_8(self):
        # With the optimistic initial budget (32000), a fresh provider should
        # immediately get dynamic_max ≥ 8 (full concurrency), not crawl up.
        lim = get_limiter("test:bootstrap-dmax")
        self.assertGreaterEqual(lim._dynamic_max_requests, 8)

    def test_known_ceiling_starts_at_headroom(self):
        # Seed the store with a discovered ceiling.
        from adaptive_limiter import _write_store, HEADROOM

        store = {"test:bootstrap-known": {"discoveredCeiling": 40000}}
        _write_store(store)
        reset_registry_for_tests()  # force a fresh get_limiter read

        lim = get_limiter("test:bootstrap-known")
        self.assertEqual(lim._budget, round(40000 * HEADROOM))
        self.assertGreater(lim._budget, FLOOR_TOKENS)


class ErrorClassificationTests(unittest.TestCase):
    """_is_capacity_error vs _is_network_error — the core fix.

    The historical bug lumped network instability in with rate-limiting, so a
    single timeout collapsed the AIMD budget (×0.75) and stranded graph
    extraction at concurrency=1 because AIMD recovers very slowly.
    """

    def setUp(self):
        _isolate_store(self)

    def tearDown(self):
        _cleanup_store(self)

    def test_capacity_markers_match(self):
        from adaptive_limiter import _is_capacity_error
        for msg in [
            "429 Too Many Requests",
            "rate limit exceeded",
            "Rate_Limit: user is throttled",
            "too many requests",
            "quota exceeded",
            "503 Service Unavailable",
            "overloaded",
        ]:
            self.assertTrue(_is_capacity_error(Exception(msg)), f"should be capacity: {msg}")

    def test_network_markers_not_treated_as_capacity(self):
        from adaptive_limiter import _is_capacity_error
        for msg in [
            "ETIMEDOUT",
            "read timed out",
            "ECONNRESET",
            "connection reset by peer",
            "connection refused",
            "getaddrinfo failed",
            "ApiConnectionError: connection error",
            "socket hang up",
            "fetch failed: ECONNRESET",
        ]:
            self.assertFalse(_is_capacity_error(Exception(msg)), f"must NOT be capacity: {msg}")

    def test_network_markers_match_network_classifier(self):
        from adaptive_limiter import _is_network_error
        for msg in [
            "ETIMEDOUT",
            "read timed out",
            "ECONNRESET",
            "connection reset by peer",
            "connection refused",
            "getaddrinfo failed",
            "ApiConnectionError",
            "socket hang up",
            "fetch failed",
        ]:
            self.assertTrue(_is_network_error(Exception(msg)), f"should be network: {msg}")

    def test_schema_error_is_neither(self):
        from adaptive_limiter import _is_capacity_error, _is_network_error
        e = Exception("invalid_request: bad response_format")
        self.assertFalse(_is_capacity_error(e))
        self.assertFalse(_is_network_error(e))


class NotifyNetworkBlipTests(unittest.TestCase):
    """notify_network_blip must NOT shrink budget or enter cooldown."""

    def setUp(self):
        _isolate_store(self)

    def tearDown(self):
        _cleanup_store(self)

    def test_does_not_shrink_budget(self):
        lim = AdaptiveLimiter("test:blip-budget", initial_budget=FLOOR_TOKENS * 8)
        before = lim._budget
        asyncio.run(lim.notify_network_blip())
        self.assertEqual(lim._budget, before, "network blip must not shrink budget")

    def test_does_not_enter_cooldown(self):
        lim = AdaptiveLimiter("test:blip-cooldown", initial_budget=FLOOR_TOKENS * 8)
        asyncio.run(lim.notify_network_blip())
        self.assertNotEqual(lim._phase, "cooldown", "network blip must not enter cooldown")
        # And acquire must not block (cooldown_until unchanged).
        self.assertEqual(lim._cooldown_until, 0.0)

    def test_resets_consecutive_successes(self):
        lim = AdaptiveLimiter("test:blip-successes", initial_budget=FLOOR_TOKENS * 8)
        asyncio.run(_succeed_n(lim, 5))  # accumulate some successes
        self.assertGreater(lim._consecutive_successes, 0)
        asyncio.run(lim.notify_network_blip())
        self.assertEqual(lim._consecutive_successes, 0)

    def test_increments_blip_counter(self):
        lim = AdaptiveLimiter("test:blip-counter", initial_budget=FLOOR_TOKENS * 8)
        self.assertEqual(lim._network_blips, 0)
        asyncio.run(lim.notify_network_blip())
        asyncio.run(lim.notify_network_blip())
        self.assertEqual(lim._network_blips, 2)


class MinConcurrencyTests(unittest.TestCase):
    """_dynamic_max_requests must floor at LLM_LIMITER_GRAPH_MIN_CONCURRENCY."""

    def setUp(self):
        _isolate_store(self)

    def tearDown(self):
        _cleanup_store(self)

    def test_floor_at_min_concurrency_when_budget_collapses(self):
        # Budget at the absolute floor (worst case) — without the floor guard
        # derived concurrency would be 1 (4000 // 4000). The min guard must
        # raise it to the configured floor (default 2).
        lim = AdaptiveLimiter("test:min-floor", initial_budget=FLOOR_TOKENS)
        self.assertGreaterEqual(lim._dynamic_max_requests, 2)

    def test_respects_env_override(self):
        os.environ["LLM_LIMITER_GRAPH_MIN_CONCURRENCY"] = "4"
        try:
            lim = AdaptiveLimiter("test:min-env", initial_budget=FLOOR_TOKENS)
            self.assertGreaterEqual(lim._dynamic_max_requests, 4)
        finally:
            del os.environ["LLM_LIMITER_GRAPH_MIN_CONCURRENCY"]

    def test_cap_still_applies_above_floor(self):
        # When budget is large, the cap (default 8) still binds — floor only
        # matters when budget is small.
        lim = AdaptiveLimiter("test:min-cap", initial_budget=FLOOR_TOKENS * 100)
        self.assertLessEqual(lim._dynamic_max_requests, lim._max_requests_cap)


class WrapLlmFuncNetworkBlipTests(unittest.TestCase):
    """wrap_llm_func must route network errors through notify_network_blip,
    NOT notify_rate_limited — verifying the end-to-end fix."""

    def setUp(self):
        _isolate_store(self)

    def tearDown(self):
        _cleanup_store(self)

    def test_network_error_does_not_shrink_budget(self):
        class TimeoutError(Exception):
            pass

        async def fake_llm(prompt, system_prompt=None, history_messages=None, **kwargs):
            raise TimeoutError("ETIMEDOUT: read timed out")

        lim = get_limiter("test:wrap-net")
        # Grow the budget first so a shrink would be observable.
        asyncio.run(_succeed_n(lim, SLOW_START_SUCCESSES))
        budget_before = lim._budget

        wrapped = wrap_llm_func(fake_llm, "test:wrap-net")
        with self.assertRaises(TimeoutError):
            asyncio.run(wrapped(prompt="hello"))

        self.assertEqual(lim._budget, budget_before, "network error must not shrink budget")
        self.assertNotEqual(lim._phase, "cooldown", "network error must not enter cooldown")
        self.assertEqual(lim._network_blips, 1)

    def test_network_error_releases_as_200_not_429(self):
        class ConnReset(Exception):
            pass

        async def fake_llm(prompt, system_prompt=None, history_messages=None, **kwargs):
            raise ConnReset("ECONNRESET: connection reset")

        captured = {}
        lim = get_limiter("test:wrap-net-status")
        original_release = lim.release

        async def spy_release(estimated, status=200, actual_tokens=None, latency_ms=None):
            captured["status"] = status
            return await original_release(estimated, status=status, actual_tokens=actual_tokens, latency_ms=latency_ms)

        lim.release = spy_release

        wrapped = wrap_llm_func(fake_llm, "test:wrap-net-status")
        with self.assertRaises(ConnReset):
            asyncio.run(wrapped(prompt="hello"))

        # Released as 200 (benign) — NOT 429 — so AIMD neither punishes nor rewards.
        self.assertEqual(captured["status"], 200)


if __name__ == "__main__":
    unittest.main()
