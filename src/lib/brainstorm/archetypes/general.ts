import type { ArchetypeSkill } from "./index";

const skill: ArchetypeSkill = {
  id: "general",
  label: {
    en: "General Professional Documents",
    "zh-CN": "通用专业文档",
  },
  useWhen: {
    en: "technology selection reports, architecture documents, test plans, or documents that do not fit the specific archetypes",
    "zh-CN": "技术选型报告、架构设计文档、测试方案等不适合特定原型的文档",
  },
  principle: {
    en: "structure serves purpose, logical clarity, no forced template",
    "zh-CN": "结构服务目的，逻辑清晰",
  },
  skeleton: {
    en: "Executive Summary -> Background & Context -> Core Analysis -> Key Findings/Arguments -> Recommendations/Next Steps -> Supporting Evidence/Appendices",
    "zh-CN": "执行摘要 -> 背景与上下文 -> 核心分析 -> 关键发现/论点 -> 建议/后续步骤 -> 支撑证据/附录",
  },
  focus: {
    en: "logical consistency, focused scope, avoid generic templates; adapt the skeleton to the document's actual purpose",
    "zh-CN": "逻辑一致性、聚焦范围；根据文档实际目的调整骨架结构",
  },
};

export default skill;
