import { db } from "../src/lib/db";

async function main() {
  const all = await db.modelConfig.findMany({
    select: { id: true, modelName: true, modelId: true, capabilities: true, isDefaultFor: true, provider: { select: { name: true, userId: true } } },
  });
  console.log("All ModelConfigs:");
  for (const c of all) {
    console.log(`  ${c.id.slice(0,8)}  modelName=${c.modelName.padEnd(28)}  caps=${c.capabilities.padEnd(20)}  isDefaultFor=${(c.isDefaultFor??"-").padEnd(10)}  provider=${c.provider.name}  user=${c.provider.userId.slice(0,8)}`);
  }
  await db.$disconnect();
}
main().catch(console.error);
