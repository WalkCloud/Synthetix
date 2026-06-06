# 大型文档处理最终优化与执行方案 (Final Optimization Plan)

## 目标说明 (Goal Description)
彻底解决大型文档上传后拆分、向量化和知识图谱构建时间过长的瓶颈问题。通过引入生产消费者流水线、向量相似度拆分算法、LightRAG 的并发批处理以及两阶段索引机制，实现文档的极速处理与平滑展示。代码实现保证优雅、高内聚和可维护。

---

## 优化模块与详细执行逻辑 (Proposed Changes)

### 1. 核心流程优化与两阶段就绪 (Two-Stage Readiness)
目前整个流程从转换到生成最后复杂的 Graph 都在 `document-worker.ts` 中阻塞。我们将实行两阶段分离，确保文档能最快用于普通 RAG 问答。

#### [MODIFY] [document-worker.ts](file:///e:/project01/src/lib/queue/workers/document-worker.ts)
- **阶段一（极速完成）**：执行 Markdown 转换、快速拆分、以及 Embedding 向量化。完成后，执行轻量级的 Basic Indexing（只更新状态，不卡图谱）。将 `document.status` 更新为 `ready`，并在前台解锁标准向量问答。
- **阶段二（后台慢炖）**：若用户选择了 `graph` 索引模式，在文档标记为 `ready` 且当前任务标记完成 (100%) 时，调用 `queue.submit("document_graph_index", { docId })`，将最耗时的图谱抽取衍生为一个完全独立的后台任务。

#### [MODIFY] [queue/index.ts](file:///e:/project01/src/lib/queue/index.ts)
- **注册新 Worker**: 注册 `document_graph_index` 任务处理器。专门用来在后台调用 `pipeline.indexWithLightRAG` 进行知识图谱抽取，与用户的首屏响应时间彻底解绑。

---

### 2. LightRAG 引擎性能释放 (Batch Insert)
当前的 Python 脚本里用 `for` 循环逐个插入，导致大语言模型并发抽取形同虚设。

#### [MODIFY] [rag_index.py](file:///e:/project01/workers/python/rag_index.py)
- **移除逐条循环**：将原来的 `for f in chunk_files: await rag.ainsert(content)` 改造为：
  ```python
  contents, ids, paths = [], [], []
  for f in chunk_files:
      # ... 读取组装
      contents.append(content)
      ids.append(chunk_id)
      paths.append(chunk_path)
  
  # 彻底激活 LightRAG 底层的并发控制与批量提取
  await rag.ainsert(contents, ids=ids, file_paths=paths)
  ```
- 这样能让 LightRAG 根据配置的 `MAX_ASYNC` 充分利用大模型的并发请求配额，将耗时从线性降低为原来的 `1/N`。

---

### 3. 解耦 Embedding 的网络与磁盘 I/O
目前 `embedDocumentChunks` 方法在每一批次请求后，都必须同步等待数据库更新完毕才发起下一次请求网络。

#### [MODIFY] [pipeline.ts](file:///e:/project01/src/lib/documents/pipeline.ts)
- **非阻塞更新**：在 `embedDocumentChunks` 循环中，调用 `provider.embed` 后获得的向量结果，组装为数据库 Update Promise 数组放入后台执行，不再使用 `await boundedAll` 阻塞主线程的网络循环。或者直接改用单次 `db.$executeRaw` 批量写入。
- **本地存储非阻塞**：`splitAndPersistChunks` 中，把数百个 chunk 的本地 `storage.saveChunk` 操作封装为背景异步任务，允许下一步立刻开始调用大模型提取向量。

---

### 4. Semantic Split 算法重构：从 LLM 生成转向向量相似度
利用 LLM 的聊天接口去合并文档标题，慢且极其费钱。

#### [MODIFY] [semantic-splitter.ts](file:///e:/project01/src/lib/documents/semantic-splitter.ts)
#### [MODIFY] [pipeline.ts](file:///e:/project01/src/lib/documents/pipeline.ts) (传递 Embedding Config)
- **引入向量 Cosine Similarity**：我们将废弃原来发送给 `writingModel` 的 prompt。改为：
  1. 调用 `embedModel` 快速给所有相邻标题/段落生成低维文本向量。
  2. 计算相邻向量的**余弦相似度**（纯本地数学计算，耗时 < 10ms）。
  3. 若相似度 > `0.85`（阈值），则将其合并到同一语义块。
- **收益**：速度提升近百倍，不再受限于大模型的 429 限流，并且避免了生成式回答中容易出现的格式错乱问题。

---

## 验证计划 (Verification Plan)

### 功能性验证
- **长文档上传测试**：上传超过 20,000 字的文档。测试拆分阶段是否在几秒内完成（得益于向量相似度拆分），以及是否不再出现 429 Rate Limit。
- **状态流转验证**：前端监控，文档上传后 `embedding` -> `ready` 应该在很短时间内完成，此时能够进行基础 QA。

### 性能评测对比 (预期指标)
- **拆分阶段**：期望耗时从分钟级下降至 5 秒内。
- **Embedding阶段**：因解除了 DB IO 阻塞，耗时预计缩减 30%-50%。
- **知识图谱阶段**：通过 `rag_index.py` 的批量并发抽取，耗时预计缩减为原来的 `1/4` 甚至更低（取决于 `MAX_ASYNC` 的配置）。

## User Review Required

> [!IMPORTANT]
> 这份最终方案完全贴合了系统的高可维护性要求，不修改复杂的 Prisma Schema 模型，而是巧妙地利用异步队列调度和批量处理来压榨性能极限。
> 
> **请审阅本次即将修改的核心文件和逻辑，如果一切符合您的期望，请您批准备案。获得批准后，我将立即开始修改代码。**
