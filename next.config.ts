import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// 让 next dev 也能使用 Cloudflare 绑定（由 OpenNext 适配器要求）
import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
