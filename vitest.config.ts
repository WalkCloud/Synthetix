import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    env: {
      DATABASE_URL: "file:./dev.db",
      JWT_SECRET: "test-jwt-secret-for-vitest",
      ENCRYPTION_KEY: "test-encryption-key-for-vitest-32c",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
