"use client"

/**
 * AdminSettlements — gestión de períodos de repasse automáticos.
 *
 * Features:
 * - Lista de períodos de repasse (semanal/mensal)
 * - Geração manual de novo período
 * - Detalhes do período com repasses por prestador
 * - Finalizar período
 * - Marcar repasse individual como pago
 */

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  DollarSign,
  Handshake,
  Loader2,
  Plus,
  UserCircle,
  Wallet,
} from "lucide-react"

import { apiGet, apiPost } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { ErrorState, EmptyState, PageSectionHeader, StatusBadge } from "./_shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PeriodType = "WEEKLY" | "MONTHLY"
type PeriodStatus = "PENDING" | "FINALIZED"
type ProviderSettStatus = "PENDING" | "PAID"

type ProviderSettlement = {
  id: string
  status: ProviderSettStatus
  totalAmount: number
  commission: number
  netAmount: number
  transactionCount: number
  paidAt: string | null
  paidBy: string | null
  provider: {
    id: string
    name: string
    email: string
    avatarUrl: string | null
  }
}

type SettlementPeriodItem = {
  id: string
  type: PeriodType
  status: PeriodStatus
  startDate: string
  endDate: string
  totalAmount: number
  totalCommission: number
  totalNet: number
  providerCount: number
  transactionCount: number
  notes: string | null
  finalizedAt: string | null
  finalizedBy: string | null
  createdAt: string
  providers: ProviderSettlement[]
  _count: { providers: number }
}

type SettlementsResponse = {
  items: SettlementPeriodItem[]
  total: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
}

const PERIOD_TYPE_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: "MONTHLY", label: "Mensal" },
  { value: "WEEKLY", label: "Semanal" },
]

const SETTLEMENT_STATUS_STYLES: Record<PeriodStatus, string> = {
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  FINALIZED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
}

const PROVIDER_STATUS_STYLES: Record<ProviderSettStatus, string> = {
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
}

