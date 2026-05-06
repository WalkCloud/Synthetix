import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import type { ApiResponse } from "@/types/api";

const OUTLINE_PROMPT = `根据上面的对话内容，生成一份完整的文档大纲。

要求：
1. 提取对话中用户确认的文档结构、章节划分和关键要点
2. 每个章节必须包含具体的 keyPoints（3-5个），不能为空
3. 根据内容复杂度合理估算每个章节的字数（estimatedWords）
4. 章节数量 4-10 个，根据内容需要灵活调整
5. 如果某个章节有子章节，使用 children 数组表示

输出格式为 JSON：
{
  "title": "文档标题",
  "sections": [
    {
      "num": "1",
      "title": "章节名称",
      "keyPoints": ["要点1", "要点2", "要点3"],
      "estimatedWords": 800,
      "children": [
        {"num": "1.1", "title": "子章节", "keyPoints": [...], "estimatedWords": 400}
      ]
    }
  ]
}

请确保大纲完整覆盖对话中讨论的所有主题，章节顺序逻辑清晰。`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

  const chatModel = await db.modelConfig.findFirst({
    where: { isDefaultFor: "chat" },
    include: { provider: true },
  });
  if (!chatModel) return NextResponse.json({ success: false, error: "No chat model configured" }, { status: 400 });

  const conversation = session.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
    .join("\n\n");

  const messages = [
    { role: "system" as const, content: OUTLINE_PROMPT },
    { role: "user" as const, content: `Here is the brainstorming conversation:\n\n${conversation}\n\nGenerate the outline.` },
  ];

  try {
    const provider = createLLMProvider(chatModel.provider);
    const chunks: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of provider.chatStream({
      model: chatModel.modelId,
      messages,
    })) {
      chunks.push(chunk.content || "");
      if (chunk.inputTokens) inputTokens = chunk.inputTokens;
      if (chunk.outputTokens) outputTokens = chunk.outputTokens;
    }

    const raw = chunks.join("");
    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const outline = jsonMatch ? JSON.parse(jsonMatch[0]) : {
      title: session.title,
      sections: [{ num: "1", title: "Introduction", keyPoints: [], estimatedWords: 500 }],
    };

    await db.brainstormSession.update({
      where: { id },
      data: { outline: JSON.stringify(outline) },
    });

    await recordTokenUsage({
      userId: user.id,
      modelConfigId: chatModel.id,
      module: "outline",
      inputTokens,
      outputTokens,
      referenceId: id,
    }).catch(() => {});

    await db.message.create({
      data: { sessionId: id, role: "system", content: "Outline generated and ready for review." },
    });

    return NextResponse.json({ success: true, data: outline });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Outline generation failed",
    }, { status: 500 });
  }
}
