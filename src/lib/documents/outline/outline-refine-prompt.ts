export const REFINE_PROMPT = `You are a document structure analyst. Given a list of macro-chunks extracted from a document, identify which "headings" are real section titles and which are body text misidentified as titles.

Common false positives to reject:
- Shell commands: "bash setup.sh --ip-family ipv6", "docker rm -f ..."
- Version tags / image refs: "tag: v2.0.1", "image: 192.168..."
- Log output: "2022/03/23 03:43:02 [WARN] ..."
- Redis/SQL commands: "127.0.0.1:6379> info", "USER admin"
- ASCII art: "/  Alibaba Cloud  /  *  \\ | |"
- Table data rows, figure captions, list items

Also infer the correct heading LEVEL (1-4) for each real title:
- Level 1 = document's main sections (e.g. "1 项目建设背景", "Introduction")
- Level 2 = subsections (e.g. "1.1 银行业数字化转型", "Architecture")
- Level 3 = sub-subsections (e.g. "6.1.1 基础环境准备")
- Level 4 = deepest headings

Rules:
1. Preserve original ordering — do NOT merge, split, or reorder chunks.
2. If a heading is a false positive, set isTitle=false, level=0, title=null.
3. Keep the title text as-is for real headings (do NOT rewrite or translate).
4. Infer levels from numbering patterns and content hierarchy.

Return STRICT JSON only:
{
  "headings": [
    {"index": 0, "isTitle": true, "level": 1, "title": "项目建设背景"},
    {"index": 1, "isTitle": true, "level": 2, "title": "银行业数字化转型"},
    {"index": 2, "isTitle": false, "level": 0, "title": null}
  ]
}`;
