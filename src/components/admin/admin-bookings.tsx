"use client"

/**
 * AdminBookings — read-only oversight of all bookings (admin).
 *
 * Data source: GET /api/bookings?role=ADMIN&status=&page=
 *              GET /api/admin/stats  (bookingsByStatus — para contagens nas Tabs)
 *
 * Nielsen heuristics covered (design system em admin-shared.tsx):
 *   H1 — TableSkeleton / ErrorState com retry / contagens por status nas Tabs
 *        (mostra "?" enquanto stats carrega) / ResultCount contextual
 *   H2 — Labels pt-BR no domínio (agendamento, prestador, valor, pagamento)
 *   H3 — Dialog de detalhe abre no click da linha (liberdade de explorar)
 *   H4 — CRITICAL FIX: REMOVIDO o STATUS_BADGE_CLS / PAYMENT_BADGE_CLS local
 *        que divergia de BOOKING_STATUS_COLORS (constants.ts).
 *        Agora UMA única source of truth: BookingStatusBadge + PaymentStatusBadge
 *        do admin-shared.tsx — mesma cor em admin-dashboard e admin-bookings.
 *   H5 — N/A (read-only; sem toggles destrutivos)
 *   H6 — Linhas CLICÁVEIS abrem Dialog de detalhe (reconhecimento > memorização)
 *        Cursor pointer + hint visual no hover; ⋮ não é mais a única ação
 *   H7 — SearchInput filtra por cliente, prestador ou serviço (client-side)
 *        Hint H2 "Busca aplicada apenas à página atual"
 *   H8 — Tabs simplificadas (label + count, sem ícone redundante).
 *        O badge de Status na tabela mantém ícone para varredura visual rápida
 *   H9 — ErrorState com onRetry=refetch
 *   H10— Tooltip "Ver detalhes" no hover da linha; Dialog acessível (focus trap)
 */

