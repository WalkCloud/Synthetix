import { db } from "@/lib/db";

type ModelWithProvider = NonNullable<
  Awaited<ReturnType<typeof db.modelConfig.findFirst<{ include: { provider: true } }>>>
>;

export async function resolveModel(capability: string): Promise<ModelWithProvider | null> {
  let model = await db.modelConfig.findFirst({
    where: { isDefaultFor: capability },
    include: { provider: true },
  });

  if (!model) {
    const all = await db.modelConfig.findMany({ include: { provider: true } });
    model = all.find((m) => {
      try { return JSON.parse(m.capabilities as string).includes(capability); } catch { return false; }
    }) || null;
  }

  return model;
}
