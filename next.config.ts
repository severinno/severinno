import type { NextConfig } from "next"
import withBundleAnalyzer from "@next/bundle-analyzer"

// CSP is set dynamically in proxy.ts with strict directives.
// Static security headers here apply to pre-rendered responses.
// See proxy.ts (Next.js 16 — formerly middleware.ts) for the dynamic CSP header.

const nextConfig: NextConfig = {
  ...(process.env.BUILD_STANDALONE === "true" || process.env.DOCKER_BUILD === "true"
    ? { output: "standalone" }
    : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  generateEtags: true,
  compress: true,

  // Skip TypeScript type-checking during build ONLY in Docker (CI always runs tsc --noEmit separately).
  // ⚠️ NEVER set this to true in CI/CD — it masks type errors that break production.
  typescript: {
    ignoreBuildErrors:
      process.env.DOCKER_BUILD === "true" && process.env.SKIP_TYPESCRIPT_CHECK === "true",
  },

  // Security headers are set by Caddy reverse proxy (HSTS, X-Frame-Options,
  // X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP).
  // Only dynamic headers are set in proxy.ts (formerly middleware.ts).
  async headers() {
    return []
  },

  // Image optimization
  images: {
    // Dev-only: MinIO serves avatars from localhost:9000 (private IP) — Next 16's
    // optimizer blocks private-IP upstreams unless this is on. Prod serves via
    // https://severinno.com (public), so SSRF protection stays enabled there.
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    remotePatterns: [
      // MinIO / local S3 (dev)
      { protocol: "http", hostname: "localhost" },
      // Production domain
      { protocol: "https", hostname: "severinno.com" },
      { protocol: "https", hostname: "*.severinno.com" },
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
      "@tanstack/react-query",
    ],
  },
}

const withBundleAnalyzerFn = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})

// withSentryConfig is NOT needed for self-hosted GlitchTip.
// The @sentry/nextjs SDK still works — it sends events directly
// via the configured DSN (no build-time plugin required).
// Source maps are uploaded manually if desired.

export default withBundleAnalyzerFn(nextConfig)
