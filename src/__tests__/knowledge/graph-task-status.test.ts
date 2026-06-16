import { describe, expect, it } from "vitest";
import { getGraphTaskDecision } from "@/lib/knowledge/graph-task-status";

describe("getGraphTaskDecision", () => {
  it("continues polling while graph indexing is running", () => {
    expect(getGraphTaskDecision({ taskStatus: "running", hasGraphNodes: false })).toEqual({
      status: "running",
      shouldPollAgain: true,
      shouldRefreshGraph: false,
    });
  });

  it("refreshes the graph when indexing completed after an empty graph", () => {
    expect(getGraphTaskDecision({ taskStatus: "completed", hasGraphNodes: false })).toEqual({
      status: "completed",
      shouldPollAgain: false,
      shouldRefreshGraph: true,
    });
  });

  it("does not refresh when completed graph data is already visible", () => {
    expect(getGraphTaskDecision({ taskStatus: "completed", hasGraphNodes: true })).toEqual({
      status: "completed",
      shouldPollAgain: false,
      shouldRefreshGraph: false,
    });
  });

  it("stops polling when there is no graph task", () => {
    expect(getGraphTaskDecision({ taskStatus: null, hasGraphNodes: false })).toEqual({
      status: "idle",
      shouldPollAgain: false,
      shouldRefreshGraph: false,
    });
  });
});
