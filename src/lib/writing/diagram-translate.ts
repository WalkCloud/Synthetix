import type { LLMProvider } from "@/lib/llm/types";

const DIAGRAM_TYPES = `architecture, data-flow, flowchart, sequence, agent, memory, comparison, timeline, mind-map, class, use-case, state-machine, er-diagram, network-topology`;
const NODE_SHAPES = `rect, double_rect, cylinder, hexagon, diamond, document, folder, terminal, speech, user_avatar, bot, icon_box`;
const ARROW_FLOWS = `control (purple), read (blue), write (green), data (orange), async (yellow), feedback (red), neutral (gray)`;

export const SYSTEM_PROMPT_CREATE = `You are a technical diagram generator. Output ONLY valid JSON — no explanation, no fences.

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

export const SYSTEM_PROMPT_EDIT = `You are a technical diagram editor. Output ONLY valid JSON — no explanation, no fences.

Given: current diagram JSON + modification request. Modify according to request, preserve structure.
- Node shapes: ${NODE_SHAPES}
- Arrow flows: ${ARROW_FLOWS}
- All text labels MUST be in the SAME language as the user's modification request.`;

export function isCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

function extractAllTexts(json: string): string[] {
  const texts: string[] = [];
  const patterns = [/"title"\s*:\s*"([^"]+)"/g, /"subtitle"\s*:\s*"([^"]+)"/g, /"label"\s*:\s*"([^"]+)"/g, /"sublabel"\s*:\s*"([^"]+)"/g, /"typeLabel"\s*:\s*"([^"]+)"/g, /"footer"\s*:\s*"([^"]+)"/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(json)) !== null) {
      if (m[1] && !isCJK(m[1])) texts.push(m[1]);
    }
  }
  return [...new Set(texts)];
}

function applyTranslations(obj: any, translations: Record<string, string>): any {
  if (typeof obj === "string") return translations[obj] || obj;
  if (Array.isArray(obj)) return obj.map((item) => applyTranslations(item, translations));
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

export async function translateLabels(code: string, provider: LLMProvider, modelId: string): Promise<string> {
  const englishTexts = extractAllTexts(code);
  if (englishTexts.length === 0) return code;

  const list = englishTexts.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const resp = await provider.chat({
    model: modelId,
    messages: [
      { role: "system", content: `Translate the following technical diagram labels to Chinese. Output ONLY a JSON object mapping original English to Chinese translation. Example: {"API Gateway":"API 网关","Database":"数据库"}. No explanation.` },
      { role: "user", content: list },
    ],
    temperature: 0.1,
    maxTokens: 1024,
  });

  try {
    let raw = resp.content.trim();
    raw = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    const map = JSON.parse(raw);
    if (typeof map === "object" && map !== null) {
      const parsed = JSON.parse(code);
      return JSON.stringify(applyTranslations(parsed, map));
    }
  } catch {}
  return code;
}

export function repairJson(code: string): string {
  try { JSON.parse(code); return code; } catch {}
  const jsonMatch = code.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return code;
  try { JSON.parse(jsonMatch[0]); return jsonMatch[0]; } catch {}
  let fixed = jsonMatch[0];
  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/\]/g) || []).length;
  const openBraces = (fixed.match(/\{/g) || []).length;
  const closeBraces = (fixed.match(/\}/g) || []).length;
  for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += "]";
  for (let i = 0; i < openBraces - closeBraces; i++) fixed += "}";
  if (fixed.match(/"[^"]*$/)) fixed += '"';
  try { JSON.parse(fixed); return fixed; } catch {}
  return code;
}

export function stripCodeFences(code: string): string {
  return code.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}
