"""Synthetix document export — converts Markdown to PDF (HTML-based) or DOCX.

Usage:
  python export.py --input <file.md> --output <output_path> --format [pdf|docx]

For PDF: generates a print-friendly standalone HTML file (browser prints to PDF).
For DOCX: uses python-docx for native Word format.
"""
import sys
import json
import argparse
import os


def export_to_html(md_path: str, output_path: str) -> dict:
    """Convert Markdown to a standalone print-friendly HTML (print to PDF)."""
    try:
        import markdown
    except ImportError:
        return {"error": "markdown package not installed. Run: pip install markdown"}

    with open(md_path, "r", encoding="utf-8") as f:
        md_content = f.read()

    title = ""
    for line in md_content.split("\n"):
        if line.startswith("# "):
            title = line[2:].strip()
            break

    html_body = markdown.markdown(
        md_content,
        extensions=["tables", "fenced_code", "codehilite", "toc", "nl2br"],
    )

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{title or "Document"}</title>
<style>
  @media print {{
    body {{ margin: 20mm 25mm; }}
    @page {{ size: A4; }}
  }}
  body {{
    font-family: "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", Georgia, serif;
    font-size: 12pt;
    line-height: 1.8;
    color: #1a1a1a;
    max-width: 210mm;
    margin: 40px auto;
    padding: 0 20px;
  }}
  h1 {{ font-size: 22pt; border-bottom: 2px solid #333; padding-bottom: 8px; margin-top: 0; }}
  h2 {{ font-size: 16pt; margin-top: 28px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }}
  h3 {{ font-size: 14pt; margin-top: 22px; }}
  p {{ margin: 8px 0; }}
  pre {{ background: #f5f5f5; padding: 12px 16px; border-radius: 6px; font-size: 10pt; overflow-x: auto; }}
  code {{ font-family: "JetBrains Mono", "Courier New", monospace; font-size: 10pt; }}
  table {{ border-collapse: collapse; margin: 12px 0; width: 100%; }}
  th, td {{ border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 11pt; }}
  th {{ background: #f0f0f0; font-weight: 600; }}
  blockquote {{ border-left: 3px solid #7c3aed; margin: 12px 0; padding: 4px 16px; color: #555; background: #fafafa; }}
  img {{ max-width: 100%; height: auto; }}
  .page-break {{ page-break-before: always; }}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

    return {"status": "ok", "format": "pdf_html", "output": output_path, "title": title}


def export_to_docx(md_path: str, output_path: str) -> dict:
    """Convert Markdown to DOCX using python-docx."""
    try:
        from docx import Document
        from docx.shared import Pt, Inches, RGBColor
        from docx.enum.text import WD_ALIGN_PARAGRAPH
    except ImportError:
        return {"error": "python-docx not installed. Run: pip install python-docx"}

    with open(md_path, "r", encoding="utf-8") as f:
        md_content = f.read()

    doc = Document()

    # Set default font
    style = doc.styles["Normal"]
    font = style.font
    font.name = "Calibri"
    font.size = Pt(11)

    lines = md_content.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()

        if line.startswith("# "):
            heading = doc.add_heading(line[2:], level=1)
            heading.alignment = WD_ALIGN_PARAGRAPH.LEFT
        elif line.startswith("## "):
            doc.add_heading(line[3:], level=2)
        elif line.startswith("### "):
            doc.add_heading(line[4:], level=3)
        elif line.startswith("#### "):
            doc.add_heading(line[5:], level=4)
        elif line.startswith("```"):
            # Code block — collect until closing ```
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            if code_lines:
                p = doc.add_paragraph()
                run = p.add_run("\n".join(code_lines))
                run.font.name = "Courier New"
                run.font.size = Pt(9)
                p.paragraph_format.left_indent = Inches(0.3)
        elif line.startswith("- ") or line.startswith("* "):
            doc.add_paragraph(line[2:], style="List Bullet")
        elif line.startswith("1. ") or line.startswith("2. "):
            doc.add_paragraph(line[3:], style="List Number")
        elif line.startswith("> "):
            p = doc.add_paragraph()
            run = p.add_run(line[2:])
            run.font.italic = True
            run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
        elif line.startswith("---"):
            doc.add_paragraph("─" * 60)
        elif line == "":
            pass  # skip empty lines
        elif line.startswith("!["):
            caption_end = line.find("](")
            url_end = line.rfind(")")
            if caption_end > 0 and url_end > caption_end:
                alt_text = line[2:caption_end]
                image_ref = line[caption_end + 2:url_end]

                image_path = None
                if image_ref.startswith("data:image/svg+xml;base64,"):
                    import base64
                    import tempfile
                    b64_data = image_ref[len("data:image/svg+xml;base64,"):]
                    try:
                        svg_bytes = base64.b64decode(b64_data)
                        tmp = tempfile.NamedTemporaryFile(suffix=".svg", delete=False, mode="wb")
                        tmp.write(svg_bytes)
                        tmp.close()
                        image_path = tmp.name
                    except Exception:
                        pass
                elif image_ref.startswith("data/"):
                    image_path = os.path.abspath(image_ref)

                if image_path and os.path.exists(image_path):
                    try:
                        from docx.shared import Inches as _Inches
                        doc.add_picture(image_path, width=_Inches(5.5))
                        last_paragraph = doc.paragraphs[-1]
                        last_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        if alt_text:
                            cap = doc.add_paragraph()
                            cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
                            cap_run = cap.add_run(alt_text)
                            cap_run.font.size = Pt(9)
                            cap_run.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
                    except Exception:
                        _add_image_placeholder(doc, alt_text)
                    finally:
                        if image_ref.startswith("data:"):
                            try:
                                os.unlink(image_path)
                            except OSError:
                                pass
                else:
                    _add_image_placeholder(doc, alt_text)
        elif line.startswith("|"):
            # Simple table handling
            rows = [line]
            i += 1
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i].strip())
                i += 1
            if rows:
                add_md_table(doc, rows)
                continue
        else:
            doc.add_paragraph(line)

        i += 1

    doc.save(output_path)
    return {"status": "ok", "format": "docx", "output": output_path}


def _add_image_placeholder(doc, alt_text: str):
    p = doc.add_paragraph()
    run = p.add_run(f"[{alt_text}]")
    run.font.italic = True
    run.font.color.rgb = RGBColor(0x99, 0x99, 0x99)


def add_md_table(doc, rows: list[str]):
    """Parse Markdown table rows and add to docx document."""
    if len(rows) < 2:
        return

    data = []
    for row in rows:
        cells = [c.strip() for c in row.strip("|").split("|")]
        data.append(cells)

    if not data:
        return

    # Check if second row is separator (e.g. |---|)
    if all(c.replace("-", "").replace(":", "").strip() == "" for c in data[1] if len(data) > 1):
        header = data[0]
        body = data[2:]
    else:
        header = data[0]
        body = data[1:]

    num_cols = len(header)
    table = doc.add_table(rows=1 + len(body), cols=num_cols)
    table.style = "Light Grid Accent 1"

    for j, cell_text in enumerate(header):
        cell = table.rows[0].cells[j]
        p = cell.paragraphs[0]
        run = p.add_run(cell_text)
        run.font.bold = True

    for r, row_data in enumerate(body):
        for c, cell_text in enumerate(row_data):
            if c < num_cols:
                cell = table.rows[r + 1].cells[c]
                cell.paragraphs[0].add_run(cell_text)


def main() -> None:
    parser = argparse.ArgumentParser(description="Synthetix document exporter")
    parser.add_argument("--input", required=True, help="Path to Markdown file")
    parser.add_argument("--output", required=True, help="Output file path")
    parser.add_argument("--format", choices=["pdf", "docx"], required=True)
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}))
        sys.exit(1)

    if args.format == "pdf":
        result = export_to_html(args.input, args.output)
    else:
        result = export_to_docx(args.input, args.output)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
