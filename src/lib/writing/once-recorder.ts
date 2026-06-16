/**
 * Wraps a side-effecting function so it executes at most once across many `.record()` calls.
 *
 * Use case: a request handler has both a "happy path" and a "failure" code branch that may
 * each try to record token usage. The branches can both fire (e.g. happy path records,
 * then `controller.close()` throws and the catch block records again). This helper makes
 * the recording idempotent — second and later calls are no-ops, even while the first
 * call is still in flight.
 */
export function createOnceRecorder<T extends () => Promise<void>>(fn: T): { record: () => Promise<void> } {
  let started = false;
  return {
    async record() {
      if (started) return;
      started = true;
      await fn();
    },
  };
}
