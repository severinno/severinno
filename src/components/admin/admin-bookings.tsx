"use client"

/**
 * AdminBookings — read-only oversight of all bookings (admin).
 *
 * Data source: GET /api/bookings?role=ADMIN&status=&page=
 * (admin sees all bookings — no edit. Oversight only.)
 *
 * Status filter is a pill segmented control. Pagination hidden when only
 * one page. The breadcrumb is provided by the shell — this view does not
 * duplicate it.
 */

import * as React from "react"
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Loader,
  CalendarDays,
  type LucideIcon,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/lib/api"
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type BookingStatus,
  type PaymentStatus,
  type PaymentMethod,
} from "@/lib/constants"
import { formatBRL, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"

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

type StatusFilter = "ALL" | BookingStatus

// ---------------------------------------------------------------------------
// Status badge system — emerald (success) / amber (pending) / rose (error)
// / slate (neutral) / teal (in_progress). Blue is forbidden.
// ---------------------------------------------------------------------------
const STATUS_BADGE_CLS: Record<BookingStatus, string> = {
  PENDING:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300",
  CONFIRMED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  IN_PROGRESS:
    "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/40 dark:bg-teal-950/30 dark:text-teal-300",
  COMPLETED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  CANCELLED:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300",
}

const STATUS_ICON: Record<BookingStatus, LucideIcon> = {
  PENDING: Clock,
  CONFIRMED: CheckCircle2,
  IN_PROGRESS: Loader,
  COMPLETED: CheckCircle2,
  CANCELLED: XCircle,
}

const PAYMENT_BADGE_CLS: Record<PaymentStatus, string> = {
  PENDING:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300",
  PAID: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  REFUNDED:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300",
}

export function AdminBookings() {
  const [status, setStatus] = React.useState<StatusFilter>("ALL")
  const [page, setPage] = React.useState(1)
  const limit = 12

  const { data, isLoading, isError } = useQuery({
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

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="flex flex-col gap-4">
      {/* Status tabs — pill segmented control */}
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
          </TabsTrigger>
          {(Object.keys(BOOKING_STATUS_LABELS) as BookingStatus[]).map((s) => {
            const Icon = STATUS_ICON[s]
            return (
              <TabsTrigger
                key={s}
                value={s}
                className="h-8 gap-1.5 rounded-md px-3 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <Icon className="size-3.5" />
                {BOOKING_STATUS_LABELS[s]}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {/* Result count */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total > 0
            ? `Mostrando ${(page - 1) * limit + 1}–${Math.min(
                page * limit,
                total,
              )} de ${total.toLocaleString("pt-BR")} agendamento(s)`
            : "Nenhum agendamento"}
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          <CalendarCheck className="size-3 text-primary" />
          {total.toLocaleString("pt-BR")} no total
        </span>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">
                <CalendarCheck className="size-6" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  Não foi possível carregar os agendamentos
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Verifique se você está autenticado como administrador.
                </p>
              </div>
            </div>
          ) : (
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
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i} className="h-14">
                        <TableCell colSpan={7}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : items.length === 0 ? (
                    <TableRow className="h-14 hover:bg-transparent">
                      <TableCell colSpan={7} className="py-12">
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <CalendarCheck className="size-7" />
                          </div>
                          <div>
                            <p className="text-base font-semibold">
                              Nenhum agendamento encontrado
                            </p>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {status !== "ALL"
                                ? `Não há agendamentos com status "${BOOKING_STATUS_LABELS[status as BookingStatus]}".`
                                : "Os novos agendamentos aparecerão aqui."}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((b) => {
                      const StatusIcon = STATUS_ICON[b.status]
                      return (
                        <TableRow
                          key={b.id}
                          className="h-14 border-b transition-colors last:border-0 hover:bg-muted/30"
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
                            <Badge
                              variant="outline"
                              className={cn(
                                "gap-1 text-[10px] font-medium",
                                STATUS_BADGE_CLS[b.status],
                              )}
                            >
                              <StatusIcon
                                className={cn(
                                  "size-3",
                                  b.status === "IN_PROGRESS" && "animate-spin",
                                )}
                              />
                              {BOOKING_STATUS_LABELS[b.status] ?? b.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden px-4 py-3 sm:table-cell">
                            <div className="flex flex-col gap-0.5">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "w-fit gap-1 text-[10px] font-medium",
                                  PAYMENT_BADGE_CLS[b.paymentStatus],
                                )}
                              >
                                {PAYMENT_STATUS_LABELS[b.paymentStatus] ??
                                  b.paymentStatus}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">
                                {PAYMENT_METHOD_LABELS[b.paymentMethod] ??
                                  b.paymentMethod}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination — hidden when only 1 page */}
          {totalPages > 1 ? (
            <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 sm:flex-row">
              <p className="text-xs text-muted-foreground tabular-nums">
                Página {page} de {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 gap-1"
                >
                  <ChevronLeft className="size-4" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-8 gap-1"
                >
                  Próxima
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function initials(name: string): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
