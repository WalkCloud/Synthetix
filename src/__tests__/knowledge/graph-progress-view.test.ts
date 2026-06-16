import { describe, expect, it } from "vitest";
import { getGraphProgressView } from "@/lib/knowledge/graph-progress-view";

describe("getGraphProgressView", () => {
  it("builds chunk and heartbeat labels for running graph extraction", () => {
    const view = getGraphProgressView({
      status: "running",
      progress: 55,
      result: {
        stage: "indexing",
        message: "Extracting entities and relationships",
        processed: 5,
        total: 20,
        lastHeartbeatAt: "2026-06-08T00:00:10.000Z",
      },
      now: new Date("2026-06-08T00:00:25.000Z"),
    });

    expect(view).toEqual({
      stage: "indexing",
      progress: 55,
      message: "Extracting entities and relationships",
      chunkLabel: "5 / 20 chunks",
      heartbeatLabel: "Last activity 15s ago",
      isSlow: false,
    });
  });

  it("marks a running task slow when heartbeat is stale", () => {
    const view = getGraphProgressView({
      status: "running",
      progress: 55,
      result: { lastHeartbeatAt: "2026-06-08T00:00:00.000Z" },
      now: new Date("2026-06-08T00:02:30.000Z"),
    });

    expect(view.isSlow).toBe(true);
    expect(view.heartbeatLabel).toBe("Last activity 150s ago");
  });
});
