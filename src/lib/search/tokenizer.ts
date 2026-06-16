import { Jieba } from "@node-rs/jieba";
import { dict as dictBuffer } from "@node-rs/jieba/dict";

let jiebaInstance: Jieba | null = null;

function getJieba(): Jieba {
  if (!jiebaInstance) {
    jiebaInstance = new Jieba();
    jiebaInstance.loadDict(new Uint8Array(dictBuffer));
  }
  return jiebaInstance;
}

export function tokenizeChinese(text: string): string {
  const jieba = getJieba();
  const tokens = jieba.cut(text);
  return tokens.join(" ");
}

export function tokenizeQuery(query: string): string {
  const jieba = getJieba();
  const tokens = jieba.cutForSearch(query).filter((t) => t.trim().length > 0);
  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) return "";
  if (uniqueTokens.length <= 3) {
    return uniqueTokens.map((t) => `"${t}"`).join(" OR ");
  }
  const groups: string[] = [];
  const windowSize = Math.min(3, uniqueTokens.length);
  for (let i = 0; i <= uniqueTokens.length - windowSize; i++) {
    const group = uniqueTokens.slice(i, i + windowSize).map((t) => `"${t}"`).join(" ");
    groups.push(`(${group})`);
  }
  return groups.join(" OR ");
}
