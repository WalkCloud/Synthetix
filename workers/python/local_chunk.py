"""Local semantic chunking via ONNX bge-small-zh-v1.5.

Reads a JSON batch from stdin, computes per-batch sentence embeddings and
cosine-similarity-based boundary detection, then writes per-batch boundaries
to stdout.

Input (stdin JSON):
{
  "batches": [
    { "id": "seg_0", "sentences": ["sent1", "sent2", ...], "maxTokens": 1100 },
    ...
  ],
  "threshold": 0.55
}

Output (stdout JSON):
{
  "results": [
    { "id": "seg_0", "similarities": [0.82, 0.45, ...], "boundaries": [3, 7] },
    ...
  ]
}
"""

import json
import os
import sys

import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_PATH = os.environ.get("LOCAL_EMBED_MODEL_PATH", "data/models/bge-small-zh-v1.5")

_model = None


def get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer(
            MODEL_PATH,
            backend="onnx",
            device="cpu",
            model_kwargs={"file_name": "model.onnx"},
        )
    return _model


def find_boundaries(
    sentences: list[str],
    max_tokens: int,
    threshold: float = 0.55,
    jump_window: int = 1,
):
    """Return similarity scores and split boundary indices.

    Boundaries are sentence indices where a new chunk should start.
    Hard constraint: no chunk exceeds max_tokens.
    Jump-merge: skip isolated low-similarity points within jump_window
    of the previous boundary, unless segment would exceed max_tokens.
    """
    model = get_model()

    if len(sentences) <= 1:
        return [], []

    embeddings = model.encode(sentences, normalize_embeddings=True)

    similarities = [
        float(np.dot(embeddings[i], embeddings[i + 1]))
        for i in range(len(embeddings) - 1)
    ]

    # Detect valleys (low similarity = topic transition)
    raw_boundaries = [
        i + 1 for i, sim in enumerate(similarities) if sim < threshold
    ]

    # Estimate tokens per sentence using character-count approximation
    tokens_per_sentence = [max(1, len(s) // 2) for s in sentences]

    # Jump-merge with hard token constraint
    boundaries: list[int] = []
    if raw_boundaries:
        boundaries.append(raw_boundaries[0])
        for b in raw_boundaries[1:]:
            seg_tokens = sum(tokens_per_sentence[boundaries[-1] : b])
            if b - boundaries[-1] <= jump_window and seg_tokens < int(max_tokens * 1.2):
                continue  # Skip isolated point, merge
            boundaries.append(b)

    # Hard constraint: ensure no segment exceeds max_tokens
    final_boundaries: list[int] = []
    last = 0
    for b in boundaries:
        seg_tokens = sum(tokens_per_sentence[last:b])
        if seg_tokens > max_tokens:
            # Force-split at midpoint
            mid = last + (b - last) // 2
            if mid > last:
                final_boundaries.append(mid)
        last = b
        final_boundaries.append(b)

    # Tail check
    if last < len(sentences):
        seg_tokens = sum(tokens_per_sentence[last:])
        if seg_tokens > max_tokens:
            mid = last + (len(sentences) - last) // 2
            if mid > last and mid < len(sentences):
                final_boundaries.append(mid)

    return similarities, final_boundaries


def main():
    data = json.loads(sys.stdin.read())
    batches = data["batches"]
    threshold = data.get("threshold", 0.55)

    results = []
    for batch in batches:
        sims, bounds = find_boundaries(
            batch.get("sentences", []),
            batch.get("maxTokens", 1100),
            threshold,
        )
        results.append(
            {
                "id": batch["id"],
                "similarities": sims,
                "boundaries": bounds,
            }
        )

    print(json.dumps({"results": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
