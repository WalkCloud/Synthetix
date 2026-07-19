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

## Version sources (single source of truth)

The version lives in `package.json` and is propagated to every other place that
needs it. **Never hand-edit the derived files** — run `npm run generate:meta`
and the build flow instead. The `verify:versions` script fails the build if any
of these drift apart (this is what caught the v1.0.2/v1.0.3 regression where
the installer was named 1.0.3 but the app reported 1.0.1):

| Source | File | How it stays in sync |
|---|---|---|
| Canonical | `package.json` `version` | Hand-edit on bump |
| About dialog | `src/generated/app-version.ts` | `npm run generate:meta` |
| Build provenance | `public/build-info.json` | `npm run generate:meta` |
| Electron `app.getVersion()` | `dist/electron-main/main.js` | `electron:build` (chains `generate:meta`) |
| Packed app.asar | `dist/electron/win-unpacked/resources/app.asar` | `electron:build` (refuses to reuse a stale win-unpacked) |
| Update manifest | `stable.json` on the GitHub Release | `npm run publish` |

`build` and `electron:build` both chain `generate:meta` so a clean build can
never again ship with a stale About-dialog version.

## Cutting a release

### 1. Bump version

```bash
git checkout main
git pull origin main
# edit package.json: "version": "1.0.5"
npm run generate:meta   # propagates to src/generated/app-version.ts
git add package.json src/generated/app-version.ts
git commit -m "release: v1.0.5"
```

### 2. Tag and push

```bash
git tag -a v1.0.5 -m "v1.0.5 — <one-line summary>"
git push origin main
git push origin v1.0.5
```

### 3. Windows installer + update manifest (automatic)

Pushing a `v*` tag triggers `.github/workflows/release-windows.yml` on a
Windows runner. The workflow:

1. Installs pnpm dependencies, generates the Prisma client, and builds the
   Next.js standalone bundle.
2. On the clean Windows runner, downloads pinned Node 20 x64 and
   python-build-standalone 3.12 x64 runtimes, then installs
   `workers/python/requirements.txt` into the bundled Python environment. This
   step deliberately does not depend on an Actions cache.
3. Runs `node scripts/build-installer.mjs --assemble-only --no-build` after the
   Next build to assemble `dist/app`, then verifies the bundled Node, Python,
   worker requirements, Prisma package, and migrations before packaging.
4. Decodes the Authenticode certificate secret to a temporary `.pfx` before
   `electron:build` (if signing is configured).
5. Builds and signs the Electron NSIS installer via `electron:build` (which
   refuses to reuse a stale `win-unpacked`).
6. Runs `verify:versions` to assert `package.json` == `app-version.ts` ==
   `app.asar` version.
7. Runs `npm run publish`, which only handles release creation/upload and:
   - computes SHA-256 of the installer,
   - signs the update manifest (`stable.json`) with the Ed25519 key
     (`SYNTHETIX_SIGNING_KEY` secret),
   - uploads the installer + manifest to the GitHub Release.

Installed clients then discover the new version via
`https://github.com/WalkCloud/Synthetix/releases/latest/download/stable.json`,
verify the manifest signature against the public key baked into the app,
download the installer, verify its SHA-256, and (after the user confirms) run
the NSIS installer visibly.

### 4. Release notes

Write release notes when creating the tag, or attach them after:

```bash
gh release edit v1.0.5 --notes-file .github/release-notes/v1.0.5.md
```

## Update manifest format (`stable.json`)

The updater requires this schema (see `electron/updater.ts` `LatestManifest`):

```json
{
  "version": "1.0.5",
  "channel": "stable",
  "publishedAt": "2026-07-18T09:00:00.000Z",
  "minRequiredVersion": null,
  "forceFull": false,
  "platforms": {
    "win-x64": {
      "updateKind": "full",
      "full": { "url": "...", "size": 625053950, "sha256": "..." }
    }
  },
  "signature": "<Ed25519 signature>"
}
```

`publish-release.mjs` generates and signs this automatically; do not hand-edit
it. Older manifests that lack `platforms` / `signature` are rejected by current
clients (this is what made the pre-fix `stable.json` unusable).

## Windows code signing (Authenticode)

