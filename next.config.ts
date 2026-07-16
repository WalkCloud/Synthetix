import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@node-rs/jieba"],
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
