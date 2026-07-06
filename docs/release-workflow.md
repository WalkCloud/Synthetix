# Release Workflow

How Synthetix ships versions. The model is simple: **main is always releasable; a release is just a tag on main.**

## Versioning

Semantic versioning: `vMAJOR.MINOR.PATCH`

- **PATCH** (v1.0.0 → v1.0.1): bug fixes, no new features
- **MINOR** (v1.0.0 → v1.1.0): new features, backward compatible
- **MAJOR** (v1.0.x → v2.0.0): breaking changes

## Branching model

Single mainline — no `develop` branch, no release branches.

```
feature/* ──PR──► main ──tag──► v1.0.x
```

1. Develop on `feature/<topic>` branches off `main`
2. Open a PR to `main`, merge when ready
3. `main` always reflects the latest releasable state
4. Cut a release by tagging a commit on `main`

## Cutting a release

Run these steps each time you ship a new version. Replace `1.0.1` with your target version.

### 1. Bump version

Edit these files (search-and-replace the old version string):

- `package.json` → `"version": "1.0.1"`
- `packaging/Synthetix-Electron.iss` → `MyAppVersion` and `OutputBaseFilename`

```bash
git checkout main
git pull origin main
# edit the two files, then:
git add package.json packaging/Synthetix-Electron.iss
git commit -m "release: v1.0.1"
```

### 2. Tag and push

```bash
git tag -a v1.0.1 -m "v1.0.1 — <one-line summary>"
git push origin main
git push origin v1.0.1
```

### 3. Create GitHub Release

Write release notes to `.github/release-notes/v1.0.1.md`, then:

```bash
gh release create v1.0.1 \
  --title "Synthetix v1.0.1" \
  --notes-file .github/release-notes/v1.0.1.md
```

Or create it on the web: https://github.com/WalkCloud/Synthetix/releases/new?tag=v1.0.1

### 4. (Optional) Attach binaries

If shipping a Windows installer, upload the built `.exe` as a release asset:

```bash
gh release upload v1.0.1 dist/installer/Synthetix-Setup-v1.0.1.exe
```

## Quick reference: the whole flow as a script

```bash
# Set the version you're cutting
VER=1.0.1

git checkout main && git pull origin main

# Bump version in both files (adjust paths as needed)
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VER\"/" package.json
# For the .iss file, update MyAppVersion and OutputBaseFilename manually

git add package.json packaging/Synthetix-Electron.iss
git commit -m "release: v$VER"
git tag -a v$VER -m "v$VER"
git push origin main
git push origin v$VER

# Then create the Release via gh or the web UI
```

## Hotfixes to a released version

If you need to fix something on an already-released version without pulling in newer main work:

1. Branch off the tag: `git checkout -b hotfix/v1.0.2 v1.0.1`
2. Fix, commit, tag `v1.0.2`, push
3. Merge the hotfix branch back to `main` via PR

This is rare for a single-developer project — usually you just fix on main and cut the next version.
