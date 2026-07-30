"use client"

/**
 * MetricCard — Card with header (icon + title) and content area
 *
 * Reusable card component used across admin dashboards (geo-metrics,
 * benchmarks, health, errors, etc.). Extracted from 7 duplicate local
 * definitions to a single shared file.
 *
 * Usage:
 *   import { MetricCard } from "@/components/admin/admin-metric-card"
 *
 *   <MetricCard icon={BarChart3} title="Latência (ms)">
 *     <div>content</div>
 *   </MetricCard>
 */

import React, { type ReactNode } from "react"
import { cn } from "@/lib/utils"

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
