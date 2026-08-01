"use client"

import * as React from "react"
import { CalendarRange, ExternalLink, SearchX, X } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import { formatBRL, formatDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageSectionHeader,
  Pagination,
  ResultCount,
  SearchInput,
  TableSkeleton,
} from "./_shared"

type LytexInvoice = {
  _id: string
  _hashId: string
  status: string
  totalValue: number
  referenceId?: string
  linkCheckout?: string
  dueDate: string
  createdAt: string
  client?: { name: string; email: string; cpfCnpj: string }
  recipient?: { fantasyName: string; corporateName: string }
  paymentMethods?: { list: string[] }
}

const STATUS_LABELS: Record<string, string> = {
  waitingPayment: "Aguardando",
  paid: "Pago",
  expired: "Expirado",
  canceled: "Cancelado",
  refunded: "Estornado",
  chargeback: "Chargeback",
  overdue: "Vencido",
  processing: "Processando",
}

const STATUS_COLORS: Record<string, string> = {
  waitingPayment: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
  paid: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30",
  expired: "text-red-600 bg-red-50 dark:bg-red-950/30",
  canceled: "text-gray-500 bg-gray-100 dark:bg-gray-900",
  refunded: "text-purple-600 bg-purple-50 dark:bg-purple-950/30",
  chargeback: "text-rose-600 bg-rose-50 dark:bg-rose-950/30",
  overdue: "text-orange-600 bg-orange-50 dark:bg-orange-950/30",
  processing: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
}

export function AdminGateway() {
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL")
  const [dateRange, setDateRange] = React.useState<string>("all")
  const [customStart, setCustomStart] = React.useState<string>("")
  const [customEnd, setCustomEnd] = React.useState<string>("")
  const perPage = 20

  const isDateActive = dateRange !== "all" || !!customStart || !!customEnd

  const activeFilterCount =
    (search ? 1 : 0) + (statusFilter !== "ALL" ? 1 : 0) + (isDateActive ? 1 : 0)

  const clearFilters = () => {
    setSearch("")
    setStatusFilter("ALL")
    setDateRange("all")
    setCustomStart("")
    setCustomEnd("")
    setPage(1)
  }

  // Build date range query params
  const buildDateParams = () => {
    const params = new URLSearchParams()
    if (dateRange === "custom") {
      // Só envia se pelo menos uma data foi preenchida
      if (customStart || customEnd) {
        params.set("dateRange", "custom")
        if (customStart) params.set("startDate", customStart)
        if (customEnd) params.set("endDate", customEnd)
      }
    } else if (dateRange !== "all") {
      params.set("dateRange", dateRange)
    }
    const qs = params.toString()
    return qs ? `&${qs}` : ""
  }

  const queryKey = [
    "admin-gateway-invoices",
    page,
    perPage,
    search,
    statusFilter,
    dateRange,
    customStart,
    customEnd,
  ]
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<{
        ok: boolean
        results: LytexInvoice[]
        paginate: { perPage: number; page: number; pages: number; total: number }
      }>(
        `/api/admin/gateway/invoices?page=${page}&perPage=${perPage}${search ? `&search=${encodeURIComponent(search)}` : ""}${statusFilter !== "ALL" ? `&status=${statusFilter}` : ""}${buildDateParams()}`,
      ),
  })

  const invoices = data?.results ?? []
  const paginate = data?.paginate

  return (
    <div className="grid gap-4">
      <PageSectionHeader
        title="Faturas Lytex"
        description="Transações no gateway de pagamento. Somente leitura."
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => refetch()}
          >
            Atualizar
          </Button>
        }
      />

      <FilterBar onClear={clearFilters} activeCount={activeFilterCount}>
        <SearchInput
          placeholder="Buscar por ID, cliente…"
          value={search}
          onChange={setSearch}
          className="min-w-[200px] flex-1"
        />

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setPage(1)
          }}
          className="border-input/60 bg-background text-muted-foreground hover:border-foreground/20 focus:border-primary/50 h-9 appearance-none rounded-lg border px-3 pr-8 text-xs font-medium transition-colors outline-none"
        >
          <option value="ALL">Status: todos</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* ── Date range filter inline ────────────────────────────── */}
        <div className="relative flex items-center gap-1.5">
          <CalendarRange className="text-muted-foreground size-3.5 shrink-0" />
          <select
            value={dateRange}
            onChange={(e) => {
              setDateRange(e.target.value)
              setPage(1)
              if (e.target.value !== "custom") {
                setCustomStart("")
                setCustomEnd("")
              }
            }}
            className="border-input/60 bg-background text-muted-foreground hover:border-foreground/20 focus:border-primary/50 h-9 appearance-none rounded-lg border px-2.5 pr-7 text-xs font-medium transition-colors outline-none"
          >
            <option value="all">Período: todos</option>
            <option value="today">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="custom">Personalizado…</option>
          </select>

          {/* Custom date inputs — aparece apenas quando "custom" é selecionado */}
          {dateRange === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customStart}
                onChange={(e) => {
                  setCustomStart(e.target.value)
                  setPage(1)
                }}
                className="border-input/60 bg-background text-foreground hover:border-foreground/20 focus:border-primary/50 h-9 rounded-lg border px-2.5 text-xs [color-scheme:var(--color-scheme)] transition-colors outline-none"
                aria-label="Data inicial"
              />
              <span className="text-muted-foreground text-xs">até</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => {
                  setCustomEnd(e.target.value)
                  setPage(1)
                }}
                min={customStart || undefined}
                className="border-input/60 bg-background text-foreground hover:border-foreground/20 focus:border-primary/50 h-9 rounded-lg border px-2.5 text-xs [color-scheme:var(--color-scheme)] transition-colors outline-none"
                aria-label="Data final"
              />
            </div>
          )}
        </div>

        {paginate ? (
          <ResultCount page={paginate.page} limit={perPage} total={paginate.total} />
        ) : null}
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nenhuma fatura encontrada."
          action={
            activeFilterCount > 0 ? (
              <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                <X className="size-3.5" />
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Criação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv._id}>
                    <TableCell className="font-mono text-xs">{inv._id.slice(0, 12)}…</TableCell>
                    <TableCell className="text-xs">{inv.client?.name ?? "—"}</TableCell>
                    <TableCell className="text-xs font-medium">
                      {formatBRL(inv.totalValue / 100)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                          STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600",
                        )}
                      >
                        {STATUS_LABELS[inv.status] ?? inv.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {inv.paymentMethods?.list?.join(", ") ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(inv.createdAt)}
                    </TableCell>
                    <TableCell>
                      {inv.linkCheckout && (
                        <Button variant="ghost" size="icon" className="size-7" asChild>
                          <a href={inv.linkCheckout} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="size-3.5" />
                          </a>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {paginate && (
            <Pagination page={paginate.page} totalPages={paginate.pages} onPageChange={setPage} />
          )}
        </>
      )}
    </div>
  )
}

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ")
}
