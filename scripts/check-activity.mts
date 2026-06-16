import { db } from "../src/lib/db";

async function main() {
  const docs = await db.document.count();
  const drafts = await db.draft.count();
  const sections = await db.section.count();
  const messages = await db.message.count();
  const sessions = await db.brainstormSession.count();
  const tasks = await db.asyncTask.count();
  const usage = await db.tokenUsage.count();
  console.log({ docs, drafts, sections, messages, sessions, tasks, usage });
  
  const recentSections = await db.section.findMany({
    where: { content: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { id: true, title: true, status: true, wordCount: true, updatedAt: true },
  });
  console.log("Recent sections with content:");
  for (const s of recentSections) {
    console.log(`  ${s.updatedAt.toISOString()}  status=${s.status}  words=${s.wordCount}  ${s.title}`);
  }
  
  const recentMessages = await db.message.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, role: true, createdAt: true, sessionId: true },
  });
  console.log("Recent messages:");
  for (const m of recentMessages) {
    console.log(`  ${m.createdAt.toISOString()}  role=${m.role}  session=${m.sessionId.slice(0,8)}`);
  }
  
  await db.$disconnect();
}
main().catch(console.error);
