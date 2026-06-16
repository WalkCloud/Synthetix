# 知识图谱无内容（方案 A）优化修复实施方案

为了解决用户上传文档成功后，知识图谱中无任何节点和关系的问题，本方案详细阐述了**方案 A** 的实施设计。

方案 A 的核心原则是：**保留异步两阶段索引的性能优势（即先通过 `basic` 模式快速让文档可检索，再通过后台 `graph` 模式异步抽取图谱），同时在执行 `graph` 索引前，自动清理该文档在 LightRAG 中的冲突分块标记，从而打破重复文件过滤机制，确保 LLM 抽取被正确触发。**

---

## 一、 核心成因及修复点

1. **时序问题（Prisma Pipeline）**：`pipeline.ts` 中维度判定滞后，导致首次运行的文档强制降级为 `basic` 模式。
   * **修复点**：将 `resolveEmbeddingDim` 移动到兼容性校验 `isLightRAGCompatible` 之前执行。
2. **重复块过滤冲突（LightRAG Indexer）**：`basic` 模式和 `graph` 模式共用分块 ID（`doc_id/chunk_xxx`）。异步 RAG 提取任务运行时，LightRAG 判断分块已存在而跳过其插入和图谱提取过程。
   * **修复点**：在 `rag_index.py` 中，执行图谱索引插入前，通过查询 `doc_status` 找出该文档的所有分块，调用 `adelete_by_doc_id` 进行前缀级联删除，重置其插入状态。

---

## 二、 详细代码修改设计

### 1. 修改 `src/lib/documents/pipeline.ts` (时序修复)

优先解析维度并更新局部模型状态，确保 `isLightRAGCompatible` 获得的是真实维度而不是 `null` 或 `0`。

```diff
<<<<
  let indexMode = options.indexMode || "basic";
  if (indexMode === "graph" && !isLightRAGCompatible(embedModel)) {
    console.warn(`Embedding model ${embedModel.modelId} (dim=${embedModel.embeddingDim}) not compatible with LightRAG graph mode (requires >= 1536), downgrading to basic`);
    indexMode = "basic";
  }

  const ragChunksDir = outputDir;
  const ragEmbedConfig = embedModel.provider.apiKey
    ? buildEmbedConfig(embedModel)
    : undefined;

  const ragLlmConfig = writingModel?.provider.apiKey
    ? buildEmbedConfig(writingModel)
    : undefined;

  const ragEmbedDim = await resolveEmbeddingDim(embedModel).catch(() => 768);
====
  const ragEmbedDim = await resolveEmbeddingDim(embedModel).catch(() => 768);
  
  // 更新本地模型实体的 embeddingDim，防止 timing 造成的错误降级
  embedModel.embeddingDim = ragEmbedDim;

  let indexMode = options.indexMode || "basic";
  if (indexMode === "graph" && !isLightRAGCompatible(embedModel)) {
    console.warn(`Embedding model ${embedModel.modelId} (dim=${embedModel.embeddingDim}) not compatible with LightRAG graph mode (requires >= 1536), downgrading to basic`);
    indexMode = "basic";
  }

  const ragChunksDir = outputDir;
  const ragEmbedConfig = embedModel.provider.apiKey
    ? buildEmbedConfig(embedModel)
    : undefined;

  const ragLlmConfig = writingModel?.provider.apiKey
    ? buildEmbedConfig(writingModel)
    : undefined;
>>>>
```

### 2. 修改 `workers/python/rag_index.py` (自动清理冲突标记)

在 `initialize_storages` 之后，且在 `insert_chunks` 之前，扫描 `doc_status` 中以该 `doc_id/` 开头的所有分块 ID。如果有，则逐个调用 `adelete_by_doc_id` 物理移除，包括删除它们在向量库（例如 `vdb_chunks`）和 KV 存储中的痕迹。

```diff
<<<<
        await rag.initialize_storages()

        chunk_files = sorted([f for f in os.listdir(chunks_dir) if f.startswith("chunk_")])
====
        await rag.initialize_storages()

        # 如果在 graph 模式下运行，优先清除可能已经存在的 basic 索引痕迹
        if index_mode == "graph":
            from lightrag.base import DocStatus
            print(f"Cleaning existing RAG chunks for document {doc_id} to prevent duplicate skipping...", file=sys.stderr)
            try:
                # 获取所有状态的文档记录（兼容任意底层 KV 存储）
                all_docs = await rag.doc_status.get_docs_by_statuses(list(DocStatus))
                # 过滤出当前文档的分块 ID 以及根 ID
                to_delete = [k for k in all_docs.keys() if k == doc_id or k.startswith(doc_id + "/")]
                if to_delete:
                    print(f"Found {len(to_delete)} registered chunks/docs to clean up.", file=sys.stderr)
                    for chunk_id in to_delete:
                        await rag.adelete_by_doc_id(chunk_id)
                    print("RAG workspace cleanup completed successfully.", file=sys.stderr)
            except Exception as cleanup_err:
                print(f"Warning during RAG pre-indexing cleanup (non-blocking): {cleanup_err}", file=sys.stderr)

        chunk_files = sorted([f for f in os.listdir(chunks_dir) if f.startswith("chunk_")])
>>>>
```

---

## 三、 实施步骤

1. **备份受影响的文件**：
   * `src/lib/documents/pipeline.ts`
   * `workers/python/rag_index.py`
2. **应用方案代码修改**：按照上述 Diff 对文件做精确修改。
3. **任务队列重启**：
   若处于本地开发环境，重启 `npm run dev` / `next dev` 开发服务器，确保新代码在进程中加载。

---

## 四、 验证与测试方法

### 1. 命令行集成测试

执行以下命令直接测试已被 `basic` 索引过的文档是否能成功提取图谱：

```bash
python workers/python/rag_index.py --doc-id 8ca5eaa3-93e0-478c-b3b1-815047575d17 --user-id eeca6436-72cd-4fd1-8cbe-00e9a7279896 --chunks-dir data/documents/eeca6436-72cd-4fd1-8cbe-00e9a7279896/8ca5eaa3-93e0-478c-b3b1-815047575d17 --index-mode graph --embed-dim 1536 --embeddings-file data/documents/eeca6436-72cd-4fd1-8cbe-00e9a7279896/8ca5eaa3-93e0-478c-b3b1-815047575d17/embeddings.bin --llm-api-base https://token-plan-cn.xiaomimimo.com/v1 --llm-api-key <decrypted_key> --llm-model mimo-v2.5-pro
```

**期望输出**：
控制台打印：
```text
Cleaning existing RAG chunks for document 8ca5eaa3-93e0-478c-b3b1-815047575d17...
Found 60 registered chunks/docs to clean up.
...
RAG workspace cleanup completed successfully.
...
INFO: Completed merging: X entities, Y relations
```

### 2. 数据库状态检查

查询 `async_tasks` 表中的最近 `rag_index` 任务记录：

```sql
SELECT id, result_data FROM async_tasks WHERE type='rag_index' ORDER BY created_at DESC LIMIT 1;
```

**期望结果**：
`result_data` 中的 `graph_entities` 值应大于 `0`（例如 `197`），且 `status` 为 `indexed`。

### 3. 前端图谱展示确认

登录应用并进入“知识图谱（Knowledge Graph）”页面，在无 entity 搜索框的情况下直接加载核心图谱，图谱 Canvas 应该渲染展示网络拓扑图，拓扑节点与边数不为 0。
