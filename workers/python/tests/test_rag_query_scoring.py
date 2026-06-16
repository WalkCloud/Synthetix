import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rag_query import build_rank_score, normalize_vector_score


class RagQueryScoringTests(unittest.TestCase):
    def test_rank_score_is_not_fake_perfect_match(self):
        self.assertLess(build_rank_score(rank=0, total=5), 1.0)
        self.assertGreater(build_rank_score(rank=0, total=5), build_rank_score(rank=4, total=5))

    def test_vector_score_is_clamped_to_zero_one(self):
        self.assertEqual(normalize_vector_score(1.2), 1.0)
        self.assertEqual(normalize_vector_score(-0.2), 0.0)
        self.assertEqual(normalize_vector_score(0.72), 0.72)

    def test_missing_vector_score_returns_none(self):
        self.assertIsNone(normalize_vector_score(None))


if __name__ == "__main__":
    unittest.main()
