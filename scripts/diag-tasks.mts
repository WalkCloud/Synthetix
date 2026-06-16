import { db } from "../src/lib/db";

async function main() {
  console.log("=== rag_embed_index task inputData ===");
  const tasks = await db.asyncTask.findMany({
    where: { type: "rag_embed_index" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, status: true, inputData: true, resultData: true, createdAt: true },
  });
  for (const t of tasks) {
    console.log(`\n  task ${t.id.slice(0,8)}  ${t.status}  ${t.createdAt.toISOString()}`);
    console.log(`  inputData : ${t.inputData}`);
    console.log(`  resultData: ${(t.resultData ?? "").slice(0, 200)}`);
  }

  console.log("\n=== Sample chunks for one doc ===");
  const sample = await db.documentChunk.findMany({
    take: 3,
    select: { id: true, documentId: true, embedModel: true, embedding: true },
  });
  for (const c of sample) {
    console.log(`  chunk ${c.id.slice(0,8)} doc=${c.documentId.slice(0,8)} embedModel=${c.embedModel ?? "(null)"} hasEmb=${!!c.embedding}`);
  }

  await db.$disconnect();
}
main().catch(console.error);
