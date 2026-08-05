"use client"

/**
 * RealtimeStatusBadge — Live-connection indicator for real-time features.
 *
 * Shows a small pill with a pulsing dot and label that reflects the current
 * Socket.io connection state:
 *   - connected    → green pulsing dot + "Ao vivo"
 *   - connecting   → amber pulsing dot + "Conectando…"
 *   - reconnecting → amber pulsing dot + "Reconectando…"
 *   - disconnected → gray dot + "Offline"
 *   - error        → red dot + "Erro"
 *
 * Usage:
 *   import { useRealtime } from "@/hooks/use-realtime"
 *
 *   const { status, isConnected } = useRealtime()
 *   <RealtimeStatusBadge status={status} isConnected={isConnected} />
 *
 * Or via the finance hook:
 *   const { status, isConnected } = useRealtimeFinance()
 *   <RealtimeStatusBadge status={status} isConnected={isConnected} />
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import type { ConnectionStatus } from "@/hooks/use-realtime"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RealtimeStatusBadgeProps {
  status: ConnectionStatus
  isConnected: boolean
  /** Size variant. Default "sm" fits inside a header row. */
  size?: "sm" | "md"
  /** Optional extra class names. */
  className?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; dotColor: string; dotPulse: boolean }
> = {
  connected: {
    label: "Ao vivo",
    dotColor: "bg-emerald-500",
    dotPulse: true,
  },
  connecting: {
    label: "Conectando\u2026",
    dotColor: "bg-amber-400",
    dotPulse: true,
  },
  reconnecting: {
    label: "Reconectando\u2026",
    dotColor: "bg-amber-400",
    dotPulse: true,
  },
  disconnected: {
    label: "Offline",
    dotColor: "bg-muted-foreground/40",
    dotPulse: false,
  },
  error: {
    label: "Erro",
    dotColor: "bg-rose-500",
    dotPulse: false,
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RealtimeStatusBadge({
  status,
  isConnected,
  size = "sm",
  className,
}: RealtimeStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.disconnected

  // If we're disconnected but the config says connected (transitional state
  // or SSR guard), show "Ao vivo" but force no pulse.
  const dotPulse = config.dotPulse && isConnected

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border leading-none font-medium transition-colors",
        // Size
        size === "sm" ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-xs",
        // Tone — muted border unless connected
        isConnected
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300"
          : "border-border/60 bg-muted/40 text-muted-foreground",
        className,
      )}
      title={config.label}
      role="status"
      aria-live="polite"
    >
      {/* Pulsing dot */}
      <span
        className={cn(
          "inline-block rounded-full",
          size === "sm" ? "size-1.5" : "size-2",
          config.dotColor,
          dotPulse && "animate-pulse",
        )}
        aria-hidden="true"
      />

      {config.label}
    </span>
  )
}

export default RealtimeStatusBadge
