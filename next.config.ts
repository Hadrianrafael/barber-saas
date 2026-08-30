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
    const isProd = process.env.NODE_ENV === "production";
    // Baseline CSP. `'unsafe-inline'` for scripts is still required by Next's
    // bootstrap without a nonce-injection layer (a nonce CSP is a follow-up).
    const csp = [
      "default-src 'self'",
      "img-src 'self' data: blob: https:",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self' https://api.anthropic.com https://api.stripe.com https://graph.facebook.com",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(self)",
          },
          { key: "Content-Security-Policy", value: csp },
          ...(isProd
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
