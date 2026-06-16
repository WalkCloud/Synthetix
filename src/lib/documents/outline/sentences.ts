const SENTENCE_END = /(?<=[。！？.!?])(?=\s|$|[A-Z\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff])/;

export function splitSentences(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const isLastLine = i === lines.length - 1;
    const lineStr = line + (isLastLine ? "" : "\n");
    const trimmed = line.trim();

    // Collect code blocks atomically
    if (trimmed.startsWith("```")) {
      const blockLines = [lineStr];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        const bl = lines[i];
        blockLines.push(bl + (i === lines.length - 1 ? "" : "\n"));
        i++;
      }
      if (i < lines.length) {
        const bl = lines[i];
        blockLines.push(bl + (i === lines.length - 1 ? "" : "\n"));
        i++;
      }
      result.push(blockLines.join(""));
      continue;
    }

    // Collect tables atomically
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines = [lineStr];
      i++;
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        const tl = lines[i];
        tableLines.push(tl + (i === lines.length - 1 ? "" : "\n"));
        i++;
      }
      result.push(tableLines.join(""));
      continue;
    }

    // Empty line: preserve exactly
    if (!trimmed) {
      result.push(lineStr);
      i++;
      continue;
    }

    // Regular paragraph: split by sentence boundary
    const sentences = lineStr.split(SENTENCE_END);
    result.push(...sentences.filter((s) => s.length > 0));
    i++;
  }

  return result;
}