The installer and EXE are signed when these repository secrets are set:

- `WINDOWS_CERT_FILE` — the `.pfx` base64-encoded.
- `WINDOWS_CERT_PASSWORD` — the `.pfx` password.

When unset, the build skips signing and Windows SmartScreen will warn on first
run. For a public release, configure an EV or OV certificate. The Ed25519
manifest signature protects the *update channel* regardless, but Authenticode
protects the *first manual download* and the publisher identity shown by
Windows.

The `.pfx` is decoded in CI to a temp file **before** `electron:build`.
`scripts/build-electron.mjs` maps `WINDOWS_CERT_PATH` and
`WINDOWS_CERT_PASSWORD` to electron-builder's standard `CSC_LINK` and
`CSC_KEY_PASSWORD` environment variables for the electron-builder child
process. The password is not placed in command-line arguments or logged, and
`npm run publish` receives no Authenticode options because it only uploads the
already-built installer. The certificate never lives in the repo or in
`electron-builder.yml`.

## Update signing key (Ed25519)

Generate once:

```bash
npm run generate:signing-key
```

Store the private key as the `SYNTHETIX_SIGNING_KEY` repository secret. The
public key is baked into the app at `electron/generated/update-pubkey.ts` and
committed; the updater verifies every manifest against it.

## Pre-release license compliance checklist

Run through this before tagging a release. Full rationale in
`docs/about-dialog-design-and-compliance-plan-2026-07-08.md` §12.

- [ ] `npm run verify:versions` passes (version consistency).
- [ ] About dialog version matches `package.json` (`npm run generate:meta`).
- [ ] About copyright text no longer says "All rights reserved / 保留所有权利".
- [ ] Root `LICENSE` exists and is Apache-2.0.
- [ ] `npm run generate:notices` succeeds and `public/legal/THIRD-PARTY-NOTICES.txt` is generated.
- [ ] Notices cover npm, Python, Electron, and asset sources.
- [ ] No `Unknown` license entries remain (review warnings emitted by the script).
- [ ] No unreviewed GPL/LGPL/AGPL/MPL entries.
- [ ] Windows installer (post-build) contains `resources/app/LICENSE` and `resources/app/THIRD-PARTY-NOTICES.txt`.
- [ ] Update manifest (`stable.json`) on the Release is signed and matches the installer's SHA-256.

## Quick reference: the whole flow

```bash
VER=1.0.5

git checkout main && git pull origin main

# Bump version (single edit — generate:meta + the build chain do the rest)
# edit package.json: "version": "$VER"
npm run generate:meta
git add package.json src/generated/app-version.ts
git commit -m "release: v$VER"
git tag -a v$VER -m "v$VER — <summary>"
git push origin main
git push origin v$VER

# The release-windows.yml workflow builds, signs, and publishes the installer
# + stable.json automatically. Verify on the Actions tab.
```

## Hotfixes to a released version

If you need to fix something on an already-released version without pulling in newer main work:

1. Branch off the tag: `git checkout -b hotfix/v1.0.6 v1.0.5`
2. Fix, commit, tag `v1.0.6`, push
3. Merge the hotfix branch back to `main` via PR

This is rare for a single-developer project — usually you just fix on main and cut the next version.

## In-app update flow (what users see)

1. The app checks for updates 30s after boot, then every 12h
   (`electron/main.ts` `scheduleUpdateChecks`).
2. When a newer signed manifest is found, the **sidebar** shows a reminder
   button above the user avatar (amber for normal updates, orange for forced).
3. Clicking it opens the **About dialog** with release notes, size, and a
   "Download now" button.
4. Download runs in the Electron main process with a progress bar; the user
   can cancel.
5. Once downloaded + SHA-256-verified, the dialog shows "Restart & install"
   (full) or "Apply now" (patch).
6. Full: the app quits and the **NSIS installer runs visibly** (the user sees
   the install page); a helper relaunches the new app once it's ready. Patch:
   the local Next service is restarted in place.
7. Staged download artifacts are cleaned up after a successful apply and on
   every boot.

Plain browser / self-hosted-web deployments hide all of this — in-app updates
are an Electron-desktop capability only (the browser cannot safely download
and run a Windows installer).
