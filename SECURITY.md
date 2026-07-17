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

## Data Handling and Privacy

- Uploaded documents, the bundled SQLite database, and local RAG indices are stored in the configured local user-data location (for the Windows desktop app, `%APPDATA%\Synthetix\`), not in the install directory.
- Remote LLM, embedding, rerank, and image providers receive the task-related prompts, document excerpts, images, or other content needed to perform the configured operation. Review each provider's privacy and retention terms before sending sensitive data.
- Local providers, such as Ollama-compatible services, can keep supported AI processing on your own machine and allow offline workflows when every required provider and backend is local.
- LightRAG uses local storage by default, but an optional externally hosted LightRAG/storage backend can be configured; content sent to that backend then follows its deployment and privacy controls.
- Synthetix does **not** enable product telemetry by default.
- LLM API keys are encrypted at rest with AES-256-GCM (see `src/lib/crypto.ts`).
