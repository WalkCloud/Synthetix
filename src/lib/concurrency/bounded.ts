/**
 * Bounded-concurrency worker pool.
 *
 * Unified from documents/pipeline.ts `boundedAll` and wiki/synthesizer.ts
 * `runBounded` (design §4.6). Both had the same pattern with slightly
 * different signatures; this version supports both via the index parameter.
 */

/**
 * Run `fn` over `items` with at most `concurrency` in-flight calls.
 *
 * Each call receives its original index so callers can write results into a
 * pre-sized array in order, regardless of completion order.
 *
 * @returns void — callers that need results should capture them via closure.
 */
export async function mapBounded<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<unknown>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      if (i >= items.length) break;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
}
