"use client"

/**
 * ClientQuotes — list of all quote requests submitted by the client.
 *
 * Polish (Nielsen + trust/transparency):
 *  - Page header with quick action (Pedir orçamento — emerald, prominent).
 *  - Status filter tabs with counts (Pendentes, Respondidos, Aprovados,
 *    Rejeitados, Expirados, Todos).
 *  - Quote cards with: provider avatar+name, items summary, created date,
 *    expiry, status badge. Expandable (Collapsible) to show items with the
 *    provider's quoted price + note. The QuoteTimeline is preserved in the
 *    expanded view.
 *  - Actions: Aprovar (emerald), Rejeitar, Ver prestador, Enviar mensagem.
 *  - Pagination (client-side, 8/page).
 */

import * as React from "react"
import {
  useMutation,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query"
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  MapPin,
  MessageSquare,
  Plus,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { apiGet, apiPatch } from "@/lib/api"
import {
  QUOTE_ITEM_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  SERVICE_UNIT_SHORT,
  type QuoteItemStatus,
  type QuoteStatus,
  type ServiceUnit,
} from "@/lib/constants"
import { formatBRL, formatDate, formatDateTime } from "@/lib/format"
import { useUIStore, useViewStore } from "@/store"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  EmptyState,
} from "@/components/shared/dashboard-shell"
import { QuoteTimeline } from "@/components/shared/flow-timeline"
import {
  PageHeader,
  StatusBadge,
  quoteIcon,
  quoteTone,
} from "@/components/client/client-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QuoteItem = {
  id: string
  serviceId: string
  description: string
  quantity: number
  unit: ServiceUnit
  price?: number | null
  providerNote?: string | null
  status: string
  service: { id: string; title: string }
  provider: { id: string; name: string; avatarUrl?: string | null }
}

type QuoteRequest = {
  id: string
  status: QuoteStatus
  address: string
  cep: string
  createdAt: string
  expiresAt: string
  provider: { id: string; name: string; avatarUrl?: string | null }
  items: QuoteItem[]
}

