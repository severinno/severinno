"use client"

/**
 * Skeletons — domain-specific loading placeholders.
 *
 * Each skeleton mirrors the exact layout of the real component it replaces
 * so there's zero CLS when the real content loads.
 *
 * Uses the base `<Skeleton>` from `@/components/ui/skeleton`.
 */

import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Service Card Skeleton — matches the marketplace service card layout
// ---------------------------------------------------------------------------
export function ServiceCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("overflow-hidden rounded-xl", className)}>
      {/* Image placeholder */}
      <Skeleton className="h-40 w-full rounded-none" />
      <CardContent className="space-y-3 p-4">
        {/* Category badge */}
        <Skeleton className="h-5 w-20 rounded-full" />
        {/* Title */}
        <Skeleton className="h-5 w-3/4" />
        {/* Description lines */}
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
        </div>
        {/* Rating + Price row */}
        <div className="flex items-center justify-between pt-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Provider Card Skeleton — matches provider-card.tsx layout
// ---------------------------------------------------------------------------
export function ProviderCardSkeleton({ className }: { className?: string }) {
  return (
    <Card
      className={cn("flex flex-col justify-between rounded-xl border p-4 shadow-xs", className)}
    >
      <div>
        {/* Header: Avatar + name + badges */}
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          {/* Action icons */}
          <div className="flex gap-1">
            <Skeleton className="size-7 rounded-lg" />
            <Skeleton className="size-7 rounded-lg" />
          </div>
        </div>
        {/* Rating + Price */}
        <div className="mt-3 flex items-center justify-between border-t pt-2.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        {/* Bio */}
        <Skeleton className="mt-2.5 h-3 w-full" />
        <Skeleton className="mt-1.5 h-3 w-3/4" />
        {/* Tags */}
        <div className="mt-2.5 flex gap-1">
          <Skeleton className="h-5 w-16 rounded-md" />
          <Skeleton className="h-5 w-20 rounded-md" />
        </div>
      </div>
      {/* Action buttons */}
      <div className="mt-4 flex gap-2 border-t pt-3">
        <Skeleton className="h-8 flex-1 rounded-lg" />
        <Skeleton className="h-8 flex-1 rounded-lg" />
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Conversation List Skeleton — matches messages-view conversation list
// ---------------------------------------------------------------------------
export function ConversationListSkeleton({
  count = 5,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={cn("space-y-1", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Map Skeleton — placeholder for maplibre maps
// ---------------------------------------------------------------------------
export function MapSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-muted/50 relative flex items-center justify-center overflow-hidden rounded-xl",
        className,
      )}
      style={{ minHeight: 300 }}
    >
      {/* Animated wave overlay */}
      <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="text-muted-foreground flex flex-col items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-40"
        >
          <path d="M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 0 1-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0 1 12 0" />
          <circle cx="12" cy="8" r="2" />
        </svg>
        <span className="text-xs font-medium opacity-40">Carregando mapa…</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard Stats Skeleton — 4 KPI cards
// ---------------------------------------------------------------------------
export function DashboardStatsSkeleton({
  count = 4,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-5 rounded" />
            </div>
            <Skeleton className="mt-3 h-8 w-20" />
            <Skeleton className="mt-2 h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table Skeleton — generic table with N rows
// ---------------------------------------------------------------------------
export function TableSkeleton({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {/* Header */}
      <div className="bg-muted/50 flex gap-4 rounded-lg px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}
