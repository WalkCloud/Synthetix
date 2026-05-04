"""Synthetix LightRAG semantic query.

Usage: python rag_query.py --user-id <uid> --query "<text>" --mode hybrid --limit 20
Output: JSON string to stdout (LightRAG raw response)
"""
import sys
import json
import os
import argparse
import asyncio


async def query_rag(user_id: str, query_text: str, mode: str = "hybrid", limit: int = 20) -> str:
    """Query LightRAG knowledge graph."""
    working_dir = os.path.join("data", "rag", user_id)

    if not os.path.exists(working_dir):
        print(json.dumps([]))
        return

    from lightrag import LightRAG, QueryParam
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

    param = QueryParam(mode=mode, top_k=limit)

    try:
        result = await rag.aquery(query_text, param=param)
        print(result)
    except Exception as e:
        print(json.dumps({"error": str(e)}))


def main() -> None:
    parser = argparse.ArgumentParser(description="LightRAG semantic query")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--mode", default="hybrid")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    asyncio.run(query_rag(args.user_id, args.query, args.mode, args.limit))


if __name__ == "__main__":
    main()
