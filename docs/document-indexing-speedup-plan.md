# 大文档知识库导入与向量化性能提速方案 (Document Ingestion & Vectorization Speedup Plan)

本设计方案旨在将超大文档（如 80MB 以上的 PDF/Word）导入知识库时的解析、拆分、向量化和 LightRAG 索引耗时，从数十分钟（或超时卡死）降低至 **45 秒以内**，同时在拆分边界完整性和向量召回精确度上不作任何妥协。

---

## 1. 提速目标与量化指标

-   **核心目标**：实现大文档极速处理，解决文件锁、429限流与队列超时问题。
-   **量化指标 (以 80M 级别 PDF 约 10,000+ 个 Chunk 为例)**：
    -   大文档解析与 Markdown 转换：由 2 分钟降至 **15 秒** 左右（通过大文档图片提取过滤）。
    -   大纲语义拆分：由 5 分钟（超时放弃）降至 **5 秒** 左右（通过全局 TOC 单次决策与句边界递归定位）。
    -   Prisma SQLite 向量存盘：由 15 分钟降至 **3 秒** 左右（通过批量事务合并）。
    -   LightRAG 图与向量索引：由 20 分钟降至 **15 秒** 左右（通过内存批量合并落盘）。

---

## 2. 关键优化模块与代码级修改设计

### 任务 1：Prisma SQLite 事务合并批量更新 (提速 500x)
-   **现状瓶颈**：在 [pipeline.ts](file:///E:/project01/src/lib/documents/pipeline.ts) 的 `embedDocumentChunks` 阶段，对生成的向量进行逐条 `update` 存入 SQLite。因为 SQLite 为文件锁机制，单条更新会导致频繁锁表，CPU 暴涨。
-   **重构方案**：
    -   将向量的更新逻辑重构为分批处理（例如每 500 条一组），使用 Prisma 的 `$transaction` 统一提交。
-   **伪代码设计**：
    ```typescript
    // src/lib/documents/pipeline.ts 中的向量存盘修改
    const BATCH_SIZE = 500;
    const updates = embedResult.embeddings.map((emb, ei) => {
      const embBuf = float32ToBuffer(new Float32Array(emb));
      const chunkId = validChunks[start + ei].id;
      return { chunkId, embedding: embBuf };
    });

    for (let k = 0; k < updates.length; k += BATCH_SIZE) {
      const batch = updates.slice(k, k + BATCH_SIZE);
      await db.$transaction(
        batch.map(u =>
          db.documentChunk.update({
            where: { id: u.chunkId },
            data: { embedding: u.embedding, embedModel: embedModel.modelId },
          })
        )
      );
    }
    ```

---

### 任务 2：LightRAG 串行改批量（Bulk Ingestion）落盘 (提速 80x)
-   **现状瓶颈**：在 [rag_index.py](file:///E:/project01/workers/python/rag_index.py) 中，系统对每个 Chunk 文件逐一串行读取并调用 `rag.ainsert()`，触发了 LightRAG 内部严重的读写放大和反序列化开销。
-   **重构方案**：
    -   改为一次性读取所有 Chunk 文本，将其作为列表 `List[str]` 传入 `rag.ainsert(list_of_chunks)`。
    -   配置 LightRAG 的并发控制参数 `insert_batch_size` 和 `max_parallel_insert`，保证多路并发的高效运行并在内存中合并后**一次性落盘**。
-   **Python 伪代码设计**：
    ```python
    # workers/python/rag_index.py 批量索引重构
    chunk_files = sorted([f for f in os.listdir(chunks_dir) if f.startswith("chunk_")])
    contents = []
    chunk_ids = []
    
    for f in chunk_files:
        chunk_path = os.path.join(chunks_dir, f)
        with open(chunk_path, "r", encoding="utf-8") as fp:
            contents.append(fp.read())
        chunk_ids.append(f"{doc_id}/{f.replace('.md', '')}")

    if contents:
        # 配置大批次并发以减少单次大模型往返
        rag.insert_batch_size = 40
        rag.max_parallel_insert = 4
        # 一次性批量写入
        await rag.ainsert(contents, ids=chunk_ids)
    ```

---

### 任务 3：大文档语义拆分降级与全局 TOC 提取决策 (提速 100x)
-   **现状瓶颈**：[semantic-splitter.ts](file:///E:/project01/src/lib/documents/semantic-splitter.ts) 发送数百个 LLM 请求来确定小段落合并，导致接口被大模型限流锁死，最终超时白白耗费 5 分钟。
-   **重构方案**：
    -   **目录树（TOC）一次性决策**：提取出 Markdown 中所有带有 `#`、`##` 标识的标题，组装为全局目录树，一次性投喂给 LLM 做合并判定，从数百次 API 压缩为 1 次 API。
    -   **句边界保护与面包屑增强**：当单章节字数超标时，使用基于标点符号（如 `。`、`.`）的递归分段器进行本地合并，绝对不截断句子。同时在 Chunk 中拼接 `[Context: 章节层级]` 面包屑前缀，保证向量检索召回精确度。

---

### 任务 4：限制大文档图片解析 (PDF 转换优化)
-   **现状瓶颈**：在 [convert.py](file:///E:/project01/workers/python/convert.py) 中，对 PDF 进行逐页图片提取，大量小图标和背景图片阻塞了磁盘 IO，且后端需进行海量数据库 `upsert`。
-   **重构方案**：
    -   在 PDF 转换时，读取总页数。若 PDF 页数超过 50 页（或文件大于 20MB），转换器自动关闭图片提取功能，仅提取文字为 Markdown。
-   **Python 伪代码设计**：
    ```python
    # workers/python/convert.py 中 PDF 图片提取限制
    doc = fitz.open(input_file)
    extract_images = len(doc) <= 50  # 超过50页的文档不进行图片提取
    
    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text("text")
        # ...
        if extract_images:
            image_list = page.get_images(full=True)
            # 提取图片并保存 ...
    ```

---

## 3. 实施风险与控制 (Risks & Mitigations)

1.  **LightRAG 并发提取触发 API 429 报错**：
    -   *风险*：批量插入时并发数配置过大（如 `max_parallel_insert=10`）可能瞬间压垮企业限额。
    -   *控制*：默认限制 `max_parallel_insert = 4`，并将批量插入时可能出现的重试捕获在 `llm_func` 的重试装饰器中（增加指数退避时间）。
2.  **大文档无结构情况下的拆分降级**：
    -   *风险*：某些超大文档本身就是扫描件或排版极差，没有明显的 Markdown 标题结构。
    -   *控制*：在此类无结构大文档中，系统将自动使用**句边界递归拆分器**进行本地等长滑块处理，利用标点分割，保证语义单位完整性，不再调用 LLM 进行合并判定。
