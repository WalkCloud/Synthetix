import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";
import type { LLMProvider } from "@/lib/llm/types";

const DIAGRAM_TYPES = `architecture, data-flow, flowchart, sequence, agent, memory, comparison, timeline, mind-map, class, use-case, state-machine, er-diagram, network-topology`;
const NODE_SHAPES = `rect, double_rect, cylinder, hexagon, diamond, document, folder, terminal, speech, user_avatar, bot, icon_box`;
const ARROW_FLOWS = `control (purple), read (blue), write (green), data (orange), async (yellow), feedback (red), neutral (gray)`;

const SYSTEM_PROMPT_CREATE = `You are a technical diagram generator. Output ONLY valid JSON — no explanation, no fences.

Structure:
{
  "type": "diagram-type", "title": "Title", "subtitle": "optional",
  "style": "flat-icon|dark-terminal|blueprint|notion-clean|glassmorphism|claude|openai",
  "nodes": [{ "id": "id", "label": "Label", "shape": "shape", "typeLabel": "Type", "sublabel": "detail" }],
  "arrows": [{ "from": "id", "to": "id", "label": "label", "flow": "flow-type", "dashed": false }],
  "containers": [{ "id": "id", "label": "Group", "subtitle": "optional", "nodeIds": ["id"] }],
  "legend": [{ "flow": "flow-type", "label": "Description" }],
  "footer": "optional"
}

Rules:
- Types: ${DIAGRAM_TYPES}
- Shapes: ${NODE_SHAPES}
- Flows: ${ARROW_FLOWS}
- Max 18 nodes, 25 arrows. Concise labels (1-3 words).
- Every arrow needs a meaningful flow type and label.
- Use containers to group related nodes.
- All text labels (title, node labels, arrow labels, container labels, legend) MUST be in the SAME language as the user's description.`;

const SYSTEM_PROMPT_EDIT = `You are a technical diagram editor. Output ONLY valid JSON — no explanation, no fences.

Given: current diagram JSON + modification request. Modify according to request, preserve structure.
- Node shapes: ${NODE_SHAPES}
- Arrow flows: ${ARROW_FLOWS}
- All text labels MUST be in the SAME language as the user's modification request.`;

function isCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

function extractAllTexts(json: string): string[] {
  const texts: string[] = [];
  const patterns = [
    /"title"\s*:\s*"([^"]+)"/g,
    /"subtitle"\s*:\s*"([^"]+)"/g,
    /"label"\s*:\s*"([^"]+)"/g,
    /"sublabel"\s*:\s*"([^"]+)"/g,
    /"typeLabel"\s*:\s*"([^"]+)"/g,
    /"footer"\s*:\s*"([^"]+)"/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(json)) !== null) {
      if (m[1] && !isCJK(m[1])) texts.push(m[1]);
    }
  }
  return [...new Set(texts)];
}

function applyTranslations(obj: any, translations: Record<string, string>): any {
  if (typeof obj === "string") {
    return translations[obj] || obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => applyTranslations(item, translations));
  }
  if (typeof obj === "object" && obj !== null) {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "title" || key === "subtitle" || key === "label" || key === "sublabel" || key === "typeLabel" || key === "footer") {
        result[key] = typeof value === "string" ? (translations[value] || value) : value;
      } else {
        result[key] = applyTranslations(value, translations);
      }
    }
    return result;
  }
  return obj;
}

async function translateLabels(
  code: string,
  provider: LLMProvider,
  modelId: string,
): Promise<string> {
  const englishTexts = extractAllTexts(code);
  console.log("[mermaid-gen] extracted English texts:", englishTexts);
  if (englishTexts.length === 0) return code;

  const list = englishTexts.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const resp = await provider.chat({
    model: modelId,
    messages: [
      {
        role: "system",
        content: `Translate the following technical diagram labels to Chinese. Output ONLY a JSON object mapping original English to Chinese translation. Example: {"API Gateway":"API 网关","Database":"数据库"}. No explanation.`,
      },
      { role: "user", content: list },
    ],
    temperature: 0.1,
    maxTokens: 1024,
  });

  console.log("[mermaid-gen] translation response:", resp.content);
  try {
    let raw = resp.content.trim();
    raw = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    const map = JSON.parse(raw);
    console.log("[mermaid-gen] parsed translations:", map);
    if (typeof map === "object" && map !== null) {
      const parsed = JSON.parse(code);
      const translated = applyTranslations(parsed, map);
      const result = JSON.stringify(translated);
      console.log("[mermaid-gen] translated result:", result.slice(0, 500));
      return result;
    }
  } catch (e) {
    console.error("[mermaid-gen] translation parse error:", e);
  }
  return code;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId } = await params;
  const body = await request.json();
  const { prompt, existingCode } = body as { prompt?: string; existingCode?: string };

  if (!prompt || !prompt.trim()) {
    return errorResponse("Prompt is required", 400);
  }

  const draft = await (await import("@/lib/db")).db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return errorResponse("Draft not found", 404);
  }

  try {
    const writingModel = await resolveModel("writing");
    if (!writingModel?.provider) {
      return errorResponse("No LLM model configured", 400);
    }

    const provider = createLLMProvider({
      apiBaseUrl: writingModel.provider.apiBaseUrl,
      apiKey: writingModel.provider.apiKey,
    });

    const hasExisting = existingCode && existingCode.trim().length > 0;
    const needChinese = isCJK(prompt.trim());
    console.log("[mermaid-gen] prompt:", prompt.trim().slice(0, 100));
    console.log("[mermaid-gen] needChinese:", needChinese);

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

    let code = response.content.trim();
    code = code.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

    try {
      JSON.parse(code);
    } catch {
      const jsonMatch = code.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          JSON.parse(jsonMatch[0]);
          code = jsonMatch[0];
        } catch {
          let fixed = jsonMatch[0];
          const openBrackets = (fixed.match(/\[/g) || []).length;
          const closeBrackets = (fixed.match(/\]/g) || []).length;
          const openBraces = (fixed.match(/\{/g) || []).length;
          const closeBraces = (fixed.match(/\}/g) || []).length;
          for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += "]";
          for (let i = 0; i < openBraces - closeBraces; i++) fixed += "}";
          if (fixed.match(/"[^"]*$/)) fixed += '"';
          try {
            JSON.parse(fixed);
            code = fixed;
            console.log("[mermaid-gen] fixed truncated JSON");
          } catch {}
        }
      }
    }

    console.log("[mermaid-gen] LLM output (first 300):", code.slice(0, 300));

    if (needChinese) {
      const before = code;
      code = await translateLabels(code, provider, writingModel.modelId);
      console.log("[mermaid-gen] before translation:", before.slice(0, 200));
      console.log("[mermaid-gen] after translation:", code.slice(0, 200));
    }

    return successResponse({ code });
  } catch (error) {
    console.error("[mermaid-gen] error:", error);
    return errorResponse(error);
  }
}
