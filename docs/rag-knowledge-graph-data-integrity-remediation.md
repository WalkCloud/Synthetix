# LightRAG 跨文档知识图谱数据损坏根治实施指南

> 文档状态：**已审定，进入实施**  
> 审查基线：当前 `main`，包含提交 `9d2d350`  
> 建议目标版本：`v1.0.4`  
> 实施边界：**重点修复代码本身；已有测试数据允许删除后重新上传，不建设复杂的数据迁移和历史数据抢救系统。**  
> 计划审查：经两轮独立代码审查确认，无推翻性意见；采纳的细化点已并入下文（通用 busy 错误、缺失 chunks_list 即失败、锁 `assert_owned`、完整性失败与 provider 失败分流、取消走真实 `queue.cancel()`）。

---

## 1. 目标与范围

本文指导修复以下核心问题：

> 清理、删除或重新建立某一个文档的 LightRAG 知识图谱时，可能错误影响同一用户其他文档的知识图谱数据。

当前 LightRAG 工作区按用户共享：

```text
<RAG_ROOT>/<userId>/
```

同一用户的所有文档共用以下存储：

```text
kv_store_doc_status.json
kv_store_full_docs.json
kv_store_text_chunks.json
kv_store_entity_chunks.json
kv_store_relation_chunks.json
kv_store_full_entities.json
kv_store_full_relations.json
kv_store_llm_response_cache.json
vdb_chunks.json
vdb_entities.json
vdb_relationships.json
graph_chunk_entity_relation.graphml
```

因此，虽然业务操作面向“一个文档”，底层修改的却是“一个用户的共享 RAG 工作区”。根治必须解决代码中的三个问题：

1. **删除语义正确**：只移除目标文档来源，保留其他文档及共享实体/关系。
2. **写入互斥正确**：同一用户任意时刻只能有一个 RAG writer。
3. **失败处理正确**：失败、超时、取消或解析异常不能触发隐式整目录清空，也不能留下后台进程继续写入。

### 1.1 明确不做的内容

本轮不建设以下复杂能力：

- 不做历史损坏图谱的逐条抢救。
- 不做多 generation 工作区和在线原子切换。
- 不做旧图谱来源的取证式修复。
- 不为测试数据设计复杂迁移工具。
- 不把恢复已有坏数据作为代码验收前提。

已有测试数据可在代码修复完成后执行：

```text
删除测试文档和旧 RAG 工作区
→ 重新上传测试文档
→ 重新生成索引和图谱
→ 验证删除/重建一个文档不会影响其他文档
```

生产环境若未来需要无损在线重建，可在本次正确性修复稳定后另立项目实施。

---

## 2. 已确认的代码问题

## 2.1 当前 graph cleanup 使用了错误 ID

当前应用把每个 Markdown 分块作为一个 LightRAG 文档插入：

```text
<applicationDocId>/chunk_000
<applicationDocId>/chunk_001
...
```

LightRAG 再生成内部 chunk ID：

```text
<applicationDocId>/chunk_000-chunk-000
<applicationDocId>/chunk_001-chunk-000
...
```

两者含义不同：

| ID 类型 | 示例 | 主要存储 |
|---|---|---|
| LightRAG 文档 ID | `docId/chunk_016` | `doc_status`、`full_docs`、`full_entities`、`full_relations` |
| LightRAG 内部 chunk ID | `docId/chunk_016-chunk-000` | `text_chunks`、`chunks_vdb`、实体/关系来源 |

当前代码把 LightRAG 文档 ID 直接传给：

```python
await rag.text_chunks.delete(to_delete)
await rag.chunks_vdb.delete(to_delete)
```

位置：

- `workers/python/rag_index.py:628`
- `workers/python/rag_index.py:634`

这些存储需要内部 chunk ID，因此当前删除通常无法清理目标 chunk。

## 2.2 删除顺序破坏了 LightRAG 来源感知删除

