/**
 * Shared list of Python packages that are excluded from the distributed app
 * AND from the third-party notices display.
 *
 * Single source of truth — imported by both:
 *   - scripts/build-installer.mjs   (physically deletes them from dist/app)
 *   - scripts/generate-third-party-notices.mjs (filters them from the notices)
 *
 * Keeping these in sync means the notices always reflect what actually ships.
 *
 * Categories:
 *   - cloud SDKs / dev tooling never imported by any worker
 *   - companion packages to kept deps (torchvision etc.)
 *   - dead transitive deps pulled in by optional code paths not used at runtime
 */
export const PYTHON_EXCLUDED_PACKAGES = [
  // AWS / cloud SDKs — never imported by any worker.
  "aws_cdk", "aws-cdk.assets-handlers", "aws-cdk", "boto3", "botocore",
  "s3transfer", "jmespath",
  // Azure SDK — pulled in via pydantic-settings → azure-identity → azure-core,
  // and via markitdown → azure-ai-documentintelligence. No worker imports
  // azure; these are dead transitive deps from cloud-backend code paths.
  "azure-core", "azure-identity", "azure-ai-documentintelligence",
  // markitdown — only referenced by the dead convert_legacy_backup.py (not
  // imported by any active module). Its own deps (azure, etc.) are excluded above.
  "markitdown",
  // torch is KEPT (docling imports it at load). Only companion packages unused:
  "torchvision", "functorch", "torch_tensorrt",
  // patchright (95MB) — Playwright anti-detection fork, pure dev/test tooling.
  "patchright",
  // scipy / sklearn — not imported by workers, docling, lightrag, or torch.
  "scipy", "sklearn", "scikit_learn",
  // rapidocr — not imported; docling uses its own OCR pipeline.
  "rapidocr",
  // onnx (the format package) — distinct from onnxruntime (which IS used).
  "onnx",
  // faker — fake-data generator, dev-only.
  "faker",
  // opencv — not imported by workers.
  "cv2", "opencv_python",
  // misc dev tooling that leaked in.
  "pip", "setuptools", "wheel", "ensurepip",
];

/**
 * Normalize a package name for matching (PEP 503: lowercase, runs of -_. → -).
 */
export function normalizePkgName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** Set of normalized excluded names for O(1) lookup. */
export const EXCLUDED_PYTHON_SET = new Set(
  PYTHON_EXCLUDED_PACKAGES.map(normalizePkgName),
);
