import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/locales/en";
import zhCN from "@/lib/i18n/locales/zh-CN";
import {
  formatTopologyCount,
  formatTopologyStats,
} from "@/lib/i18n/topology-count";

describe("topology count localization", () => {
  it("uses English singular and plural forms for each topology noun", () => {
    const counts = en.topology.counts;

    expect(formatTopologyCount(1, "en", counts.entities)).toBe("1 entity");
    expect(formatTopologyCount(2, "en", counts.entities)).toBe("2 entities");
    expect(formatTopologyCount(1, "en", counts.relations)).toBe("1 relation");
    expect(formatTopologyCount(2, "en", counts.references)).toBe("2 references");
    expect(formatTopologyCount(1, "en", counts.documents)).toBe("1 document");
    expect(formatTopologyCount(2, "en", counts.refs)).toBe("2 refs");
    expect(formatTopologyCount(1, "en", counts.sections)).toBe("1 section");
  });

  it("uses Chinese templates without applying English plural rules", () => {
    const counts = zhCN.topology.counts;

    expect(formatTopologyCount(1, "zh-CN", counts.entities)).toBe("1 个实体");
    expect(formatTopologyCount(3, "zh-CN", counts.entities)).toBe("3 个实体");
    expect(formatTopologyCount(2, "zh-CN", counts.relations)).toBe("2 条关系");
    expect(formatTopologyCount(4, "zh-CN", counts.references)).toBe("4 条引用");
    expect(formatTopologyCount(2, "zh-CN", counts.documents)).toBe("2 个文档");
    expect(formatTopologyCount(5, "zh-CN", counts.refs)).toBe("5 条引用");
    expect(formatTopologyCount(6, "zh-CN", counts.sections)).toBe("6 个章节");
  });

  it("formats complete stats sentences and the most-referenced label", () => {
    expect(formatTopologyStats({ totalEntities: 1, totalRelations: 2 }, "en", en.topology.counts)).toBe(
      "1 entity · 2 relations",
    );
    expect(formatTopologyStats({ totalReferences: 1, uniqueDocuments: 2, mostReferencedDoc: "Guide" }, "en", en.topology.counts)).toBe(
      "1 reference from 2 documents · most referenced: Guide",
    );
    expect(formatTopologyStats({ totalReferences: 3, uniqueDocuments: 1, mostReferencedDoc: "指南" }, "zh-CN", zhCN.topology.counts)).toBe(
      "3 条引用，来自 1 个文档 · 最常引用：指南",
    );
  });
});
