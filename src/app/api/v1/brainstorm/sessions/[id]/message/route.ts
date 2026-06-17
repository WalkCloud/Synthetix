import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { preFetchDomainKnowledge } from "@/lib/brainstorm/domain-context";
import { buildLengthRequirementQuestion, conversationHasLengthRequirement } from "@/lib/brainstorm/length-requirement";
import { detectMarker, stripMarker } from "@/lib/brainstorm/markers";
import { resolveBrainstormPromptPhase } from "@/lib/brainstorm/phase-routing";
import { resolveLocale } from "@/lib/i18n/server";
import { resolveBrainstormLocale } from "@/lib/brainstorm/messages";
import { buildFacilitatorPrompt, resolveDocumentLanguage } from "@/lib/prompts";
import type { ChatResponse } from "@/lib/llm/types";

type ClientMarker = "GENERATE_DIRECT" | "SECTION_BY_SECTION" | "ALL_SECTIONS_CONFIRMED";
type BrainstormPhase = "gathering" | "direction" | "mode_select" | "section_refine" | "ready_to_generate" | "ready";

const BRAINSTORM_HISTORY_LIMIT = 16;
const BRAINSTORM_MESSAGE_CHAR_LIMIT = 6_000;
// 1600 truncated the assistant mid-outline (a 300-page plan outline spans many
// chapters) before it could emit the GENERATE_DIRECT marker that triggers the
// structured outline-worker — so the outline never got generated. 8192 lets the
// assistant finish its outline recap + emit the marker in one turn.
const BRAINSTORM_MAX_OUTPUT_TOKENS = 8192;

function isClientMarker(value: unknown): value is ClientMarker {
  return value === "GENERATE_DIRECT"
    || value === "SECTION_BY_SECTION"
    || value === "ALL_SECTIONS_CONFIRMED";
}

function isBrainstormPhase(value: unknown): value is BrainstormPhase {
  return value === "gathering"
    || value === "direction"
    || value === "mode_select"
    || value === "section_refine"
    || value === "ready_to_generate"
    || value === "ready";
}

function trimMessageContent(content: string): string {
  if (content.length <= BRAINSTORM_MESSAGE_CHAR_LIMIT) return content;
  return `${content.slice(0, BRAINSTORM_MESSAGE_CHAR_LIMIT)}\n\n[Earlier content truncated to keep the brainstorming context responsive.]`;
}

function isTransientLLMError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|terminated|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timeout|aborted/i.test(message);
}

async function runBrainstormCompletion(
  provider: ReturnType<typeof createLLMProvider>,
  model: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<ChatResponse> {
  try {
    return await provider.chat({
      model,
      messages,
      maxTokens: BRAINSTORM_MAX_OUTPUT_TOKENS,
    });
  } catch (error) {
    if (!isTransientLLMError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 800));
    return provider.chat({
      model,
      messages,
      maxTokens: BRAINSTORM_MAX_OUTPUT_TOKENS,
    });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return errorResponse({ code: "notFound", message: "Not found" }, 404);

  let body: { content?: string; clientMarker?: unknown; phase?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse({ code: "invalidInput", message: "Invalid request body" }, 400);
  }
  const { content } = body;
  if (!content) return errorResponse({ code: "invalidInput", message: "Message required" }, 400);
  if (body.clientMarker !== undefined && !isClientMarker(body.clientMarker)) {
    return errorResponse({ code: "invalidInput", message: "Invalid client marker" }, 400);
  }
  if (body.phase !== undefined && !isBrainstormPhase(body.phase)) {
    return errorResponse({ code: "invalidInput", message: "Invalid brainstorm phase" }, 400);
  }
  const clientMarker = body.clientMarker;
  const phase = isBrainstormPhase(body.phase) ? body.phase : "gathering";

  const userMessage = await db.message.create({
    data: { sessionId: id, role: "user", content },
  });

  if (clientMarker === "GENERATE_DIRECT" || clientMarker === "ALL_SECTIONS_CONFIRMED") {
    return successResponse({ userMessage, message: null, marker: clientMarker });
  }

  const chatModel = await resolveModel("chat", user.id);
  if (!chatModel) return errorResponse({ code: "modelNotConfigured", message: "No chat model configured" }, 400);

  const existingCount = await db.message.count({
    where: { sessionId: id, role: { in: ["user", "ai"] } },
  });

  let ragSupplement = "";
  if (existingCount <= 2) {
    const ragResult = await preFetchDomainKnowledge(content, user.id);
    if (ragResult) {
      ragSupplement = `\n\n## Background Reference (internal only; never mention, cite, or imply that this material exists)\n${ragResult}`;
    }
  }

  const historyDesc = await db.message.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: "desc" },
    take: BRAINSTORM_HISTORY_LIMIT,
  });
  const history = historyDesc.reverse();

  const locale = resolveDocumentLanguage(resolveBrainstormLocale(request.headers.get("x-locale")) ?? await resolveLocale());
  const promptPhase = resolveBrainstormPromptPhase(phase, history);
  const facilitatorPrompt = buildFacilitatorPrompt(locale, promptPhase);

  const llmMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: facilitatorPrompt + ragSupplement },
    ...history.filter((m) => m.role !== "system").map((m) => ({
      role: (m.role === "ai" ? "assistant" : "user") as "assistant" | "user",
      content: trimMessageContent(m.content),
    })),
  ];

  try {
    const provider = createLLMProvider(chatModel.provider);
    const response = await runBrainstormCompletion(provider, chatModel.modelId, llmMessages);
    const rawContent = response.content;
    const marker = detectMarker(rawContent);
    const cleanContent = stripMarker(rawContent, marker);
    let effectiveMarker = clientMarker ?? marker;
    let effectiveContent = cleanContent;

    // Server-side hard gate: never let the conversation leave the gathering
    // phase without a user-confirmed length requirement. If the model tries to
    // end discovery (NEEDS_GATHERED) before the user has stated length/words/
    // pages/format, ask the length question instead of advancing.
    if (promptPhase === "gathering" && marker === "NEEDS_GATHERED" && !conversationHasLengthRequirement(history)) {
      effectiveMarker = null;
      effectiveContent = buildLengthRequirementQuestion(locale);
    }

    if (promptPhase === "direction" && marker === "DIRECTION_CONFIRMED" && !conversationHasLengthRequirement(history)) {
      effectiveMarker = null;
      effectiveContent = buildLengthRequirementQuestion(locale);
    }

    const msg = await db.message.create({
      data: { sessionId: id, role: "ai", content: effectiveContent },
    });

    await recordTokenUsage({
      userId: user.id,
      modelConfigId: chatModel.id,
      module: "brainstorm",
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      referenceId: id,
    }).catch(() => {});

    return successResponse({ userMessage, message: msg, marker: effectiveMarker });
  } catch (error) {
    if (isTransientLLMError(error)) {
      return errorResponse({
        code: "generationFailed",
        message: "Brainstorm response generation failed because the model service connection was interrupted. Please retry this message.",
      }, 502);
    }
    return errorResponse(error);
  }
}
