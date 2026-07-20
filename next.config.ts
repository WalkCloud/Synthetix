import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Prisma 7.8 + better-sqlite3 12.11.1 use dynamic require() chains
  // (`better-sqlite3/lib/database.js` → `bindings` → `file-uri-to-path`;
  // `@prisma/client-*/runtime/client.js` → `@prisma/client-runtime-utils`)
  // that Next's Turbopack standalone tracer fails to expose at the top level
  // of `.next/standalone/node_modules/`. Marking them as serverExternalPackages
  // makes Next preserve their full node_modules subtree (including transitive
  // deps) instead of tracing only entry points, which fixes the
  // `Cannot find module 'bindings'` / `'@prisma/client-runtime-utils'`
  // crashes observed when the packaged Electron app first starts.
  serverExternalPackages: [
    "@node-rs/jieba",
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/client",
  ],
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
