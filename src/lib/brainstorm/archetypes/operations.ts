import type { ArchetypeSkill } from "./index";

const skill: ArchetypeSkill = {
  id: "operations",
  label: {
    en: "Operations / Management Documents",
    "zh-CN": "运营/管理文档",
  },
  useWhen: {
    en: "operations plans, management systems, emergency procedures, SLAs",
    "zh-CN": "运营方案、管理制度、应急预案、服务等级协议",
  },
  principle: {
    en: "clear responsibilities, executable processes, emergency readiness",
    "zh-CN": "责任明确 -> 可执行流程 -> 应急准备",
  },
  skeleton: {
    en: "Overview & Scope -> Organization & Responsibilities -> Standard Procedures -> Monitoring & Alerts -> Emergency Response -> Performance Review & Continuous Improvement",
    "zh-CN": "概述与范围 -> 组织与职责 -> 标准流程 -> 监控与告警 -> 应急响应 -> 绩效考核",
  },
  focus: {
    en: "explicit process steps with role owners, tiered emergency response levels, measurable KPIs and SLAs",
    "zh-CN": "明确流程步骤及责任人、分级应急响应、可量化的 KPI",
  },
};

export default skill;
