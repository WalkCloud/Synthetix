"""Synthetix document converter — Docling-only.

Usage: python convert.py <input_file> <output_dir>
Output: prints JSON to stdout with conversion results.

On success (exit 0):
  {
    "markdown": "<output_dir>/full.md",
    "structure": "<output_dir>/structure.json",
    "imageManifest": "<output_dir>/images/manifest.json" | null,
    "imageCount": N,
    "format": ".ext",
    "conversionMethod": "docling",
    "metadata": { "pageCount": N, "hasTables": bool, "hasFigures": bool, "hasStructure": bool }
  }

On failure (exit 1):
  { "error": "...", "conversionMethod": "docling" }
"""
import sys
import os
import json
import hashlib
import traceback

from docling.document_converter import DocumentConverter


def _build_image_manifest(doc, output_dir: str) -> tuple[list[dict], int]:
    images_dir = os.path.join(output_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    manifest = []
    img_index = 0

    for pic in doc.pictures:
        img_bytes = None
        ext = "png"

        if hasattr(pic, "image") and pic.image is not None:
            try:
                if hasattr(pic.image, "pil_image") and pic.image.pil_image is not None:
                    import io
                    buf = io.BytesIO()
                    pic.image.pil_image.save(buf, format="PNG")
                    img_bytes = buf.getvalue()
                elif hasattr(pic.image, "uri") and pic.image.uri:
                    if os.path.isfile(pic.image.uri):
                        with open(pic.image.uri, "rb") as f:
                            img_bytes = f.read()
                        _, ext = os.path.splitext(pic.image.uri)
                        ext = ext.lstrip(".") or "png"
            except Exception:
                continue

        if img_bytes is None:
            continue

        if len(img_bytes) < 100:
            continue

        if ext == "jpeg":
            ext = "jpg"

        h = hashlib.md5(img_bytes).hexdigest()[:8]
        filename = f"img_{img_index:03d}_{h}.{ext}"
        filepath = os.path.join(images_dir, filename)
        with open(filepath, "wb") as f:
            f.write(img_bytes)

        page = None
        if hasattr(pic, "prov") and pic.prov:
            prov = pic.prov[0] if isinstance(pic.prov, list) else pic.prov
            if hasattr(prov, "page_no"):
                page = prov.page_no
            elif isinstance(prov, dict):
                page = prov.get("page_no")

        caption = None
        if hasattr(pic, "caption") and pic.caption:
            cap = pic.caption
            if hasattr(cap, "text"):
                caption = cap.text
            elif isinstance(cap, str):
                caption = cap

        ref = ""
        if hasattr(pic, "self_ref"):
            ref = str(pic.self_ref)

        manifest.append({
            "ref": ref,
            "filename": filename,
            "path": f"images/{filename}",
            "page": page,
            "caption": caption,
            "size": len(img_bytes),
        })
        img_index += 1

    return manifest, img_index


def _build_structure_json(doc) -> dict:
    structure = {
        "schema": "docling_structure_v1",
        "sections": [],
        "texts": [],
        "tables": [],
        "pictures": [],
    }

    for item, level in doc.iterate_items():
        label = getattr(item, "label", "unknown")
        text = getattr(item, "text", None) or ""
        heading_path = ""

        if hasattr(item, "heading_path"):
            hp = item.heading_path
            if hasattr(hp, "sections"):
                heading_path = " > ".join(
                    s.text for s in hp.sections if hasattr(s, "text")
                )
            elif isinstance(hp, str):
                heading_path = hp

        page_no = None
        if hasattr(item, "prov") and item.prov:
            prov = item.prov[0] if isinstance(item.prov, list) else item.prov
            if hasattr(prov, "page_no"):
                page_no = prov.page_no
            elif isinstance(prov, dict):
                page_no = prov.get("page_no")

        entry = {
            "label": label,
            "level": level,
            "text": text[:5000],
            "headingPath": heading_path,
            "page": page_no,
        }

        if label == "section_header":
            structure["sections"].append(entry)
        elif label == "table":
            md_text = ""
            if hasattr(item, "export_to_markdown"):
                try:
                    result_obj = item.export_to_markdown(doc)
                    md_text = result_obj.text if hasattr(result_obj, "text") else str(result_obj)
                except TypeError:
                    try:
                        md_text = item.export_to_markdown().text
                    except Exception:
                        pass
                except Exception:
                    pass
            entry["markdown"] = md_text
            structure["tables"].append(entry)
        elif label in ("picture", "figure"):
            entry["pictureRef"] = str(getattr(item, "self_ref", ""))
            structure["pictures"].append(entry)
        else:
            structure["texts"].append(entry)

    return structure


def convert(input_file: str, output_dir: str) -> dict:
    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)

    if not os.path.isdir(output_dir):
        raise RuntimeError(f"Failed to create output directory: {output_dir}")

    ext = os.path.splitext(input_file)[1].lower()

    converter = DocumentConverter()
    result = converter.convert(input_file)
    doc = result.document

    markdown = doc.export_to_markdown()

    md_path = os.path.join(output_dir, "full.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(markdown)

    structure = _build_structure_json(doc)
    structure_path = os.path.join(output_dir, "structure.json")
    with open(structure_path, "w", encoding="utf-8") as f:
        json.dump(structure, f, ensure_ascii=False, indent=2)

    image_manifest, image_count = _build_image_manifest(doc, output_dir)
    manifest_path = None
    if image_count > 0:
        manifest_path = os.path.join(output_dir, "images", "manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump({"images": image_manifest, "count": image_count}, f, ensure_ascii=False, indent=2)

    pages_dict = doc.export_to_dict().get("pages", {})
    page_count = len(pages_dict) if isinstance(pages_dict, (dict, list)) else 0

    metadata = {
        "pageCount": page_count,
        "hasTables": len(doc.tables) > 0 if hasattr(doc, "tables") else False,
        "hasFigures": len(doc.pictures) > 0 if hasattr(doc, "pictures") else False,
        "hasStructure": len(structure["sections"]) > 0,
    }

    output = {
        "markdown": md_path,
        "structure": structure_path,
        "imageManifest": manifest_path,
        "imageCount": image_count,
        "format": ext,
        "conversionMethod": "docling",
        "metadata": metadata,
    }

    return output


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: python convert.py <input_file> <output_dir>", "conversionMethod": "docling"}))
        sys.exit(1)

    input_file = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(input_file):
        print(json.dumps({"error": f"Input file not found: {input_file}", "conversionMethod": "docling"}))
        sys.exit(1)

    try:
        result = convert(input_file, output_dir)
        print(json.dumps(result, ensure_ascii=False))
    except FileNotFoundError as e:
        tb = traceback.format_exc()
        msg = f"[Errno 2] {str(e)}"
        print(json.dumps({"error": msg, "conversionMethod": "docling", "hint": "Output directory or input file not accessible. Check permissions and disk space."}))
        sys.exit(1)
    except Exception as e:
        tb = traceback.format_exc()
        msg = f"Docling conversion failed: {str(e)}"
        print(json.dumps({"error": msg, "conversionMethod": "docling", "traceback": tb}))
        sys.exit(1)


if __name__ == "__main__":
    main()
