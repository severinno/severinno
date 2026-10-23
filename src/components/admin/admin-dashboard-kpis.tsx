"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

export function KpiCard({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value: string
  onClick?: () => void
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          {label}
        </p>
        <span className="bg-primary/8 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-1.5 text-xl font-bold tracking-tight tabular-nums">{value}</p>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="border-border/50 bg-card hover:border-primary/30 hover:bg-accent/20 rounded-xl border px-3.5 py-3 text-left transition-all active:scale-95"
      >
        {content}
      </button>
    )
  }

  return (
    <div className="border-border/50 bg-card hover:border-primary/20 rounded-xl border px-3.5 py-3 transition-colors">
      {content}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton — mirrors the final layout
// ---------------------------------------------------------------------------

export function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* Header skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-8 w-44 rounded-lg" />
        </div>
      </div>

      {/* 4 KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-border/50 bg-card rounded-xl border p-5">
            <Skeleton className="size-10 rounded-lg" />
            <Skeleton className="mt-3 h-7 w-24" />
            <Skeleton className="mt-1 h-3 w-16" />
          </div>
        ))}
      </div>

      {/* 2 chart cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="border-border/50 bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="p-4">
              <Skeleton className="h-[220px] w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Table + List */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="border-border/50 bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="mb-2 h-12 w-full rounded-md" />
              ))}
            </div>
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="border-border/50 bg-card rounded-xl border">
            <div className="border-b px-5 py-4">
              <Skeleton className="h-4 w-44" />
            </div>
            <div className="p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="mb-2 h-14 w-full rounded-md" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
