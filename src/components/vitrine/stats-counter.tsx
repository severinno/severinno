"use client"

/**
 * StatsCounter — Animated platform statistics counter section.
 *
 * Heuristic mapping:
 *   H1  Visibility of system status  → Show live platform numbers
 *   H2  Match real world             → Use familiar metrics (prestadores, serviços, avaliações)
 *   H4  Consistency                  → Consistent with hero stat bar style
 *   H6  Recognition > recall         → Icons + numbers = immediate recognition
 *   H7  Flexibility/efficiency       → Auto-animated counters on scroll
 *   H8  Aesthetic minimalism         → Clean 4-column layout
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Users, Wrench, CheckCircle2, Star, type LucideIcon } from "lucide-react"
import { motion } from "framer-motion"

import { apiGet } from "@/lib/api"
import { useCountUp, useScrollReveal } from "@/hooks/use-animation"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublicStats = {
  providers: number
  services: number
  reviews: number
  completedBookings: number
  avgRating: number
}

type StatItem = {
  icon: LucideIcon
  label: string
  value: number
  decimals?: number
  suffix?: string
}

// ---------------------------------------------------------------------------
// Animated number component — H7: auto-animated on scroll
// ---------------------------------------------------------------------------

function AnimatedNumber({
  target,
  decimals = 0,
  suffix = "",
}: {
  target: number
  decimals?: number
  suffix?: string
}) {
  const { ref, value } = useCountUp(target, { decimals, duration: 2000 })

  return (
    <span ref={ref} className="tabular-nums">
      {decimals > 0 ? value.toFixed(decimals) : value.toLocaleString("pt-BR")}
      {suffix}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StatsCounter() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()

  // Fetch stats from API
  const statsQuery = useQuery({
    queryKey: ["public-stats"],
    queryFn: () => apiGet<PublicStats>("/api/stats/public"),
    staleTime: 5 * 60 * 1000,
  })

  const stats = statsQuery.data

  const items: StatItem[] = React.useMemo(
    () => [
      {
        icon: Users,
        label: "Prestadores verificados",
        value: stats?.providers ?? 0,
      },
      {
        icon: Wrench,
        label: "Serviços cadastrados",
        value: stats?.services ?? 0,
      },
      {
        icon: CheckCircle2,
        label: "Serviços concluídos",
        value: stats?.completedBookings ?? 0,
      },
      {
        icon: Star,
        label: "Nota média",
        value: stats?.avgRating ?? 0,
        decimals: 1,
        suffix: "/5",
      },
    ],
    [stats],
  )

  return (
    <section className="relative overflow-hidden bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-800 dark:from-emerald-700 dark:via-emerald-800 dark:to-teal-900">
      {/* Decorative mesh blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/4 size-64 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute right-1/4 bottom-0 size-56 rounded-full bg-teal-400/10 blur-3xl" />
      </div>

      <div ref={ref} className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        <div className="grid grid-cols-2 gap-6 sm:gap-8 lg:grid-cols-4">
          {items.map((item, idx) => {
            const Icon = item.icon
            return (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 16 }}
                animate={visible ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                className="flex flex-col items-center gap-2 text-center"
              >
                <div className="flex size-12 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 sm:size-14">
                  <Icon className="size-6 text-white sm:size-7" />
                </div>
                <div className="text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
                  {statsQuery.isLoading ? (
                    <span className="inline-block h-8 w-16 animate-pulse rounded bg-white/20" />
                  ) : (
                    <AnimatedNumber
                      target={item.value}
                      decimals={item.decimals}
                      suffix={item.suffix}
                    />
                  )}
                </div>
                <p className="text-xs font-medium text-emerald-100 sm:text-sm">{item.label}</p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
