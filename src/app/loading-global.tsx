/**
 * loading-global.tsx
 *
 * Polished pre-hydration loading screen shown while the app bootstraps
 * (auth check, store hydration, persisted view restore).
 *
 * Replaces the inline spinner in page-client.tsx with a branded skeleton
 * that uses the same LoadingShell / shimmer design language.
 *
 * Entrance + dot pulse are pure CSS keyframes (fadeSlideUp / svnDotPulse
 * from loading-base's shimmerCSS, rendered by <LoadingShell>) — no
 * framer-motion dependency, keeping the animation lib out of the initial JS.
 */

"use client"

import { LoadingShell, S } from "@/app/loading-shell"

export default function LoadingGlobal() {
  return (
    <LoadingShell>
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-background via-background to-muted/30">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-32 -top-32 size-72 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-400/5" />
          <div className="absolute -bottom-32 -right-32 size-96 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-400/5" />
        </div>

        <div className="relative flex flex-col items-center gap-6">
          {/* Brand skeleton */}
          <S className="h-8 w-44 sm:h-9 sm:w-48" />

          {/* Tagline skeleton */}
          <S className="h-4 w-64 sm:h-4 sm:w-72" />

          {/* Animated dots (CSS: fadeSlideUp entrance + svnDotPulse loop) */}
          <div className="mt-4 flex items-center gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="size-2.5 rounded-full bg-emerald-500 dark:bg-emerald-400"
                style={{
                  animation:
                    "fadeSlideUp 0.35s ease-out both, svnDotPulse 1.4s ease-in-out infinite",
                  animationDelay: `${(0.4 + i * 0.15).toFixed(2)}s, 0.6s`,
                  boxShadow: "0 0 6px rgba(5, 150, 105, 0.3)",
                }}
              />
            ))}
          </div>

          {/* Screen-reader text */}
          <span className="sr-only" role="status">
            Carregando Severinno…
          </span>
        </div>
      </div>
    </LoadingShell>
  )
}
