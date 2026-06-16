export function sanitizeMarkdown(text: string): string {
  let result = text;

  // Compress 3+ consecutive newlines to double newline
  result = result.replace(/\n{3,}/g, "\n\n");

  // Keep image anchors searchable while removing links to local binary files.
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, alt: string) => {
    const trimmedAlt = alt.trim();
    return trimmedAlt ? `[Image: ${trimmedAlt}]` : "";
  });

  return result;
}