当前顺序大致为：

```text
删除 doc_status
→ 删除 full_docs
→ 尝试删除 text_chunks/chunks_vdb
→ 调用 adelete_by_doc_id(parentDocId)
```

位置：

- `workers/python/rag_index.py:620`
- `workers/python/rag_index.py:650`

LightRAG 1.5.4 的 `adelete_by_doc_id()` 首先读取目标文档的 `doc_status`，并使用其中的 `chunks_list`、`full_entities` 和 `full_relations` 计算来源变化。

当前代码提前删除 `doc_status`，导致官方删除 API 返回 `not_found`，不能进行实体和关系来源清理。

## 2.3 调用的文档 ID 层级错误

当前调用：

```python
await rag.adelete_by_doc_id(doc_id)
```

传入的是应用父文档 ID；但现有 LightRAG 记录通常是：

```text
<docId>/chunk_NNN
```

因此即使不提前删除 `doc_status`，单次传入父 ID 通常也找不到实际记录。

## 2.4 删除结果未被检查

LightRAG 1.5.4 的删除失败通常通过返回值表达：

```text
success
not_found
not_allowed
fail
```

而不是全部抛异常。当前代码只捕获异常，没有检查 `DeletionResult.status`，会把 `not_found` 或 `fail` 当成成功继续执行。

## 2.5 普通索引仍可能清空整个用户工作区

当前 embedding 维度异常路径可能执行：

```python
shutil.rmtree(working_dir, ignore_errors=True)
os.makedirs(working_dir, exist_ok=True)
```

位置：

- `workers/python/rag_index.py:560`
- `workers/python/rag_index.py:570`

`working_dir` 是用户级目录。一个文档配置错误不应获得删除该用户全部图谱数据的权限。

## 2.6 `rag_manage.py` 仍会自动删除共享文件

`rag_manage.py` 仍在普通操作前执行：

- `fix_corrupted_json_files()`。
- JSON 解析失败后 `os.remove()`。
- GraphML 解析失败后 `os.remove()`。

位置：

- `workers/python/rag_manage.py:834`
- `workers/python/rag_manage.py:850`

这会使图谱查询、实体列表或删除操作在遇到异常时修改整个用户工作区。

## 2.7 `.indexing.lock` 不是互斥锁

当前 `indexing_lock()` 只是：

```python
with open(lock_path, "w", encoding="utf-8") as fp:
    fp.write(doc_id)
```

位置：

- `workers/python/rag_index.py:249`
- `workers/python/rag_index.py:259`

它不具备：

- 排他获取。
- owner token。
- PID 和进程启动身份。
- heartbeat。
- owner 校验释放。
- 跨 Node/Python 进程互斥。

两个 writer 可以同时进入，并相互覆盖或删除 marker。

## 2.8 查询端会删除仍有效的 marker

查询端将超过 30 分钟的 `.indexing.lock` 直接删除：

- `workers/python/rag_query.py:219`
- `workers/python/rag_query.py:228`

但 graph index 允许运行数小时。查询端不得判断并删除 writer 锁。

## 2.9 任务取消后 Python 可能继续写入

任务状态改成 `cancelled`、`failed` 或 lease 过期，不代表 Python daemon/spawn 已退出。后台 writer 可能继续修改共享文件，并与重试、删除或重建任务并发。

相关边界：

- `src/lib/python.ts`
- `src/lib/python-daemon.ts`
- `src/lib/queue/queue.ts`
- `src/lib/documents/lifecycle.ts`

## 2.10 Node、Python 和 Electron 的 RAG 路径不统一

Python worker 仍使用相对路径：

```text
data/rag/<userId>
```

而安装版的数据库、文档和用户数据预期位于用户可写目录。若各运行时解析到不同路径，会出现：

- 锁定一个目录、实际写另一个目录。
- 安装目录权限问题。
- 更新或卸载时丢失数据。
- 健康检查与实际查询不一致。

