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
 *   import { MetricCard, KpiCard } from "@/components/admin"
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

function renderMetricIcon(icon: React.ElementType | ReactNode, sizeClass = "size-4") {
  if (icon === null || icon === undefined || typeof icon === "boolean") {
    return null
  }
  if (typeof icon === "string" || typeof icon === "number" || React.isValidElement(icon)) {
    return (
      <span className={cn("text-primary [&>svg]:size-4", sizeClass && `[&>svg]:${sizeClass}`)}>
        {icon}
      </span>
    )
  }
  const IconComponent = icon as React.ElementType
  return <IconComponent className={cn("text-primary", sizeClass)} />
}

export function MetricCard({ icon: Icon, title, children, className }: MetricCardProps) {
  return (
    <div className={cn("border-border/50 bg-card rounded-xl border", className)}>
      <div className="flex items-center gap-2 border-b px-5 py-4">
        {renderMetricIcon(Icon, "size-4")}
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ── KpiCard ───────────────────────────────────────────────────────────────

export interface KpiCardProps {
  /** Lucide icon component (or any React element type). */
  icon: React.ElementType | ReactNode
  /** KPI label text. */
  label: string
  /** KPI value string (formatted). */
  value: string
  /** Optional subtitle below the label. */
  subtitle?: string
  /** Optional trend indicator. */
  trend?: "up" | "down"
  /** Optional trend label text. */
  trendLabel?: string
}

export function KpiCard({ icon: Icon, label, value, subtitle, trend, trendLabel }: KpiCardProps) {
  return (
    <div className="border-border/50 bg-card hover:border-primary/20 rounded-xl border p-5 transition-colors">
      <div className="flex items-start justify-between">
        <span className="bg-primary/8 text-primary flex size-10 items-center justify-center rounded-lg">
          {renderMetricIcon(Icon, "size-5")}
        </span>
        {trend ? (
          <div className="flex items-center gap-1">
            {trend === "up" ? (
              <TrendingUp className="size-4 text-emerald-500" />
            ) : (
              <TrendingDown className="size-4 text-red-500" />
            )}
            {trendLabel ? (
              <span
                className={cn(
                  "text-[10px] font-medium",
                  trend === "up" ? "text-emerald-500" : "text-red-500",
                )}
              >
                {trendLabel}
              </span>
            ) : null}
          </div>
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
