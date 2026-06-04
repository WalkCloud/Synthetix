import type { ArchetypeSkill } from "./index";

const skill: ArchetypeSkill = {
  id: "bidding",
  label: {
    en: "Bid / Tender Documents",
    "zh-CN": "投标/应标文件",
  },
  useWhen: {
    en: "bid technical proposals, tender technical documents, RFP responses, competitive bids",
    "zh-CN": "投标技术方案、应标技术文件、竞标响应",
  },
  principle: {
    en: "strict compliance with tender requirements, point-by-point response",
    "zh-CN": "严格对应招标文件要求，合规优先，差异化其次",
  },
  skeleton: {
    en: "Company Profile & Qualifications -> Project Understanding & Requirements -> Technical Solution (Overall + Detailed) -> Project Implementation -> After-Sales & Training -> Reference Cases -> Pricing (if applicable)",
    "zh-CN": "公司概况与资质 -> 对项目理解与需求分析 -> 总体与详细技术方案 -> 项目实施方案 -> 售后服务与培训 -> 经典案例 -> 报价（如适用）",
  },
  focus: {
    en: "point-by-point alignment with scoring criteria, competitive differentiation, team credentials, actionable after-sales commitments",
    "zh-CN": "逐点响应招标要求，突出差异化竞争优势，售后需具备可执行性",
  },
};

export default skill;