## 2.11 现有构建产物仍可能包含旧代码

以下旧构建目录中的 worker 与当前源码不一致：

```text
dist/app/workers/python/
.next/standalone/workers/python/
dist/electron/win-unpacked/resources/app/workers/python/
```

代码修复完成后必须清理旧构建并重新打包。

---

## 3. 根治后的强制不变量

## 3.1 用户级单 writer

同一 `userId` 任意时刻最多一个操作能够修改 RAG 工作区，包括：

- basic index
- graph index
- document delete/cleanup
- entity create/edit/delete/merge
- user RAG reset

## 3.2 Routine 操作不得隐式清空

普通索引、查询、文档删除和图谱管理遇到损坏或配置异常时：

```text
停止操作
→ 返回明确错误
→ 保留现场
→ 允许用户显式清空并重新上传
```

禁止自动删除共享 JSON、GraphML 或整个用户目录。

## 3.3 删除必须来源感知

删除文档 A 后：

- A 独有实体和关系被删除。
- A/B 共享实体保留 B 来源。
- B 独有实体和关系不变。
- 共享实体/关系根据剩余 chunk 来源重建。

## 3.4 删除失败不得继续重建

以下任一情况必须终止任务：

- purge metadata 不完整。
- LightRAG 返回 `fail` 或 `not_allowed`。
- storage flush 失败。
- 删除后仍检测到目标文档来源。
- writer lock 丢失。

不得在旧来源未清干净时继续插入新版本。

## 3.5 取消必须等待真实退出

取消完成必须满足：

1. Python 进程或 daemon 已退出。
2. Windows 子进程树已终止。
3. child `close` 已完成。
4. 用户级 writer lock 已释放。
5. cancellation 不会触发 daemon → spawn fallback。

---

## 4. 实施总顺序

```text
Phase 0  移除隐式破坏性行为
Phase 1  统一 RAG_ROOT
Phase 2  用户级跨进程 writer lock
Phase 3  Python 取消与进程树终止
Phase 4  来源感知 aggregate purge
Phase 5  只读一致性验证和回归测试
Phase 6  清理测试数据并重新上传验证
Phase 7  全新打包和发布
```

本轮不要求 generation、shadow workspace 或历史数据迁移。

---

## 5. Phase 0：移除隐式破坏性行为

## 5.1 移除 `rag_manage.py` 自动修复

从普通执行路径移除：

```python
fix_corrupted_json_files(working_dir)
```

同时移除解析失败后的 JSON/GraphML `os.remove()`。

若文件不可解析，应返回：

```json
{
  "status": "failed",
  "code": "RAG_STORAGE_CORRUPTED",
  "requires_reset": true,
  "message": "Knowledge storage is unreadable. Reset and rebuild the knowledge base."
}
```

不要自动修改文件。

## 5.2 移除 embedding mismatch 自动 `rmtree`

改为稳定错误：

```json
{
  "status": "failed",
  "code": "EMBEDDING_DIMENSION_MISMATCH",
  "requires_reset": true
}
```

用户可以显式清理测试数据并重新上传，但单文档索引任务不能自行清空用户工作区。

## 5.3 查询端不再删除 marker/lock

删除 `rag_query.py` 中按 30 分钟年龄删除 `.indexing.lock` 的代码。

查询端只允许：

- 使用已有缓存快照。
- 返回 `RAG_MUTATION_BUSY`。
- 在 writer 结束后重新加载。

## 5.4 移除正常流程中的直接文件 hard delete

`_hard_delete_doc_from_storage()` 当前直接修改 JSON、VectorDB 和 GraphML，不适合作为正常文档删除路径。

处理方式：

- 正常删除统一走 LightRAG adapter。
- hard delete 只能保留为显式离线诊断工具，不能自动 fallback。
- 本轮测试数据可通过用户显式 reset 后重传，不需要自动猜测修复损坏数据。

