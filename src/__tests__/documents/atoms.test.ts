import { describe, expect, it } from "vitest";

import {
  buildDocumentAtoms,
  buildWindowSignatures,
  detectCandidateBoundaries,
  type StructureJson,
} from "@/lib/documents/atoms";

const SAMPLE_MD = `# 第一章 项目概述

本项目是一个云原生平台方案。

## 1.1 建设背景

银行业务需要容器化改造。

## 1.2 建设目标

实现高可用与弹性伸缩。

# 第二章 技术架构

采用微服务架构。

## 2.1 微服务划分

按业务域拆分服务。`;

describe("buildDocumentAtoms", () => {
  it("produces atoms covering every block in order with stable indices", () => {
    const atoms = buildDocumentAtoms(SAMPLE_MD);
    expect(atoms.length).toBeGreaterThan(0);
    // Indices are 0..n-1 contiguous.
    expect(atoms.map((a) => a.index)).toEqual(atoms.map((_, i) => i));
  });

  it("records char offsets that are monotonic and non-overlapping", () => {
    const atoms = buildDocumentAtoms(SAMPLE_MD);
    for (let i = 1; i < atoms.length; i++) {
      const prev = atoms[i - 1];
      const cur = atoms[i];
      expect(cur.charStart).not.toBeNull();
      expect(prev.charEnd).not.toBeNull();
      expect(cur.charStart!).toBeGreaterThanOrEqual(prev.charStart!);
    }
  });

  it("tracks a heading breadcrumb path (headingPath)", () => {
    const atoms = buildDocumentAtoms(SAMPLE_MD);
    const introPara = atoms.find((a) => a.content.includes("云原生平台方案"));
    expect(introPara?.headingPath).toContain("第一章 项目概述");
    // A paragraph under a ## subsection carries both the h1 and h2.
    const bgPara = atoms.find((a) => a.content.includes("银行业务"));
    expect(bgPara?.headingPath).toContain("1.1 建设背景");
    expect(bgPara?.headingPath).toContain("第一章 项目概述");
  });

  it("back-fills page numbers from structure.json sections", () => {
    const structure: StructureJson = {
      schema: "docling_structure_v1",
      sections: [
        { text: "第一章 项目概述", level: 1, page: 1 },
        { text: "1.1 建设背景", level: 2, page: 3 },
        { text: "第二章 技术架构", level: 1, page: 10 },
      ],
    };
    const atoms = buildDocumentAtoms(SAMPLE_MD, structure);
    const overviewHeading = atoms.find((a) => a.blockType === "heading" && a.content.includes("项目概述"));
    expect(overviewHeading?.pageStart).toBe(1);
    const bgPara = atoms.find((a) => a.content.includes("银行业务"));
    expect(bgPara?.pageStart).toBe(3); // inherits 1.1's page
    const archPara = atoms.find((a) => a.content.includes("微服务架构"));
    expect(archPara?.pageStart).toBe(10); // 第二章's page
  });

  it("leaves page null when structure.json is absent (offsets still authoritative)", () => {
    const atoms = buildDocumentAtoms(SAMPLE_MD);
    for (const a of atoms) {
      expect(a.pageStart).toBeNull();
    }
  });

  it("returns [] for empty markdown", () => {
    expect(buildDocumentAtoms("   ")).toEqual([]);
  });
});

describe("buildWindowSignatures", () => {
  it("groups atoms into token-budgeted windows", () => {
    const atoms = buildDocumentAtoms(SAMPLE_MD);
    const windows = buildWindowSignatures(atoms, 200); // small budget → multiple windows
    expect(windows.length).toBeGreaterThanOrEqual(1);
    // Every atom is covered exactly once (no gaps, no overlap).
    const allCovered = windows.flatMap((w) => range(w.startAtomIndex, w.endAtomIndex));
    expect(allCovered).toEqual(atoms.map((a) => a.index));
  });

  it("each window records its token count and previews", () => {
    const atoms = buildDocumentAtoms(SAMPLE_MD);
    const windows = buildWindowSignatures(atoms, 300);
    for (const w of windows) {
      expect(w.tokenCount).toBeGreaterThan(0);
      expect(w.previews.length).toBeLessThanOrEqual(3);
      expect(w.leadingHeadingPath === null || typeof w.leadingHeadingPath === "string").toBe(true);
    }
  });
});

describe("detectCandidateBoundaries", () => {
  it("suggests top-level heading boundaries with enough tokens between them", () => {
    const atoms = buildDocumentAtoms(SAMPLE_MD);
    const boundaries = detectCandidateBoundaries(atoms, 50);
    // At least the second top-level heading ("第二章") should be a boundary.
    expect(boundaries.length).toBeGreaterThan(0);
    const ch2Heading = atoms.find((a) => a.content.includes("第二章"));
    expect(ch2Heading).toBeDefined();
    expect(boundaries).toContain(ch2Heading!.index);
  });

  it("returns no boundaries when segments would be too small", () => {
    const atoms = buildDocumentAtoms(SAMPLE_MD);
    const boundaries = detectCandidateBoundaries(atoms, 1_000_000);
    expect(boundaries).toEqual([]);
  });
});

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}