const PROVIDER_STATUS_LABELS: Record<ProviderSettStatus, string> = {
  PENDING: "Pendente",
  PAID: "Pago",
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminSettlements() {
  const queryClient = useQueryClient()
  const [generateOpen, setGenerateOpen] = React.useState(false)
  const [generateType, setGenerateType] = React.useState<PeriodType>("MONTHLY")
  const [expandedPeriod, setExpandedPeriod] = React.useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "settlements"],
    queryFn: () => apiGet<SettlementsResponse>("/api/admin/settlements"),
    staleTime: 30_000,
  })

  const generateMutation = useMutation({
    mutationFn: (type: PeriodType) =>
      apiPost<{ period: SettlementPeriodItem }>("/api/admin/settlements", {
        type,
      }),
    onSuccess: () => {
      toast.success("Período de repasse gerado com sucesso!")
      setGenerateOpen(false)
      queryClient.invalidateQueries({ queryKey: ["admin", "settlements"] })
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Não foi possível gerar o período de repasse."
      toast.error(msg)
    },
  })

  const finalizeMutation = useMutation({
    mutationFn: (periodId: string) =>
      apiPost<{ period: SettlementPeriodItem }>(`/api/admin/settlements/${periodId}/finalize`, {}),
    onSuccess: () => {
      toast.success("Período finalizado com sucesso!")
      queryClient.invalidateQueries({ queryKey: ["admin", "settlements"] })
    },
    onError: (e: unknown) => toast.error(String(e)),
  })

  const payMutation = useMutation({
    mutationFn: ({ periodId, providerId }: { periodId: string; providerId: string }) =>
      apiPost<{ settlement: ProviderSettlement }>(
        `/api/admin/settlements/${periodId}/pay/${providerId}`,
        {},
      ),
    onSuccess: () => {
      toast.success("Repasse marcado como pago!")
      queryClient.invalidateQueries({ queryKey: ["admin", "settlements"] })
    },
    onError: (e: unknown) => toast.error(String(e)),
  })

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os repasses"
        description="Verifique sua conexão e tente novamente."
        onRetry={() => void refetch()}
      />
    )
  }

  const periods = data?.items ?? []

  return (
    <div className="flex flex-col gap-4">
      <PageSectionHeader
        title="Repasses"
        description="Períodos de repasse automáticos — gere, finalize e marque como pago."
        action={
          <Button size="sm" className="gap-1.5" onClick={() => setGenerateOpen(true)}>
            <Plus className="size-4" />
            Gerar novo período
          </Button>
        }
      />

      {isLoading ? (
        <SettlementsSkeleton />
      ) : periods.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="Nenhum período de repasse"
          description="Gere o primeiro período de repasse para começar."
          action={
            <Button size="sm" className="gap-1.5" onClick={() => setGenerateOpen(true)}>
              <Plus className="size-4" />
              Gerar primeiro período
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {periods.map((period) => {
            const isExpanded = expandedPeriod === period.id
            const paidCount = period.providers.filter((p) => p.status === "PAID").length
            const pendingCount = period.providers.filter((p) => p.status === "PENDING").length

            return (
              <Card key={period.id} className="border-border/50 overflow-hidden rounded-xl border">
                {/* Period header — clickable */}
                <button
                  type="button"
                  onClick={() => setExpandedPeriod(isExpanded ? null : period.id)}
                  className="hover:bg-muted/20 flex w-full items-center justify-between px-5 py-4 text-left transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex size-10 items-center justify-center rounded-lg",
                        period.status === "FINALIZED"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                      )}
                    >
                      {period.status === "FINALIZED" ? (
                        <CheckCircle2 className="size-5" />
                      ) : (
                        <Wallet className="size-5" />
                      )}
                    </span>
                    <div>
                      <p className="text-sm font-semibold">
                        {formatPeriodLabel(period.startDate, period.endDate, period.type)}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {PERIOD_TYPE_LABELS[period.type]} · {period.providerCount} prestador
                        {period.providerCount !== 1 ? "es" : ""} · {period.transactionCount}{" "}
                        transação
                        {period.transactionCount !== 1 ? "ões" : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="hidden items-center gap-3 text-right sm:flex">
                      <div>
                        <p className="text-muted-foreground text-xs">Repasse total</p>
                        <p className="text-sm font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                          {formatBRL(period.totalNet)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Comissão</p>
                        <p className="text-sm font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                          {formatBRL(period.totalCommission)}
                        </p>
                      </div>
                    </div>
                    <StatusBadge tone={period.status === "FINALIZED" ? "emerald" : "amber"}>
                      {period.status === "FINALIZED" ? "Finalizado" : "Pendente"}
                    </StatusBadge>
                    {isExpanded ? (
                      <ChevronUp className="text-muted-foreground size-4" />
                    ) : (
                      <ChevronDown className="text-muted-foreground size-4" />
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-border/50 border-t">
                    {/* Period summary bar */}
                    <div className="border-border/30 bg-muted/20 grid grid-cols-2 gap-4 border-b px-5 py-3 sm:grid-cols-4">
                      <div>
                        <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                          Total recebido
                        </p>
                        <p className="text-sm font-semibold tabular-nums">
                          {formatBRL(period.totalAmount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                          Comissão
                        </p>
                        <p className="text-sm font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                          {formatBRL(period.totalCommission)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                          Repasse líquido
                        </p>
                        <p className="text-sm font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                          {formatBRL(period.totalNet)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                          Status
                        </p>
                        <div className="mt-0.5 flex items-center gap-1">
                          <StatusBadge tone={period.status === "FINALIZED" ? "emerald" : "amber"}>
                            {period.status === "FINALIZED" ? "Finalizado" : "Pendente"}
                          </StatusBadge>
                          {pendingCount > 0 && period.status === "FINALIZED" && (
                            <span className="text-muted-foreground text-[10px]">
                              {paidCount}/{period.providers.length} pagos
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    {period.status === "PENDING" && (
                      <div className="border-border/30 flex items-center justify-end gap-2 border-b px-5 py-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => finalizeMutation.mutate(period.id)}
                          disabled={finalizeMutation.isPending}
                        >
                          {finalizeMutation.isPending ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : null}
                          Finalizar período
                        </Button>
                      </div>
                    )}

                    {/* Per-provider table */}
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30 hover:bg-muted/30 h-10">
                            <TableHead className="text-muted-foreground px-4 text-[10px] font-semibold tracking-wide uppercase">
                              Prestador
                            </TableHead>
                            <TableHead className="text-muted-foreground px-4 text-right text-[10px] font-semibold tracking-wide uppercase">
                              Transações
                            </TableHead>
                            <TableHead className="text-muted-foreground px-4 text-right text-[10px] font-semibold tracking-wide uppercase">
                              Total
                            </TableHead>
                            <TableHead className="text-muted-foreground px-4 text-right text-[10px] font-semibold tracking-wide uppercase">
                              Comissão
                            </TableHead>
                            <TableHead className="text-muted-foreground px-4 text-right text-[10px] font-semibold tracking-wide uppercase">
                              Repasse
                            </TableHead>
                            <TableHead className="text-muted-foreground px-4 text-[10px] font-semibold tracking-wide uppercase">
                              Status
                            </TableHead>
                            {period.status === "FINALIZED" && (
                              <TableHead className="text-muted-foreground px-4 text-[10px] font-semibold tracking-wide uppercase">
                                Ação
                              </TableHead>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {period.providers.map((ps) => (
                            <TableRow
                              key={ps.id}
                              className="hover:bg-muted/20 h-12 transition-colors"
                            >
                              <TableCell className="px-4">
                                <div className="flex items-center gap-2">
                                  <div className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full">
                                    <UserCircle className="size-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium">
                                      {ps.provider.name}
                                    </p>
                                    <p className="text-muted-foreground truncate text-[10px]">
                                      {ps.provider.email}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 text-right text-xs tabular-nums">
                                {ps.transactionCount}
                              </TableCell>
                              <TableCell className="px-4 text-right text-xs font-semibold tabular-nums">
                                {formatBRL(ps.totalAmount)}
                              </TableCell>
                              <TableCell className="px-4 text-right text-xs text-amber-600 tabular-nums dark:text-amber-400">
                                -{formatBRL(ps.commission)}
                              </TableCell>
                              <TableCell className="px-4 text-right text-xs font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                                {formatBRL(ps.netAmount)}
                              </TableCell>
                              <TableCell className="px-4">
                                <span
                                  className={cn(
                                    "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                    PROVIDER_STATUS_STYLES[ps.status],
                                  )}
                                >
                                  {PROVIDER_STATUS_LABELS[ps.status]}
                                </span>
                              </TableCell>
                              {period.status === "FINALIZED" && (
                                <TableCell className="px-4">
                                  {ps.status === "PENDING" ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 gap-1 text-[10px]"
                                      onClick={() =>
                                        payMutation.mutate({
                                          periodId: period.id,
                                          providerId: ps.provider.id,
                                        })
                                      }
                                      disabled={payMutation.isPending}
                                    >
                                      <DollarSign className="size-3" />
                                      Pagar
                                    </Button>
                                  ) : (
                                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                                      {ps.paidAt ? formatDateShort(ps.paidAt) : "Pago"}
                                    </span>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Generate dialog */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Gerar período de repasse</DialogTitle>
            <DialogDescription>
              Cria um novo período de repasse com todos os pagamentos confirmados do período
              selecionado.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <label className="text-muted-foreground text-xs font-medium">Tipo de período</label>
            <div className="bg-muted/50 inline-flex h-9 items-center rounded-lg border p-0.5">
              {PERIOD_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setGenerateType(opt.value)}
                  className={cn(
                    "h-7 flex-1 rounded-md px-3 text-xs font-medium transition-colors",
                    generateType === opt.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGenerateOpen(false)}
              disabled={generateMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => generateMutation.mutate(generateType)}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Calendar className="size-4" />
              )}
              Gerar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPeriodLabel(startIso: string, endIso: string, type: PeriodType): string {
  try {
    const start = new Date(startIso)
    const end = new Date(endIso)
    end.setDate(end.getDate() - 1) // Show last day of period

    if (type === "MONTHLY") {
      return start.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      })
    }

    return `${start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} - ${end.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}`
  } catch {
    return `${startIso} — ${endIso}`
  }
}

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SettlementsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  )
}
