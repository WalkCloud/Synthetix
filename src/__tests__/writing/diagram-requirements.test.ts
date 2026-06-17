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

  it("uses topology relationships instead of flow arrows for deployment isolation diagrams", () => {
    const content = ensureRequiredDiagramRequest(
      "传统基础设施资源层部署现状说明烟囱式业务系统与资源池物理隔离。",
      {
        title: "传统基础设施资源层部署现状",
        description: "展示烟囱式业务系统与 x86、信创多资源池的物理隔离状态，呈现资源孤岛形成逻辑",
        keyPoints: "核心账务系统, 惠农支付系统, 网点运营系统, x86物理机资源池, VMware虚拟化资源池, 海光信创资源池, 鲲鹏信创资源池",
      },
    );

    expect(content).toContain("type=deployment");
    expect(content).toContain("relationships=derive topology, ownership, management scope, and isolation boundaries from the section content");
    expect(content).not.toContain("flows=derive from the section content");
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
