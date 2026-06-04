import { describe, expect, it } from "vitest";
import {
  ensureRequiredDiagramRequest,
  sectionNeedsDiagram,
} from "@/lib/writing/diagram-requirements";

describe("section diagram requirements", () => {
  it("detects Chinese architecture and topology sections", () => {
    expect(sectionNeedsDiagram({
      title: "总体架构设计",
      description: "说明系统架构、部署拓扑和模块关系",
      keyPoints: null,
    })).toBe(true);
  });

  it("detects explicit diagram requests from additional requirements", () => {
    expect(sectionNeedsDiagram(
      { title: "建设方案", description: null, keyPoints: null },
      { additionalRequirements: "本章节必须包含架构图，说明系统模块关系" },
    )).toBe(true);
  });

  it("does not force diagrams for plain conceptual sections", () => {
    expect(sectionNeedsDiagram({
      title: "项目背景",
      description: "介绍项目建设背景和必要性",
      keyPoints: JSON.stringify(["政策背景", "建设必要性"]),
    })).toBe(false);
  });

  it("adds a diagram request when required and missing", () => {
    const content = ensureRequiredDiagramRequest(
      "This section explains the deployment design.",
      { title: "Deployment Architecture", description: "Show deployment topology", keyPoints: "gateway, services, database" },
    );

    expect(content).toContain("[DIAGRAM_REQUEST:");
    expect(content).toContain("type=deployment");
    expect(content).toContain("title=Deployment Architecture diagram");
  });

  it("does not duplicate existing diagram requests", () => {
    const existing = [
      "Architecture overview.",
      "[DIAGRAM_REQUEST:",
      "type=architecture",
      "title=Existing",
      "purpose=Show architecture",
      "]",
    ].join("\n");

    const content = ensureRequiredDiagramRequest(
      existing,
      { title: "Architecture", description: "Architecture overview", keyPoints: null },
    );

    expect(content.match(/\[DIAGRAM_REQUEST:/g)).toHaveLength(1);
  });
});
