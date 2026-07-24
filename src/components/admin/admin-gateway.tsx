"use client"

import * as React from "react"
import { Banknote, ExternalLink, SearchX, ShieldQuestion, X } from "lucide-react"
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
  DateRangeFilter,
  EmptyState,
  ErrorState,
  FilterBar,
  PageSectionHeader,
  Pagination,
  ResultCount,
  SearchInput,
  TableSkeleton,
  type DateRangePreset,
} from "./admin-shared"

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
  const [dateRange, setDateRange] = React.useState<DateRangePreset>("all")
  const perPage = 20

  const activeFilterCount =
    (search ? 1 : 0) +
    (statusFilter !== "ALL" ? 1 : 0) +
    (dateRange !== "all" ? 1 : 0)

  const clearFilters = () => {
    setSearch("")
    setStatusFilter("ALL")
    setDateRange("all")
    setPage(1)
  }

  const queryKey = ["admin-gateway-invoices", page, perPage, search, statusFilter, dateRange]
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<{
        ok: boolean
        results: LytexInvoice[]
        paginate: { perPage: number; page: number; pages: number; total: number }
      }>(
        `/api/admin/gateway/invoices?page=${page}&perPage=${perPage}${search ? `&search=${encodeURIComponent(search)}` : ""}${statusFilter !== "ALL" ? `&status=${statusFilter}` : ""}${dateRange !== "all" ? `&dateRange=${dateRange}` : ""}`,
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
            className="h-7 text-xs gap-1"
            onClick={() => refetch()}
          >
            Atualizar
          </Button>
        }
      />

      <FilterBar
        onClear={clearFilters}
        activeCount={activeFilterCount}
      >
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
          className="h-9 appearance-none rounded-lg border border-input/60 bg-background px-3 pr-8 text-xs font-medium text-muted-foreground outline-none transition-colors hover:border-foreground/20 focus:border-primary/50"
        >
          <option value="ALL">Status: todos</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        <DateRangeFilter
          value={dateRange}
          onChange={(v) => {
            setDateRange(v)
            setPage(1)
          }}
        />

        {paginate ? (
          <ResultCount
            page={paginate.page}
            limit={perPage}
            total={paginate.total}
          />
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
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="gap-1.5"
              >
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
                    <TableCell className="font-mono text-xs">
                      {inv._id.slice(0, 12)}…
                    </TableCell>
                    <TableCell className="text-xs">
                      {inv.client?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      {formatBRL(inv.totalValue / 100)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                          STATUS_COLORS[inv.status] ?? "text-gray-600 bg-gray-100",
                        )}
                      >
                        {STATUS_LABELS[inv.status] ?? inv.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {inv.paymentMethods?.list?.join(", ") ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(inv.createdAt)}
                    </TableCell>
                    <TableCell>
                      {inv.linkCheckout && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          asChild
                        >
                          <a
                            href={inv.linkCheckout}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
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
            <Pagination
              page={paginate.page}
              totalPages={paginate.pages}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ")
}
