import { db } from "@/lib/db";
import { parseCapabilities } from "./capabilities";

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
      const caps = parseCapabilities(m.capabilities);
      if (capability === "writing" && caps.includes("chat")) return true;
      return caps.includes(capability);
    }) || null;
  }

  return model;
}
