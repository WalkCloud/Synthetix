import { describe, it, expect } from "vitest";
import { splitByMacroAST, coalesceMacroChunks, type MacroChunk } from "@/lib/documents/outline/macro-split";

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
  it("splits on H1 and H2 boundaries", async () => {
    const chunks = await splitByMacroAST(sampleMd);

    expect(chunks.length).toBeGreaterThan(1);

    const headings = chunks.filter((c) => !c.isAtomic);
    expect(headings.some((c) => c.h2 === "Architecture")).toBe(true);
    expect(headings.some((c) => c.h2 === "Deployment")).toBe(true);
    expect(headings.some((c) => c.h2 === "Security")).toBe(true);
  });

  it("keeps markdown headings in chunk content", async () => {
    const chunks = await splitByMacroAST(sampleMd);

    const architecture = chunks.find((c) => c.h2 === "Architecture");
    expect(architecture?.content).toContain("## Architecture");
    expect(architecture?.content).toContain("The system uses a microservice architecture.");
  });

  it("does not promote H3 headings into H2 boundaries", async () => {
    const chunks = await splitByMacroAST(`# Guide\n\n## Setup\n\nIntro.\n\n### Details\n\nMore detail.`);

    const nonAtomic = chunks.filter((c) => !c.isAtomic);
    expect(nonAtomic).toHaveLength(1);
    expect(nonAtomic[0].h2).toBe("Setup");
    expect(nonAtomic[0].content).toContain("### Details");
  });

  it("marks tables as atomic", async () => {
    const chunks = await splitByMacroAST(sampleMd);
    const tables = chunks.filter((c) => c.isAtomic);
    expect(tables.length).toBe(1);
    expect(tables[0].content).toContain("| Service | Port |");
  });

  it("includes headingPath metadata", async () => {
    const chunks = await splitByMacroAST(sampleMd);

    for (const chunk of chunks) {
      if (chunk.isAtomic) continue;
      expect(chunk.headingPath).toBeTruthy();
      expect(chunk.h1).toBeTruthy();
    }
  });

  it("estimates token count for each chunk", async () => {
    const chunks = await splitByMacroAST(sampleMd);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it("detects plain-text headings in DOCX-style documents", async () => {
    const chunks = await splitByMacroAST(docxStyleMd);

    const headings = chunks.filter((c) => c.h2 !== null);
    expect(headings.length).toBeGreaterThanOrEqual(2);
    expect(headings.some((c) => c.h2 === "项目建设背景")).toBe(true);
    expect(headings.some((c) => c.h2 === "以建为基")).toBe(true);
  });

  it("produces headingPath for DOCX-style documents", async () => {
    const chunks = await splitByMacroAST(docxStyleMd);

    const withPath = chunks.filter((c) => c.headingPath.length > 0);
    expect(withPath.length).toBeGreaterThan(0);
    expect(withPath.some((c) => c.headingPath.includes("项目总体概述"))).toBe(true);
  });

  it("keeps plain-text headings in DOCX-style chunk content", async () => {
    const chunks = await splitByMacroAST(docxStyleMd);

    const background = chunks.find((c) => c.h2 === "项目建设背景");
    expect(background?.content).toContain("项目建设背景");
    expect(background?.content).toContain("备注：根据具体项目情况，补充完整。");
  });
});

describe("coalesceMacroChunks", () => {
  it("merges adjacent small non-atomic chunks", () => {
    const chunks: MacroChunk[] = [
      { headingPath: "H1", h1: "H1", h2: null, content: "a".repeat(20), tokenCount: 15, isAtomic: false },
      { headingPath: "H1 > A", h1: "H1", h2: "A", content: "b".repeat(20), tokenCount: 15, isAtomic: false },
      { headingPath: "H1 > B", h1: "H1", h2: "B", content: "c".repeat(20), tokenCount: 15, isAtomic: false },
    ];

    const merged = coalesceMacroChunks(chunks, 50);
    expect(merged.length).toBe(1); // all 3 merged since 15*3=45 <= 50
  });

  it("merges small chunks across heading changes", async () => {
    const chunks = await splitByMacroAST(`# Manual\n\n## A\n\nAlpha.\n\n## B\n\nBeta.\n\n## C\n\nGamma.`);

    const merged = coalesceMacroChunks(chunks, 500);

    expect(merged).toHaveLength(1);
    expect(merged[0].content).toContain("## A");
    expect(merged[0].content).toContain("## B");
    expect(merged[0].content).toContain("## C");
    // Content-aware title uses first sentence of merged content
    expect(merged[0].headingPath).toContain("Manual");
  });

  it("does not merge atomic chunks", () => {
    const chunks: MacroChunk[] = [
      { headingPath: "H1", h1: "H1", h2: null, content: "a".repeat(20), tokenCount: 15, isAtomic: false },
      { headingPath: "H1", h1: "H1", h2: null, content: "| table |", tokenCount: 15, isAtomic: true },
      { headingPath: "H1 > A", h1: "H1", h2: "A", content: "b".repeat(20), tokenCount: 15, isAtomic: false },
    ];

    const merged = coalesceMacroChunks(chunks, 50);
    expect(merged.length).toBe(3); // atomic prevents merge
    expect(merged[1].isAtomic).toBe(true);
  });

  it("stops merging when combined exceeds minTokens", () => {
    const chunks: MacroChunk[] = [
      { headingPath: "H1", h1: "H1", h2: null, content: "a".repeat(100), tokenCount: 50, isAtomic: false },
      { headingPath: "H1 > A", h1: "H1", h2: "A", content: "b".repeat(100), tokenCount: 50, isAtomic: false },
      { headingPath: "H1 > B", h1: "H1", h2: "B", content: "c".repeat(100), tokenCount: 50, isAtomic: false },
    ];

    const merged = coalesceMacroChunks(chunks, 80);
    expect(merged.length).toBe(3);
  });
});

