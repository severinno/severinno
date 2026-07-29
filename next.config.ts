import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

// CSP is set dynamically in middleware.ts with strict directives.
// Static security headers here apply to pre-rendered responses.
// See src/middleware.ts for the dynamic CSP header.

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  generateEtags: true,
  compress: true,

  // Skip TypeScript type-checking during build when SKIP_TYPESCRIPT_CHECK=true
  // (used in Docker builds where type-checking is very slow)
  typescript: {
    ignoreBuildErrors: process.env.SKIP_TYPESCRIPT_CHECK === "true",
  },

  // Static security headers (CSP is handled by middleware)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },

  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    remotePatterns: [
      // MinIO / local S3 (dev)
      { protocol: "http", hostname: "localhost" },
      // Production domain
      { protocol: "https", hostname: "severinno.com.br" },
      { protocol: "https", hostname: "*.severinno.com.br" },
      // Cloudflare R2 / common CDN patterns
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "*.cloudflare.com" },
      // Gravatar / UI avatars (fallback)
      { protocol: "https", hostname: "*.gravatar.com" },
      { protocol: "https", hostname: "ui-avatars.com" },
      // Picsum photos (cover fallback)
      { protocol: "https", hostname: "picsum.photos" },
      // Pravatar (avatar fallback)
      { protocol: "https", hostname: "i.pravatar.cc" },
    ],
  },

  // Experimental features
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-icons",
      "recharts",
      "date-fns",
      "framer-motion",
      "zod",
      "sonner",
    ],
  },
};

const withBundleAnalyzerFn = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})

// withSentryConfig is NOT needed for self-hosted GlitchTip.
// The @sentry/nextjs SDK still works — it sends events directly
// via the configured DSN (no build-time plugin required).
// Source maps are uploaded manually if desired.

export default withBundleAnalyzerFn(nextConfig)
