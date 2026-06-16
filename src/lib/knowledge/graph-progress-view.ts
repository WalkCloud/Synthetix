export interface GraphProgressViewInput {
  status: string;
  progress: number;
  result?: unknown;
  now?: Date;
}

export interface GraphProgressView {
  stage: string;
  progress: number;
  message: string;
  chunkLabel: string | null;
  heartbeatLabel: string | null;
  isSlow: boolean;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function getGraphProgressView(input: GraphProgressViewInput): GraphProgressView {
  const result = (input.result && typeof input.result === "object" ? input.result : {}) as Record<string, unknown>;
  const processed = getNumber(result.processed);
  const total = getNumber(result.total);
  const lastHeartbeatAt = getString(result.lastHeartbeatAt);
  let heartbeatLabel: string | null = null;
  let isSlow = false;

  if (lastHeartbeatAt) {
    const elapsedSeconds = Math.max(0, Math.floor(((input.now || new Date()).getTime() - new Date(lastHeartbeatAt).getTime()) / 1000));
    heartbeatLabel = `Last activity ${elapsedSeconds}s ago`;
    isSlow = elapsedSeconds >= 120;
  }

  return {
    stage: getString(result.stage) || "indexing",
    progress: Math.max(0, Math.min(100, input.progress || 0)),
    message: getString(result.message) || "Generating knowledge graph",
    chunkLabel: processed !== undefined && total !== undefined ? `${processed} / ${total} chunks` : null,
    heartbeatLabel,
    isSlow,
  };
}
