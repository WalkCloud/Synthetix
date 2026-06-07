export function sanitizeMarkdown(text: string): string {
  let result = text;

  // Compress 3+ consecutive newlines to double newline
  result = result.replace(/\n{3,}/g, "\n\n");

  // Strip meaningless short image placeholders (no alt text, no useful info)
  result = result.replace(/!\[.{0,10}\]\([^)]+\)/g, "");

  return result;
}
