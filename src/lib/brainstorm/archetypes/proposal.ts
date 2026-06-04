import type { ArchetypeSkill } from "./index";

const skill: ArchetypeSkill = {
  id: "proposal",
  label: {
    en: "Justification / Approval Documents",
    "zh-CN": "立项/可研报告",
  },
  useWhen: {
    en: "project initiation reports, feasibility studies, investment proposals, funding requests",
    "zh-CN": "立项报告、可行性研究、投资方案、资金申请",
  },
  principle: {
    en: "necessity first, then feasibility, then investment and benefits",
    "zh-CN": "先讲必要性，再讲可行性，最后讲投入产出",
  },
  skeleton: {
    en: "Background & Necessity -> Feasibility Analysis (technical / economic / operational) -> Solution Overview -> Investment Estimate -> Benefit & Risk Analysis -> Safeguards & Schedule",
    "zh-CN": "项目背景 -> 必要性分析 -> 可行性分析 -> 建设方案概述 -> 投资估算 -> 效益与风险分析 -> 组织保障与进度安排",
  },
  focus: {
    en: "policy or data-backed necessity claims, quantified investment and benefits, mitigation plans for identified risks",
    "zh-CN": "必要性需有政策或数据支撑，投资和效益必须量化",
  },
};

export default skill;
