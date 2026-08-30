"use client"

/**
 * MapSkeleton — Beautiful loading skeleton for maps.
 *
 * Shows:
 * - Pulse animation background
 * - Fake map grid lines
 * - Animated pin placeholders
 * - "Carregando mapa..." text
 */

import { Loader2 } from "lucide-react"

type Props = {
  height?: number
  className?: string
}

export default function MapSkeleton({ height = 400, className = "" }: Props) {
  return (
    <div
      className={`bg-muted relative overflow-hidden rounded-xl border ${className}`}
      style={{ height }}
    >
      {/* Animated gradient background */}
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-gray-100 via-gray-50 to-gray-200 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800" />

      {/* Fake grid lines */}
      <svg className="absolute inset-0 h-full w-full opacity-10" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Animated pin placeholders */}
      <div className="absolute top-1/4 left-1/3">
        <div className="flex items-center gap-1 rounded-full bg-emerald-200/60 px-3 py-1.5">
          <div className="size-2 rounded-full bg-emerald-400 animate-pulse" />
          <div className="h-2.5 w-12 rounded bg-emerald-300/60" />
        </div>
      </div>
      <div className="absolute top-1/2 left-2/3">
        <div className="flex items-center gap-1 rounded-full bg-emerald-200/60 px-3 py-1.5">
          <div className="size-2 rounded-full bg-emerald-400 animate-pulse" />
          <div className="h-2.5 w-16 rounded bg-emerald-300/60" />
        </div>
      </div>
      <div className="absolute top-2/3 left-1/4">
        <div className="flex items-center gap-1 rounded-full bg-gray-200/60 px-3 py-1.5">
          <div className="size-2 rounded-full bg-gray-400" />
          <div className="h-2.5 w-10 rounded bg-gray-300/60" />
        </div>
      </div>

      {/* Center loader */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-white/80 shadow-lg backdrop-blur-sm">
          <Loader2 className="text-emerald-600 size-6 animate-spin" />
        </div>
        <span className="text-muted-foreground text-xs font-medium">Carregando mapa...</span>
      </div>
    </div>
  )
}
