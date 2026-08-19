"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"

const cardMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
} as const

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("bg-muted/30 border-dashed py-10 text-center", className)}>
      <CardContent className="flex flex-col items-center gap-3">
        <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full">
          <Icon className="size-7" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold">{title}</p>
          {description ? (
            <p className="text-muted-foreground mx-auto max-w-md text-sm">{description}</p>
          ) : null}
        </div>
        {action}
      </CardContent>
    </Card>
  )
}

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "primary",
  index = 0,
  trend,
}: {
  icon: LucideIcon
  label: string
  value: React.ReactNode
  hint?: string
  tone?: "primary" | "amber" | "sky" | "rose" | "zinc"
  /** Index for staggered mount animation (0-based). */
  index?: number
  /** Optional trend indicator shown next to the value. */
  trend?: { direction: "up" | "down"; label: string }
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    sky: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200",
  }[tone]

  return (
    <motion.div
      initial={cardMotion.initial}
      animate={cardMotion.animate}
      transition={{ delay: index * 0.05, duration: 0.25, ease: "easeOut" }}
    >
      <Card className="bg-card rounded-xl shadow-sm transition-shadow hover:shadow-md">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <span className={cn("flex size-10 items-center justify-center rounded-lg", toneClass)}>
              <Icon className="size-5" />
            </span>
            {trend ? (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  trend.direction === "up"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                    : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
                )}
              >
                {trend.direction === "up" ? "↑" : "↓"} {trend.label}
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
          <p className="text-muted-foreground mt-1 text-xs font-medium tracking-wide uppercase">
            {label}
          </p>
          {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-foreground text-base font-semibold tracking-tight md:text-lg">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground truncate text-xs">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}
