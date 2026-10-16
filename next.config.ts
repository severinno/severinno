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

  // Edge caching and static asset performance headers.
  // Security headers are handled in proxy.ts / Caddy.
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/_next/image/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
          },
          {
            key: "CDN-Cache-Control",
            value: "max-age=604800, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/icons/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
          {
            key: "Content-Type",
            value: "application/manifest+json",
          },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
          {
            key: "Content-Type",
            value: "application/manifest+json",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
    ]
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
