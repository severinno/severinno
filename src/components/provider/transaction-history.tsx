"use client"

import * as React from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Clock,
  Download,
  History,
  List,
  Loader2,
  Wallet,
} from "lucide-react"

import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { TransactionRow } from "./wallet-row"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TransactionItem = {
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

type HistoryResponse = {
  items: TransactionItem[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

// ---------------------------------------------------------------------------
// Infinite scroll sentinel
// ---------------------------------------------------------------------------

function useIntersectionObserver(
  callback: () => void,
  enabled: boolean,
): React.RefObject<HTMLDivElement | null> {
  const sentinelRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const el = sentinelRef.current
    if (!el || !enabled) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          callback()
        }
      },
      { rootMargin: "200px" },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [callback, enabled])

  return sentinelRef
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Filter type definitions
// ---------------------------------------------------------------------------

type FilterType = "all" | "paid" | "pending" | "withdrawn"

const FILTERS: Array<{ key: FilterType; label: string; icon: typeof List }> = [
  { key: "all", label: "Todas", icon: List },
  { key: "paid", label: "Recebidas", icon: ArrowUpRight },
  { key: "pending", label: "Pendentes", icon: Clock },
  { key: "withdrawn", label: "Sacadas", icon: ArrowDownLeft },
]

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TransactionHistory({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [filter, setFilter] = React.useState<FilterType>("all")
  const [dateStart, setDateStart] = React.useState("")
  const [dateEnd, setDateEnd] = React.useState("")

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError } =
    useInfiniteQuery<HistoryResponse>({
      queryKey: ["provider", "wallet", "history", filter, dateStart, dateEnd],
      queryFn: async ({ pageParam }) => {
        const params: Record<string, string | number> = {
          page: pageParam as number,
          limit: 20,
        }
        if (filter !== "all") {
          params.type = filter
        }
        if (dateStart) params.dateStart = dateStart
        if (dateEnd) params.dateEnd = dateEnd
        return apiGet("/api/provider/wallet/history", params)
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
      enabled: open,
    })

  const loadMore = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const sentinelRef = useIntersectionObserver(loadMore, hasNextPage && !isFetchingNextPage)

  const exportUrl = React.useMemo(() => {
    const params = new URLSearchParams()
    if (filter !== "all") params.set("type", filter)
    if (dateStart) params.set("dateStart", dateStart)
    if (dateEnd) params.set("dateEnd", dateEnd)
    const qs = params.toString()
    return `/api/provider/wallet/history/export${qs ? `?${qs}` : ""}`
  }, [filter, dateStart, dateEnd])

  const allTransactions = React.useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])

  const total = data?.pages[0]?.total ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            Extrato completo
          </DialogTitle>
        </DialogHeader>

        {/* Filter tabs */}
        <div className="bg-muted/30 flex flex-wrap gap-1.5 rounded-lg p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <f.icon className="size-3" />
              {f.label}
            </button>
          ))}
        </div>

        {/* Date range filter */}
        <div className="bg-muted/30 flex items-center gap-2 rounded-lg px-3 py-2">
          <Calendar className="text-muted-foreground size-3.5 shrink-0" />
          <input
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="bg-background text-foreground h-7 w-[130px] rounded-md border px-2 text-xs shadow-sm"
            aria-label="Data inicial"
          />
          <span className="text-muted-foreground text-xs">até</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="bg-background text-foreground h-7 w-[130px] rounded-md border px-2 text-xs shadow-sm"
            aria-label="Data final"
          />
          {(dateStart || dateEnd) && (
            <button
              type="button"
              onClick={() => {
                setDateStart("")
                setDateEnd("")
              }}
              className="text-primary hover:text-primary/80 ml-auto text-xs"
            >
              Limpar
            </button>
          )}
        </div>

        {/* Summary bar */}
        <div className="bg-muted/30 text-muted-foreground flex items-center justify-between rounded-lg px-3 py-2 text-xs">
          <span>
            {total} transaç{total === 1 ? "ão" : "ões"}
            {filter !== "all" && (
              <span className="ml-1">
                ({filter === "paid" ? "recebidas" : filter === "pending" ? "pendentes" : "sacadas"})
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {total > 0 && (
              <a
                href={exportUrl}
                download
                className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs transition-colors"
              >
                <Download className="size-3" />
                CSV
              </a>
            )}
            {isFetchingNextPage && (
              <span className="flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                Carregando…
              </span>
            )}
          </div>
        </div>

        <Separator />

        {/* Transaction list */}
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
              <p className="text-muted-foreground text-sm">Carregando extrato…</p>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-red-500">Erro ao carregar extrato.</p>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Tentar novamente
              </Button>
            </div>
          ) : allTransactions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
                <Wallet className="size-5" />
              </div>
              <p className="text-muted-foreground text-sm">Nenhuma transação encontrada.</p>
            </div>
          ) : (
            <>
              {allTransactions.map((t) => (
                <TransactionRow key={`${t.status}-${t.id}`} t={t} />
              ))}

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-4" />

              {isFetchingNextPage && (
                <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Carregando mais transações…
                </div>
              )}

              {!hasNextPage && allTransactions.length > 0 && (
                <div className="text-muted-foreground py-4 text-center text-xs">
                  {allTransactions.length < total
                    ? `Mostrando ${allTransactions.length} de ${total} transações`
                    : "Todas as transações carregadas."}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default TransactionHistory
