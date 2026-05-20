import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

const OUTLINE_PROMPT = `Based on the conversation above, generate a complete document outline.

Requirements:
1. Extract the confirmed document structure, chapter divisions, and key points from the conversation
2. Each chapter must include specific keyPoints (2-4), cannot be empty
3. Each chapter must include a concise description that explains the chapter's scope
4. Each chapter must include hidden writingRequirements for later drafting. These requirements should define what to cover, what to avoid, desired angle, and boundaries with adjacent sections
5. Each chapter must include retrievalQuery and referenceHints for knowledge-base retrieval before drafting
6. Reasonably estimate word count (estimatedWords) for each chapter based on content complexity
7. 3-8 top-level chapters total, flexibly adjusted based on content needs
8. **Multi-level headings with unlimited depth**: For chapters with substantial content, split into sub-sections (children). Sub-sections may themselves have children, forming a hierarchy of any depth (2, 3, 4+ levels). Use as many levels as needed to properly organize the content.
9. Num format reflects hierarchy: "1", "1.1", "1.1.1", "1.1.1.1", etc.
10. Generally, sections expected to exceed 800 words should be split into sub-sections
11. Leaf sections (deepest level) should each cover a coherent topic that can be written as a unit

Output format is JSON (strictly follow, do not add any other text):
{
  "title": "Document Title",
  "sections": [
    {
      "num": "1",
      "title": "Chapter Name",
      "description": "One-sentence chapter scope and role in the document",
      "keyPoints": ["Point 1", "Point 2"],
      "estimatedWords": 1500,
      "writingRequirements": "Hidden drafting instruction: coverage, angle, boundaries, style, and facts to look for",
      "retrievalQuery": "Search query optimized for retrieving supporting knowledge for this chapter",
      "referenceHints": ["keyword/entity/document type 1", "keyword/entity/document type 2"],
      "children": [
        {
          "num": "1.1",
          "title": "Sub-section Name",
          "description": "One-sentence sub-section scope",
          "keyPoints": ["Sub-point 1"],
          "estimatedWords": 500,
          "writingRequirements": "Hidden drafting instruction for this sub-section",
          "retrievalQuery": "Search query for this sub-section",
          "referenceHints": ["keyword 1", "keyword 2"],
          "children": [
            {"num": "1.1.1", "title": "Detail Name", "description": "Detail scope", "keyPoints": ["Detail point"], "estimatedWords": 250, "writingRequirements": "Hidden drafting instruction", "retrievalQuery": "Search query", "referenceHints": ["keyword"]}
          ]
        },
        {"num": "1.2", "title": "Sub-section Name", "description": "One-sentence sub-section scope", "keyPoints": ["Sub-point 1"], "estimatedWords": 600, "writingRequirements": "Hidden drafting instruction", "retrievalQuery": "Search query", "referenceHints": ["keyword"]}
      ]
    }
  ]
}

Ensure the outline comprehensively covers all topics discussed in the conversation, with logical chapter ordering.`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return errorResponse("Not found", 404);

  const chatModel = await resolveModel("chat");

  if (!chatModel) return errorResponse("No chat model configured", 400);

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
    }).catch((err) => { console.warn("Failed to record token usage:", err); });

    await db.message.create({
      data: { sessionId: id, role: "system", content: "Outline generated and ready for review." },
    });

    return successResponse(outline);
  } catch (error) {
    return errorResponse(error);
  }
}
