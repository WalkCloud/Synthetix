import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { recordTokenUsage } from "@/lib/llm/usage";
import { generateSectionStream } from "@/lib/writing/generator";
import { persistDiagramAssets } from "@/lib/writing/assets";
import { generateAllPendingAssets } from "@/lib/writing/diagram-generator";
import { auditSection } from "@/lib/writing/auditor";

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

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
  });
  if (!draft) return NextResponse.json({ success: false, error: "Draft not found" }, { status: 404 });

  const section = await db.section.findFirst({
    where: { id: sectionId, draftId },
  });
  if (!section) return NextResponse.json({ success: false, error: "Section not found" }, { status: 404 });

  const constraints = body.constraints
    ? {
        wordLimit: body.constraints.wordLimit,
        additionalRequirements: body.constraints.additionalRequirements,
      }
    : undefined;

  const encoder = new TextEncoder();

  let fullContent = "";
  let inTokens = 0;
  let outTokens = 0;
  let modelConfigId = "";

  const readable = new ReadableStream({
    async start(controller) {
      try {
        await db.section.update({
          where: { id: sectionId },
          data: { status: "retrieving" },
        });

        const completedSections = await db.section.findMany({
          where: { draftId, status: { in: ["locked", "summarized"] } },
          select: { title: true, summary: true, status: true },
          orderBy: { index: "asc" },
        });

        const result = await generateSectionStream(
          draft,
          section,
          completedSections,
          user.id,
          constraints
        );

        modelConfigId = result.modelConfigId;

        await db.sectionReference.deleteMany({ where: { sectionId } });
        if (result.ragReferences.length > 0) {
          await db.sectionReference.createMany({
            data: result.ragReferences.map((ref) => ({
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

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "references", references: result.ragReferences })}\n\n`)
        );

        for await (const chunk of result.stream) {
          if (chunk.content) {
            fullContent += chunk.content;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "chunk", content: chunk.content })}\n\n`)
            );
          }
          if (chunk.reasoning) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "reasoning", content: chunk.reasoning })}\n\n`)
            );
          }
          if (chunk.inputTokens) inTokens = chunk.inputTokens;
          if (chunk.outputTokens) outTokens = chunk.outputTokens;
        }

        let finalContent = fullContent;
        let assetCount = 0;

        try {
          const result = await persistDiagramAssets(draftId, sectionId, fullContent);
          finalContent = result.cleaned || fullContent;
          assetCount = result.assets;
        } catch (assetErr) {
          console.error(`persistDiagramAssets failed for section ${sectionId}:`, assetErr);
          const { parseDiagramRequests } = await import("@/lib/writing/diagram");
          const fallback = parseDiagramRequests(fullContent);
          finalContent = fallback.cleaned || fullContent;
          assetCount = 0;
        }

        await db.section.update({
          where: { id: sectionId },
          data: {
            content: finalContent,
            wordCount: finalContent.split(/\s+/).filter(Boolean).length,
            status: "reviewing",
          },
        });

        if (assetCount > 0) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "assets", count: assetCount })}\n\n`)
          );

          generateAllPendingAssets(draftId, sectionId).catch((err) => {
            console.error(`Background diagram generation failed for section ${sectionId}:`, err);
          });
        }

        await recordTokenUsage({
          userId: user.id,
          modelConfigId,
          module: "writing",
          inputTokens: inTokens,
          outputTokens: outTokens,
        }).catch(() => {});

        (async () => {
          try {
            const auditResult = await auditSection(section.title, finalContent, section.keyPoints);
            const current = await db.section.findUnique({ where: { id: sectionId }, select: { constraints: true } });
            const existing = current?.constraints ? JSON.parse(current.constraints) : {};
            await db.section.update({
              where: { id: sectionId },
              data: { constraints: JSON.stringify({ ...existing, _audit: auditResult }) },
            });
          } catch (err) {
            console.error(`Background audit failed for section ${sectionId}:`, err);
          }
        })();

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      } catch (error) {
        await db.section.update({
          where: { id: sectionId },
          data: { status: "failed" },
        }).catch(() => {});
        const message = error instanceof Error ? error.message : "Stream failed";
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`)
          );
        } catch {}
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
