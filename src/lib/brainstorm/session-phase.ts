// Client-side phase recovery for brainstorm sessions on reload.
//
// The Phase type is duplicated from src/hooks/brainstorm/types.ts on purpose:
// src/lib must not import from src/hooks (hooks already depend on lib, so a
// reverse edge would create a circular dependency). The two declarations are
// kept in sync manually — they are a stable 6-value literal union.
export type Phase =
  | "gathering"
  | "direction"
  | "mode_select"
  | "section_refine"
  | "ready_to_generate"
  | "ready";

/**
 * Minimal shape of an outline_generate async task needed to infer a session's
 * phase. The /api/v1/tasks endpoint returns these fields (plus more); this
 * interface keeps the function testable without coupling to the full task DTO.
 * `id` is included as optional because callers in loadSession need it to
 * resume polling, while inferSessionPhase itself only reads sessionId/status.
 */
export interface OutlineTaskLike {
  id?: string;
  sessionId: string | null;
  status: string;
}

/**
 * Reconstructs the phase a brainstorm session should show after a page reload.
 *
 * Phase is not persisted server-side, so on load we re-derive it from the only
 * durable signals we have: whether an outline already exists, and the state of
 * this session's outline_generate async tasks.
 *
 * Priority (highest wins):
 *  1. outline present         → "ready"  (outline panel renders the result)
 *  2. pending/running task    → "ready"  (polling resumes via startPollingExternal)
 *  3. failed task, no active  → "ready"  (page.tsx renders the "generation
 *                                        failed + retry" panel so the user can
 *                                        recover — this is the fix for sessions
 *                                        stuck after a heartbeat-timeout task)
 *  4. otherwise               → "gathering" (fresh or early-stage session)
 *
 * Note: intermediate conversational phases (direction / mode_select /
 * section_refine / ready_to_generate) are NOT recoverable from durable state —
 * their markers are stripped before the AI message is persisted, so reload
 * always flattens them to "gathering" (or "ready" via the task path above).
 * That is a known limitation and outside this function's scope.
 */
export function inferSessionPhase(
  hasOutline: boolean,
  tasks: OutlineTaskLike[],
  sessionId: string,
): Phase {
  if (hasOutline) return "ready";

  // Only consider tasks belonging to this session.
  const sessionTasks = tasks.filter((t) => t.sessionId === sessionId);

  const hasActive = sessionTasks.some(
    (t) => t.status === "pending" || t.status === "running",
  );
  if (hasActive) return "ready";

  const hasFailed = sessionTasks.some((t) => t.status === "failed");
  if (hasFailed) return "ready";

  return "gathering";
}
