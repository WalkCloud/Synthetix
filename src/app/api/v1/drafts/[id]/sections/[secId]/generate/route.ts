import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { recordTokenUsage } from "@/lib/llm/usage";
import { generateSectionStream } from "@/lib/writing/generator";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId, secId: sectionId } = await params;

  let body: { constraints?: { wordLimit?: number; additionalRequirements?: string } };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
    });
    if (!draft) return NextResponse.json({ success: false, error: "Draft not found" }, { status: 404 });

    const section = await db.section.findFirst({
      where: { id: sectionId, draftId },
    });
    if (!section) return NextResponse.json({ success: false, error: "Section not found" }, { status: 404 });

    await db.section.update({
      where: { id: sectionId },
      data: { status: "retrieving" },
    });

    const completedSections = await db.section.findMany({
      where: { draftId, status: { in: ["locked", "summarized"] } },
      select: { title: true, summary: true, status: true },
      orderBy: { index: "asc" },
    });

    const constraints = body.constraints
      ? {
          wordLimit: body.constraints.wordLimit,
          additionalRequirements: body.constraints.additionalRequirements,
        }
      : undefined;

    const { stream, modelConfigId, ragReferences } = await generateSectionStream(
      draft,
      section,
      completedSections,
      user.id,
      constraints
    );

    await db.sectionReference.deleteMany({ where: { sectionId } });
    if (ragReferences.length > 0) {
      await db.sectionReference.createMany({
        data: ragReferences.map((ref) => ({
          sectionId,
          documentId: ref.documentId || null,
          chunkId: ref.chunkId || null,
          documentName: ref.documentName,
          relevanceScore: ref.score,
          sourceAnchor: ref.title || null,
        })),
      });
    }

    await db.section.update({
      where: { id: sectionId },
      data: { status: "generating" },
    });

    const encoder = new TextEncoder();
    let fullContent = "";
    let inTokens = 0;
    let outTokens = 0;

    const readable = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "references", references: ragReferences })}\n\n`));

          for await (const chunk of stream) {
            if (chunk.content) {
              fullContent += chunk.content;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "chunk", content: chunk.content })}\n\n`));
            }
            if (chunk.inputTokens) inTokens = chunk.inputTokens;
            if (chunk.outputTokens) outTokens = chunk.outputTokens;
          }

          await db.section.update({
            where: { id: sectionId },
            data: {
              content: fullContent,
              wordCount: fullContent.split(/\s+/).filter(Boolean).length,
              status: "reviewing",
            },
          });

          await recordTokenUsage({
            userId: user.id,
            modelConfigId,
            module: "writing",
            inputTokens: inTokens,
            outputTokens: outTokens,
          }).catch(() => {});

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        } catch (error) {
          await db.section.update({
            where: { id: sectionId },
            data: { status: "failed" },
          }).catch(() => {});
          const message = error instanceof Error ? error.message : "Stream failed";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error: unknown) {
    try {
      await db.section.update({
        where: { id: sectionId },
        data: { status: "failed" },
      });
    } catch {}
    
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