describe("splitByMacroAST — code-comment and caption guards", () => {
  // Reproduces the "weird chunk name" bug: Docling emits shell/Dockerfile code
  // blocks WITHOUT ``` fences, so a `# comment` line matches the heading regex
  // and hijacks currentH1, mis-grouping every following chunk.
  it("does not promote a `#` shell comment embedded in code to an H1", async () => {
    const md = [
      "# 真实章节标题",
      "",
      "正文导言段落。",
      "",
      "tar -xvf package-1.0.tar.gz",
      "# 编译安装",
      "yum install -y gcc make",
      "",
    ].join("\n");

    const chunks = await splitByMacroAST(md);

    expect(chunks.some((c) => c.h1 === "编译安装")).toBe(false);
    expect(chunks.some((c) => c.h1 === "真实章节标题")).toBe(true);
    // The comment text is preserved as content under the real heading.
    expect(chunks.some((c) => c.content.includes("# 编译安装"))).toBe(true);
  });

  it("does not promote figure captions, bold lines, or list items to headings", async () => {
    const md = [
      "文档主标题",
      "",
      "这是正文内容描述段落。",
      "",
      "图 1.2-7 系统总体架构图",
      "",
      "架构图的说明文字。",
      "",
      "**自定义容器内部命令检测**",
      "",
      "加粗小节之后的正文。",
      "",
      "- 金融级高可用能力",
      "",
      "列表项之后的正文描述。",
    ].join("\n");

    const chunks = await splitByMacroAST(md);
    const paths = chunks.map((c) => c.headingPath);

    expect(paths.some((p) => p.includes("系统总体架构图"))).toBe(false);
    expect(paths.some((p) => p.includes("自定义容器内部命令检测"))).toBe(false);
    expect(paths.some((p) => p.includes("金融级高可用能力"))).toBe(false);
    // The real document title is still recognized.
    expect(chunks.some((c) => c.h1 === "文档主标题")).toBe(true);
  });

  it("still recognizes real # / ## headings around code (regression)", async () => {
    const md = [
      "# 1 项目技术方案",
      "",
      "这是方案概述。",
      "",
      "## 1.1 系统架构",
      "",
      "架构详情描述。",
      "",
      "```bash",
      "tar -xvf app.tar.gz",
      "yum install -y httpd",
      "```",
      "",
      "## 1.2 部署流程",
      "",
      "部署说明。",
    ].join("\n");

    const chunks = await splitByMacroAST(md);

    expect(chunks.some((c) => c.h1 === "1 项目技术方案")).toBe(true);
    expect(chunks.some((c) => c.h2 === "1.1 系统架构")).toBe(true);
    expect(chunks.some((c) => c.h2 === "1.2 部署流程")).toBe(true);
  });

  // Docling mis-emits whole sentences, notes, and code flags as `#` headings.
  // These are NOT section titles and must be demoted to body content.
  it("demotes Docling `#` sentences, notes, and code flags to body content", async () => {
    const md = [
      "# 真实根章节",
      "",
      "正文段落。",
      "",
      "# 注意：此处会访问互联网下载依赖包。",
      "",
      "说明文字。",
      "",
      "# WORKDIR指令便于后续指令使用相对路径，以简化脚本",
      "",
      "更多说明。",
      "",
      "# -e 若指令传回值不等于0，则立即退出shell",
      "",
      "结尾说明。",
    ].join("\n");

    const chunks = await splitByMacroAST(md);
    const h1s = new Set(chunks.map((c) => c.h1));

    expect(h1s.has("真实根章节")).toBe(true);
    // None of the sentence / note / code-flag `#` lines become an H1.
    expect(h1s.has("注意：此处会访问互联网下载依赖包。")).toBe(false);
    expect(h1s.has("WORKDIR指令便于后续指令使用相对路径，以简化脚本")).toBe(false);
    expect(h1s.has("-e 若指令传回值不等于0，则立即退出shell")).toBe(false);
  });
});
