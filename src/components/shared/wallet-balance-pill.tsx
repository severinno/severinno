"use client"

/**
 * WalletBalancePill — balance indicator for provider navbar.
 *
 * Shows the available balance with a pulsing animation when the balance
 * increases, and a tooltip with available / pending / total breakdown.
 *
 * Extracted from DashboardShell so it can be reused in other contexts
 * (e.g. mobile sheet, provider dashboard).
 */

import { useQuery } from "@tanstack/react-query"
import { Wallet } from "lucide-react"

import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { useBalancePulse } from "@/lib/use-balance-pulse"
import { useCoinSound } from "@/lib/use-coin-sound"
import { useViewStore } from "@/store/view"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WalletBalancePill() {
  const navigate = useViewStore((s) => s.navigate)
  const { playCoin } = useCoinSound()
  const { data, isLoading } = useQuery<{ balance: number; pendingBalance: number }>({
    queryKey: ["provider", "wallet", "topbar"],
    queryFn: () => apiGet("/api/provider/wallet"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  // ---- Pulse animation + coin sound when balance increases ----------------
  const { isPulsing } = useBalancePulse(data?.balance, playCoin)

  if (isLoading) {
    return (
      <div className="flex h-7 w-20 animate-pulse items-center justify-center rounded-md bg-muted/50" />
    )
  }

  if (!data || data.balance <= 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Pulse is pure CSS (svn-scale-pulse) — no framer-motion (budget guard). */}
        <button
          type="button"
          onClick={() => navigate("provider.finance")}
          className={`mr-1.5 inline-flex h-7 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50${isPulsing ? " svn-scale-pulse" : ""}`}
        >
          <Wallet className="size-3.5" />
          {formatBRL(data.balance)}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="w-48 p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Disponível</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {formatBRL(data.balance)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">A receber</span>
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              {formatBRL(data.pendingBalance)}
            </span>
          </div>
          <div className="border-t pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Total</span>
              <span className="font-bold text-foreground">
                {formatBRL(data.balance + data.pendingBalance)}
              </span>
            </div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
