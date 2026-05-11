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
  const tokens = jieba.cutForSearch(query);
  // Build FTS5 query: each token must be present
  return tokens.filter((t) => t.trim().length > 0).map((t) => `"${t}"`).join(" ");
}
