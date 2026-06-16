/**
 * Lightweight FIFO semaphore for in-process concurrency control.
 *
 * Currently consumed by `TaskQueue` (`src/lib/queue/queue.ts`) as a single-
 * permit `schedulerLock` that serialises the cap-check / SQL-claim / counter-
 * increment section so concurrent processNext() invocations cannot overshoot
 * a per-type concurrency cap. Kept generic on purpose — reuse it elsewhere
 * if you need bounded async concurrency without pulling in a dependency.
 */

export class Semaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(1, Math.floor(permits));
  }

  /**
   * Acquire one permit, returning a release function. The release function
   * is idempotent — calling it more than once is a no-op.
   */
  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return this.makeReleaser();
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    return this.makeReleaser();
  }

  private makeReleaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        // Hand the permit directly to the next waiter (no permit++ here).
        next();
      } else {
        this.permits += 1;
      }
    };
  }

  get available(): number {
    return this.permits;
  }

  get pending(): number {
    return this.waiters.length;
  }
}
