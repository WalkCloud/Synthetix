import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rag_manage import action_core_graph


class FakeRag:
    async def get_graph_labels(self):
        return [f"Entity{i}" for i in range(30)]

    async def get_knowledge_graph(self, label, max_depth=1, max_nodes=100):
        nodes = [
            SimpleNamespace(id=f"Entity{i}", labels=[f"Entity{i}"], properties={"description": f"Desc {i}"})
            for i in range(10)
        ]
        edges = [SimpleNamespace(source="Entity0", target="Entity1", properties={"description": "rel", "weight": 1})]
        return SimpleNamespace(nodes=nodes, edges=edges)


class CoreGraphTests(unittest.TestCase):
    def test_sparse_graph_falls_back_to_visible_nodes(self):
        result = asyncio.run(action_core_graph(FakeRag(), max_nodes=10, min_degree=2))

        self.assertNotIn("error", result)
        self.assertGreaterEqual(len(result["graph"]["nodes"]), 8)
        self.assertGreaterEqual(result["total_entities"], 30)


if __name__ == "__main__":
    unittest.main()
