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
});
