# 文档转换性能优化

日期：2026-06-26
范围：优化 Docling 对大文档（docx/pptx/pdf）的转换耗时，针对"拆分给 LightRAG/wiki/graph"这一真实目标，移除对检索无价值的处理。

---

## 1. 问题

一个 72.6MB / 693 页 / 879 张内嵌图的 docx（投标技术方案），转换耗时 **40+ 分钟**。用户预期：只需把文档拆成文本块喂给 LightRAG，不需要图片/版面的深度分析。

## 2. 根因（通过 faulthandler 栈追踪定位）

初始假设是 DrawingML→LibreOffice 图片渲染慢。栈追踪证伪了它——**真正的瓶颈是 Docling 的文本格式查询**：

```
msword_backend._get_format_from_run()
  → python-docx paragraph.style          ← 慢根源
  → styles.get_by_id → base_style        ← 每次都做 XML xpath
  → xmlchemy.xpath
```

Docling 对**每个 run** 调 `paragraph.style` 判断粗体（爬样式继承链）。python-docx 的 `style.name`/`base_style` 每次查询都触发一次 `xpath` 查找。3415 段落 × 每段多 run × 每次样式查找 = 几十万次 xpath，这是 40 分钟的主要来源。

实测验证（同一文档）：
- 只取 text：0.2 秒
- text + `style.name`：21.2 秒（单次遍历）
- 直接读 XML pStyle：0.0 秒

图片处理（DrawingML/PIL）是次要成本（~20%），不是主因。

## 3. 优化方案

全部改动在 `workers/python/convert.py`，按格式分层：

### 3.1 docx/pptx：monkeypatch 跳过慢路径

- **`_get_format_from_run`**：重写为只读 run 自身的直接格式（`run.bold`/`run.italic`），**不爬样式继承链**。粗体等样式信息对 RAG 无意义，丢失可接受。
- **图片处理方法**（`_handle_pictures`/`_handle_vml_pictures`/`_handle_drawingml`）：no-op，跳过所有图片提取和渲染。图片对 RAG 无价值。

Patches 幂等、防御性（try/except，失败回退原行为不崩溃）。

### 3.2 pdf：文本层检测，按需 OCR

`_pdf_has_text_layer()` 用 pypdfium2 抽样前 5 页，检测是否有可提取文本：
- 有文本层（数字 PDF）：`do_ocr=False`（跳过 OCR 模型推理，大幅加速）
- 无文本层（扫描件）：`do_ocr=True`（保留 OCR，必需）

`CONVERT_FORCE_OCR=true` 可强制开启 OCR 兜底。

### 3.3 其他格式（html/txt/md/xlsx/csv）

默认配置，本就轻量，不动。

## 4. 实测结果

用 ACP 全栈云平台技术方案（88MB / 3415 段落 / 905 图）：

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 转换耗时 | 40+ 分钟 | **86 秒** |
| 加速比 | — | **~28 倍** |
| markdown | — | 351KB / 6088 行 |
| 标题结构 | — | 429 个标题（`##`/`###`/`####` 层级完整保留） |
| 表格 | — | 保留（hasTables=True） |
| 图片 | — | 跳过（对 RAG 无用） |

标题层级抽样验证：
```
## 1 项目总体概述
### 1.1 项目建设背景
#### 1.5.1 建设思路
```
层级清晰、编号连贯，splitter 的 `splitByMacroAST`（按标题切分）可正常工作。

## 5. 配置项

| 环境变量 | 默认 | 说明 |
|---------|------|------|
| `CONVERT_SKIP_IMAGES` | `true` | 跳过图片提取（设 false 恢复图片预览） |
| `CONVERT_FORCE_OCR` | `false` | 强制 PDF 开启 OCR（兜底误判） |

## 6. 不变的部分

- 切分逻辑（`splitter.ts` 的 `splitByMacroAST`）完全不变。
- wiki/graph/embed 流程不变。
- 标题结构和文本质量无损保留——只是不再含图片和样式元信息。

## 7. 局限与后续

- docx 剩余 ~70 秒主要来自 Docling 仍逐 run 遍历（即使不查 style）。进一步压到秒级需绕过 Docling 完全用 python-docx，但自定义样式文档（如本例的内部 ID 样式）无法靠 python-docx 可靠识别标题层级，会牺牲切分质量。当前 28 倍加速已满足需求。
- 图片预览功能缺失（用户已确认接受，图片对 RAG 无价值）。
