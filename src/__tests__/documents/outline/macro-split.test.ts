import { describe, it, expect } from "vitest";
import { splitByMacroAST } from "@/lib/documents/outline/macro-split";

const sampleMd = `# Introduction

This is the intro paragraph with background info.

## Architecture

The system uses a microservice architecture.

## Deployment

Deployment uses Kubernetes with Helm.

| Service | Port |
|---------|------|
| A       | 8080 |

## Security

Security is handled at multiple layers.
`;

const docxStyleMd = `项目总体概述

项目建设背景

备注：根据具体项目情况，补充完整。

项目建设需求

备注：根据具体项目情况，补充完整。

项目建设目标

备注：根据具体项目情况，补充完整。

平台建设核心

平台是企业技术集大成者，为其它中台提供高性能且敏捷的架构、开发运维一体化的交付支撑、稳定高效与弹性伸缩的运行能力、开放融合共享的技术服务体系。

以建为基

实施建设规划，快速构建容器、DevOps、应用架构平台、中间件数据服务四位一体的PaaS中台。

以用为本

平台的承载应用的规模是PaaS中台落地效果的直观体现，平台实施的核心是应用的迁移和运行支撑。
`;

describe("splitByMacroAST", () => {
  it("splits on H1 and H2 boundaries", () => {
    const chunks = splitByMacroAST(sampleMd);

    expect(chunks.length).toBeGreaterThan(1);

    const headings = chunks.filter((c) => !c.isAtomic);
    expect(headings.some((c) => c.h2 === "Architecture")).toBe(true);
    expect(headings.some((c) => c.h2 === "Deployment")).toBe(true);
    expect(headings.some((c) => c.h2 === "Security")).toBe(true);
  });

  it("marks tables as atomic", () => {
    const chunks = splitByMacroAST(sampleMd);
    const tables = chunks.filter((c) => c.isAtomic);
    expect(tables.length).toBe(1);
    expect(tables[0].content).toContain("| Service | Port |");
  });

  it("includes headingPath metadata", () => {
    const chunks = splitByMacroAST(sampleMd);

    for (const chunk of chunks) {
      if (chunk.isAtomic) continue;
      expect(chunk.headingPath).toBeTruthy();
      expect(chunk.h1).toBeTruthy();
    }
  });

  it("estimates token count for each chunk", () => {
    const chunks = splitByMacroAST(sampleMd);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it("detects plain-text headings in DOCX-style documents", () => {
    const chunks = splitByMacroAST(docxStyleMd);

    const headings = chunks.filter((c) => c.h2 !== null);
    expect(headings.length).toBeGreaterThanOrEqual(2);
    expect(headings.some((c) => c.h2 === "项目建设背景")).toBe(true);
    expect(headings.some((c) => c.h2 === "以建为基")).toBe(true);
  });

  it("produces headingPath for DOCX-style documents", () => {
    const chunks = splitByMacroAST(docxStyleMd);

    const withPath = chunks.filter((c) => c.headingPath.length > 0);
    expect(withPath.length).toBeGreaterThan(0);
    expect(withPath.some((c) => c.headingPath.includes("项目总体概述"))).toBe(true);
  });
});
