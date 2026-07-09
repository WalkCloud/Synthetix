#!/usr/bin/env python3
"""Resolve the transitive closure of Python worker dependencies.

Reads a requirements.txt path from argv[1], walks the full dependency tree via
importlib.metadata, and emits one JSON object per dependency on stdout (NDJSON).
This is invoked by scripts/generate-third-party-notices.mjs (scanPython) so the
JS side never has to embed Python source in a template literal (which mangles
quotes and newlines). Keeping the script in its own file avoids escaping hell.
"""
import sys
import json

try:
    import importlib.metadata as md
except Exception:
    sys.exit(2)  # python too old / importlib.metadata missing

req_file = sys.argv[1] if len(sys.argv) > 1 else ""

# Parse requirements.txt: strip version pins, extras, markers, comments.
roots = []
try:
    with open(req_file, encoding="utf-8") as f:
        for line in f:
            line = line.split("#")[0].strip()
            if not line:
                continue
            name = line
            for sep in "<>=!~[":
                name = name.split(sep)[0]
            name = name.strip().replace("_", "-").lower()
            if name:
                roots.append(name)
except Exception:
    sys.exit(3)  # requirements.txt not found / unreadable

# BFS the transitive closure.
seen = {}
stack = list(roots)
while stack:
    raw = stack.pop(0)
    name = raw.replace("_", "-").lower()
    if name in seen:
        continue
    try:
        dist = md.distribution(raw)
    except Exception:
        continue
    seen[name] = dist.version or ""
    for req in dist.requires or []:
        bare = req.split(";")[0].split()[0]
        for sep in "<>=!~[]()":
            bare = bare.split(sep)[0]
        bare = bare.strip().replace("_", "-").lower()
        if bare and bare not in seen:
            stack.append(bare)

# Emit NDJSON for each resolved dependency.
for name, version in seen.items():
    try:
        dist = md.distribution(name)
    except Exception:
        continue
    meta = dist.metadata
    lic_expr = meta.get("License-Expression")
    lic_raw = meta.get("License")
    classifiers = meta.get_all("Classifier") or []
    lic_cls = [c for c in classifiers if c.startswith("License ::")]
    # License label: prefer SPDX expression, then short License: raw, then classifier.
    license_label = lic_expr or (lic_raw if lic_raw and len(lic_raw) < 80 else None)
    if not license_label and lic_cls:
        license_label = lic_cls[0].split("::")[-1].strip()
    if not license_label:
        license_label = "UNKNOWN"
    homepage = meta.get("Home-page") or ""
    project_urls = meta.get_all("Project-URL") or []
    repo = ""
    for pu in project_urls:
        low = pu.lower()
        if "repository" in low or "github" in low or "gitlab" in low or "bitbucket" in low:
            repo = pu.split(",")[-1].strip()
            break
    obj = {
        "name": name,
        "version": version,
        "license": license_label,
        "homepage": homepage,
        "repository": repo,
        "source": "python",
    }
    sys.stdout.write(json.dumps(obj) + "\n")
