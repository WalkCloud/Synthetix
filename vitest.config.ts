import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const stripMjsShebang = {
  name: "strip-mjs-shebang-for-vitest",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    const cleanId = id.split("?", 1)[0];
    if (!cleanId.endsWith(".mjs") || !code.startsWith("#!")) return null;
    return code.replace(/^#![^\n]*(?:\n|$)/, "");
  },
};

export default defineConfig({
  // Vite's SSR transform can inject imports before a script's `#!` line,
  // which makes executable .mjs files invalid when tests dynamically import
  // them. Strip the shebang in-memory for Vitest only; the CLI files on disk
  // retain it and remain directly executable by Node.
  plugins: [stripMjsShebang, react()],
  test: {
    environment: "node",
    // This project uses a shared real SQLite test DB, so file-level parallelism
    // creates cross-suite row/daemon races. Individual tests remain async; only
    // test files run serially.
    fileParallelism: false,
    include: ["src/__tests__/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/_archive/**",
      "**/e2e/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
    env: {
      DATABASE_URL: "file:./dev.db",
      JWT_SECRET: "test-jwt-secret-for-vitest",
      ENCRYPTION_KEY: "test-encryption-key-for-vitest-32c",
      ORT_DISABLE_ALL: "1",
      LOCAL_EMBED_MODEL_PATH: "data/models/bge-small-zh-v1.5",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
