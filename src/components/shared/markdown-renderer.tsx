export function renderAIContent(content: string): React.ReactNode {
  const text = content.replace(/OUTLINE_REQUESTED/g, "").trim();
  if (!text) return null;

  const lines = text.split("\n");
  return lines.map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const renderedLine = parts.map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={j} className="text-indigo-900 font-semibold">{part.slice(2, -2)}</strong>;
      }
      return part;
    });

    const isList = /^[-*]\s|^[0-9]+[.．]\s/.test(line.trim());
    if (isList) {
      return (
        <div key={i} className="pl-4 relative my-1 text-slate-700">
          <span className="absolute left-0 top-[8px] w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
          {renderedLine}
        </div>
      );
    }
    return <span key={i} className="block mb-2 text-slate-700 leading-relaxed">{renderedLine}</span>;
  });
}
