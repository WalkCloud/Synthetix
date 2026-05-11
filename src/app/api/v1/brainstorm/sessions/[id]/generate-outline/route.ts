import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import type { ApiResponse } from "@/types/api";

const OUTLINE_PROMPT = `Based on the conversation above, generate a complete document outline.

Requirements:
1. Extract the confirmed document structure, chapter divisions, and key points from the conversation
2. Each chapter must include specific keyPoints (2-4), cannot be empty
3. Reasonably estimate word count (estimatedWords) for each chapter based on content complexity
4. 3-8 chapters total, flexibly adjusted based on content needs
5. **Multi-level headings**: For chapters with substantial content, must split into sub-chapters (children), forming a 2-3 level outline structure
6. Sub-chapter num format should be "1.1", "1.2", etc.
7. Generally, chapters expected to exceed 1000 words should be split into sub-chapters

Output format is JSON (strictly follow, do not add any other text):
{
  "title": "Document Title",
  "sections": [
    {
      "num": "1",
      "title": "Chapter Name",
      "keyPoints": ["Point 1", "Point 2"],
      "estimatedWords": 1500,
      "children": [
        {"num": "1.1", "title": "Sub-chapter Name", "keyPoints": ["Sub-point 1"], "estimatedWords": 500},
        {"num": "1.2", "title": "Sub-chapter Name", "keyPoints": ["Sub-point 1"], "estimatedWords": 600}
      ]
    }
  ]
}

Ensure the outline comprehensively covers all topics discussed in the conversation, with logical chapter ordering.`;

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

  const chatModel = await resolveModel("chat");

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
      data: { 
        outline: JSON.stringify(outline),
        title: outline.title || session.title
      },
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
