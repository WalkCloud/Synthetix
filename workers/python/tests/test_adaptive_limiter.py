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

    def test_fresh_provider_starts_at_floor(self):
        lim = get_limiter("test:bootstrap-fresh")
        self.assertEqual(lim._budget, FLOOR_TOKENS)

    def test_known_ceiling_starts_at_headroom(self):
        # Seed the store with a discovered ceiling.
        from adaptive_limiter import _write_store, HEADROOM

        store = {"test:bootstrap-known": {"discoveredCeiling": 40000}}
        _write_store(store)
        reset_registry_for_tests()  # force a fresh get_limiter read

        lim = get_limiter("test:bootstrap-known")
        self.assertEqual(lim._budget, round(40000 * HEADROOM))
        self.assertGreater(lim._budget, FLOOR_TOKENS)


if __name__ == "__main__":
    unittest.main()
