import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { recordTokenUsage } from "@/lib/llm/usage";
import { generateSectionStream } from "@/lib/writing/generator";
import { parseDiagramRequests, segmentContent } from "@/lib/writing/diagram";
import { generateAllPendingAssets } from "@/lib/writing/diagram-generator";
import { auditSection } from "@/lib/writing/auditor";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import { authErrorResponse, errorResponse } from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId, secId: sectionId } = await params;

  let body: { constraints?: { wordLimit?: number; additionalRequirements?: string }; modelAConfigId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
  });
  if (!draft) return errorResponse("Draft not found", 404);

  const section = await db.section.findFirst({
    where: { id: sectionId, draftId },
  });
  if (!section) return errorResponse("Section not found", 404);

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
          constraints,
          body.modelAConfigId
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

        const { diagrams, images, cleaned } = parseDiagramRequests(fullContent);

        let finalContent = stripLeadingSectionTitle(cleaned, section.title);
        let assetCount = 0;

        console.log(`[generate] section="${section.title}" diagrams=${diagrams.length} images=${images.length}`);

        if (diagrams.length > 0 || images.length > 0) {
          try {
            await db.sectionAsset.deleteMany({ where: { sectionId } });
            for (const diagram of diagrams) {
              await db.sectionAsset.create({
                data: {
                  draftId,
                  sectionId,
                  type: "diagram",
                  title: diagram.title,
                  description: diagram.purpose,
                  prompt: diagram.raw,
                  status: "pending",
                  metadata: JSON.stringify({
                    diagramType: diagram.type,
                    placement: diagram.placement,
                    nodes: diagram.nodes,
                    flows: diagram.flows,
                  }),
                },
              });
            }
            for (const image of images) {
              if (!image.prompt) continue;
              await db.sectionAsset.create({
                data: {
                  draftId,
                  sectionId,
                  type: "image",
                  title: image.title,
                  description: image.prompt.slice(0, 200),
                  prompt: image.raw,
                  status: "pending",
                  metadata: JSON.stringify({ imagePrompt: image.prompt }),
                },
              });
            }
            console.log(`[generate] assets created: ${diagrams.length} diagrams, ${images.length} images`);
          } catch (assetErr) {
            console.error(`[generate] asset creation failed:`, assetErr);
          }
        }

        await db.section.update({
          where: { id: sectionId },
          data: {
            content: finalContent,
            wordCount: finalContent.split(/\s+/).filter(Boolean).length,
            status: "reviewing",
          },
        });

        if (diagrams.length > 0 || images.length > 0) {
          try {
            const genResult = await generateAllPendingAssets(draftId, sectionId);
            console.log(`[generate] SVG gen: total=${genResult.total} ok=${genResult.succeeded} fail=${genResult.failed}`);

            if (genResult.succeeded > 0) {
              const readyAssets = await db.sectionAsset.findMany({
                where: { sectionId, draftId, status: "ready" },
                orderBy: { createdAt: "asc" },
              });

              const segments = segmentContent(fullContent);
              const diagramAssets = readyAssets.filter((a) => a.type === "diagram" || a.type === "svg");
              const imageAssets = readyAssets.filter((a) => a.type === "image");
              let dIdx = 0, iIdx = 0;
              const positionedParts: string[] = [];
              for (const seg of segments) {
                if (seg.kind === "text") {
                  positionedParts.push(seg.content);
                } else if (seg.kind === "diagram" && dIdx < diagramAssets.length) {
                  positionedParts.push(`\n\n[DIAGRAM:${diagramAssets[dIdx++].id}]\n\n`);
                } else if (seg.kind === "image" && iIdx < imageAssets.length) {
                  positionedParts.push(`\n\n[IMAGE:${imageAssets[iIdx++].id}]\n\n`);
                }
              }

              const markedContent = stripLeadingSectionTitle(
                positionedParts.join(""),
                section.title,
              );
              assetCount = readyAssets.length;

              await db.section.update({
                where: { id: sectionId },
                data: { content: markedContent },
              });
              console.log(`[generate] markers placed in-position: ${readyAssets.length} assets`);
            }
          } catch (genErr) {
            console.error(`[generate] SVG generation failed:`, genErr);
          }
        }

        if (assetCount > 0) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "assets", count: assetCount })}\n\n`)
          );
        }

        await recordTokenUsage({
          userId: user.id,
          modelConfigId,
          module: "writing",
          inputTokens: inTokens,
          outputTokens: outTokens,
        }).catch((err) => { console.warn("Failed to record token usage:", err); });

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
        }).catch((err) => { console.warn("Failed to update section status:", err); });
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
