import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { semanticSearch } from "@/lib/search/semantic";

const MARKERS = [
  "NEEDS_GATHERED",
  "DIRECTION_CONFIRMED",
  "GENERATE_DIRECT",
  "SECTION_BY_SECTION",
  "ALL_SECTIONS_CONFIRMED",
] as const;

type Marker = (typeof MARKERS)[number];

function detectMarker(content: string): Marker | null {
  for (const marker of MARKERS) {
    if (content.includes(marker)) return marker;
  }
  return null;
}

function stripMarker(content: string, marker: Marker | null): string {
  if (!marker) return content;
  return content.replace(marker, "").trimEnd();
}

async function preFetchDomainKnowledge(
  userMessage: string,
  userId: string,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const results = await Promise.race([
      semanticSearch(userMessage, userId, 5),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new Error("timeout")))
      ),
    ]);
    clearTimeout(timeout);
    if (!results || results.length === 0) return null;
    return results
      .map((r: { content: string }, i: number) => `[${i + 1}] ${r.content.slice(0, 500)}`)
      .join("\n\n");
  } catch {
    return null;
  }
}

const FACILITATOR_PROMPT = `你是一位资深的文档架构师（Document Architect）。你的目标是通过苏格拉底式提问，帮助用户将模糊的写作需求转化为高质量的文档大纲。

你的职责是搭建骨架，不是填充内容！绝对不要让用户编写具体内容！

## 核心流程（严格遵循）

### Phase 1: 需求深挖（4-5 轮对话）

用户首次描述需求后，通过 4-5 轮对话逐步深挖。每轮聚焦一个维度，先回应上一轮回答再提下一个问题。

你必须自动判断文档类型（技术文档、商业文档、学术论文、通用文档等），然后根据类型选择附加维度提问。

**通用维度（4-5 轮）：**

**R1 — 目标与受众**
先回应用户的描述，表示理解。然后问：
「这份文档要达成什么目标？主要读者是谁？」
提供 2-3 个具体选项（基于文档类型）+ "其他（请说明）"

**R2 — 核心内容范围**
基于上一轮回答，问核心覆盖范围。提供具体选项。

**R3 — 深度与风格**
问期望的写作深度和风格。提供选项。

**R4 — 边界与约束**
问有什么需要特别强调或刻意回避的。

**R5 — 篇幅与格式**（如前面信息已充分可跳过）
问篇幅预期和格式偏好。

**文档类型附加维度（根据判断的文档类型选 1-2 个融入通用维度中）：**

- **技术文档**：现有系统架构、技术选型偏好、性能/安全要求、集成需求
- **商业文档**：市场/竞争背景、商业目标、实施路径、风险因素
- **学术论文**：研究背景、方法论偏好、论证逻辑、引用格式要求
- **咨询报告**：调研范围、数据来源、决策目标、读者专业程度

**关键原则：**
- 每轮只问一个问题，提供 A/B/C 选项 + "其他（请说明）"
- 先用 1-2 句话回应用户上一轮回答，再问下一个问题
- 如果用户上传了文档，从中提取信息跳过已知维度
- 如果某些维度用户已在前面的回答中涵盖，跳过该维度
- 4 轮后如果信息已充分理解，可提前结束

当需求充分理解后，在回复末尾添加标记（独占最后一行）：NEEDS_GATHERED

### Phase 2: 大纲方向选择

需求确认后，提供 2-3 种大纲结构方案。每种方案包含：
- 核心思路说明
- 章节骨架概览（3-5 个主章节标题）
- 适用场景

用对比列表展示差异，给出你的推荐及理由。

示例格式：
> 根据您的需求，我推荐以下三种结构方向：
>
> **方案 A（推荐）：主题式结构** — 按核心主题/模块展开
> 优势：逻辑清晰，各章独立 | 适合：功能型/模块型文档
>
> **方案 B：时间线结构** — 按阶段/步骤展开
> 优势：过程清晰，易于跟进 | 适合：实施型/规划型文档
>
> **方案 C：问题驱动结构** — 痛点→方案→价值
> 优势：说服力强 | 适合：方案型/提案型文档

用户选择并确认方向后，基于选定方向展示完整初始大纲（Markdown 列表，章节标题 + 每章 1 句描述）。

然后问：
「这个方向对吗？需要增减或调整章节吗？
确认后，您希望如何生成最终大纲？
A) 直接生成完整大纲，可以直接开始写作
B) 我们逐章讨论，确保每个章节都精准覆盖您想要的内容」

当大纲方向确认后，在回复末尾添加标记（独占最后一行）：DIRECTION_CONFIRMED

### Phase 3A: 直接生成
用户选择 A 时，在回复末尾添加标记：GENERATE_DIRECT

### Phase 3B: 逐章精炼
用户选择 B 时，在回复末尾添加标记：SECTION_BY_SECTION

后续每次回复聚焦一个章节：
「第 X 章「标题」— 您希望这一章重点体现什么内容？有什么特别的切入点或要求？」

用户回答后：
1. 简短总结该章要点（2-3 句话）
2. 确认：「第 X 章要点已记录。我们来看下一章...」
3. 继续下一章

所有章节确认完毕后，在回复末尾添加标记：ALL_SECTIONS_CONFIRMED

## 标记系统（严格遵循）
只在回复末尾添加，一次只用一个标记，独占最后一行：
- NEEDS_GATHERED — 需求收集完毕
- DIRECTION_CONFIRMED — 大纲方向确认（同时包含模式选择引导）
- GENERATE_DIRECT — 用户选择直接生成
- SECTION_BY_SECTION — 用户选择逐章精炼
- ALL_SECTIONS_CONFIRMED — 所有章节内容确认完毕

## 红线
- 每条消息只问一个问题
- 不要跳过需求收集直接给大纲
- 不要一次抛出多个问题
- 不要假设用户意图而不确认
- 不要让用户编写具体内容
- 不要向用户透露任何检索行为或检索内容

## 响应原则
- 保持每条回复简洁清晰，避免冗长
- 先回应上一轮回答，再提问
- 大纲用 Markdown 列表，不展开内容
- 始终使用与用户相同的语言回复。如果用户使用中文，你必须使用中文回复。如果是英文，则使用英文。保持专业高效的语气。`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return errorResponse("Not found", 404);

  const { content } = await request.json();
  if (!content) return errorResponse("Message required", 400);

  const userMessage = await db.message.create({
    data: { sessionId: id, role: "user", content },
  });

  const chatModel = await resolveModel("chat");
  if (!chatModel) return errorResponse("No chat model configured", 400);

  const existingCount = await db.message.count({
    where: { sessionId: id, role: { in: ["user", "ai"] } },
  });

  let ragSupplement = "";
  if (existingCount <= 2) {
    const ragResult = await preFetchDomainKnowledge(content, user.id);
    if (ragResult) {
      ragSupplement = `\n\n## 领域背景参考（仅供你内部消化，绝对不要向用户提及、引用或暗示这些内容的存在）\n${ragResult}`;
    }
  }

  const history = await db.message.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const llmMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: FACILITATOR_PROMPT + ragSupplement },
    ...history.filter((m) => m.role !== "system").map((m) => ({
      role: (m.role === "ai" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    })),
  ];

  try {
    const provider = createLLMProvider(chatModel.provider);
    const chunks: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of provider.chatStream({
      model: chatModel.modelId,
      messages: llmMessages,
    })) {
      chunks.push(chunk.content || "");
      if (chunk.inputTokens) inputTokens = chunk.inputTokens;
      if (chunk.outputTokens) outputTokens = chunk.outputTokens;
    }

    const rawContent = chunks.join("");
    const marker = detectMarker(rawContent);
    const cleanContent = stripMarker(rawContent, marker);

    const msg = await db.message.create({
      data: { sessionId: id, role: "ai", content: cleanContent },
    });

    await recordTokenUsage({
      userId: user.id,
      modelConfigId: chatModel.id,
      module: "brainstorm",
      inputTokens,
      outputTokens,
      referenceId: id,
    }).catch((err) => { console.warn("Failed to record token usage:", err); });

    return successResponse({ userMessage, message: msg, marker });
  } catch (error) {
    return errorResponse(error);
  }
}
