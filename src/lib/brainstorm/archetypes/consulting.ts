import type { ArchetypeSkill } from "./index";

const skill: ArchetypeSkill = {
  id: "consulting",
  label: {
    en: "Consulting / Research Reports",
    "zh-CN": "咨询/调研报告",
  },
  useWhen: {
    en: "consulting reports, industry research, white papers, market analysis",
    "zh-CN": "咨询报告、行业研究、白皮书、市场分析",
  },
  principle: {
    en: "data-driven, analysis to insights to recommendations",
    "zh-CN": "数据驱动，从现象到本质，从分析到建议",
  },
  skeleton: {
    en: "Research Overview (purpose, scope, methodology) -> Industry & Market Analysis -> Current State Assessment & Benchmarking -> Issue Diagnosis & Root Causes -> Strategic Recommendations & Pathways -> Implementation Roadmap -> Risk Assessment",
    "zh-CN": "研究概述/摘要 -> 行业与市场背景分析 -> 现状评估与对标 -> 问题诊断与成因 -> 策略与路径建议 -> 实施路线图 -> 风险与应对",
  },
  focus: {
    en: "cited data with source and recency, established frameworks (SWOT, PESTEL, Porter Five Forces), actionable prioritized recommendations",
    "zh-CN": "数据引用需标明来源和时效，使用 SWOT/PEST 等经典分析框架，建议需具备落地性",
  },
};

export default skill;
