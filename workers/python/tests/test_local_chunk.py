import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import local_chunk


class FakeModel:
    def encode(self, sentences, normalize_embeddings=True):
        return np.eye(len(sentences), dtype=np.float32)


class LocalChunkTests(unittest.TestCase):
    def test_find_boundaries_keeps_segments_under_max_tokens(self):
        sentences = ["x" * 100 for _ in range(10)]
        with patch.object(local_chunk, "get_model", return_value=FakeModel()):
            _sims, boundaries = local_chunk.find_boundaries(sentences, max_tokens=120, threshold=-1.0)

        points = [0] + boundaries + [len(sentences)]
        for start, end in zip(points, points[1:]):
            seg_tokens = sum(max(1, len(s) // 2) for s in sentences[start:end])
            self.assertLessEqual(seg_tokens, 120)


if __name__ == "__main__":
    unittest.main()