type QuotesResponse = {
  items: QuoteRequest[]
  total: number
  page: number
  limit: number
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

const TABS: Array<{ key: string; label: string }> = [
  { key: "PENDING", label: "Pendentes" },
  { key: "RESPONDED", label: "Respondidos" },
  { key: "APPROVED", label: "Aprovados" },
  { key: "REJECTED", label: "Rejeitados" },
  { key: "EXPIRED", label: "Expirados" },
  { key: "ALL", label: "Todos" },
]

const PAGE_SIZE = 8

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerInitials(name?: string | null): string {
  if (!name) return "P"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientQuotes() {
  const qc = useQueryClient()
  const navigate = useViewStore((s) => s.navigate)
  const openProvider = useUIStore((s) => s.openProvider)
  const openQuote = useUIStore((s) => s.openQuote)

  const [tab, setTab] = React.useState("ALL")
  const [page, setPage] = React.useState(1)

  React.useEffect(() => setPage(1), [tab])

  // Fetch up to 4 pages of 50 (= 200 max) so we can compute accurate counts
  // per status and paginate client-side.
  const queries = useQueries({
    queries: [1, 2, 3, 4].map((p) => ({
      queryKey: ["quotes", "CLIENT", "all", p],
      queryFn: () =>
        apiGet<QuotesResponse>("/api/quotes", {
          role: "CLIENT",
          page: p,
          limit: 50,
        }),
      staleTime: 30_000,
    })),
  })

  const allQuotes = React.useMemo(() => {
    const merged: QuoteRequest[] = []
    for (const q of queries) {
      if (q.data?.items?.length) merged.push(...q.data.items)
    }
    return merged
  }, [queries])

  const isLoading = queries.some((q) => q.isLoading)

  const counts = React.useMemo(() => {
    const map: Record<string, number> = {
      ALL: allQuotes.length,
      PENDING: 0,
      RESPONDED: 0,
      APPROVED: 0,
      REJECTED: 0,
      EXPIRED: 0,
    }
    for (const q of allQuotes) {
      if (map[q.status] != null) map[q.status]!++
    }
    return map
  }, [allQuotes])

  const visible = React.useMemo(() => {
    const filtered =
      tab === "ALL"
        ? allQuotes
        : allQuotes.filter((q) => q.status === tab)
    // Active first (asc by createdAt), terminal last (desc by createdAt).
    const isActive = (s: QuoteStatus) =>
      s === "PENDING" || s === "RESPONDED" || s === "APPROVED"
    return [...filtered].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      const aActive = isActive(a.status)
      const bActive = isActive(b.status)
      if (aActive && bActive) return tb - ta
      if (!aActive && !bActive) return tb - ta
      return aActive ? -1 : 1
    })
  }, [allQuotes, tab])

  const total = visible.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiPatch(`/api/quotes/${id}`, { status: "APPROVED" }),
    onSuccess: () => {
      toast.success("Orçamento aprovado! Você já pode agendar o serviço.")
      qc.invalidateQueries({ queryKey: ["quotes"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
    },
    onError: (e: { message?: string }) =>
      toast.error(e?.message || "Não foi possível aprovar o orçamento."),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      apiPatch(`/api/quotes/${id}`, { status: "REJECTED" }),
    onSuccess: () => {
      toast.success("Orçamento rejeitado.")
      qc.invalidateQueries({ queryKey: ["quotes"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
    },
    onError: (e: { message?: string }) =>
      toast.error(e?.message || "Não foi possível rejeitar o orçamento."),
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orçamentos"
        subtitle="Acompanhe as cotações que você solicitou e aprove a melhor oferta."
        action={
          <Button
            onClick={() => openQuote()}
            className="h-10 gap-2"
          >
            <Plus className="size-4" />
            Pedir orçamento
          </Button>
        }
      />

      {/* Status tabs with counts */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap justify-start gap-1 h-auto p-1 sm:w-auto">
          {TABS.map((t) => {
            const count = counts[t.key] ?? 0
            const active = tab === t.key
            return (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className="h-8 flex-shrink-0 gap-1.5"
              >
                {t.label}
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                    active
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {/* Result count */}
      <p className="text-xs text-muted-foreground">
        {isLoading
          ? "Carregando…"
          : total === 0
            ? "Nenhum orçamento nesta categoria."
            : `Mostrando ${pageItems.length} de ${total} orçamento${total !== 1 ? "s" : ""}.`}
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Carregando orçamentos…
        </div>
      ) : pageItems.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={
            tab === "ALL"
              ? "Você ainda não tem orçamentos"
              : "Nenhum orçamento com este status"
          }
          description={
            tab === "ALL"
              ? "Que tal pedir o primeiro? Encontre um prestador e solicite uma cotação personalizada."
              : "Não há orçamentos com este status no momento. Tente outra categoria."
          }
          action={
            <Button
              onClick={() => openQuote()}
              className="mt-2 gap-2"
            >
              <Plus className="size-4" />
              Pedir orçamento
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {pageItems.map((q) => (
            <QuoteCard
              key={q.id}
              quote={q}
              onApprove={() => approveMutation.mutate(q.id)}
              onReject={() => rejectMutation.mutate(q.id)}
              onViewProvider={() => openProvider(q.provider.id)}
              onMessage={() =>
                navigate("client.messages", { with: q.provider.id })
              }
              isApproving={approveMutation.isPending}
              isRejecting={rejectMutation.isPending}
            />
          ))}
        </div>
      )}

      {total > PAGE_SIZE ? (
        <div className="flex flex-col items-center justify-between gap-2 border-t pt-3 sm:flex-row">
          <p className="text-xs text-muted-foreground tabular-nums">
            Página {page} de {totalPages} · {total} orçamentos
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-9 gap-1"
            >
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <span className="px-2 text-xs text-muted-foreground tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="h-9 gap-1"
            >
              Próxima
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// QuoteCard
// ---------------------------------------------------------------------------

function QuoteCard({
  quote,
  onApprove,
  onReject,
  onViewProvider,
  onMessage,
  isApproving,
  isRejecting,
}: {
  quote: QuoteRequest
  onApprove: () => void
  onReject: () => void
  onViewProvider: () => void
  onMessage: () => void
  isApproving: boolean
  isRejecting: boolean
}) {
  const [open, setOpen] = React.useState(false)

  const provider = quote.provider
  const initials = providerInitials(provider.name)

  const status = quote.status as QuoteStatus
  const totalQuoted = quote.items.reduce(
    (acc, i) => acc + (i.price ?? 0) * i.quantity,
    0,
  )
  const allQuoted = quote.items.every(
    (i) => i.status === "QUOTED" || i.status === "ACCEPTED",
  )
  const canApprove =
    status === "RESPONDED" || (status === "PENDING" && allQuoted)
  const canReject =
    status === "RESPONDED" || status === "PENDING" || status === "APPROVED"
  const isExpired =
    status === "EXPIRED" ||
    (status !== "APPROVED" && new Date(quote.expiresAt).getTime() < Date.now())

  const itemsCount = quote.items.length
  const firstServiceTitle = quote.items[0]?.service?.title ?? "—"

  return (
    <Card className="rounded-xl shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="py-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onViewProvider}
            className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Ver perfil de ${provider.name}`}
          >
            <Avatar className="size-11 border">
              {provider.avatarUrl ? (
                <AvatarImage src={provider.avatarUrl} alt={provider.name} />
              ) : null}
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {initials || "P"}
              </AvatarFallback>
            </Avatar>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onViewProvider}
                className="truncate text-sm font-semibold hover:text-primary focus-visible:underline"
              >
                {provider.name}
              </button>
              <StatusBadge tone={quoteTone(status)} icon={quoteIcon(status)}>
                {QUOTE_STATUS_LABELS[status]}
              </StatusBadge>
              {isExpired && status !== "EXPIRED" ? (
                <StatusBadge tone="zinc" icon={Clock}>
                  Expirado
                </StatusBadge>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {itemsCount} {itemsCount === 1 ? "item" : "itens"} ·{" "}
              {firstServiceTitle}
              {itemsCount > 1 ? ` +${itemsCount - 1}` : ""}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock className="size-3.5 text-primary" />
                Solicitado em {formatDateTime(quote.createdAt)}
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <CalendarClock className="size-3.5" />
                Expira em {formatDate(quote.expiresAt)}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                <span className="max-w-[12rem] truncate">{quote.address}</span>
              </span>
            </div>
          </div>

          {allQuoted && totalQuoted > 0 ? (
            <div className="shrink-0 text-right">
              <p className="text-xs text-muted-foreground">Total orçado</p>
              <p className="text-sm font-semibold tabular-nums">
                {formatBRL(totalQuoted)}
              </p>
            </div>
          ) : null}
        </div>

        {/* Expandable items */}
        <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium text-primary"
            >
              <FileText className="size-3.5" />
              {open
                ? "Ocultar itens"
                : `Ver ${itemsCount} ${itemsCount === 1 ? "item" : "itens"}`}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            {/* Flow transparency — "what happens now" timeline */}
            <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
              <QuoteTimeline status={status} />
            </div>
            <ul className="divide-y rounded-lg border">
              {quote.items.map((it) => {
                const subtotal =
                  it.price != null ? it.price * it.quantity : null
                const itemStatus = it.status as QuoteItemStatus
                return (
                  <li
                    key={it.id}
                    className="grid gap-1 p-3 text-sm sm:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{it.service.title}</p>
                        <StatusBadge tone="zinc" className="text-[10px]">
                          {QUOTE_ITEM_STATUS_LABELS[itemStatus] ?? it.status}
                        </StatusBadge>
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {it.quantity} {SERVICE_UNIT_SHORT[it.unit]} ·{" "}
                        {it.price != null
                          ? `${formatBRL(it.price)} / ${SERVICE_UNIT_SHORT[it.unit]}`
                          : "Aguardando preço"}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {it.description}
                      </p>
                      {it.providerNote ? (
                        <p className="rounded-md bg-muted/50 px-2 py-1 text-xs">
                          <span className="font-medium">
                            Nota do prestador:
                          </span>{" "}
                          {it.providerNote}
                        </p>
                      ) : null}
                    </div>
                    <div className="self-start text-right text-sm">
                      {subtotal != null ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Subtotal
                          </p>
                          <p className="font-semibold tabular-nums">
                            {formatBRL(subtotal)}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>

        {/* Actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewProvider}
            className="h-9 gap-1.5"
          >
            <MapPin className="size-4" />
            Ver prestador
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onMessage}
            className="h-9 gap-1.5"
          >
            <MessageSquare className="size-4" />
            Mensagem
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {canReject ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onReject}
                disabled={isRejecting}
                className="h-9 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {isRejecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <X className="size-4" />
                )}
                Rejeitar
              </Button>
            ) : null}
            {canApprove ? (
              <Button
                size="sm"
                onClick={onApprove}
                disabled={isApproving}
                className="h-9 gap-1.5"
              >
                {isApproving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Aprovar orçamento
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
