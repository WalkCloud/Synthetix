"""Synthetix document converter — uses MarkItDown to convert files to Markdown.

Usage: python convert.py <input_file> <output_dir>
Output: writes full.md to output_dir, prints output path to stdout
"""
import sys
import os
from markitdown import MarkItDown

def main():
    if len(sys.argv) != 3:
        print("Usage: python convert.py <input_file> <output_dir>", file=sys.stderr)
        sys.exit(1)

    input_file = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(input_file):
        print(f"Input file not found: {input_file}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    md = MarkItDown()
    result = md.convert(input_file)
    output_path = os.path.join(output_dir, "full.md")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(result.text_content)

    print(output_path)

if __name__ == "__main__":
    main()
