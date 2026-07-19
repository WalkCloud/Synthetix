import type { Locale, TranslationSchema } from "@/lib/i18n";

type CountTemplates = { one: string; other: string };
type TopologyCounts = TranslationSchema["topology"]["counts"];

function applyCount(template: string, count: number): string {
  return template.replaceAll("{count}", String(count));
}

export function formatTopologyCount(
  count: number,
  locale: Locale,
  templates: CountTemplates,
): string {
  const category = new Intl.PluralRules(locale).select(count);
  return applyCount(category === "one" ? templates.one : templates.other, count);
}

export function formatTopologyStats(
  stats: {
    totalEntities?: number;
    totalRelations?: number;
    totalReferences?: number;
    uniqueDocuments?: number;
    mostReferencedDoc?: string | null;
  },
  locale: Locale,
  counts: TopologyCounts,
): string {
  if (stats.totalEntities !== undefined) {
    return counts.entityRelationSummary
      .replace("{entities}", formatTopologyCount(stats.totalEntities, locale, counts.entities))
      .replace("{relations}", formatTopologyCount(stats.totalRelations ?? 0, locale, counts.relations));
  }

  let result = counts.referenceDocumentSummary
    .replace("{references}", formatTopologyCount(stats.totalReferences ?? 0, locale, counts.references))
    .replace("{documents}", formatTopologyCount(stats.uniqueDocuments ?? 0, locale, counts.documents));

  if (stats.mostReferencedDoc) {
    result += ` · ${counts.mostReferenced.replace("{document}", stats.mostReferencedDoc)}`;
  }
  return result;
}
