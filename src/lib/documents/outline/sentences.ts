const SENTENCE_END = /(?<=[。！？.!?])(?=\s|$|[A-Z\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff])/g;

export function splitSentences(text: string): string[] {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Collect code blocks atomically
    if (trimmed.startsWith("```")) {
      const blockLines: string[] = [lines[i]];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        blockLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) blockLines.push(lines[i++]); // closing fence
      result.push(blockLines.join("\n"));
      continue;
    }

    // Collect tables atomically
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [lines[i]];
      i++;
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      result.push(tableLines.join("\n"));
      continue;
    }

    // Empty line: skip
    if (!trimmed) {
      i++;
      continue;
    }

    // Regular paragraph: split by sentence boundary
    const sentences = trimmed.split(SENTENCE_END).map((s) => s.trim()).filter((s) => s.length > 0);
    result.push(...sentences);
    i++;
  }

  return result;
}
