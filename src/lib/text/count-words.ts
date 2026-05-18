export function countWords(text: string): number {
  const latin = text.match(/[a-zA-Z0-9]+/g) || [];
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g) || [];
  return latin.length + cjk.length;
}
