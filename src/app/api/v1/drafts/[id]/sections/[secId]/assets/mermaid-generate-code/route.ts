import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { SYSTEM_PROMPT_CREATE, SYSTEM_PROMPT_EDIT, isCJK, translateLabels, stripCodeFences, repairJson } from "@/lib/writing/diagram-translate";

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

    const response = await provider.chat({
      model: writingModel.modelId,
      messages,
      temperature: 0.3,
      maxTokens: 4096,
    });

    let code = stripCodeFences(response.content.trim());
    code = repairJson(code);

    if (needChinese) {
      code = await translateLabels(code, provider, writingModel.modelId);
    }

    return successResponse({ code });
  } catch (error) {
    return errorResponse(error);
  }
}
