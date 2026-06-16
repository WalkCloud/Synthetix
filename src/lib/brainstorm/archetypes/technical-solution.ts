import type { ArchetypeSkill } from "./index";

const skill: ArchetypeSkill = {
  id: "technical_solution",
  label: {
    en: "Construction / Implementation Proposals",
    "zh-CN": "建设/实施方案",
  },
  useWhen: {
    en: "technical proposals, system construction plans, digital transformation, implementation plans",
    "zh-CN": "技术方案、系统建设方案、数字化转型方案、实施方案",
  },
  principle: {
    en: "top-down, architecture-first, then details",
    "zh-CN": "先全局后局部，先架构后细节，逻辑自顶向下",
  },
  skeleton: {
    en: "Overview -> Requirements Analysis -> Overall Design -> Detailed Design -> Security & Operations -> Implementation Plan -> Training & Delivery",
    "zh-CN": "项目概述 -> 需求分析 -> 总体设计 -> 详细设计 -> 安全与运维保障 -> 实施计划与步骤 -> 项目保障体系",
  },
  focus: {
    en: "architecture diagrams, justified technology choices with versions, quantified performance metrics (concurrency, latency, availability)",
    "zh-CN": "架构设计需有图、技术选型需有理由和版本、性能指标需量化（并发、延迟、可用性）",
  },
};

export default skill;
