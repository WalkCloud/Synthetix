import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/.git/**", "**/_archive/**"],
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
