/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * loading-global.tsx
 *
 * Polished pre-hydration loading screen shown while the app bootstraps
 * (auth check, store hydration, persisted view restore).
 *
 * Replaces the inline spinner in page-client.tsx with a branded skeleton
 * that uses the same LoadingShell / shimmer design language.
 */

"use client"

import { motion } from "framer-motion"
import { LoadingShell, S } from "@/app/loading-shell"

const dotVariants: any = {
  hidden: { opacity: 0, y: 4 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: 0.4 + i * 0.15,
      duration: 0.35,
      ease: "easeOut",
    },
  }),
}

const pulseVariants: any = {
  pulse: {
    scale: [1, 1.3, 1],
    opacity: [0.6, 1, 0.6],
    transition: {
      duration: 1.4,
      repeat: Infinity,
      ease: "easeInOut",
      delay: 0.6,
    },
  },
}

export default function LoadingGlobal() {
  return (
    <LoadingShell>
      <div className="from-background via-background to-muted/30 relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-32 size-72 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-400/5" />
          <div className="absolute -right-32 -bottom-32 size-96 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-400/5" />
        </div>

        <div className="relative flex flex-col items-center gap-6">
          {/* Brand skeleton */}
          <S className="h-8 w-44 sm:h-9 sm:w-48" />

          {/* Tagline skeleton */}
          <S className="h-4 w-64 sm:h-4 sm:w-72" />

          {/* Animated dots */}
          <div className="mt-4 flex items-center gap-2">
            {[0, 1, 2].map((i) => (
              <motion.div key={i} custom={i} variants={dotVariants} initial="hidden" animate="show">
                <motion.div
                  variants={pulseVariants}
                  animate="pulse"
                  className="size-2.5 rounded-full bg-emerald-500 dark:bg-emerald-400"
                  style={{
                    boxShadow: "0 0 6px rgba(5, 150, 105, 0.3)",
                  }}
                />
              </motion.div>
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
