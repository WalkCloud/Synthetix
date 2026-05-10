export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getQueue } = await import("@/lib/queue");
    const queue = getQueue();
    void queue.processNext();
    console.log("[queue] Task queue initialized");
  }
}
