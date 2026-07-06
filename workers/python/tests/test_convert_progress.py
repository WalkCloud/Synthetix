import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from convert import emit_progress


class ConvertProgressTests(unittest.TestCase):
    def test_emit_progress_writes_json_progress_event_to_stderr(self):
        stderr = io.StringIO()
        with patch("sys.stderr", stderr):
            emit_progress("docling_convert", 25, "Converting document with Docling", elapsedSeconds=40)

        event = json.loads(stderr.getvalue())
        self.assertEqual(event["type"], "progress")
        self.assertEqual(event["stage"], "docling_convert")
        self.assertEqual(event["progress"], 25)
        self.assertEqual(event["message"], "Converting document with Docling")
        self.assertEqual(event["elapsedSeconds"], 40)

    def test_emit_progress_clamps_progress(self):
        stderr = io.StringIO()
        with patch("sys.stderr", stderr):
            emit_progress("x", 150, "too high")

        event = json.loads(stderr.getvalue())
        self.assertEqual(event["progress"], 100)


if __name__ == "__main__":
    unittest.main()
