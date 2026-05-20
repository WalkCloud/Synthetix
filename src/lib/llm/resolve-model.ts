import { db } from "@/lib/db";
import { parseCapabilities } from "./capabilities";

type ModelWithProvider = NonNullable<
  Awaited<ReturnType<typeof db.modelConfig.findFirst<{ include: { provider: true } }>>>
>;

function defaultSlotForCapability(capability: string): "llm" | "embedding" | "image" {
  if (capability === "embedding" || capability === "embed") return "embedding";
  if (capability === "image_generation" || capability === "image") return "image";
  return "llm";
}

function matchesCapability(rawCapabilities: unknown, capability: string): boolean {
  const caps = parseCapabilities(rawCapabilities);
  return (
    caps.includes(capability) ||
    (capability === "writing" && caps.includes("chat")) ||
    (capability === "chat" && caps.includes("writing"))
  );
}

export async function resolveModel(capability: string): Promise<ModelWithProvider | null> {
  const defaultFor = defaultSlotForCapability(capability);
  const scopedDefault = await db.modelConfig.findFirst({
    where: { isDefaultFor: defaultFor },
    include: { provider: true },
  });

  if (scopedDefault && matchesCapability(scopedDefault.capabilities, capability)) {
    return scopedDefault;
  }

  const legacyDefault = await db.modelConfig.findFirst({
    where: { isDefaultFor: "default" },
    include: { provider: true },
  });

  if (legacyDefault && matchesCapability(legacyDefault.capabilities, capability)) {
    return legacyDefault;
  }

  const all = await db.modelConfig.findMany({ include: { provider: true } });
  return (
    all.find((m) => matchesCapability(m.capabilities, capability)) || null
  );
}
