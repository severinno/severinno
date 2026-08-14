"use client"

/**
 * QuoteCompareTable — side-by-side comparison modal/table for up to 3 quotes.
 *
 * Features:
 * - Direct side-by-side provider metrics (Rating, Review count, Verified badge)
 * - Item-by-item price comparison
 * - Automatic "Melhor Custo-Benefício" highlight with badge
 * - One-click approval button per quote column
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { BadgeCheck, Check, GitCompare, Loader2, Sparkles, Star, X } from "lucide-react"

import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export type ComparedQuoteData = {
  id: string
  status: string
  createdAt: string
  expiresAt: string
  total: number
  itemsCount: number
  provider: {
    id: string
    name: string
    avatarUrl?: string | null
    verified: boolean
    avgRating: number
    reviewCount: number
    whatsapp?: string | null
  }
  items: Array<{
    id: string
    serviceTitle: string
    quantity: number
    unit: string
    price: number | null
    status: string
  }>
  score: number
  isBestValue: boolean
}

type QuoteCompareTableProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  quoteIds: string[]
  onApproveQuote?: (quoteId: string) => void
}

export function QuoteCompareTable({
  open,
  onOpenChange,
  quoteIds,
  onApproveQuote,
}: QuoteCompareTableProps) {
  const query = useQuery<{ quotes: ComparedQuoteData[] }>({
    queryKey: ["quotes-compare", quoteIds.join(",")],
    queryFn: () =>
      apiGet<{ quotes: ComparedQuoteData[] }>(`/api/quotes/compare?ids=${quoteIds.join(",")}`),
    enabled: open && quoteIds.length >= 2,
  })

  const quotes = query.data?.quotes ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl overflow-hidden sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <GitCompare className="size-5 text-emerald-600" />
            Comparativo de Orçamentos
          </DialogTitle>
          <DialogDescription>
            Compare preços, qualificações e prazos lado a lado para tomar a melhor decisão.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="size-8 animate-spin text-emerald-600" />
            <p className="text-sm">Carregando comparativo…</p>
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <X className="size-10 text-red-500" />
            <p className="text-muted-foreground text-sm">
              Erro ao carregar dados dos orçamentos para comparação.
            </p>
          </div>
        ) : quotes.length < 2 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Selecione pelo menos 2 orçamentos para comparar.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto pb-2">
            <div className="grid min-w-[600px] grid-cols-3 gap-4">
              {quotes.map((q) => (
                <div
                  key={q.id}
                  className={`relative flex flex-col justify-between rounded-xl border p-4 transition-all ${
                    q.isBestValue
                      ? "border-emerald-500 bg-emerald-50/40 shadow-md ring-2 ring-emerald-500/20 dark:border-emerald-700 dark:bg-emerald-950/20"
                      : "border-border bg-card shadow-sm"
                  }`}
                >
                  {q.isBestValue && (
                    <div className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-emerald-600 px-3 py-0.5 text-[11px] font-bold text-white shadow">
                      <Sparkles className="size-3" />
                      Melhor Custo-Benefício
                    </div>
                  )}

                  <div className="space-y-3 pt-2">
                    {/* Provider info */}
                    <div className="flex items-center gap-3">
                      <Avatar className="size-12 border">
                        {q.provider.avatarUrl ? (
                          <AvatarImage src={q.provider.avatarUrl} alt={q.provider.name} />
                        ) : null}
                        <AvatarFallback className="bg-primary/10 text-primary font-bold">
                          {q.provider.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <p className="truncate text-sm font-semibold">{q.provider.name}</p>
                          {q.provider.verified && (
                            <BadgeCheck className="size-4 shrink-0 text-emerald-600" />
                          )}
                        </div>
                        <div className="text-muted-foreground flex items-center gap-1 text-xs">
                          <Star className="size-3.5 fill-amber-400 text-amber-400" />
                          <span className="text-foreground font-bold">
                            {q.provider.avgRating > 0 ? q.provider.avgRating.toFixed(1) : "Novo"}
                          </span>
                          <span>({q.provider.reviewCount})</span>
                        </div>
                      </div>
                    </div>

                    {/* Total Price */}
                    <div className="bg-background rounded-lg border p-3 text-center">
                      <span className="text-muted-foreground block text-xs">Valor Total</span>
                      <span className="text-xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                        {q.total > 0 ? formatBRL(q.total) : "Sob consulta"}
                      </span>
                    </div>

                    {/* Items Breakdown */}
                    <div className="space-y-1.5 text-xs">
                      <span className="text-muted-foreground block font-semibold">
                        Itens orçados:
                      </span>
                      {q.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between border-b pb-1 last:border-0"
                        >
                          <span className="text-foreground/80 max-w-[120px] truncate">
                            {item.serviceTitle}
                          </span>
                          <span className="font-medium tabular-nums">
                            {item.price ? formatBRL(item.price * item.quantity) : "Pendente"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 border-t pt-3">
                    <Button
                      onClick={() => onApproveQuote?.(q.id)}
                      className={`w-full gap-1.5 ${
                        q.isBestValue ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""
                      }`}
                      variant={q.isBestValue ? "default" : "outline"}
                      size="sm"
                    >
                      <Check className="size-4" />
                      Aprovar este
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