## 5.5 提交边界

```text
fix: stop implicit destructive RAG recovery paths
```

该提交只负责移除危险行为，不同时实现新的 purge。

---

## 6. Phase 1：统一绝对 RAG_ROOT

## 6.1 公共路径解析

在 Python 公共模块增加：

```python
def resolve_rag_root() -> str:
    root = os.environ.get("RAG_ROOT") or os.path.join("data", "rag")
    return os.path.abspath(root)


def resolve_user_rag_dir(user_id: str) -> str:
    return os.path.join(resolve_rag_root(), user_id)
```

所有 Python worker 统一使用：

- `rag_index.py`
- `rag_query.py`
- `rag_manage.py`
- `daemon.py`

Node 侧也应通过一个公共模块解析，禁止各文件自行拼接 fallback 路径。

## 6.2 Electron 与旧启动器

Electron 应显式传入：

```text
RAG_ROOT=%APPDATA%\Synthetix\rag
RAG_LOCK_ROOT=%APPDATA%\Synthetix\locks\rag
```

Windows 旧启动脚本也传入相同变量。

## 6.3 路径验证

增加测试断言：

- Node 和 Python 对相同环境变量解析出同一绝对路径。
- 用户 ID 只能作为单层目录名，不允许路径穿越。
- 安装版实际 RAG 目录位于用户可写位置。

## 6.4 提交边界

```text
fix: use one canonical writable RAG root
```

---

## 7. Phase 2：用户级跨进程 writer lock

## 7.1 锁路径

锁目录放在用户 RAG 工作区之外：

```text
<RAG_LOCK_ROOT>/<sha256(userId)>.lock/
```

不能放在 `<RAG_ROOT>/<userId>` 内，因为显式 reset 会删除用户 RAG 目录。

## 7.2 锁 metadata

`owner.json` 至少包含：

```json
{
  "version": 1,
  "token": "uuid",
  "pid": 1234,
  "processStartIdentity": "...",
  "runtime": "python-daemon",
  "operation": "graph-index",
  "taskId": "...",
  "documentId": "...",
  "acquiredAt": "...",
  "heartbeatAt": "..."
}
```

## 7.3 排他获取

Python：

```python
os.mkdir(lock_dir)
```

Node：

```typescript
await fs.promises.mkdir(lockDir);
```

不使用 `recursive`。目录创建成功者是唯一 owner；已存在表示 busy。

## 7.4 heartbeat

建议：

- 每 10 秒更新一次。
- 45–60 秒后标记 suspect。
- 仅 heartbeat 超时不能强制接管。

接管前必须确认：

1. 原 PID 已不存在，或 process start identity 不匹配。
2. owner token 和 heartbeat 二次读取后未变化。
3. contender 原子 rename 锁目录成功。

## 7.5 owner 校验释放

释放时读取 owner metadata 并校验 token。使用：

```text
user.lock
→ user.lock.releasing.<token>
→ 删除 releasing 目录
```

旧 owner 不得删除新 owner 的锁。

## 7.6 锁持有范围

Python index：

```text
获取锁
→ 初始化 LightRAG storage
→ 清理旧文档来源
→ 插入新内容
→ storage flush/finalize
→ 删除后/写后验证
→ 缓存失效
→ 释放锁
```

Python manage mutation：

```text
获取锁
→ 初始化 storage
→ 执行实体或文档 mutation
→ flush
→ 验证
→ 释放锁
```

Node reset：

```text
取消用户 RAG 任务并等待真实退出
→ 获取锁
→ 显式删除用户 RAG 数据
→ 重建空目录
→ 释放锁
```

## 7.7 必须串行的入口

- `rag_embed_index`
- `rag_index`
- `document_cleanup`
- create/edit/delete entity
- merge entities
- explicit knowledge reset
- startup orphan RAG cleanup

