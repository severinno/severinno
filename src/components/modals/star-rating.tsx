"use client"

import * as React from "react"
import { Star } from "lucide-react"
import { cn } from "@/lib/utils"

type StarRatingProps = {
  /** 0–5 (supports half stars visually via clip) */
  value: number
  /** Total reviews shown next to stars (display-only). */
  count?: number
  /** Star size in px. */
  size?: number
  className?: string
  showCount?: boolean
}

/**
 * Display-only star rating — supports 0.5 increments by clipping a
 * "filled" layer over an "empty" layer.
 */
export function StarRatingDisplay({
  value,
  count,
  size = 16,
  className,
  showCount = true,
}: StarRatingProps) {
  const clamped = Math.max(0, Math.min(5, value))
  const pct = (clamped / 5) * 100
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      aria-label={`Avaliação ${clamped.toFixed(1)} de 5${
        count != null ? ` (${count} avaliações)` : ""
      }`}
    >
      <span
        className="relative inline-flex"
        style={{ width: size * 5 + 4 * 2, height: size }}
      >
        {/* empty layer */}
        <span className="absolute inset-0 flex" style={{ gap: 2 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              style={{ width: size, height: size }}
              className="fill-muted text-muted-foreground/40"
              strokeWidth={0}
            />
          ))}
        </span>
        {/* filled layer, clipped to value % */}
        <span
          className="absolute inset-0 flex overflow-hidden"
          style={{ width: `${pct}%`, gap: 2 }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              style={{ width: size, height: size }}
              className="fill-amber-400 text-amber-400"
              strokeWidth={0}
            />
          ))}
        </span>
      </span>
      {showCount && (
        <span className="text-xs font-medium text-muted-foreground">
          {clamped.toFixed(1)}
          {count != null ? ` (${count})` : ""}
        </span>
      )}
    </span>
  )
}

type StarRatingInputProps = {
  value: number
  onChange: (v: number) => void
  size?: number
  className?: string
  name?: string
  disabled?: boolean
}

/**
 * Interactive 1–5 star rating — keyboard accessible (left/right arrows
 * decrement/increment, 1–5 keys set value).
 */
export function StarRatingInput({
  value,
  onChange,
  size = 32,
  className,
  name,
  disabled,
}: StarRatingInputProps) {
  const [hover, setHover] = React.useState<number | null>(null)
  const active = hover ?? value

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault()
      onChange(Math.min(5, Math.max(1, value + 1)))
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault()
      onChange(Math.min(5, Math.max(1, value - 1)))
    } else if (/^[1-5]$/.test(e.key)) {
      e.preventDefault()
      onChange(Number(e.key))
    }
  }

  return (
    <div
      className={cn("inline-flex items-center gap-1", className)}
      role="radiogroup"
      aria-label="Sua avaliação"
    >
      {Array.from({ length: 5 }).map((_, i) => {
        const v = i + 1
        const filled = v <= active
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            aria-label={`${v} estrela${v > 1 ? "s" : ""}`}
            disabled={disabled}
            tabIndex={value === v ? 0 : -1}
            className={cn(
              "rounded-md p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              disabled && "cursor-not-allowed opacity-60 hover:scale-100",
            )}
            onMouseEnter={() => !disabled && setHover(v)}
            onMouseLeave={() => !disabled && setHover(null)}
            onClick={() => !disabled && onChange(v)}
            onKeyDown={onKeyDown}
          >
            <Star
              style={{ width: size, height: size }}
              className={cn(
                filled
                  ? "fill-amber-400 text-amber-400"
                  : "fill-transparent text-muted-foreground/50",
              )}
              strokeWidth={1.5}
            />
          </button>
        )
      })}
      {name && <input type="hidden" name={name} value={value} readOnly />}
      <span className="ml-1.5 text-sm font-medium tabular-nums text-muted-foreground">
        {active > 0 ? `${active}.0` : "—"}
      </span>
    </div>
  )
}
