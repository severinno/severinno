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
    <div className="bg-card hover:bg-accent/40 flex items-center gap-3 rounded-lg border p-3 transition-colors">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          t.status === "paid" &&
            "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
          t.status === "pending" &&
            "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
          t.status === "refunded" &&
            "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
          isWithdrawn && "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
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
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{t.description}</p>
        <p className="text-muted-foreground truncate text-xs">
          {isWithdrawn
            ? `Saque realizado — ${formatDate(t.date)}`
            : `${t.clientName} — ${formatDate(t.date)}`}
        </p>
      </div>
      <div className="text-right">
        <p
          className={cn(
            "text-sm font-semibold tabular-nums",
            isWithdrawn && "text-red-600 dark:text-red-400",
          )}
        >
          {isWithdrawn ? `- ${formatBRL(t.netAmount)}` : formatBRL(t.netAmount)}
        </p>
        <Badge
          variant="outline"
          className={cn(
            "mt-0.5 text-[10px] font-normal",
            t.status === "paid" &&
              "border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300",
            t.status === "pending" &&
              "border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-300",
            isWithdrawn &&
              "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-400",
          )}
        >
          {isWithdrawn ? "Sacado" : t.status === "paid" ? "Recebido" : "Pendente"}
        </Badge>
      </div>
    </div>
  )
}

export default TransactionRow
