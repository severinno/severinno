"use client"

/**
 * PixCountdown — circular countdown timer for PIX payment expiration.
 *
 * Renders an animated circular progress ring that transitions from
 * emerald → amber → red as time runs out. Shows remaining time in
 * hours:minutes:seconds format.
 */

import * as React from "react"
import { motion } from "framer-motion"

type PixCountdownProps = {
  /** ISO date string when the PIX expires */
  expiresAt: string
  /** Called when countdown reaches zero */
  onExpired?: () => void
  /** Size in pixels (default: 80) */
  size?: number
}

export function PixCountdown({ expiresAt, onExpired, size = 80 }: PixCountdownProps) {
  const expiresMs = new Date(expiresAt).getTime()

  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= expiresMs) {
        clearInterval(timer)
        onExpired?.()
      }
    }, 1_000)
    return () => clearInterval(timer)
  }, [expiresMs, onExpired])

  const remainingMs = Math.max(0, expiresMs - now)
  const totalMs = Math.max(1, expiresMs - (expiresMs - 24 * 60 * 60 * 1000)) // assume 24h window
  const fraction = Math.min(1, remainingMs / totalMs)

  // Format remaining time
  const totalSeconds = Math.floor(remainingMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const timeStr =
    hours > 0
      ? `${hours}h${String(minutes).padStart(2, "0")}m`
      : minutes > 0
        ? `${minutes}m${String(seconds).padStart(2, "0")}s`
        : `${seconds}s`

  // Color transitions: green → amber → red
  const color =
    fraction > 0.5
      ? "stroke-emerald-500 dark:stroke-emerald-400"
      : fraction > 0.15
        ? "stroke-amber-500 dark:stroke-amber-400"
        : "stroke-red-500 dark:stroke-red-400"

  const textColor =
    fraction > 0.5
      ? "text-emerald-600 dark:text-emerald-400"
      : fraction > 0.15
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400"

  const radius = (size - 8) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - fraction)

  if (remainingMs <= 0) {
    return (
      <div
        className="flex flex-col items-center justify-center"
        style={{ width: size, height: size }}
      >
        <span className="text-xs font-medium text-red-500">Expirado</span>
      </div>
    )
  }

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`PIX expira em ${timeStr}`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={4}
          className="stroke-muted/30"
        />
        {/* Animated progress circle */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={4}
          strokeLinecap="round"
          className={color}
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-xs font-bold tabular-nums ${textColor}`}>{timeStr}</span>
      </div>
    </div>
  )
}
