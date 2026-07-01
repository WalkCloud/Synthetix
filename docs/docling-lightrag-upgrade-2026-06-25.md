# Docling 2.107.0 + LightRAG 1.5.4 + Python 3.14 升级记录

> 日期：2026-06-25
> 分支：feat/anthropic-llm-adapter
> 范围：(1) Python worker 依赖 `docling 2.99.0 → 2.107.0`、`lightrag-hku 1.5.0 → 1.5.4`；(2) Python 解释器 `3.13.3 → 3.14.3`

## 一、改动文件

| 文件 | 改动 |
|---|---|
| `workers/python/requirements.txt` | `docling>=2.99.0` → `docling>=2.107.0`；`lightrag-hku==1.5.0` → `lightrag-hku==1.5.4` |
| `src/lib/documents/converter.ts` | `CONVERSION_CACHE_VERSION` 1 → 2（失效所有旧 Docling 转换缓存，强制重新转换） |
| `workers/python/rag_manage.py` | 适配 `doc_status` API 变化（见下） |
| `.env` | 新增 `PYTHON_PATH="python3.14"`（本地，gitignored） |
| `.env.example` | 新增 `PYTHON_PATH` 模板说明 |
| `README.md` | Python 版本要求 `3.10+` → `3.13+ (3.14 recommended)`；补充 `PYTHON_PATH` 说明 |

## 〇、Python 解释器升级：3.13.3 → 3.14.3

### 说明

Python **没有 LTS 概念**，发布模型是每年一个稳定版，新版发布后旧版仅安全维护。截至 2026-06：
- **Python 3.14**（2025-10 发布）是最新稳定版，积极维护，性能最优，官方称"生产就绪"。
- **Python 3.13** 仍在维护期但已是上一代。

项目原用 3.13.3（`D:\Python\python.exe`）。本系统已安装 3.14.3，docling 官方提供 `docling-parse` 的 cp314 wheel，且经全量测试验证 3.14 可用。

### 切换方式

通过 `PYTHON_PATH` 环境变量指向 3.14。在 `.env` 中设置：

```
PYTHON_PATH="python3.14"
```

`python3.14` 是 PATH 上一个不带空格的命令名（`spawn` 直接调用，不经 shell，所以**不能用** `py -3.14` 或带空格的绝对路径）。该写法可移植——任何装了 3.14 且在 PATH 的机器都能用，不依赖机器特定的用户目录路径。

### 验证

- Node 端 `spawn('python3.14', ...)` 解析到 3.14.3 ✅
- 真实 spawn Python 的 Node 测试（progress/usage/daemon）9/9 通过 ✅
- Python 单元测试套件在 3.14 下 18/18 通过 ✅


## 二、代码适配：`doc_status` API 变化（lightrag-hku 1.5.4）

1.5.4 移除了 `doc_status.get_all()`，且 `get_docs_by_statuses()` 的返回值从 `dict[str, dict]` 变为 `dict[str, DocProcessingStatus]`（dataclass，非 dict，无 `.get()` 方法）。

`rag_manage.py` 的 `action_delete_by_doc` 受影响两处：

1. **第 102 行 fallback**：`get_all()` 已不存在。改为 `getattr(rag.doc_status, "get_all", None)` 守卫，缺失时返回 `{}`。主路径 `get_docs_by_statuses(list(DocStatus))` 已能取全部状态，fallback 仅为兼容旧版本保留。

2. **第 104-113 行 value 访问**：value 现在是 `DocProcessingStatus` dataclass。改为同时兼容 dict 和 dataclass 两种形态（`isinstance(value, dict)` 走 `.get()`，否则走 `getattr()`）。这样 `original_doc_id` / `file_path` 关联清理在新旧版本下都正确。

3. **第 123 行剩余文档检查**：`get_all()` 已不存在。改用 1.5.4 新增的 `is_empty()`（语义最贴切），并对旧版本保留 `get_all()` fallback。

> 适配代码对 dict 和 dataclass 两种返回形态都做了处理，因此向前向后兼容，不会因 LightRAG 未来再次调整而立即失效。

