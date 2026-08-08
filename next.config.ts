import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

// Security headers are set here (static — applies to ALL routes, including
// static/ISR HTML served from cache) and in src/middleware.ts (API +
// dashboard/settings only, because the middleware matcher is scoped there).
//
// CSP design notes — read before editing:
//   • The CSP below is STATIC (no nonce) on purpose. A nonce-based CSP
//     requires `headers()` in the root layout, which opts every route into
//     dynamic rendering and silently disables ISR for the whole app — the
//     exact regression documented in src/app/layout.tsx. With ISR now active
//     (home revalidate=60, /categoria + /u revalidate=300) a nonce is the
//     wrong tool.
//   • JSON-LD (`<script type="application/ld+json">`) is a DATA BLOCK per
//     the HTML spec — never executed, and therefore NOT governed by the
//     script-src directive. The pages with inline JSON-LD (/, /categoria,
//     /u) need no nonce for those blocks.
//   • The only inline EXECUTABLE scripts Next.js emits are the RSC flight
//     payload (`self.__next_f.push(...)`), present on EVERY page — so
//     script-src needs 'unsafe-inline' (or a per-request nonce, which would
//     kill ISR). This is the documented tradeoff: strict everywhere else,
//     script-src 'self' 'unsafe-inline' to keep static rendering.
//   • 'unsafe-eval' is only added in dev (webpack HMR requires it).
//   • 'upgrade-insecure-requests' is only added in production (it would
//     break plain-http localhost dev).

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the tracing root to THIS project. Without it Next infers the root from
  // the nearest lockfile walking up — in a Freebuff worktree nested under the
  // main project (C:\PROJETOS\severinno) it picked the MAIN project's
  // pnpm-lock.yaml, which resolves `next` from the wrong node_modules and
  // caused the prerender invariant "Expected workUnitAsyncStorage to have a
  // store" (Next 16.1.x, E696) during `next build` in this worktree.
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  poweredByHeader: false,
  generateEtags: true,
  compress: true,

  // Skip TypeScript type-checking during build when SKIP_TYPESCRIPT_CHECK=true
  // (used in Docker builds where type-checking is very slow)
  typescript: {
    ignoreBuildErrors: process.env.SKIP_TYPESCRIPT_CHECK === "true",
  },

  // Static security headers — applied to every response, including static
  // and ISR HTML. The middleware adds the same headers for API routes and
  // the dashboard (its matcher only runs there), plus rate-limit headers.
  async headers() {
    const isDev = process.env.NODE_ENV !== "production"
    const csp = [
      "default-src 'self'",
      // Next.js RSC flight payload is an inline executable script on every
      // page; see the design notes above. 'unsafe-eval' only for dev HMR.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      // Inline <style> injected by chart.tsx / social-proof-ticker + 97
      // style={{ }} usages require style 'unsafe-inline'.
      "style-src 'self' 'unsafe-inline'",
      // Images: user uploads (S3/R2), avatars (gravatar, ui-avatars,
      // pravatar), covers (picsum) and OSM map tiles.
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // API is same-origin; Sentry/GlitchTip DSN is https; chat socket is
      // same-origin with wss upgrade.
      "connect-src 'self' https: wss:",
      // maplibre bundles workers as blob; the PWA service worker is 'self'.
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "manifest-src 'self'",
      // Violations POST here (see src/app/api/csp-report/route.ts) — makes a
      // wrongly-strict directive visible in production instead of silent.
      // CSP3: report-to + Reporting-Endpoints header is the modern path
      // (Chrome/Edge 96+, Safari 16+); report-uri stays as the LEGACY
      // fallback (older Chrome/Edge, Safari <16). Browsers that support both
      // prefer report-to and ignore report-uri — the pair is safe to send
      // together, per the Reporting API spec.
      "report-to csp-endpoint",
      "report-uri /api/csp-report",
      ...(isDev ? [] : ["upgrade-insecure-requests"]),
    ].join("; ")

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // CSP3 Reporting API endpoint definition — referenced by the
          // "report-to csp-endpoint" directive above. The relative URL is
          // resolved against the document origin, so no config drift between
          // dev/staging/prod hostnames.
          { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Public pages never pass through the middleware (its matcher is
          // /api + /dashboard + /settings), so these previously only reached
          // API/dashboard responses — duplicated here for full coverage.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
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
