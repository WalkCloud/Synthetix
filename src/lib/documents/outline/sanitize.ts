export function sanitizeMarkdown(text: string): string {
  let result = text;

  // Compress 3+ consecutive newlines to double newline
  result = result.replace(/\n{3,}/g, "\n\n");

  // Keep image anchors searchable while removing links to local binary files.
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, alt: string) => {
    const trimmedAlt = alt.trim();
    return trimmedAlt ? `[Image: ${trimmedAlt}]` : "";
  });

  // Docling sometimes emits headings with 7+ # symbols (e.g. "########### 1 目录").
  // Standard markdown only supports #{1,6}. Cap to 6 so isMarkdownHeading can match.
  result = result.replace(/^(#{7,})\s+/gm, () => "#".repeat(6) + " ");

  // Docling exports TOC entries as plain text with tab+page-number suffixes
  // ("1 项目建设背景\t6"). These are not headings — strip the trailing tab+number
  // so isPlainTextTitle doesn't promote them to section titles with page noise.
  // Only matches lines that DON'T start with #, |, [, or whitespace (real
  // markdown headings, tables, and images are excluded).
  result = result.replace(/^([^\n|#\[\s].*?)\t\d+[ \t]*$/gm, "$1");

  // Remove all-empty markdown tables (Docling emits these for image-based tables
  // it can't parse). They carry no retrieval value and waste chunk space.
  // A table is "all-empty" when every data row is only pipes and spaces.
  // Format: header(separator row) + one or more empty data rows.
  result = result.replace(
    /^\|[|\s-]+\|[|\s]*\n(?:\|[|\s]+\|[|\s]*\n?)+/gm,
    "",
  );

  // Remove the Table of Contents block. Docling emits a heading like
  // "###### 1 目录" (or originally "########### 1 目录") followed by TOC entries
  // (plain text lines, some with tab+page-number suffixes). The TOC ends at
  // the first real content heading (## level). Everything between is navigation
  // noise with no retrieval value.
  result = result.replace(
    /(^#{1,6}\s+\d*\s*目录\s*\n)([\s\S]*?)(?=^#{1,6}\s)/m,
    "",
  );

  // Remove document cover pages — standalone bold date/company lines that
  // Docling places before the TOC. These produce empty-near-empty chunks with
  // no retrieval value. Pattern: lines that are entirely **bold** and look like
  // a date or company name.
  result = result.replace(/^\*\*(\d{4}[-/]\d{1,2}[-/]\d{1,2})\*\*\s*$/gm, "");
  result = result.replace(/^\*\*.{2,30}(公司|科技|有限|集团|银行)\*\*\s*$/gm, "");

  // Compress again after removals to avoid triple newlines.
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}
