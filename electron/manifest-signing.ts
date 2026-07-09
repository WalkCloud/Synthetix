/**
 * Ed25519 manifest signing for the auto-update supply chain (Plan A).
 *
 * PROBLEM this solves: Synthetix is an unsigned open-source Windows app, so
 * there is no Windows code-signing chain to prove a downloaded update really
 * came from us. Without protection, a tampered GitHub Release asset or a MITM
 * on the manifest host could ship arbitrary code as an "update".
 *
 * SOLUTION (zero-cost, independent of the Windows signing ecosystem): sign the
 * update manifest with an Ed25519 keypair WE generate. The private key is kept
 * offline (never in the repo); the public key is baked into the app at build
 * time (src/generated/update-pubkey.ts). The updater verifies every manifest
 * against the embedded public key before offering the update.
 *
 * WHY SIGN A SUBSET, NOT THE WHOLE FILE: the signature has to live INSIDE
 * latest.json, so signing the whole file would be self-referential. Instead we
 * sign a CANONICAL STRING built from the security-critical fields (version +
 * every asset's url/size/sha256 + runtime hash) in a fixed order with fixed
 * separators. This is deterministic regardless of JSON key order, whitespace,
 * or any non-security fields (release notes, timestamps) the publisher adds —
 * and it covers exactly the fields an attacker would mutate to deliver a
 * malicious payload.
 *
 * The canonical-string algorithm is implemented TWICE (here in TS for the
 * updater, and as plain JS in scripts/publish-release.mjs for signing). They
 * must produce byte-identical output; manifest-signing.test.ts enforces this.
 */
import crypto from "crypto";

// ─── canonical subset construction ──────────────────────────────────────────

/**
 * The fields from a manifest asset that go into the signed canonical string.
 * url + size + sha256 fully pin "what to download and that it's intact".
 * For patch, minRuntimeHash is also pinned (so an attacker can't swap a patch
 * to target a different runtime layer).
 */
interface SignableAsset {
  url: string;
  size: number;
  sha256: string;
}
interface SignablePatch extends SignableAsset {
  minRuntimeHash?: string;
}
interface SignablePlatform {
  full: SignableAsset;
  patch?: SignablePatch;
}
interface SignableManifest {
  version: string;
  platforms: Partial<Record<string, SignablePlatform>>;
}

/** Magic prefix so a signature from a different scheme/format is rejected. */
const CANONICAL_PREFIX = "synthetix-update-v1\n";

/**
 * Build the canonical, deterministically-ordered string that gets signed.
 *
 * Layout (every field on its own line, `\n`-separated):
 *   synthetix-update-v1
 *   <version>
 *   <platformKey>           (sorted; one block per platform, in sorted order)
 *     full <url> <size> <sha256>
 *     patch <url> <size> <sha256> <minRuntimeHash>   (only if patch present)
 *
 * Platforms are iterated in sorted key order so two signers producing JSON with
 * different platform key order still yield the same canonical string.
 */
export function buildCanonicalString(manifest: SignableManifest): string {
  const lines: string[] = [CANONICAL_PREFIX.trimEnd(), manifest.version];
  const platformKeys = Object.keys(manifest.platforms).sort();
  for (const key of platformKeys) {
    const block = manifest.platforms[key];
    if (!block) continue;
    lines.push(key);
    const f = block.full;
    lines.push(`full\t${f.url}\t${f.size}\t${f.sha256}`);
    if (block.patch) {
      const p = block.patch;
      lines.push(
        `patch\t${p.url}\t${p.size}\t${p.sha256}\t${p.minRuntimeHash ?? ""}`
      );
    }
  }
  return lines.join("\n");
}

// ─── verification (client side, used by the updater) ────────────────────────

export interface VerifyResult {
  ok: boolean;
  /** The parsed manifest, when JSON was valid. */
  manifest: SignableManifest | null;
  /** Why verification failed (ok=false only). */
  reason?: string;
  /** True if the manifest carried no signature at all (allowed but inadvisable). */
  unsigned?: boolean;
}

/**
 * Verify a manifest blob against the embedded public key.
 *
 * Behavior:
 *   - JSON parse error             → ok:false, reason
 *   - No `signature` field         → ok:true, unsigned:true  (forward-compat)
 *   - signature present + valid    → ok:true
 *   - signature present + INVALID  → ok:false, reason        (reject — tamper)
 *
 * The "unsigned → ok" path exists so a transition period can ship before every
 * release is signed. Once all releases are signed, tighten this to reject
 * unsigned manifests (see TODO in updater.ts).
 */
export function verifyManifest(
  rawJson: string,
  pubkeyHex: string
): VerifyResult {
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, manifest: null, reason: "manifest is not valid JSON" };
  }

  // The manifest may carry extra fields; we only need the signable subset.
  const manifest = extractSignable(parsed);
  if (!manifest) {
    return { ok: false, manifest: null, reason: "manifest missing required fields" };
  }

  const signature: string | undefined = parsed?.signature;
  if (!signature || typeof signature !== "string") {
    // Unsigned manifest — allowed during transition, flagged for the caller.
    return { ok: true, manifest, unsigned: true };
  }

  try {
    const pubkey = crypto.createPublicKey({
      key: Buffer.from(pubkeyHex, "hex"),
      format: "der",
      type: "spki",
    });
    const canonical = buildCanonicalString(manifest);
    const valid = crypto.verify(
      null, // Ed25519 ignores the algorithm argument
      Buffer.from(canonical, "utf8"),
      pubkey,
      Buffer.from(signature, "hex")
    );
    if (!valid) {
      return { ok: false, manifest, reason: "manifest signature invalid" };
    }
    return { ok: true, manifest };
  } catch (e) {
    return {
      ok: false,
      manifest,
      reason: `signature verification error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Pull only the security-critical fields out of a parsed manifest object.
 * Returns null if the structure is too malformed to sign/verify. Tolerates
 * missing patch blocks (full is mandatory).
 */
function extractSignable(parsed: any): SignableManifest | null {
  if (!parsed || typeof parsed.version !== "string") return null;
  if (!parsed.platforms || typeof parsed.platforms !== "object") return null;
  const platforms: Partial<Record<string, SignablePlatform>> = {};
  for (const [key, raw] of Object.entries(parsed.platforms)) {
    const block = raw as any;
    if (!block?.full) continue;
    const full = pickAsset(block.full);
    if (!full) continue;
    const platform: SignablePlatform = { full };
    if (block.patch) {
      const patch = pickAsset(block.patch);
      if (patch) {
        const sp: SignablePatch = { ...patch };
        if (typeof block.patch.minRuntimeHash === "string") {
          sp.minRuntimeHash = block.patch.minRuntimeHash;
        }
        platform.patch = sp;
      }
    }
    platforms[key] = platform;
  }
  if (Object.keys(platforms).length === 0) return null;
  return { version: parsed.version, platforms };
}

function pickAsset(raw: any): SignableAsset | null {
  if (
    !raw ||
    typeof raw.url !== "string" ||
    typeof raw.size !== "number" ||
    typeof raw.sha256 !== "string"
  ) {
    return null;
  }
  return { url: raw.url, size: raw.size, sha256: raw.sha256 };
}
