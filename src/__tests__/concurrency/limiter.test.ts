import { describe, it, expect } from "vitest";
import { Semaphore } from "@/lib/concurrency/limiter";

describe("Semaphore", () => {
  it("allows up to N concurrent acquires when N permits available", async () => {
    const sem = new Semaphore(3);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    const r3 = await sem.acquire();
    expect(sem.available).toBe(0);
    expect(sem.pending).toBe(0);
    r1(); r2(); r3();
    expect(sem.available).toBe(3);
  });

  it("serialises acquires when permits=1", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    const release1 = await sem.acquire();
    order.push(1);

    // These should both queue behind release1
    const p2 = (async () => {
      const r = await sem.acquire();
      order.push(2);
      return r;
    })();
    const p3 = (async () => {
      const r = await sem.acquire();
      order.push(3);
      return r;
    })();

    // give microtasks a chance to settle
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual([1]);
    expect(sem.pending).toBe(2);

    release1();
    const release2 = await p2;
    expect(order).toEqual([1, 2]);
    expect(sem.pending).toBe(1);

    release2();
    const release3 = await p3;
    expect(order).toEqual([1, 2, 3]);

    release3();
    expect(sem.available).toBe(1);
    expect(sem.pending).toBe(0);
  });

  it("hands permits to waiters in FIFO order", async () => {
    const sem = new Semaphore(1);
    const r1 = await sem.acquire();

    const order: number[] = [];
    const wait = async (id: number) => {
      const r = await sem.acquire();
      order.push(id);
      r();
    };

    const p1 = wait(1);
    await new Promise((r) => setImmediate(r));
    const p2 = wait(2);
    await new Promise((r) => setImmediate(r));
    const p3 = wait(3);
    await new Promise((r) => setImmediate(r));

    expect(sem.pending).toBe(3);

    r1();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("release is idempotent (second call is a no-op)", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    expect(sem.available).toBe(0);
    release();
    expect(sem.available).toBe(1);
    release(); // second call should not push permits past initial value
    expect(sem.available).toBe(1);
  });

  it("clamps invalid permit counts to at least 1", () => {
    const a = new Semaphore(0);
    const b = new Semaphore(-5);
    const c = new Semaphore(2.7);
    expect(a.available).toBe(1);
    expect(b.available).toBe(1);
    expect(c.available).toBe(2);
  });
});
