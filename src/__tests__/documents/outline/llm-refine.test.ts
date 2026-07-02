import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MacroChunk } from "@/lib/documents/outline/macro-split";
import type { ProcessingContext } from "@/lib/documents/pipeline";

// Mock LLM infrastructure — tests verify the refinement logic, not real API calls.
const mockChat = vi.fn();
const mockCreateLLMProvider = vi.fn(() => ({
  chat: mockChat,
  chatStream: vi.fn(),
  embed: vi.fn(),
  testConnection: vi.fn(),
  getModels: vi.fn(),
}));

vi.mock("@/lib/llm/factory", () => ({
  createLLMProvider: (...args: unknown[]) => mockCreateLLMProvider(...(args as [])),
}));

vi.mock("@/lib/llm/client", () => ({
  resolveLLMClient: vi.fn(),
}));

vi.mock("@/lib/llm/usage", () => ({
  recordTokenUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

function makeMacro(
  h1: string,
  h2: string | null,
  content: string,
  isAtomic = false,
): MacroChunk {
  const headingPath = [h1, h2].filter(Boolean).join(" > ");
  return {
    headingPath,
    h1,
    h2,
    content,
    tokenCount: Math.ceil(content.length / 1.5),
    isAtomic,
  };
}

function makeCtx(writingModel: unknown): ProcessingContext {
  return {
    taskId: "task-1",
    docId: "doc-1",
    doc: { userId: "user-1", originalName: "test.docx" },
    options: {},
    outputDir: "",
    markdownPath: "",
    structurePath: null,
    imageManifestPath: null,
    conversionMethod: "docling",
    writingModel,
    embedModel: null,
    contextWindow: 200000,
    splitThreshold: 14744,
    chunkMaxTokens: 7372,
  } as unknown as ProcessingContext;
}

const writingModel = {
  id: "model-1",
  modelId: "deepseek-chat",
  provider: {
    apiBaseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    providerType: "openai_compatible",
  },
};

describe("llmRefineMacroStructure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockReset();
  });

  it("returns original macros when writingModel is null", async () => {
    const { llmRefineMacroStructure } = await import("@/lib/documents/outline/llm-refine");
    const macros = [makeMacro("H1", null, "content")];
    const result = await llmRefineMacroStructure(macros, makeCtx(null));
    expect(result).toBe(macros);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("returns original macros when only 1 macro chunk", async () => {
    const { llmRefineMacroStructure } = await import("@/lib/documents/outline/llm-refine");
    const macros = [makeMacro("H1", null, "content")];
    const result = await llmRefineMacroStructure(macros, makeCtx(writingModel));
    expect(result).toBe(macros);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("falls back to original macros on LLM API error", async () => {
    mockChat.mockRejectedValueOnce(new Error("API timeout"));
    const { llmRefineMacroStructure } = await import("@/lib/documents/outline/llm-refine");
    const macros = [
      makeMacro("部署步骤", null, "执行以下命令"),
      makeMacro("部署步骤", "bash setup.sh", "bash setup.sh --ip-family ipv6"),
    ];
    const result = await llmRefineMacroStructure(macros, makeCtx(writingModel));
    expect(result).toEqual(macros);
  });

  it("falls back on unparseable LLM response", async () => {
    mockChat.mockResolvedValueOnce({
      content: "not json at all",
      inputTokens: 100,
      outputTokens: 10,
      model: "deepseek-chat",
    });
    const { llmRefineMacroStructure } = await import("@/lib/documents/outline/llm-refine");
    const macros = [
      makeMacro("H1", null, "content1"),
      makeMacro("H1", "H2", "content2"),
    ];
    const result = await llmRefineMacroStructure(macros, makeCtx(writingModel));
    expect(result).toEqual(macros);
  });

  it("demotes false-positive titles (shell commands) to body text", async () => {
    // Simulate: macro-split incorrectly identified "bash setup.sh" as an H2 title.
    // The LLM should mark it as non-title, and the chunk should inherit the
    // previous section's heading context.
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        headings: [
          { index: 0, isTitle: true, level: 1, title: "部署步骤" },
          { index: 1, isTitle: false, level: 0, title: null },
          { index: 2, isTitle: true, level: 1, title: "配置管理" },
        ],
      }),
      inputTokens: 200,
      outputTokens: 50,
      model: "deepseek-chat",
    });

    const { llmRefineMacroStructure } = await import("@/lib/documents/outline/llm-refine");
    const macros = [
      makeMacro("部署步骤", null, "执行以下命令安装"),
      makeMacro("部署步骤", "bash setup.sh", "bash setup.sh --ip-family ipv6"),
      makeMacro("配置管理", null, "配置文件位于 /etc/config"),
    ];

    const result = await llmRefineMacroStructure(macros, makeCtx(writingModel));

    // Chunk 0: real H1
    expect(result[0].h1).toBe("部署步骤");
    expect(result[0].h2).toBeNull();
    expect(result[0].headingPath).toBe("部署步骤");

    // Chunk 1: demoted — inherits "部署步骤" context, no H2
    expect(result[1].h1).toBe("部署步骤");
    expect(result[1].h2).toBeNull();
    expect(result[1].headingPath).toBe("部署步骤");

    // Chunk 2: real H1
    expect(result[2].h1).toBe("配置管理");
    expect(result[2].headingPath).toBe("配置管理");
  });

  it("corrects heading levels from flat to hierarchical", async () => {
    // Docling emitted everything as ## (H2), but the LLM recognizes the
    // true hierarchy: "项目建设背景" is level 1, "1.1 银行业转型" is level 2.
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        headings: [
          { index: 0, isTitle: true, level: 1, title: "项目建设背景" },
          { index: 1, isTitle: true, level: 2, title: "银行业数字化转型" },
          { index: 2, isTitle: true, level: 1, title: "项目建设目标" },
        ],
      }),
      inputTokens: 200,
      outputTokens: 50,
      model: "deepseek-chat",
    });

    const { llmRefineMacroStructure } = await import("@/lib/documents/outline/llm-refine");
    // All macros start with the same H1 (wrong), different H2s
    const macros = [
      makeMacro("项目建设背景", null, "背景内容"),
      makeMacro("项目建设背景", "银行业数字化转型", "转型内容"),
      makeMacro("项目建设目标", null, "目标内容"),
    ];

    const result = await llmRefineMacroStructure(macros, makeCtx(writingModel));

    expect(result[0].h1).toBe("项目建设背景");
    expect(result[0].h2).toBeNull();
    expect(result[0].headingPath).toBe("项目建设背景");

    expect(result[1].h1).toBe("项目建设背景");
    expect(result[1].h2).toBe("银行业数字化转型");
    expect(result[1].headingPath).toBe("项目建设背景 > 银行业数字化转型");

    expect(result[2].h1).toBe("项目建设目标");
    expect(result[2].h2).toBeNull();
    expect(result[2].headingPath).toBe("项目建设目标");
  });

  it("preserves content and tokenCount — only adjusts heading metadata", async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        headings: [
          { index: 0, isTitle: true, level: 1, title: "Real Title" },
          { index: 1, isTitle: false, level: 0, title: null },
        ],
      }),
      inputTokens: 100,
      outputTokens: 30,
      model: "deepseek-chat",
    });

    const { llmRefineMacroStructure } = await import("@/lib/documents/outline/llm-refine");
    const macros = [
      makeMacro("Old H1", null, "content one"),
      makeMacro("Old H1", "False H2", "content two"),
    ];

    const result = await llmRefineMacroStructure(macros, makeCtx(writingModel));

    expect(result[0].content).toBe("content one");
    expect(result[0].tokenCount).toBe(macros[0].tokenCount);
    expect(result[1].content).toBe("content two");
    expect(result[1].tokenCount).toBe(macros[1].tokenCount);
  });

  it("handles LLM response with markdown code fence", async () => {
    mockChat.mockResolvedValueOnce({
      content: "```json\n" + JSON.stringify({
        headings: [
          { index: 0, isTitle: true, level: 1, title: "Fenced Title" },
          { index: 1, isTitle: true, level: 2, title: "Subsection" },
        ],
      }) + "\n```",
      inputTokens: 100,
      outputTokens: 20,
      model: "deepseek-chat",
    });

    const { llmRefineMacroStructure } = await import("@/lib/documents/outline/llm-refine");
    const macros = [
      makeMacro("Old", null, "content one"),
      makeMacro("Old", "Sub", "content two"),
    ];
    const result = await llmRefineMacroStructure(macros, makeCtx(writingModel));
    expect(result[0].h1).toBe("Fenced Title");
  });

  it("handles LLM response with trailing commas", async () => {
    mockChat.mockResolvedValueOnce({
      content: '{"headings": [{"index": 0, "isTitle": true, "level": 1, "title": "T",},{"index": 1, "isTitle": false, "level": 0, "title": null,}]}',
      inputTokens: 100,
      outputTokens: 20,
      model: "deepseek-chat",
    });

    const { llmRefineMacroStructure } = await import("@/lib/documents/outline/llm-refine");
    const macros = [
      makeMacro("Old", null, "content one"),
      makeMacro("Old", "Sub", "content two"),
    ];
    const result = await llmRefineMacroStructure(macros, makeCtx(writingModel));
    expect(result[0].h1).toBe("T");
  });
});
