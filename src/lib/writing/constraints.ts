import type { ContextInput } from "@/lib/writing/context";

export interface SectionConstraintData {
  outlineNumber?: string;
  additionalRequirements?: string;
  writingRequirements?: string;
  retrievalQuery?: string;
  referenceHints?: string[];
  _audit?: unknown;
}

export function parseSectionConstraints(value?: string | null): SectionConstraintData {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const obj = parsed as Record<string, unknown>;
    return {
      outlineNumber: typeof obj.outlineNumber === "string" ? obj.outlineNumber : undefined,
      additionalRequirements: typeof obj.additionalRequirements === "string" ? obj.additionalRequirements : undefined,
      writingRequirements: typeof obj.writingRequirements === "string" ? obj.writingRequirements : undefined,
      retrievalQuery: typeof obj.retrievalQuery === "string" ? obj.retrievalQuery : undefined,
      referenceHints: Array.isArray(obj.referenceHints)
        ? obj.referenceHints.filter((item): item is string => typeof item === "string")
        : undefined,
      _audit: obj._audit,
    };
  } catch {
    return {};
  }
}

function stringifySectionConstraints(value: SectionConstraintData): string | null {
  const cleaned: SectionConstraintData = {};
  if (value.outlineNumber) cleaned.outlineNumber = value.outlineNumber;
  if (value.additionalRequirements) cleaned.additionalRequirements = value.additionalRequirements;
  if (value.writingRequirements) cleaned.writingRequirements = value.writingRequirements;
  if (value.retrievalQuery) cleaned.retrievalQuery = value.retrievalQuery;
  if (value.referenceHints?.length) cleaned.referenceHints = value.referenceHints;
  if (value._audit !== undefined) cleaned._audit = value._audit;
  return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
}

export function mergeSectionConstraints(
  existingValue: string | null | undefined,
  updates: SectionConstraintData,
): string | null {
  const existing = parseSectionConstraints(existingValue);
  return stringifySectionConstraints({
    ...existing,
    ...updates,
    referenceHints: updates.referenceHints ?? existing.referenceHints,
  });
}

export function buildEffectiveConstraints(
  sectionConstraints?: string | null,
  requestConstraints?: ContextInput["constraints"],
): ContextInput["constraints"] {
  const hidden = parseSectionConstraints(sectionConstraints);
  const hasHidden =
    Boolean(hidden.additionalRequirements) ||
    Boolean(hidden.writingRequirements) ||
    Boolean(hidden.retrievalQuery) ||
    Boolean(hidden.referenceHints?.length);

  if (!requestConstraints && !hasHidden) {
    return undefined;
  }

  const requestAdditional = requestConstraints?.additionalRequirements?.trim();
  const persistedAdditional = hidden.additionalRequirements?.trim();
  const writingRequirements = hidden.writingRequirements?.trim();
  const additionalRequirements = [
    writingRequirements,
    requestAdditional || persistedAdditional,
  ].filter(Boolean).join("\n");

  return {
    ...requestConstraints,
    additionalRequirements: additionalRequirements || requestAdditional || persistedAdditional,
    retrievalQuery: hidden.retrievalQuery,
    referenceHints: hidden.referenceHints,
    writingRequirements: hidden.writingRequirements,
  };
}
