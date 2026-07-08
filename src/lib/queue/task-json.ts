/**
 * Centralised JSON parsing for AsyncTask inputData / resultData.
 *
 * All callers should use these helpers instead of raw JSON.parse, so that
 * malformed JSON in the database (e.g. from a crashed write, a manual edit,
 * or a schema migration) degrades gracefully instead of 500-ing the route
 * or crashing the queue.
 *
 * Design: §4.5 — persisted JSON parser centralisation.
 */

/**
 * Parse AsyncTask.inputData (or any persisted JSON string) into type T.
 * Returns `fallback` when the value is null/undefined/empty or malformed.
 */
export function parseTaskInput<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Parse AsyncTask.resultData (or any persisted JSON string) into type T.
 * Returns `fallback` when the value is null/undefined/empty or malformed.
 */
export function parseTaskResult<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
