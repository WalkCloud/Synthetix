import { db } from "../src/lib/db";

async function main() {
  console.log("=== Async tasks by type/status ===");
  const tasks = await db.asyncTask.groupBy({
    by: ["type", "status"],
    _count: true,
  });
  tasks.sort((a, b) => (a.type + a.status).localeCompare(b.type + b.status));
  for (const t of tasks) {
    console.log(`  ${t.type.padEnd(28)} ${t.status.padEnd(12)} count=${t._count}`);
  }

  console.log("\n=== Documents (full) ===");
  const docs = await db.document.findMany({
    select: { id: true, originalName: true, status: true, createdAt: true, userId: true },
  });
  for (const d of docs) {
    const chunkCount = await db.documentChunk.count({ where: { documentId: d.id } });
    console.log(`  ${d.id.slice(0,8)}…  status=${d.status.padEnd(10)}  chunks=${chunkCount}  user=${d.userId.slice(0,8)}  ${d.originalName}`);
  }

  console.log("\n=== Document chunks with embeddings ===");
  const totalChunks = await db.documentChunk.count();
  const embeddedChunks = await db.documentChunk.count({ where: { embedding: { not: null } } });
  console.log(`  total chunks: ${totalChunks}`);
  console.log(`  with embedding: ${embeddedChunks}`);
  console.log(`  → ${embeddedChunks > 0 ? "embeddings WERE produced but token usage NOT recorded for them" : "no embeddings"}`);

  console.log("\n=== Recent rag_embed_index tasks ===");
  const ragTasks = await db.asyncTask.findMany({
    where: { type: { in: ["rag_embed_index", "rag_index", "document_convert"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, type: true, status: true, errorMessage: true, createdAt: true, inputData: true },
  });
  for (const t of ragTasks) {
    let docId = "?";
    try { docId = (JSON.parse(t.inputData ?? "{}") as any).docId?.slice(0,8) ?? "?"; } catch {}
    console.log(`  ${t.createdAt.toISOString()}  ${t.type.padEnd(20)}  ${t.status.padEnd(12)}  doc=${docId}  err=${t.errorMessage?.slice(0,60) ?? "-"}`);
  }

  console.log("\n=== TokenUsage table FK check ===");
  // Are there ANY rows for any user, any module?
  const all = await db.tokenUsage.findMany({ select: { userId: true, module: true, modelConfigId: true, createdAt: true } });
  console.log(`  total rows: ${all.length}`);
  for (const u of all) console.log(`    ${u.createdAt.toISOString()} user=${u.userId.slice(0,8)} module=${u.module} mc=${u.modelConfigId?.slice(0,8) ?? "(null)"}`);

  await db.$disconnect();
}
main().catch(console.error);
