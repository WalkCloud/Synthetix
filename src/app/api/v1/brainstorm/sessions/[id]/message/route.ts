import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import type { ApiResponse } from "@/types/api";

const FACILITATOR_PROMPT = `你是一位顶级的文档架构师（Document Architect）。你的唯一目标是帮助用户快速构建出一个高质量的【文档大纲（Outline）】。
千万不要问关于文档具体内容的细节问题！千万不要让用户去写具体内容！你的工作是搭骨架，不是填血肉！

## 核心流程（严格执行，绝不拖延）
1. **第一次对话**：当用户给出初始想法后，立刻分析其核心目的，**直接给出一个初步的大纲结构建议**。
   - 不要问任何澄清问题，直接先给出一个大纲方案作为靶子，让用户在这个基础上修改。
2. **后续对话**：用户会对你的大纲提出修改意见（例如：加一章、合并这两节、修改结构）。你根据意见调整大纲，并再次展示。

## 对话与提问原则
1. **绝对禁止**：禁止问“具体包含哪些内容”、“请详细描述”等试图生成内容的开放式问题。
2. **绝不追问**：不要像苏格拉底一样没完没了地问问题！你的任务是直接给方案。
3. **触发生成**：当你觉得大纲结构已经基本就绪，或者用户明确同意你的大纲、让你直接生成时，立刻在回复末尾附上大写标记：OUTLINE_REQUESTED

## 你的回复格式（非常重要）
每次回复必须非常简短（不要长篇大论）：
- **第1句话**：一句话确认用户的想法。
- **第2部分**：直接列出你的大纲建议（章节标题级别的 Markdown 列表即可，不要展开写内容）。
- **第3句话**：只问一句：“这个结构方向对吗？需要增减什么章节，还是直接生成最终大纲？”

如果用户确认当前大纲，直接回复：OUTLINE_REQUESTED

始终使用中文回复，态度专业、干练、雷厉风行。`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

  const { content } = await request.json();
  if (!content) return NextResponse.json({ success: false, error: "Message required" }, { status: 400 });

  // Save user message
  await db.message.create({
    data: { sessionId: id, role: "user", content },
  });

  // Get chat model
  const chatModel = await db.modelConfig.findFirst({
    where: { isDefaultFor: "chat" },
    include: { provider: true },
  });

  if (!chatModel) {
    return NextResponse.json({ success: false, error: "No chat model configured" }, { status: 400 });
  }

  // Get conversation history
  const history = await db.message.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const llmMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: FACILITATOR_PROMPT },
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

    const aiContent = chunks.join("");

    const msg = await db.message.create({
      data: { sessionId: id, role: "ai", content: aiContent },
    });

    await recordTokenUsage({
      userId: user.id,
      modelConfigId: chatModel.id,
      module: "brainstorm",
      inputTokens,
      outputTokens,
      referenceId: id,
    }).catch(() => {});

    // Check if outline was requested
    const outlineRequested = aiContent.includes("OUTLINE_REQUESTED");

    return NextResponse.json({
      success: true,
      data: { message: msg, outlineRequested },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "AI response failed",
    }, { status: 500 });
  }
}
