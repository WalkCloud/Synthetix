/**
 * 共享常量与类型 — 测试环境配置、文档路径、知识模式定义。
 *
 * 文档分配策略（见测试方案第二章）：
 *   full      → 大文档（90MB，heavy 档）
 *   其余三项  → 小文档（17MB，medium 档）
 */
import path from "path";

/** 登录凭证（用户已配置的真实账号）。 */
export const ADMIN = { username: "admin", password: "Admin@123" } as const;

/** 测试资源统一标识，用于 teardown 定向清理。 */
export const E2E_PREFIX = "[E2E]";
export const E2E_TAG = "e2e";

/** VM 共享目录中的真实业务文档。 */
const VM_TEST_DIR = "Z:\\VM ShareFolder\\test";

/** 大文档（仅用于 full 模式）：烟台银行容器平台投标技术方案。 */
export const BIG_DOC = {
  path: path.join(VM_TEST_DIR, "烟台银行容器平台投标技术方案_260427.docx"),
  sizeBytes: 94_351_487,
  tier: "heavy" as const,
};

/** 小文档（用于 standard/graph/wiki）：河南农商银行容器云平台建设方案。 */
export const SMALL_DOC = {
  path: path.join(VM_TEST_DIR, "河南农商银行容器云平台建设方案参考-20260305.docx"),
  sizeBytes: 17_209_926,
  tier: "medium" as const,
};

export type KnowledgeMode = "standard" | "graph" | "wiki" | "full";

/** KnowledgeMode → 后端处理选项（与 src/components/documents/processing-settings.tsx 完全一致）。 */
export function modeToOptions(mode: KnowledgeMode) {
  switch (mode) {
    case "graph":
      return { indexMode: "graph" as const, wikiEnabled: false, splitStrategy: "structure-llm", indexTarget: "full", autoSplit: true };
    case "wiki":
      return { indexMode: "basic" as const, wikiEnabled: true, splitStrategy: "structure-llm", indexTarget: "full", autoSplit: true };
    case "full":
      return { indexMode: "graph" as const, wikiEnabled: true, splitStrategy: "structure-llm", indexTarget: "full", autoSplit: true };
    case "standard":
    default:
      return { indexMode: "basic" as const, wikiEnabled: false, splitStrategy: "structure-llm", indexTarget: "full", autoSplit: true };
  }
}

/** 各模式应出现的流水线阶段节点 key 集合（断言依据）。 */
export function expectedPipelineStages(mode: KnowledgeMode): {
  linear: string[];
  branches: string[];
} {
  const linear = ["stageUpload", "stageConvert", "stageSplit", "stageEmbed", "stageIndex"];
  const branches: string[] = [];
  const opts = modeToOptions(mode);
  if (opts.indexMode === "graph") branches.push("stageGraph");
  if (opts.wikiEnabled) branches.push("stageWiki");
  return { linear, branches };
}

/** 重型任务超时（毫秒）。文档处理/级联删除等放宽。 */
export const TIMEOUTS = {
  upload: 120_000,
  taskPoll: 5_000, // 轮询间隔
  smallDocProcess: 30 * 60_000, // 小文档处理（含 graph）：≤30min
  bigDocProcess: 90 * 60_000, // 大文档 full：≤90min
  cleanupTask: 15 * 60_000, // document_cleanup（含 10min settle）
  outlineGen: 30 * 60_000, // 大纲生成
  sectionGenerate: 10 * 60_000, // 单节 SSE 生成
} as const;
