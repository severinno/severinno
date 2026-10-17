"use client"

import * as React from "react"
import { ArrowDownLeft, ArrowUpRight, Banknote, Clock } from "lucide-react"

import { formatBRL, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

import { Badge } from "@/components/ui/badge"

// ---------------------------------------------------------------------------
// Shared type
// ---------------------------------------------------------------------------

export type WalletTransaction = {
  id: string
  bookingId: string
  amount: number
  fee: number
  netAmount: number
  status: "paid" | "pending" | "refunded" | "withdrawn"
  description: string
  clientName: string
  date: string
}

// ---------------------------------------------------------------------------
// Transaction row
// ---------------------------------------------------------------------------

export function TransactionRow({ t }: { t: WalletTransaction }) {
  const isWithdrawn = t.status === "withdrawn"
  return (
    <div className="hover:bg-muted/30 flex items-center justify-between gap-3 p-3 transition-colors sm:p-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl border",
            t.status === "paid" &&
              "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            t.status === "pending" &&
              "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
            t.status === "refunded" &&
              "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
            isWithdrawn && "border-border/50 bg-muted/60 text-muted-foreground",
          )}
        >
          {isWithdrawn ? (
            <ArrowDownLeft className="size-4" />
          ) : t.status === "paid" ? (
            <ArrowUpRight className="size-4" />
          ) : t.status === "pending" ? (
            <Clock className="size-4" />
          ) : (
            <Banknote className="size-4" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-foreground truncate text-sm font-medium">{t.description}</p>
          <p className="text-muted-foreground truncate text-xs">
            {isWithdrawn
              ? `Transferência PIX — ${formatDate(t.date)}`
              : `${t.clientName} — ${formatDate(t.date)}`}
          </p>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={cn(
            "text-sm font-semibold tabular-nums",
            isWithdrawn ? "text-foreground" : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {isWithdrawn ? `- ${formatBRL(t.netAmount)}` : `+ ${formatBRL(t.netAmount)}`}
        </p>
        <Badge
          variant="outline"
          className={cn(
            "mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0 text-[10px] font-medium shadow-none",
            t.status === "paid" &&
              "border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
            t.status === "pending" &&
              "border-amber-200 bg-amber-50/60 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
            isWithdrawn && "border-border/60 bg-muted/50 text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              t.status === "paid" && "bg-emerald-500",
              t.status === "pending" && "bg-amber-500",
              isWithdrawn && "bg-zinc-400",
            )}
          />
          {isWithdrawn ? "Sacado" : t.status === "paid" ? "Recebido" : "Pendente"}
        </Badge>
      </div>
    </div>
  )
}

export default TransactionRow
