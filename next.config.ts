import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Standalone output => small Docker image for Azure Container Apps.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // BullMQ is only reached from the worker / async enqueue paths; keep it out of
  // the webpack graph so its optional `@valkey/valkey-glide` driver isn't
  // resolved during the Next build.
  serverExternalPackages: ["bullmq", "ioredis"],
  eslint: {
    // CI runs `next lint` as a dedicated step; don't fail production builds on it.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Server Actions body size for CSV/XLSX imports.
    serverActions: { bodySizeLimit: "10mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
