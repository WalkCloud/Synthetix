import type { ArchetypeSkill } from "./index";

const skill: ArchetypeSkill = {
  id: "assessment",
  label: {
    en: "Evaluation / Audit Reports",
    "zh-CN": "评估/审计报告",
  },
  useWhen: {
    en: "assessment reports, audits, compliance reviews, security evaluations",
    "zh-CN": "评估报告、审计报告、合规检查、安全评测",
  },
  principle: {
    en: "standards first, item-by-item evaluation, traceable conclusions",
    "zh-CN": "标准先行 -> 逐项评审 -> 可追溯结论",
  },
  skeleton: {
    en: "Background & Scope -> Evaluation Standards / Indicators -> Methods & Tools -> Itemized Findings -> Overall Conclusion & Rating -> Remediation Recommendations",
    "zh-CN": "背景与范围 -> 评估标准 -> 方法与工具 -> 逐项发现 -> 总体结论 -> 整改建议",
  },
  focus: {
    en: "explicit standard/criteria citations (with version/year), clear ratings/scores per item, prioritized actionable remediation",
    "zh-CN": "明确标注标准引用（含版本/年份）、每项评分、优先整改建议",
  },
};

export default skill;
