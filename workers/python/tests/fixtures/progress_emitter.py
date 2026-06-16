import json
import sys

print(json.dumps({"type": "progress", "stage": "loading", "progress": 25, "message": "Loading graph engine"}), file=sys.stderr)
print(json.dumps({"type": "progress", "stage": "indexing", "progress": 50, "processed": 1, "total": 2, "message": "Extracting entities"}), file=sys.stderr)
print(json.dumps({"ok": True}))
