"use client"

/**
 * VerifiedBadge — visual trust badge for identity-verified providers.
 *
 * Shows a green shield with a checkmark and optional tooltip.
 * Renders in 3 sizes: sm (inline), md (cards), lg (profile).
 */

import * as React from "react"
import { ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type BadgeSize = "sm" | "md" | "lg"

type VerifiedBadgeProps = {
  /** Size variant. sm = inline text, md = card, lg = profile header. */
  size?: BadgeSize
  /** Date the identity was verified. Shown in tooltip. */
  verifiedAt?: Date | string | null
  /** Show the "Verificado" text label alongside the icon */
  showLabel?: boolean
  className?: string
}

const SIZE_CONFIG: Record<BadgeSize, { icon: string; container: string; text: string }> = {
  sm: {
    icon: "size-3",
    container: "gap-0.5 px-1.5 py-0.5 text-[10px]",
    text: "text-[10px]",
  },
  md: {
    icon: "size-3.5",
    container: "gap-1 px-2 py-0.5 text-xs",
    text: "text-xs",
  },
  lg: {
    icon: "size-4",
    container: "gap-1.5 px-2.5 py-1 text-sm",
    text: "text-sm",
  },
}

export function VerifiedBadge({
  size = "sm",
  verifiedAt,
  showLabel = true,
  className,
}: VerifiedBadgeProps) {
  const config = SIZE_CONFIG[size]

  const badge = (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold",
        "bg-emerald-100 text-emerald-700",
        "dark:bg-emerald-950/60 dark:text-emerald-300",
        "transition-colors",
        config.container,
        className,
      )}
    >
      <ShieldCheck className={config.icon} />
      {showLabel && <span className={config.text}>Verificado</span>}
    </span>
  )

  // Wrap in tooltip with verification date
  const tooltipText = verifiedAt
    ? `Identidade verificada pela Severinno em ${new Date(verifiedAt).toLocaleDateString("pt-BR")}`
    : "Identidade verificada pela Severinno"

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default VerifiedBadge
