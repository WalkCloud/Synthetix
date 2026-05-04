"""Synthetix LightRAG indexing — called after document conversion and embedding.

Usage: python rag_index.py --doc-id <id> --user-id <uid> --chunks-dir <dir>
Output: JSON to stdout
"""
import sys
import json
import os
import argparse
import asyncio


async def index_document(doc_id: str, user_id: str, chunks_dir: str) -> dict:
    """Index chunk files into LightRAG knowledge graph."""
    working_dir = os.path.join("data", "rag", user_id)
    os.makedirs(working_dir, exist_ok=True)

    from lightrag import LightRAG
    from lightrag.llm import openai_complete_if_cache, openai_embedding
    from lightrag.utils import EmbeddingFunc

    embed_api_base = os.environ.get("EMBED_API_BASE", "http://localhost:11434/v1")
    embed_api_key = os.environ.get("EMBED_API_KEY", "ollama")
    embed_model = os.environ.get("EMBED_MODEL", "nomic-embed-text")

    async def embedding_func(texts: list[str]) -> list[list[float]]:
        return openai_embedding(
            texts,
            model=embed_model,
            base_url=embed_api_base,
            api_key=embed_api_key,
        )

    rag = LightRAG(
        working_dir=working_dir,
        llm_model_func=lambda prompt, system_prompt=None, history_messages=[], **kwargs: "",
        embedding_func=EmbeddingFunc(
            embedding_dim=768,
            max_token_size=8192,
            func=embedding_func,
        ),
    )

    chunk_files = sorted([f for f in os.listdir(chunks_dir) if f.startswith("chunk_")])
    if not chunk_files:
        return {"status": "skipped", "reason": "no chunks found", "doc_id": doc_id}

    for f in chunk_files:
        chunk_path = os.path.join(chunks_dir, f)
        with open(chunk_path, "r", encoding="utf-8") as fp:
            content = fp.read()
        chunk_id = f"{doc_id}/{f.replace('.md', '')}"
        await rag.ainsert(content, ids=chunk_id)

    return {"status": "indexed", "doc_id": doc_id, "chunks": len(chunk_files)}


def main() -> None:
    parser = argparse.ArgumentParser(description="LightRAG document indexer")
    parser.add_argument("--doc-id", required=True)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--chunks-dir", required=True)
    args = parser.parse_args()

    result = asyncio.run(index_document(args.doc_id, args.user_id, args.chunks_dir))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
