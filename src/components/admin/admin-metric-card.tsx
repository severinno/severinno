"use client"

/**
 * MetricCard — Card with header (icon + title) and content area
 * KpiCard — Compact KPI card with value, label, trend
 *
 * Reusable card components used across admin dashboards (geo-metrics,
 * benchmarks, health, errors, etc.). Extracted from duplicate local
 * definitions to a single shared file.
 *
 * Usage:
 *   import { MetricCard, KpiCard } from "@/components/admin/admin-metric-card"
 *
 *   <MetricCard icon={BarChart3} title="Latência (ms)">
 *     <div>content</div>
 *   </MetricCard>
 *
 *   <KpiCard icon={Activity} label="Chamadas" value="1.234" subtitle="Últimos 30 min" trend="up" />
 */

import React, { type ReactNode } from "react"
import { TrendingUp, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"

// ── MetricCard ────────────────────────────────────────────────────────────

export interface MetricCardProps {
  /** Lucide icon component (or any React element type). */
  icon: React.ElementType | ReactNode
  /** Card title shown in the header. */
  title: string
  /** Card body content. */
  children: ReactNode
  /** Optional additional class names for the outer container. */
  className?: string
}

export function MetricCard({ icon: Icon, title, children, className }: MetricCardProps) {
  return (
    <div className={cn("border-border/50 bg-card rounded-xl border", className)}>
      <div className="flex items-center gap-2 border-b px-5 py-4">
        {typeof Icon === "function" ? (
          <Icon className="text-primary size-4" />
        ) : (
          <span className="text-primary [&>svg]:size-4">{Icon}</span>
        )}
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ── KpiCard ───────────────────────────────────────────────────────────────

export interface KpiCardProps {
  /** Lucide icon component. */
  icon: React.ElementType
  /** KPI label text. */
  label: string
  /** KPI value string (formatted). */
  value: string
  /** Optional subtitle below the label. */
  subtitle?: string
  /** Optional trend indicator. */
  trend?: "up" | "down"
}

export function KpiCard({ icon: Icon, label, value, subtitle, trend }: KpiCardProps) {
  return (
    <div className="border-border/50 bg-card hover:border-primary/20 rounded-xl border p-5 transition-colors">
      <div className="flex items-start justify-between">
        <span className="bg-primary/8 text-primary flex size-10 items-center justify-center rounded-lg">
          <Icon className="size-5" />
        </span>
        {trend ? (
          trend === "up" ? (
            <TrendingUp className="size-4 text-red-500" />
          ) : (
            <TrendingDown className="size-4 text-emerald-500" />
          )
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs font-medium tracking-wider uppercase">
        {label}
      </p>
      {subtitle ? <p className="text-muted-foreground mt-0.5 text-[10px]">{subtitle}</p> : null}
    </div>
  )
}