文档级 `ExecutionRegistry` 可以保留，但不能替代用户级锁。

## 7.8 提交边界

```text
feat: serialize per-user RAG workspace mutations
```

---

## 8. Phase 3：Python 取消与进程树终止

## 8.1 Spawn 支持 AbortSignal

扩展 `spawnPythonJson()`/底层 spawn options：

```typescript
interface PythonSpawnOptions {
  signal?: AbortSignal;
  timeout?: number;
}
```

取消时：

1. 标记 abort reason。
2. 尝试正常终止。
3. 等待短暂 grace period。
4. Windows 使用：

   ```text
   taskkill /PID <pid> /T /F
   ```

5. 等待 `close`。
6. cancellation promise 才完成。

## 8.2 Daemon 支持取消

`PythonDaemonClient.call()` 接收 `AbortSignal`。

索引取消时：

- 终止 daemon 进程。
- 等待 daemon close。
- 清除当前请求。
- 下一次请求再按需启动 daemon。
- 不得因 abort 进入 spawn fallback。

## 8.3 Queue 统一取消通道

以下事件都触发相同的 controller abort：

- 用户停止。
- document delete/reprocess。
- task supersede。
- timeout。
- heartbeat stall。

任务最终状态只能在真实 worker settle 后写入终态。

## 8.4 提交边界

```text
fix: stop Python RAG writers before completing cancellation
```

---

## 9. Phase 4：来源感知 aggregate purge

## 9.1 适配层

新增：

```text
workers/python/lightrag_adapter.py
```

职责：

- 固定和校验 `lightrag-hku==1.5.4`。
- 检查 `_purge_doc_chunks_and_kg` 是否存在。
- 校验签名。
- 对项目暴露稳定的 parent-document purge API。
- 集中处理 LightRAG 返回状态。

私有 API 不得散落到 `rag_index.py` 和 `rag_manage.py`。

## 9.2 项目级接口

建议接口：

```python
async def purge_application_document(
    rag,
    parent_doc_id: str,
    operation_id: str,
) -> PurgeResult:
    ...
```

返回：

```python
@dataclass
class PurgeResult:
    parent_doc_id: str
    child_doc_ids: list[str]
    chunk_ids: list[str]
    removed_entities: int
    removed_relations: int
    rebuilt_entities: int
    rebuilt_relations: int
```

## 9.3 收集 child document IDs

从 `doc_status` 精确选择：

```python
prefix = parent_doc_id + "/"
child_doc_ids = sorted(
    key for key in all_docs
    if key == parent_doc_id or key.startswith(prefix)
)
```

## 9.4 收集真实内部 chunk IDs

从每个 child 的 `chunks_list` 聚合：

```python
aggregate_chunk_ids = list(dict.fromkeys(
    chunk_id
    for status in child_statuses
    for chunk_id in status.chunks_list
))
```

如果 child status 存在但 `chunks_list` 缺失，立即失败并提示用户显式 reset/reupload，不进入猜测性 hard delete。

## 9.5 聚合实体和关系 metadata

读取：

```python
await rag.full_entities.get_by_id(child_id)
await rag.full_relations.get_by_id(child_id)
```

聚合所有：

- `entity_names`
- `relation_pairs`

写入临时 key：

```text
__synthetix_parent_purge__/<parentDocId>/<operationId>
```

## 9.6 调用 LightRAG 来源感知 purge

在用户锁和 LightRAG pipeline reservation 内：

```python
await rag._purge_doc_chunks_and_kg(
    purge_key,
    aggregate_chunk_ids,
    pipeline_status=pipeline_status,
    pipeline_status_lock=pipeline_status_lock,
)
```

该调用负责：

- 从共享来源中扣除目标 chunk。
- 删除无剩余来源的节点和边。
- 保留其他文档仍引用的共享知识。
- 从剩余 cached extraction 重建共享实体/关系。
- 删除真实 text chunks 和 chunk vectors。