import * as React from "react"
import {
  CalendarCheck,
  CalendarDays,
  CreditCard,
  MapPin,
  SearchX,
  ShieldQuestion,
  X,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/constants"
import { formatBRL, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import {
  BookingStatusBadge,
  EmptyState,
  ErrorState,
  FilterBar,
  initials,
  PageSectionHeader,
  Pagination,
  PaymentStatusBadge,
  ResultCount,
  SearchInput,
  TableSkeleton,
} from "./admin-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AdminBooking = {
  id: string
  status: BookingStatus
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  amount: number
  scheduledAt: string
  createdAt: string
  address?: string | null
  service?: { id: string; title: string } | null
  client?: { id: string; name: string; avatarUrl?: string | null } | null
  provider?: { id: string; name: string; avatarUrl?: string | null } | null
}

type AdminBookingsResponse = {
  items: AdminBooking[]
  total: number
  page: number
  limit: number
}

type StatsResponse = {
  bookingsByStatus: Record<string, number>
}

type StatusFilter = "ALL" | BookingStatus

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function AdminBookings() {
  const [status, setStatus] = React.useState<StatusFilter>("ALL")
  const [page, setPage] = React.useState(1)
  const [q, setQ] = React.useState("")
  const [detail, setDetail] = React.useState<AdminBooking | null>(null)
  const limit = 12

  // Per-status counts (H1) — mesmo cache do dashboard (60s)
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => apiGet<StatsResponse>("/api/admin/stats"),
    staleTime: 60_000,
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "bookings", { status, page, limit }],
    queryFn: () =>
      apiGet<AdminBookingsResponse>("/api/bookings", {
        role: "ADMIN",
        ...(status !== "ALL" ? { status } : {}),
        page,
        limit,
      }),
    staleTime: 15_000,
  })

  const rawItems = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  // H7 — busca client-side por cliente, prestador ou serviço
  const query = q.trim().toLowerCase()
  const items = React.useMemo(() => {
    if (!query) return rawItems
    return rawItems.filter((b) => {
      const client = b.client?.name?.toLowerCase() ?? ""
      const provider = b.provider?.name?.toLowerCase() ?? ""
      const service = b.service?.title?.toLowerCase() ?? ""
      return (
        client.includes(query) ||
        provider.includes(query) ||
        service.includes(query)
      )
    })
  }, [rawItems, query])

  // H1 — contagens por status vindas do /api/admin/stats
  const statusCounts = React.useMemo(() => {
    const by = stats?.bookingsByStatus ?? {}
    const sum = Object.values(by).reduce((a, b) => a + (b ?? 0), 0)
    return { ALL: sum, ...by } as Record<StatusFilter, number>
  }, [stats])

  const activeFilterCount = (status !== "ALL" ? 1 : 0) + (query ? 1 : 0)
  const clearFilters = () => {
    setStatus("ALL")
    setQ("")
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageSectionHeader
        title="Agendamentos"
        description="Acompanhe todos os agendamentos da plataforma (somente leitura)."
      />

      {/* Status tabs — simplified (label + count, sem ícone redundante — H8) */}
      <Tabs
        value={status}
        onValueChange={(v) => {
          setStatus(v as StatusFilter)
          setPage(1)
        }}
      >
        <TabsList className="h-auto flex-wrap gap-1 bg-card p-1 shadow-sm">
          <TabsTrigger
            value="ALL"
            className="h-8 gap-1.5 rounded-md px-3 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Todos
            <CountBadge
              loading={statsLoading}
              count={statusCounts.ALL}
              active={status === "ALL"}
            />
          </TabsTrigger>
          {(Object.keys(BOOKING_STATUS_LABELS) as BookingStatus[]).map((s) => (
            <TabsTrigger
              key={s}
              value={s}
              className="h-8 gap-1.5 rounded-md px-3 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              {BOOKING_STATUS_LABELS[s]}
              <CountBadge
                loading={statsLoading}
                count={statusCounts[s] ?? 0}
                active={status === s}
              />
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Filter bar (H4 + H7) */}
      <FilterBar
        onClear={clearFilters}
        activeCount={activeFilterCount}
        resultCount={total}
        resultLabel={
          total === 1 ? "agendamento no total" : "agendamentos no total"
        }
      >
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Buscar por cliente, prestador ou serviço"
          className="min-w-[220px] flex-1"
        />
      </FilterBar>

      {/* Honestidade H2 — busca é client-side na página atual */}
      {query ? (
        <span className="-mt-2 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
          <ShieldQuestion className="size-3" />
          Busca aplicada apenas à página atual
        </span>
      ) : null}

      {/* Table area: error / loading / empty / table */}
      {isError ? (
        <ErrorState
          title="Não foi possível carregar os agendamentos"
          description="Verifique se você está autenticado como administrador e tente novamente."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <TableSkeleton rows={8} cols={7} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nenhum agendamento encontrado"
          description={
            status !== "ALL"
              ? `Não há agendamentos com status "${BOOKING_STATUS_LABELS[status as BookingStatus]}".`
              : query
                ? "Nenhum agendamento corresponde à busca nesta página."
                : "Os novos agendamentos aparecerão aqui."
          }
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
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="h-11 bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Cliente
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Prestador
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground md:table-cell">
                      Serviço
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:table-cell">
                      Agendado para
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Valor
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="hidden text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">
                      Pagamento
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((b) => (
                    <Tooltip key={b.id}>
                      <TooltipTrigger asChild>
                        <TableRow
                          onClick={() => setDetail(b)}
                          className="h-14 cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none"
                        >
                          <TableCell className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-9 shrink-0">
                                {b.client?.avatarUrl ? (
                                  <AvatarImage
                                    src={b.client.avatarUrl}
                                    alt={b.client.name ?? ""}
                                  />
                                ) : null}
                                <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                                  {initials(b.client?.name ?? "?")}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate text-sm font-medium">
                                {b.client?.name ?? "—"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-9 shrink-0">
                                {b.provider?.avatarUrl ? (
                                  <AvatarImage
                                    src={b.provider.avatarUrl}
                                    alt={b.provider.name ?? ""}
                                  />
                                ) : null}
                                <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                                  {initials(b.provider?.name ?? "?")}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate text-sm">
                                {b.provider?.name ?? "—"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="hidden px-4 py-3 text-sm md:table-cell">
                            {b.service?.title ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden px-4 py-3 lg:table-cell">
                            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                              <CalendarDays className="size-3.5 text-muted-foreground" />
                              <span className="tabular-nums">
                                {formatDateTime(b.scheduledAt)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-3 text-right">
                            <span className="text-sm font-semibold tabular-nums text-foreground">
                              {formatBRL(b.amount)}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-3">
                            {/* H4 — UMA source of truth: BookingStatusBadge */}
                            <BookingStatusBadge status={b.status} />
                          </TableCell>
                          <TableCell className="hidden px-4 py-3 sm:table-cell">
                            <div className="flex flex-col gap-0.5">
                              <PaymentStatusBadge status={b.paymentStatus} />
                              <span className="text-[10px] text-muted-foreground">
                                {PAYMENT_METHOD_LABELS[b.paymentMethod] ??
                                  b.paymentMethod}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Ver detalhes do agendamento
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Result count + Pagination (H1 + H7) */}
            <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 sm:flex-row">
              <ResultCount
                page={page}
                limit={limit}
                total={total}
                label="agendamentos"
              />
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* H6 — Booking detail dialog */}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="size-5 text-primary" />
              Detalhes do agendamento
            </DialogTitle>
            <DialogDescription>
              Informações completas do agendamento selecionado.
            </DialogDescription>
          </DialogHeader>

          {detail ? (
            <div className="space-y-4">
              {/* Status + Payment row */}
              <div className="flex flex-wrap items-center gap-2">
                <BookingStatusBadge status={detail.status} />
                <PaymentStatusBadge status={detail.paymentStatus} />
              </div>

              {/* People */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DetailField
                  label="Cliente"
                  value={detail.client?.name ?? "—"}
                  avatarUrl={detail.client?.avatarUrl}
                />
                <DetailField
                  label="Prestador"
                  value={detail.provider?.name ?? "—"}
                  avatarUrl={detail.provider?.avatarUrl}
                />
              </div>

              {/* Service + value */}
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Serviço
                </p>
                <p className="mt-0.5 text-sm font-medium text-foreground">
                  {detail.service?.title ?? "—"}
                </p>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Valor
                </p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
                  {formatBRL(detail.amount)}
                </p>
              </div>

              {/* Schedule */}
              <div className="space-y-2">
                <DetailRow
                  icon={CalendarDays}
                  label="Agendado para"
                  value={formatDateTime(detail.scheduledAt)}
                />
                <DetailRow
                  icon={CreditCard}
                  label="Pagamento"
                  value={
                    PAYMENT_METHOD_LABELS[detail.paymentMethod] ??
                    detail.paymentMethod
                  }
                />
                {detail.address ? (
                  <DetailRow
                    icon={MapPin}
                    label="Endereço"
                    value={detail.address}
                  />
                ) : null}
                <DetailRow
                  icon={CalendarCheck}
                  label="Criado em"
                  value={formatDateTime(detail.createdAt)}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDetail(null)}
              className="gap-1.5"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CountBadge({
  loading,
  count,
  active,
}: {
  loading: boolean
  count: number
  active: boolean
}) {
  return (
    <span
      className={cn(
        "ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
        active
          ? "bg-primary-foreground/20 text-primary-foreground"
          : "bg-muted text-muted-foreground",
      )}
      aria-label={loading ? "carregando contagem" : `${count} agendamentos`}
    >
      {loading ? "?" : count}
    </span>
  )
}

function DetailField({
  label,
  value,
  avatarUrl,
}: {
  label: string
  value: string
  avatarUrl?: string | null
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <Avatar className="size-7 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={value} /> : null}
          <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
            {initials(value)}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-sm font-medium text-foreground">
          {value}
        </span>
      </div>
    </div>
  )
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-sm text-foreground">{value}</p>
      </div>
    </div>
  )
}
