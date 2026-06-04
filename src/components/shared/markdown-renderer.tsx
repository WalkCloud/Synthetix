export function renderAIContent(content: string): React.ReactNode {
  const text = content.replace(/OUTLINE_REQUESTED/g, "").trim();
  if (!text) return null;

  const lines = text.split("\n");
  return lines.map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const renderedLine = parts.map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={j} className="font-semibold text-primary">{part.slice(2, -2)}</strong>;
      }
      return part;
    });

    const isList = /^[-*]\s|^[0-9]+[.．]\s/.test(line.trim());
    if (isList) {
      return (
        <div key={i} className="relative my-1 pl-4 text-foreground">
          <span className="absolute left-0 top-[8px] h-1.5 w-1.5 rounded-full bg-primary"></span>
          {renderedLine}
        </div>
      );
    }
    return <span key={i} className="mb-2 block leading-relaxed text-foreground">{renderedLine}</span>;
  });
}
