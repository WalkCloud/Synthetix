import type { ArchetypeSkill } from "./index";

const skill: ArchetypeSkill = {
  id: "planning",
  label: {
    en: "Strategic Planning Documents",
    "zh-CN": "规划类文档",
  },
  useWhen: {
    en: "development plans, strategic plans, technology roadmaps",
    "zh-CN": "发展规划、战略规划、技术路线图",
  },
  principle: {
    en: "vision to pathway, phased, prioritized. Near-term concrete, long-term aspirational",
    "zh-CN": "从愿景到路径，分阶段，分优先级。近期具体，远期愿景",
  },
  skeleton: {
    en: "Current State & Challenges -> Vision & Strategic Goals -> Overall Strategy -> Key Initiatives & Priority Projects -> Phased Roadmap (near / mid / long-term) -> Safeguards & Resources",
    "zh-CN": "现状与挑战 -> 愿景与战略目标 -> 总体策略 -> 重点项目 -> 分阶段路线图 -> 保障与资源",
  },
  focus: {
    en: "SMART objectives, clear phase differentiation, realistic resource allocation, measurable milestones",
    "zh-CN": "SMART 目标、明确的阶段区分、切合实际的资源配置",
  },
};

export default skill;
