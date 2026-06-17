import { describe, expect, it } from "vitest";
import { buildDiagramGenerationPrompt } from "@/lib/writing/diagram-prompt";

describe("diagram generation prompt", () => {
  it("keeps deployment topology prompts from becoming flowchart prompts", () => {
    const prompt = buildDiagramGenerationPrompt({
      type: "deployment",
      title: "传统基础设施资源层部署现状",
      purpose: "展示烟囱式业务系统与 x86、信创多资源池的物理隔离状态，清晰呈现资源孤岛的形成逻辑",
      nodes: "核心账务系统,惠农支付系统,网点运营系统,x86物理机资源池,VMware虚拟化资源池,海光信创资源池,鲲鹏信创资源池,x86运维管控单元,虚拟化运维管控单元,信创运维管控单元",
      flows: "核心账务系统->>独占x86物理机资源池,惠农支付系统->>独占VMware虚拟化资源池,网点运营系统->>独占海光信创资源池,x86运维管控单元->>仅管控x86物理机资源池",
    });

    expect(prompt).toContain("infrastructure topology");
    expect(prompt).toContain("physical isolation");
    expect(prompt).toContain("resource pools");
    expect(prompt).toContain("relationships:");
    expect(prompt).not.toContain("Flows:");
  });

  it("preserves explicit flows for flowcharts", () => {
    const prompt = buildDiagramGenerationPrompt({
      type: "flowchart",
      title: "审批流程",
      purpose: "展示审批步骤",
      nodes: "申请,审核,批准",
      flows: "申请->审核,审核->批准",
    });

    expect(prompt).toContain("flowchart diagram");
    expect(prompt).toContain("Flows: 申请->审核,审核->批准");
  });
});
