import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { SYSTEM_PROMPT_CREATE, SYSTEM_PROMPT_EDIT, isCJK, translateLabels, stripCodeFences, repairJson } from "@/lib/writing/diagram-translate";
import type { LLMProvider } from "@/lib/llm/types";

const MAX_RETRIES = 2;

async function generateDiagramCode(
  provider: LLMProvider,
  modelId: string,
  messages: { role: "system" | "user"; content: string }[],
  needChinese: boolean,
): Promise<string> {
  let lastError = "";

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

    let code = stripCodeFences(response.content.trim());
    code = repairJson(code);

    if (needChinese) {
      code = await translateLabels(code, provider, modelId);
    }

    // Validate the output structure
    try {
      const parsed = JSON.parse(code);
      if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
        return code; // Valid — return immediately
      }
      lastError = `Empty or missing nodes array (count: ${parsed.nodes?.length ?? 0})`;
      console.error("[mermaid-generate-code] LLM returned JSON with missing/empty nodes:", {
        keys: Object.keys(parsed),
        nodeCount: parsed.nodes?.length ?? 0,
      });
    } catch {
      // Not JSON — check if it looks like mermaid syntax
      if (code.includes("-->") || code.includes("==>") || code.includes("-.->")) {
        return code; // Valid mermaid syntax — pass through
      }
      lastError = "Output is neither valid JSON nor recognizable mermaid syntax";
      console.error("[mermaid-generate-code] LLM returned unparseable output:", code.slice(0, 200));
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

  const { id: draftId } = await params;
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

    const code = await generateDiagramCode(provider, writingModel.modelId, messages, needChinese);

    return successResponse({ code });
  } catch (error) {
    console.error("[mermaid-generate-code] error:", error);
    return errorResponse(error);
  }
}
