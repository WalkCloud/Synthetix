import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { recordTokenUsage } from "@/lib/llm/usage";
import { SYSTEM_PROMPT_CREATE, SYSTEM_PROMPT_EDIT, isCJK, translateLabels, stripCodeFences, repairJson } from "@/lib/writing/diagram-translate";
import type { LLMProvider } from "@/lib/llm/types";

const MAX_RETRIES = 2;

interface DiagramGenResult {
  code: string;
  inputTokens: number;
  outputTokens: number;
}

async function generateDiagramCode(
  provider: LLMProvider,
  modelId: string,
  messages: { role: "system" | "user"; content: string }[],
  needChinese: boolean,
): Promise<DiagramGenResult> {
  let lastError = "";
  let totalInput = 0;
  let totalOutput = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.warn(`[mermaid-generate-code] Retry attempt ${attempt}/${MAX_RETRIES}`);
    }

    const response = await provider.chat({
      model: modelId,
      messages,
      temperature: 0.3,
      maxTokens: 4096,
    });

    totalInput += response.inputTokens;
    totalOutput += response.outputTokens;

    let code = stripCodeFences(response.content.trim());
    code = repairJson(code);

    if (needChinese) {
      const t = await translateLabels(code, provider, modelId);
      code = t.code;
      totalInput += t.inputTokens;
      totalOutput += t.outputTokens;
    }

    try {
      const parsed = JSON.parse(code);
      if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
        return { code, inputTokens: totalInput, outputTokens: totalOutput };
      }
      lastError = `Empty or missing nodes array (count: ${parsed.nodes?.length ?? 0})`;
      console.error("[mermaid-generate-code] LLM returned JSON with missing/empty nodes:", {
        keys: Object.keys(parsed),
        nodeCount: parsed.nodes?.length ?? 0,
      });
    } catch {
      if (code.includes("-->") || code.includes("==>") || code.includes("-.->")) {
        return { code, inputTokens: totalInput, outputTokens: totalOutput };
      }
      lastError = `Unparseable output (${code.length} chars)`;
      console.error("[mermaid-generate-code] LLM returned unparseable output, length:", code.length);
    }
  }

  throw new Error(
    `LLM failed to generate valid diagram code after ${MAX_RETRIES + 1} attempts. Last issue: ${lastError}`
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId, secId: sectionId } = await params;
  const body = await request.json();
  const { prompt, existingCode } = body as { prompt?: string; existingCode?: string };

  if (!prompt || !prompt.trim()) return errorResponse("Prompt is required", 400);

  const draft = await (await import("@/lib/db")).db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) return errorResponse("Draft not found", 404);

  try {
    const writingModel = await resolveModel("writing");
    if (!writingModel?.provider) return errorResponse("No LLM model configured", 400);

    const provider = createLLMProvider({
      apiBaseUrl: writingModel.provider.apiBaseUrl,
      apiKey: writingModel.provider.apiKey,
    });

    const hasExisting = existingCode && existingCode.trim().length > 0;
    const needChinese = isCJK(prompt.trim());

    const messages = hasExisting
      ? [
          { role: "system" as const, content: SYSTEM_PROMPT_EDIT },
          { role: "user" as const, content: `Current diagram:\n${existingCode!.trim()}\n\nModification: ${prompt.trim()}` },
        ]
      : [
          { role: "system" as const, content: SYSTEM_PROMPT_CREATE },
          { role: "user" as const, content: prompt.trim() },
        ];

    const result = await generateDiagramCode(provider, writingModel.modelId, messages, needChinese);

    await recordTokenUsage({
      userId: user.id,
      modelConfigId: writingModel.id,
      module: "mermaid",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      referenceId: sectionId,
    }).catch((err) => { console.warn("Failed to record mermaid token usage:", err); });

    return successResponse({ code: result.code });
  } catch (error) {
    console.error("[mermaid-generate-code] error:", error);
    return errorResponse(error);
  }
}