## 9.7 删除 child metadata 并 flush

purge 成功后：

```python
await rag.doc_status.delete(child_doc_ids)
await rag.full_docs.delete(child_doc_ids)
await rag.full_entities.delete(child_doc_ids)
await rag.full_relations.delete(child_doc_ids)
await rag._insert_done()
```

不得直接修改 JSON、NanoVectorDB 或 GraphML。

## 9.8 严格失败语义

出现以下情况立即失败：

- LightRAG 版本或私有 API 签名不匹配。
- metadata 缺失。
- purge 抛异常。
- flush 失败。
- 目标 source 未清理干净。
- writer lock token 失效。

失败时不继续 reinsert；用户可以显式 reset 后重新上传测试文档。

## 9.9 `rag_manage.py` 统一复用

文档删除和 graph reindex 必须调用同一个 adapter 接口，避免出现两套不同删除逻辑：

- `rag_index.py`：重建前 purge。
- `rag_manage.py delete-by-doc`：永久删除时 purge。

删除完成后，`rag_manage.py` 不再自动调用 `_hard_delete_doc_from_storage()`。

## 9.10 提交边界

```text
fix: purge document graph sources through LightRAG adapter
```

---

## 10. Phase 5：只读一致性验证

本轮不修复历史坏数据，但必须能识别代码是否产生不一致。

## 10.1 文档删除后验证

检查：

- `doc_status` 无目标 parent/child ID。
- `full_docs` 无目标 child ID。
- `text_chunks` 无目标内部 chunk ID。
- `entity_chunks.chunk_ids` 无目标来源。
- `relation_chunks.chunk_ids` 无目标来源。
- GraphML `source_id` 无目标来源。

## 10.2 其他文档保护验证

删除前记录其他文档的来源集合：

```text
otherDoc → entity source IDs
otherDoc → relation source IDs
otherDoc → graph node/edge source IDs
```

删除后验证这些来源仍存在。允许共享实体的合并描述/向量因来源减少而变化，但其他文档来源不能消失。

## 10.3 健康检查只读化

`scanKnowledgeHealth()` 应报告但不修改：

```typescript
interface DocumentRagHealth {
  documentId: string;
  statusEntries: number;
  internalChunks: number;
  textChunks: number;
  entitySources: number;
  relationSources: number;
  graphNodeSources: number;
  graphEdgeSources: number;
  issues: string[];
}
```

必须能发现：

```text
文档在 DB 中存在
+ doc_status 存在
+ graph source 为 0
```

但不自动尝试修复。测试环境直接 reset/reupload。

## 10.4 提交边界

```text
test: verify cross-document RAG source isolation
```

---

## 11. 测试矩阵

## 11.1 最小来源隔离夹具

构造：

```text
文档 A：A1、共享实体 S、关系 A1—S
文档 B：B1、共享实体 S、关系 B1—S
```

删除 A 后断言：

- A1 删除。
- A1—S 删除。
- B1 保留。
- B1—S 保留。
- S 保留 B 来源。

## 11.2 三文档 graph reindex

1. 上传 A、B、C。
2. 等待三者 graph index 完成。
3. 记录每个文档的 graph source 数量。
4. 重建 B。
5. 验证 A、C 的来源数量和集合不丢失。
6. 验证 B 新图谱有效。

## 11.3 文档删除

1. 删除 B。
2. 验证 A、C 图谱仍可打开。
3. 使用 A、C 特征词分别查询。
4. 验证 B 来源全部消失。
5. 验证共享实体仍保留 A/C 来源。

## 11.4 同用户并发

并发提交：

- A graph index。
- B graph index。
- C delete。
- entity merge。

断言：

- 任意时刻只有一个用户级 writer。
- 等待任务不会覆盖锁。
- 所有任务结束后 JSON/GraphML 可解析。
- 不发生 lost update。

## 11.5 取消与超时

