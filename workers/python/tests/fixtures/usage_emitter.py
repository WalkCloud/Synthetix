import json
import sys

# Emit one progress event and one usage event, then return JSON on stdout.
print(json.dumps({"type": "progress", "stage": "loading", "progress": 10, "message": "init"}), file=sys.stderr)
print(json.dumps({"type": "usage", "module": "graph", "input_tokens": 1234, "output_tokens": 567}), file=sys.stderr)
print(json.dumps({"type": "usage", "module": "graph", "input_tokens": 100, "output_tokens": 50}), file=sys.stderr)
print(json.dumps({"ok": True}))
