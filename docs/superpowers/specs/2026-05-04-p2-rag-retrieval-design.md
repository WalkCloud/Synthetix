# Synthetix P2 RAG 检索设计文档

**日期**: 2026-05-04  
**阶段**: P2 — RAG 检索  
**状态**: 已确认  
**前置**: P1 文档处理（已完成）

---

## 1. 概述

P2 将 P1 的暴力余弦相似度搜索替换为 LightRAG 图增强检索，并在文档上传流水线中接入完整的 RAG 索引。

### 1.1 P2 范围

| 功能 | 说明 | 对应需求 |
|------|------|----------|
| LightRAG 索引 | 文档 chunks 自动入 LightRAG 索引 | F1-US4 |
| LightRAG 查询 | 混合模式（hybrid）语义检索 | F2-US3 |
| 引用追溯 | 搜索结果含来源文档、位置、相似度 | F2-BR2 |
| 搜索 API 升级 | `/api/v1/library/search/semantic` 接入 LightRAG | F2-BR2 |
| P1 搜索替换 | P1 brute-force 被 LightRAG 替代 | — |

### 1.2 不在 P2 范围

- Neo4j 图数据库（P2 用 LightRAG 本地存储）
- Reranker 独立模型（LightRAG 内置混合模式足够）
- OCR 图片文字识别

### 1.3 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| LightRAG 调用 | Python 子进程 (child_process.spawn) | 与 MarkItDown 一致，离线友好 |
| 检索模式 | hybrid (vector + keyword) | LightRAG 默认，兼顾语义和关键词 |
| 存储后端 | LightRAG 本地文件 (.json graph) | 零外部依赖 |
| Embedding | 复用现有 LLM Adapter 的 embed() | 统一接口 |

---

## 2. 目录变更

```
workers/python/
├── requirements.txt              # UPDATE: 加 lightrag-hku
├── convert.py                    # (existing)
├── rag_index.py                  # NEW: LightRAG 索引
└── rag_query.py                  # NEW: LightRAG 查询

src/
├── lib/
│   ├── search/
│   │   ├── fts.ts                # (existing)
│   │   └── semantic.ts           # UPDATE: 调用 LightRAG
│   └── queue/workers/
│       └── document-worker.ts    # UPDATE: 索引步骤追加 RAG
└── app/api/v1/library/search/
    └── semantic/route.ts         # UPDATE: 返回引用元数据
```

---

## 3. LightRAG Python 脚本

### 3.1 rag_index.py

```python
"""LightRAG document indexer.
Usage: python rag_index.py --doc-id <id> --chunks-dir <dir> --embed-model <model> --api-base <url> [--api-key <key>]
"""
import sys, os, json, argparse
from lightrag import LightRAG, QueryParam
from lightrag.llm.openai import openai_complete_if_cache, openai_embed

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--doc-id", required=True)
    parser.add_argument("--chunks-dir", required=True)
    parser.add_argument("--embed-model", required=True)
    parser.add_argument("--api-base", required=True)
    parser.add_argument("--api-key", default="")
    parser.add_argument("--working-dir", default="./data/lightrag")
    args = parser.parse_args()

    os.makedirs(args.working_dir, exist_ok=True)

    rag = LightRAG(
        working_dir=args.working_dir,
        llm_model_func=lambda prompt, **kw: "",
        embedding_func=openai_embed,
        embedding_model_name=args.embed_model,
        embedding_base_url=args.api_base,
        embedding_api_key=args.api_key or "not-needed",
    )

    chunk_files = sorted([f for f in os.listdir(args.chunks_dir) if f.endswith(".md")])
    for f in chunk_files:
        with open(os.path.join(args.chunks_dir, f)) as fp:
            content = fp.read()
        rag.insert(content, ids=f"{args.doc_id}:{f}")

    print(json.dumps({"status": "ok", "chunks_indexed": len(chunk_files)}))

if __name__ == "__main__":
    main()
```

### 3.2 rag_query.py

```python
"""LightRAG query script.
Usage: python rag_query.py --query "<text>" [--mode hybrid|local|global] [--limit 20]
"""
import sys, json, argparse
from lightrag import LightRAG, QueryParam
from lightrag.llm.openai import openai_complete_if_cache, openai_embed

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--mode", default="hybrid")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--working-dir", default="./data/lightrag")
    parser.add_argument("--embed-model", default="nomic-embed-text")
    parser.add_argument("--api-base", default="http://localhost:11434")
    parser.add_argument("--api-key", default="")
    args = parser.parse_args()

    rag = LightRAG(
        working_dir=args.working_dir,
        llm_model_func=lambda prompt, **kw: "",
        embedding_func=openai_embed,
        embedding_model_name=args.embed_model,
        embedding_base_url=args.api_base,
        embedding_api_key=args.api_key or "not-needed",
    )

    mode_map = {"hybrid": "hybrid", "local": "local", "global": "global"}
    param = QueryParam(mode=mode_map.get(args.mode, "hybrid"), top_k=args.limit)
    result = rag.query(args.query, param=param)

    print(json.dumps({"results": result}))

if __name__ == "__main__":
    main()
```

---

## 4. Node.js 侧改动

### 4.1 semantic.ts 重写

```typescript
// 调用 Python LightRAG 查询替代 brute-force
import { spawn } from "child_process";
import path from "path";

export async function lightragQuery(query: string, embedModel: { modelId: string; provider: { apiBaseUrl: string; apiKey?: string | null } }, limit = 20): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["workers/python/rag_query.py", "--query", query, "--limit", String(limit),
      "--embed-model", embedModel.modelId, "--api-base", embedModel.provider.apiBaseUrl];
    if (embedModel.provider.apiKey) args.push("--api-key", embedModel.provider.apiKey);
    const proc = spawn("python3", args);
    // ...
  });
}
```

### 4.2 document-worker.ts 追加 RAG 索引

在 embedding 步骤后调用 `python rag_index.py --doc-id {id} --chunks-dir {dir}`。

---

## 5. 对比 P1 vs P2

| 维度 | P1 | P2 |
|------|----|----|
| 检索方式 | 暴力余弦相似度 | LightRAG hybrid |
| 复杂度 | O(n) 全量遍历 | O(log n) 向量索引 |
| 搜索质量 | 仅向量距离 | 向量+关键词+图增强 |
| 引用来源 | chunkId + documentName | 完整 provenance |
| 扩展性 | 千级 chunks | 十万级 chunks |
