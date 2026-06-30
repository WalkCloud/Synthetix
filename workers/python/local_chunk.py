"""Local semantic chunking via an ONNX embedding model.

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

import argparse
import json
import os
import sys

import numpy as np

MODEL_PATH = os.environ.get("LOCAL_EMBED_MODEL_PATH", "data/models/gte-multilingual-base")
# Max sequence length passed to the tokenizer. GTE-multilingual supports 8192;
# chunking sentences are short, but cap defensively to bound memory.
MAX_SEQ_LENGTH = int(os.environ.get("LOCAL_EMBED_MAX_SEQ_LENGTH", "8192"))

_model = None


class OnnxEmbedder:
    """Direct ONNX Runtime + tokenizer embedder.

    Replaces the previous sentence_transformers.SentenceTransformer load path.
    ST cannot load GTE-multilingual-base because its `model_type: "new"` is a
    GTE-private architecture transformers doesn't recognise, and the ONNX build
    relies on remote custom modeling code. But the exported ONNX graph already
    bakes in the full pipeline (incl. pooling → `sentence_embedding` output),
    so we run it directly with onnxruntime + the (standard) tokenizer. This
    also drops the torch dependency at inference time entirely.
    """

    def __init__(self, model_path: str):
        import onnxruntime as ort
        from transformers import AutoTokenizer

        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        # Disable the default graph optimisation level touching thread pool
        # sizing — the caller (buildPythonSpawnEnv) already caps ORT threads.
        self.session = ort.InferenceSession(
            os.path.join(model_path, "model.onnx"),
            providers=["CPUExecutionProvider"],
        )
        self._dim = self.session.get_outputs()[0].shape[-1]

    def encode(self, sentences: list[str], normalize_embeddings: bool = True) -> np.ndarray:
        enc = self.tokenizer(
            sentences,
            padding=True,
            truncation=True,
            max_length=MAX_SEQ_LENGTH,
            return_tensors="np",
        )
        outputs = self.session.run(
            ["sentence_embedding"],
            {
                "input_ids": enc["input_ids"].astype("int64"),
                "attention_mask": enc["attention_mask"].astype("int64"),
            },
        )
        embeddings = outputs[0]
        if normalize_embeddings:
            # L2-normalize so dot product == cosine similarity.
            norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            embeddings = embeddings / norms
        return embeddings


def get_model():
    global _model
    if _model is None:
        _model = OnnxEmbedder(MODEL_PATH)
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

    # Hard constraint: ensure no segment exceeds max_tokens.
    candidate_boundaries = sorted(set(boundaries))
    final_boundaries: list[int] = []
    last = 0

    for b in candidate_boundaries + [len(sentences)]:
        current_tokens = 0
        idx = last
        while idx < b:
            next_tokens = tokens_per_sentence[idx]
            if current_tokens > 0 and current_tokens + next_tokens > max_tokens:
                final_boundaries.append(idx)
                current_tokens = 0
            current_tokens += next_tokens
            idx += 1
        if b < len(sentences):
            final_boundaries.append(b)
        last = b

    final_boundaries = sorted(set(x for x in final_boundaries if 0 < x < len(sentences)))
    return similarities, final_boundaries


def main():
    parser = argparse.ArgumentParser(description="Local ONNX semantic chunker")
    parser.add_argument("--input-file", required=True, help="Path to JSON input file")
    args = parser.parse_args()

    with open(args.input_file, "r", encoding="utf-8") as f:
        data = json.load(f)
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
