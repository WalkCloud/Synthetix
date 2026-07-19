import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    ".venv/**",
    "next-env.d.ts",
    "_archive/**",
    "tmp/**",
    "tmp-chrome-profile/**",
    "data/**",
    "workers/python/__pycache__/**",
    "e2e/**",
    "src/__tests__/**",
    "packaging/**",
    "*.cjs",
  ]),
  {
    files: ["scripts/**/*.{js,mjs}", "electron/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    rules: {
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "prefer-const": "warn",
    },
  },
]);

export default eslintConfig;
