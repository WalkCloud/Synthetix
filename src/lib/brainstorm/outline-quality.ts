import type { GeneratedOutline } from "@/lib/brainstorm/outline-normalizer";
import type { OutlineSection } from "@/lib/outline-tree";

export interface OutlineQualityOptions {
  minLeafCount?: number;
  minDepth?: number;
  minTopLevelCount?: number;
  maxTopLevelCount?: number;
  lengthHint?: string;
  /**
   * When false, skip the per-leaf detail-field checks (missingDescription,
   * missingKeyPoints). Use this at the skeleton stage, where the skeleton
   * prompt deliberately omits detail fields — they are filled in later by
   * the enrichment stage. Defaults to true (full check).
   */
  checkDetailFields?: boolean;
}

export interface OutlineQualityResult {
  ok: boolean;
  leafCount: number;
  maxDepth: number;
  topLevelCount: number;
  totalEstimatedWords: number;
  issues: string[];
}

interface OutlineStats {
  leafCount: number;
  maxDepth: number;
  totalEstimatedWords: number;
  missingDescription: number;
  missingKeyPoints: number;
}

function minLeafCountForLength(lengthHint?: string): number {
  if (!lengthHint) return 8;
  if (/10\s*,?\s*000|10000|full/i.test(lengthHint)) return 15;
  if (/5\s*,?\s*000|5000|8\s*,?\s*000|8000|standard/i.test(lengthHint)) return 10;
  return 8;
}

function collectStats(sections: OutlineSection[], depth = 1): OutlineStats {
  return sections.reduce<OutlineStats>((stats, section) => {
    const children = section.children ?? [];
    stats.totalEstimatedWords += section.estimatedWords ?? 0;
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    if (children.length === 0) {
      stats.leafCount += 1;
      if (!section.description?.trim()) stats.missingDescription += 1;
      if (!section.keyPoints?.length) stats.missingKeyPoints += 1;
      return stats;
    }

    const childStats = collectStats(children, depth + 1);
    stats.leafCount += childStats.leafCount;
    stats.maxDepth = Math.max(stats.maxDepth, childStats.maxDepth);
    stats.totalEstimatedWords += childStats.totalEstimatedWords;
    stats.missingDescription += childStats.missingDescription;
    stats.missingKeyPoints += childStats.missingKeyPoints;
    return stats;
  }, { leafCount: 0, maxDepth: depth, totalEstimatedWords: 0, missingDescription: 0, missingKeyPoints: 0 });
}

function plural(count: number, singular: string, pluralText: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${pluralText}`;
}

export function evaluateOutlineQuality(
  outline: GeneratedOutline,
  options: OutlineQualityOptions = {},
): OutlineQualityResult {
  const topLevelCount = outline.sections.length;
  const minTopLevelCount = options.minTopLevelCount ?? 4;
  const maxTopLevelCount = options.maxTopLevelCount ?? 8;
  const minDepth = options.minDepth ?? 2;
  const minLeafCount = options.minLeafCount ?? minLeafCountForLength(options.lengthHint);
  const checkDetailFields = options.checkDetailFields ?? true;
  const stats = collectStats(outline.sections);
  const issues: string[] = [];

  if (topLevelCount < minTopLevelCount) {
    issues.push(`Expected at least ${minTopLevelCount} top-level sections, got ${topLevelCount}`);
  }
  if (topLevelCount > maxTopLevelCount) {
    issues.push(`Expected at most ${maxTopLevelCount} top-level sections, got ${topLevelCount}`);
  }
  if (stats.maxDepth < minDepth) {
    issues.push(`Expected hierarchy depth of at least ${minDepth}, got ${stats.maxDepth}`);
  }
  if (stats.leafCount < minLeafCount) {
    issues.push(`Expected at least ${minLeafCount} leaf sections, got ${stats.leafCount}`);
  }
  if (checkDetailFields && stats.missingDescription > 0) {
    issues.push(`${plural(stats.missingDescription, "leaf section is", "leaf sections are")} missing description`);
  }
  if (checkDetailFields && stats.missingKeyPoints > 0) {
    issues.push(`${plural(stats.missingKeyPoints, "leaf section is", "leaf sections are")} missing keyPoints`);
  }

  return {
    ok: issues.length === 0,
    leafCount: stats.leafCount,
    maxDepth: stats.maxDepth,
    topLevelCount,
    totalEstimatedWords: stats.totalEstimatedWords,
    issues,
  };
}