## 三、确认无需改动的兼容性点（经探测实测）

| 风险点 | 探测结果 | 处理 |
|---|---|---|
| `getattr(openai_embed, "func", ...)` unwrap（3 处：rag_index/query/manage） | `.func` 属性仍存在，`wrap_embedding_func_with_attrs` **仍 hardcode `embedding_dim=1536`** | **保持不变**，unwrap 仍必要 |
| `StdoutTokenTracker.add_usage` 契约 | 1.5.4 仍调用 `add_usage({"prompt_tokens":...,"completion_tokens":...})` | 不变 |
| 所有管理 API（`acreate_entity`/`aedit_entity`/`amerge_entities`/`adelete_by_entity`/`get_knowledge_graph`/`get_graph_labels`） | 11/11 方法全部存在 | 不变 |
| `QueryParam`（mode/top_k/chunk_top_k/only_need_context/enable_rerank） | 字段全部存在 | 不变 |
| `DocStatus` 枚举迭代 | 仍是可迭代枚举 | 不变 |
| `docling.DocumentConverter.convert()` 签名 | 兼容（convert.py 用法 `converter.convert(input_file)` 正常） | 不变 |
| `docs_format="lightrag"` | 项目从未使用（1.5.2 移除的入口） | 不受影响 |
| `MAX_ASYNC` 环境变量 | 项目从未读取（1.5.1 重命名） | 不受影响 |
| 存储后端 | 默认本地存储（NanoVectorDB/Json/NetworkX），1.5.3 Milvus 迁移不适用 | 不受影响 |

## 四、验证结果

### 实际安装版本

```
docling 2.107.0 (含 docling-core 2.84.0, docling-parse 7.0.0, docling-slim 2.107.0)
lightrag-hku 1.5.4
```

### Python 测试

```bash
python -m unittest discover -s workers/python/tests -p "test_*.py" -v
```
**18/18 通过**（`ResourceWarning` 是 daemon 子进程既有警告，非升级引入）。

适配冒烟测试：`action_delete_by_doc` 在 1.5.4 dataclass 返回结构下正确工作，能读出 `original_doc_id` 并正确删除。

### Node 测试

```bash
npx vitest run src/__tests__/documents/ src/__tests__/queue/ src/__tests__/rag/ src/__tests__/search/ src/__tests__/python-daemon.test.ts ...
```
**204/206 通过**。2 个失败是 Prisma `db.user.upsert()` 的 `Operation has timed out`（SQLite 库竞争），单独运行时全部通过，**与升级无关**（经 git stash 对照原始代码确认）。

### 类型检查 / Lint

- `tsc --noEmit`：**0 错误**
- `eslint src/lib/documents/converter.ts`：**0 错误**（改动文件干净）
- 3 个 `no-explicit-any` lint 错误位于**本次未修改的测试文件**（`reprocess-route.test.ts`、`dimension-token-usage.test.ts`），属既有问题。

## 五、存量数据清理说明（部署后操作）

升级后，为让存量文档用新版本重新转换和索引，需要清理：

### 1. Docling 转换缓存（自动失效）

`CONVERSION_CACHE_VERSION` 已 bump 到 2，所有旧的 `.convert-cache.json` 侧车会在下次访问时自动判定为过期并重新转换。**无需手动操作。**

### 2. LightRAG 索引（需手动重建）

LightRAG working_dir 位于 `data/rag/<user_id>/`（相对项目根）。旧索引是用 1.5.0 写的，虽然 1.5.4 默认本地存储格式兼容，但为获得新版本的 chunk/抽取改进，建议重建：

```bash
# 停止应用后，删除所有用户的 LightRAG 索引目录
rm -rf data/rag/

# 或针对单个用户
rm -rf data/rag/<user_id>/
```

删除后，在应用中对该用户的文档触发"重新处理"即可用 1.5.4 重建索引。

> 注意：删除 `data/rag/` 只影响 LightRAG 图谱/向量索引，不影响已上传的原文和 chunk 文件（它们存储在另一路径），也不影响应用的数据库记录。重新处理会重新生成索引。
