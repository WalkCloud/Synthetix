# Security Policy

## Reporting a Vulnerability

Synthetix processes user documents locally and spawns Python workers for RAG/embedding. We take security seriously.

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, report them privately via **GitHub Security Advisories**:

1. Go to https://github.com/WalkCloud/Synthetix/security/advisories/new
2. Click "Report a vulnerability"
3. Provide a description, reproduction steps, and impact assessment

You can also email security concerns to the maintainers directly.

## Response Timeline

| Stage | Target |
|---|---|
| Acknowledge report | Within 48 hours |
| Initial assessment | Within 1 week |
| Fix or mitigation | Within 30 days (severity-dependent) |
| Public disclosure | After a fix is released, coordinated with reporter |

## Supported Versions

Only the latest release receives security updates.

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Older versions | ❌ |

## Update Integrity (Ed25519 Manifest Signing)

Synthetix uses Ed25519 signature verification for auto-updates. Every update manifest (`latest.json`) is signed by the maintainer's private key and verified against the public key baked into the app. If verification fails, the update is refused. This is independent of Windows code signing (the app is currently unsigned).

## What Synthetix Does NOT Do

- Does **not** send your documents to any server (all processing is local).
- Does **not** phone home with telemetry.
- LLM API keys are encrypted at rest with AES-256-GCM (see `src/lib/crypto.ts`).
- The bundled SQLite database and RAG indices live in `%APPDATA%\Synthetix\` (user data dir), never in the install directory.