在 graph index 中途：

- 用户取消。
- 模拟 timeout。
- 模拟 heartbeat stall。

断言：

- Python 进程树退出。
- 锁释放。
- 不启动 fallback spawn。
- 下一任务获取锁后不会与旧进程并发。

## 11.6 embedding dimension mismatch

1. A、B 使用维度 X 完成索引。
2. 用维度 Y 尝试索引 C。
3. C 返回明确错误。
4. A、B 存储和查询保持不变。
5. 用户显式 reset 后可以重新上传全部测试文档。

## 11.7 损坏文件 fail-closed

人为构造无法解析的 JSON/GraphML，调用：

- query
- graph manage read
- delete-by-doc
- graph index

断言：

- 返回明确错误。
- 文件未被删除或重置。
- 其他文件未被修改。

## 11.8 跨进程锁

覆盖：

- daemon 与 spawn。
- 两个独立 Python 进程。
- Node reset 与 Python index。
- owner crash 后 stale lock 回收。
- PID 复用保护。
- token 不匹配时禁止释放。

## 11.9 Windows 安装包

安装版执行完整流程：

```text
上传三个文档
→ 完成 graph index
→ 重建其中一个
→ 删除其中一个
→ 验证剩余文档图谱
→ 重启应用
→ 再次验证
```

---

## 12. 测试数据处理方式

本轮允许直接重建测试数据，推荐在代码修复部署后执行：

1. 停止开发服务器和 Python daemon。
2. 备份当前测试目录，仅用于出现意外时查证。
3. 通过显式知识库 reset 或删除测试用户数据清空旧 RAG 工作区。
4. 删除旧测试文档记录，或使用干净测试用户。
5. 重新启动应用。
6. 重新上传三份测试文档。
7. 执行完整图谱索引。
8. 运行第 11 节测试矩阵。

不得把“重传可以恢复”当作跳过代码隔离测试的理由。重传只负责恢复测试基线；代码必须保证后续单文档操作不会再次破坏其他文档。

---

## 13. 分阶段提交建议

### Commit 1

```text
fix: stop implicit destructive RAG recovery paths
```

- 移除 routine repair。
- 移除 embedding mismatch 自动清空。
- query 不删除 marker。
- 停用正常流程 direct hard delete fallback。

### Commit 2

```text
fix: use one canonical writable RAG root
```

- Node/Python/Electron 路径统一。
- 增加路径解析测试。

### Commit 3

```text
feat: serialize per-user RAG workspace mutations
```

- 跨进程锁。
- owner metadata、heartbeat、stale recovery。
- 所有 writer 接入。

### Commit 4

```text
fix: stop Python RAG writers before completing cancellation
```

- Spawn/daemon signal。
- Windows process tree termination。
- timeout/stall/delete 统一取消。

### Commit 5

```text
fix: purge document graph sources through LightRAG adapter
```

- aggregate source-aware purge。
- 统一 reindex/delete 路径。
- 严格失败处理。

### Commit 6

```text
test: verify cross-document RAG source isolation
```

- A/B/shared entity fixture。
- 三文档重建/删除。
- 跨进程和取消测试。

### Commit 7

```text
release: rebuild Windows package with RAG integrity fixes
```

- 清理旧构建。
- 全新打包。
- 建议发布 `v1.0.4`。

---

## 14. 每阶段验证门槛

每批至少执行：

```bash
python -m py_compile workers/python/*.py
python -m unittest discover -s workers/python/tests -v
pnpm run typecheck
pnpm run lint
pnpm run test:run
pnpm run build
pnpm run electron:compile
pnpm exec playwright test --list
git diff --check
```

最终阶段额外执行：

- 三文档真实浏览器测试。
- 重建一个文档后验证另外两个。
- 删除一个文档后验证另外两个。
- 应用重启后验证图谱仍完整。
- 清理 `.next` 和 `dist` 后重新构建。
- 扫描实际安装包内的 Python worker。

