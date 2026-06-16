# 知识图谱生成为空：代码级深度交叉分析报告

## 核心矛盾与分析背景

用户的困惑完全合理：“**我明明在文档初始化的时候选择了实体抽取+知识图谱，为什么最后知识图谱里还是没有任何内容？**”

为了解答这个问题，我们必须跳出单纯的“配置是否有误”的思维，进行一次从**前端请求** -> **Node.js 处理队列** -> **Python 脚本** -> **LightRAG 底层源码** 的全链路、跨语言级别的深度追踪。

通过交叉验证发现，**用户的意图没有丢失，但是被系统当前的“双阶段异步处理架构”与“底层去重机制”的冲突所吞噬了。**

以下是完整的深度剖析：

---

## 追踪节点 1：用户意图的接收 (API 层)
**文件**: `src/app/api/v1/documents/upload/route.ts`

当用户在前端勾选“实体抽取+知识图谱”时，表单数据中包含了 `indexMode: "graph"`。
在 API 层，这段意图被正确捕获：
```typescript
// route.ts 成功读取了 graph 意图
indexMode: (formData.get("indexMode") as ProcessingOptions["indexMode"]) || undefined,
```
此时，系统的数据库中也准确地将这个文档的 `ProcessingOptions.indexMode` 记为了 `graph`。**这一步，一切正常。**

---

## 追踪节点 2：意图的“强制降级”与双阶段分离 (Worker 层)
**文件**: `src/lib/queue/workers/document-worker.ts`

系统在处理大型文档时，为了让用户能“秒级”看到文本内容并开始对话，设计了一个**两阶段（Two-Phase）策略**：
1. 第一阶段（主 Worker）：先进行快速的切片和向量化（`basic` 模式），满足基础对话。
2. 第二阶段（Graph Worker）：在后台慢慢通过大模型抽取实体（`graph` 模式）。

代码中存在一个非常核心的方法：
```typescript
export function getInitialIndexMode(options: Pick<ProcessingOptions, "indexMode">): "basic" {
  // 无论你传入什么，第一阶段都会被强制转换为 basic
  return options.indexMode === "graph" ? "basic" : "basic";
}
```

而在主处理流程 `processDocument` 中：
```typescript
const originalIndexMode = ctx.options.indexMode; // 这里保存了用户的 graph 意图
ctx.options.indexMode = getInitialIndexMode(ctx.options); // 强制改写为 basic 运行第一阶段！
// ... 执行 basic 模式的嵌入 ...
ctx.options.indexMode = originalIndexMode; // 恢复 graph 意图
```
**分析结论**：主队列强制将第一遍索引的模式降级为了 `basic`，并将实际数据发送给 Python 层的 LightRAG 进行了 `basic` 索引。

---

## 追踪节点 3：致命的冲突 (LightRAG Python 源码层)
**文件**: `python/lightrag/lightrag.py` 及相关图索引模块

在第一阶段（`basic` 模式）完成后，Node.js 会启动第二阶段：
**文件**: `src/lib/queue/workers/document-graph-worker.ts`
在这个 Graph Worker 中，系统确实使用用户的原始意图 `indexMode: "graph"` 再次调用了 `lightrag_run.py`。

也就是说，系统**用同一批文档切片（Chunks），调用了两次 LightRAG 的 `ainsert` 插入方法**（一次 basic，一次 graph）。

这就是最终导致图谱为空的**致命原因**。我们来看看 LightRAG 的内部逻辑（交叉验证）：

1. **第一次调用 (Basic)**:
   LightRAG 接收到了 Chunks。它会将每个 Chunk 的 Hash 值存入自身的键值存储（KV Storage / `doc_status.filter_keys`），表示“这个 Chunk 我已经处理过了”。
2. **第二次调用 (Graph)**:
   当 Graph Worker 带着 `indexMode="graph"` 再次送入同一批 Chunks 试图提取实体时，LightRAG 在 `apipeline_enqueue_documents`（入队检查）环节会进行如下判断：
   - *“等等，这批 Chunks 的 Hash 值我之前是不是见过？”*
   - *“是的，在 Basic 阶段已经见过并存下来了。”*
   - *结论：“这是重复的废数据，直接丢弃（Filter out）。”*

**结果**：因为被判定为“重复数据”，第二次带有大模型实体抽取任务的 Pipeline 根本没有执行。抽取任务还没发给大模型，就被底层的去重机制拦截了，所以知识图谱是完全空白的。

---

## 总结：为什么会出现这个问题？

这并非单纯的 bug，而是**架构设计冲突**：
- **Node.js 端的初衷是好的**：想利用“分发机制”（先 Basic 让你能用，再后台跑 Graph 慢慢抽）。
- **Python LightRAG 的初衷也是好的**：为了防止用户重复上传相同文档导致大模型费用爆炸，内置了严格的文档 Hash 去重机制。
- **两者的结合点出了问题**：Node.js 把同一个文档“喂”给 LightRAG 两次，第二次（昂贵且关键的图谱生成阶段）直接被 LightRAG 的“好心”去重机制给拦截了。

## 验证与下一步

此前在隔离环境中的纯手工 Python 测试 (`test_graph_reindex.py`) 已经完全验证了上述猜想：只要我们避开或者重置它的重复检查（例如指向一个全新的存储目录），大模型就会立刻苏醒，狂飙式地抽取实体和关系。

所以用户的配置、Token、模型选择都没错，大模型也没有问题，全是流程里的“拦截器”惹的祸。

这就引出了我们之前制定的 **修复方案A（在进入第二阶段前，清除已有的 Hash 标记，或强制绕过去重）**。

这是最根源的技术还原，一切准备就绪，可以随时启动代码级的修复。
