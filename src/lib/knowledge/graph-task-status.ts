export type GraphTaskStatus = "idle" | "pending" | "running" | "completed" | "failed";

export interface GraphTaskDecisionInput {
  taskStatus: Exclude<GraphTaskStatus, "idle"> | null;
  hasGraphNodes: boolean;
}

export interface GraphTaskDecision {
  status: GraphTaskStatus;
  shouldPollAgain: boolean;
  shouldRefreshGraph: boolean;
}

export function getGraphTaskDecision(input: GraphTaskDecisionInput): GraphTaskDecision {
  if (!input.taskStatus) {
    return { status: "idle", shouldPollAgain: false, shouldRefreshGraph: false };
  }

  if (input.taskStatus === "pending" || input.taskStatus === "running") {
    return { status: input.taskStatus, shouldPollAgain: true, shouldRefreshGraph: false };
  }

  if (input.taskStatus === "completed") {
    return { status: "completed", shouldPollAgain: false, shouldRefreshGraph: !input.hasGraphNodes };
  }

  return { status: "failed", shouldPollAgain: false, shouldRefreshGraph: false };
}