真实 LLM 测试中允许记录以下客观问题：

- 模型响应超时。
- API 限流。
- provider 偶发连接错误。

这些问题可以重试，但不得通过吞掉删除失败、跳过来源验证或恢复隐式清空来“修复”。

---

## 15. 打包发布检查

构建后检查：

```text
dist/app/workers/python/
.next/standalone/workers/python/
dist/electron/win-unpacked/resources/app/workers/python/
```

普通 index/manage/query worker 中禁止出现：

```python
fix_corrupted_json_files(working_dir)
shutil.rmtree(working_dir)
os.remove(_fp)
```

显式 reset 模块可以删除用户 RAG 工作区，但必须：

- 用户明确触发。
- 持有用户级 writer lock。
- 等待所有 Python writer 真实退出。

建议对关键 worker 做源码与打包产物内容检查，而不是依赖旧构建目录。

---

## 16. 完成验收标准

只有全部满足才可宣称代码问题已根治：

- [ ] 普通请求不会自动删除或重置共享 RAG 文件。
- [ ] embedding mismatch 不会清空用户工作区。
- [ ] Node、Python、Electron 使用同一绝对 `RAG_ROOT`。
- [ ] 同一用户任意时刻最多一个 RAG writer。
- [ ] 锁跨 Node、Python、daemon、spawn 生效。
- [ ] query 不会删除 writer lock。
- [ ] 取消后 Python 进程树真实退出。
- [ ] cancellation 不触发 fallback spawn。
- [ ] purge 使用真实 child ID 和 `chunks_list`。
- [ ] purge 保留其他文档贡献的共享实体/关系。
- [ ] purge 或 flush 失败后不继续 reinsert。
- [ ] `rag_index.py` 与 `rag_manage.py` 使用同一删除适配层。
- [ ] 健康检查严格只读。
- [ ] 重建 B 后 A、C 来源不丢失。
- [ ] 删除 B 后 A、C 来源不丢失。
- [ ] 损坏文件测试不会触发自动清空。
- [ ] Windows 安装包包含最新 worker。
- [ ] 重新上传的三份测试文档通过完整浏览器验证。

---

## 17. 禁止事项

后续实现禁止：

1. 在普通请求中自动删除无法解析的共享文件。
2. 因一个文档异常执行 `rmtree(userRagDir)`。
3. 使用 `.indexing.lock` marker 代替真正的互斥锁。
4. 只修改任务状态、不终止 Python writer。
5. 仅捕获异常而不检查 LightRAG 删除返回状态。
6. 在 purge 失败后继续插入。
7. 直接把私有 LightRAG API 散落到多个 worker。
8. 在正常删除路径直接编辑 JSON、VectorDB 或 GraphML。
9. 依靠文件原子 replace 代替用户级 writer 互斥。
10. 用重传测试数据掩盖代码仍会跨文档删除的问题。
11. 未清理旧构建目录就发布安装包。
12. 静默覆盖已发布的 `v1.0.3` 二进制。

---

## 18. 最终实施决策

本轮采用的根治边界是：

> **不抢救已有测试图谱；先修复代码，使所有用户级 RAG mutation 串行、所有文档清理来源感知、所有失败路径 fail closed、所有取消等待真实 Python 退出。修复完成后清空旧测试数据并重新上传三份文档，通过重建/删除单个文档不影响其他文档的回归测试。**

最终实施顺序：

```text
1. 移除隐式 repair/reset/hard-delete fallback
2. 统一绝对 RAG_ROOT
3. 建立用户级跨进程 writer lock
4. 打通 Python cancellation 和 Windows 进程树终止
5. 实现 LightRAG adapter aggregate source-aware purge
6. 增加只读一致性检查和跨文档隔离测试
7. 清空旧测试数据并重新上传验证
8. 清理构建目录并发布 v1.0.4
```
