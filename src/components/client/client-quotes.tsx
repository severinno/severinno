"use client"

/**
 * ClientQuotes — Clean, minimalist in-panel quote request management.
 *
 * Allows clients to request, compare, approve and schedule custom service
 * quotes with transparent labor/materials breakdown and Escrow guarantee.
 *
 * Capabilities:
 *  - Modern Hero Banner with platform guarantee and quick actions
 *  - Segmented status tabs with live counts (Todos, Pendentes, Respondidos, Aprovados, Rejeitados, Expirados)
 *  - Quick in-list search by provider or service title
 *  - Persuasive Service Design empty state with 3-step value guide
 *  - Quote cards with:
 *    - 100% round avatars (rounded-full)
 *    - Contextual status reassurance banners (awaiting decision, ready to schedule, expired, etc.)
 *    - Flow timeline (QuoteTimeline) in collapsible items view
 *    - Transparent quote breakdown button (labor vs materials)
 *    - Direct "Agendar Atendimento" CTA upon approval
 *    - Strict platform messaging (client.messages) with zero WhatsApp leaks
 */

import * as React from "react"
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query"
import {
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  FileText,
  LayoutGrid,
  Loader2,
  MapPin,
  MessageSquare,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { apiGet, apiPatch } from "@/lib/api"
import { TransparentQuoteModal } from "@/components/shared/transparent-quote-modal"
import {
  parseTransparentQuoteNote,
  type TransparentQuoteBreakdown,
} from "@/lib/materials-breakdown"
import {
  QUOTE_ITEM_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  SERVICE_UNIT_SHORT,
  type QuoteItemStatus,
  type QuoteStatus,
  type ServiceUnit,
} from "@/lib/constants"
import { formatBRL, formatDate, formatDateTime } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { QuoteTimeline } from "@/components/shared/flow-timeline"
import { StatusBadge, quoteIcon, quoteTone } from "@/components/client/client-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuoteItem = {
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

export type QuoteRequest = {
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

const TABS: Array<{ key: string; label: string; icon: React.ElementType }> = [
  { key: "ALL", label: "Todos", icon: LayoutGrid },
  { key: "PENDING", label: "Pendentes", icon: Clock },
  { key: "RESPONDED", label: "Respondidos", icon: CheckCircle2 },
  { key: "APPROVED", label: "Aprovados", icon: Sparkles },
  { key: "REJECTED", label: "Rejeitados", icon: XCircle },
  { key: "EXPIRED", label: "Expirados", icon: CalendarClock },
]

const PAGE_SIZE = 8

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerInitials(name?: string | null): string {
  if (!name) return "PR"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

/**
 * `useNow` — a re-rendering clock.
 *
 * Returns the current epoch ms and refreshes every `intervalMs`.
 * Cards use it to compute "expired" state without calling impure `Date.now()`.
 */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientQuotes() {
  const qc = useQueryClient()
  const navigate = useViewStore((s) => s.navigate)
  const openProvider = useUIStore((s) => s.openProvider)
  const openQuote = useUIStore((s) => s.openQuote)
  const openBooking = useUIStore((s) => s.openBooking)

  const [tab, setTab] = React.useState("ALL")
  const [filterText, setFilterText] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [viewBreakdownItem, setViewBreakdownItem] = React.useState<{
    title: string
    category?: string
    breakdown: TransparentQuoteBreakdown
  } | null>(null)

  React.useEffect(() => {
    setPage(1)
  }, [tab, filterText])

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
    let filtered = tab === "ALL" ? allQuotes : allQuotes.filter((q) => q.status === tab)

    if (filterText.trim()) {
      const q = filterText.toLowerCase().trim()
      filtered = filtered.filter(
        (item) =>
          item.provider.name.toLowerCase().includes(q) ||
          item.items.some((it) => it.service.title.toLowerCase().includes(q)) ||
          item.address.toLowerCase().includes(q),
      )
    }

    // Active first (asc by createdAt), terminal last (desc by createdAt).
    const isActive = (s: QuoteStatus) => s === "PENDING" || s === "RESPONDED" || s === "APPROVED"
    return [...filtered].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      const aActive = isActive(a.status)
      const bActive = isActive(b.status)
      if (aActive && bActive) return tb - ta
      if (!aActive && !bActive) return tb - ta
      return aActive ? -1 : 1
    })
  }, [allQuotes, tab, filterText])

  const total = visible.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiPatch(`/api/quotes/${id}`, { status: "APPROVED" }),
    onSuccess: (_, id) => {
      toast.success("Orçamento aprovado! Você já pode agendar o atendimento.")
      qc.invalidateQueries({ queryKey: ["quotes"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })

      // Suggest direct booking
      const q = allQuotes.find((it) => it.id === id)
      if (q) {
        openBooking({ providerId: q.provider.id, serviceId: q.items[0]?.serviceId })
      }
    },
    onError: (e: { message?: string }) =>
      toast.error(e?.message || "Não foi possível aprovar o orçamento."),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiPatch(`/api/quotes/${id}`, { status: "REJECTED" }),
    onSuccess: () => {
      toast.success("Orçamento rejeitado.")
      qc.invalidateQueries({ queryKey: ["quotes"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
    },
    onError: (e: { message?: string }) =>
      toast.error(e?.message || "Não foi possível rejeitar o orçamento."),
  })

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="border-border/60 from-card via-card/95 to-primary/5 relative overflow-hidden rounded-3xl border bg-gradient-to-br p-5 shadow-xs sm:p-7">
        <div className="bg-primary/10 pointer-events-none absolute -top-24 -right-24 size-80 rounded-full blur-3xl" />

        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <div className="bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold">
              <Sparkles className="size-3.5" />
              <span>Cotações Inteligentes & Orçamento Transparente</span>
            </div>
            <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
              Orçamentos
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Acompanhe as cotações que você solicitou e aprove a melhor oferta.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            <Button
              onClick={() => {
                triggerHaptic("selection")
                openQuote()
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 gap-2 rounded-2xl px-4 text-xs font-semibold shadow-xs transition-all active:scale-95"
            >
              <Plus className="size-4" />
              Pedir orçamento
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.providers")
              }}
              className="border-border/60 hover:bg-muted/60 h-10 gap-2 rounded-2xl px-4 text-xs font-semibold shadow-xs transition-all active:scale-95"
            >
              <MapPin className="text-primary size-4" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      {/* Status Segmented Rail + Search Filter */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Status Pills */}
        <div className="-mx-1 flex scrollbar-none gap-1.5 overflow-x-auto px-1 pb-1">
          {TABS.map((t) => {
            const count = counts[t.key] ?? 0
            const active = tab === t.key
            const Icon = t.icon
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  setTab(t.key)
                }}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2 rounded-xl px-3.5 text-xs font-medium transition-all active:scale-95",
                  active
                    ? "bg-primary text-primary-foreground ring-primary/20 font-semibold shadow-xs ring-2"
                    : "border-border/60 bg-card hover:bg-muted/70 text-muted-foreground hover:text-foreground border",
                )}
              >
                <Icon
                  className={cn(
                    "size-3.5",
                    active ? "text-primary-foreground" : "text-muted-foreground",
                  )}
                />
                <span>{t.label}</span>
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                    active
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Quick Search inside Quotes */}
        {allQuotes.length > 0 && (
          <div className="relative min-w-[220px] sm:w-72">
            <Search className="text-muted-foreground/60 pointer-events-none absolute top-2.5 left-3 size-4" />
            <Input
              type="text"
              placeholder="Filtrar por prestador ou serviço..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="border-border/60 bg-background h-9 rounded-xl pr-8 pl-9 text-xs"
            />
            {filterText && (
              <button
                type="button"
                onClick={() => setFilterText("")}
                className="text-muted-foreground hover:text-foreground absolute top-2.5 right-2.5 p-0.5"
                title="Limpar filtro"
                aria-label="Limpar filtro"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Results Counter & Reassurance Badge */}
      <div className="text-muted-foreground flex flex-col justify-between gap-2 px-1 text-xs sm:flex-row sm:items-center">
        <div>
          {isLoading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="text-primary size-3.5 animate-spin" />
              Carregando orçamentos...
            </span>
          ) : total === 0 ? (
            <span>Nenhum orçamento nesta categoria.</span>
          ) : (
            <span>
              Mostrando{" "}
              <strong className="text-foreground font-semibold">{pageItems.length}</strong> de{" "}
              <strong className="text-foreground font-semibold">{total}</strong>{" "}
              {total === 1 ? "orçamento" : "orçamentos"}.
            </span>
          )}
        </div>

        <div className="hidden items-center gap-1.5 font-medium text-emerald-700 sm:flex dark:text-emerald-400">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          <span>🛡️ Orçamentos Protegidos · Sem Cobrança Antecipada</span>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-border/60 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center gap-4">
                <div className="bg-muted size-13 animate-pulse rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="bg-muted h-4 w-48 rounded" />
                  <div className="bg-muted h-3 w-32 rounded" />
                </div>
                <div className="bg-muted h-6 w-20 rounded" />
              </div>
            </Card>
          ))}
        </div>
      ) : pageItems.length === 0 ? (
        /* Enhanced Service Design Empty State */
        <Card className="border-border/70 rounded-3xl border-dashed p-6 text-center sm:p-10">
          <CardContent className="flex flex-col items-center justify-center space-y-4 p-0">
            <div className="bg-primary/10 text-primary flex size-16 items-center justify-center rounded-2xl shadow-xs">
              <FileText className="size-8" />
            </div>
            <div className="space-y-1.5 text-center">
              <h3 className="text-foreground text-lg font-bold">
                {tab === "ALL"
                  ? "Você ainda não tem orçamentos"
                  : "Nenhum orçamento nesta categoria"}
              </h3>
              <p className="text-muted-foreground max-w-lg text-xs sm:text-sm">
                {tab === "ALL"
                  ? "Que tal pedir o primeiro? Encontre um prestador e solicite uma cotação personalizada."
                  : "Não há orçamentos com este status no momento. Tente outra categoria ou solicite uma nova cotação."}
              </p>
            </div>

            {/* 3 Step Service Guide */}
            {tab === "ALL" && (
              <div className="grid w-full max-w-2xl gap-3 pt-2 text-left sm:grid-cols-3">
                <div className="border-border/60 bg-muted/20 space-y-1.5 rounded-2xl border p-3.5">
                  <div className="text-foreground flex items-center gap-2 text-xs font-bold">
                    <span className="bg-primary/15 text-primary flex size-5 items-center justify-center rounded-full text-[11px]">
                      1
                    </span>
                    <span>Descreva o que precisa</span>
                  </div>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    Indique o serviço, endereço e detalhes do trabalho a ser realizado.
                  </p>
                </div>

                <div className="border-border/60 bg-muted/20 space-y-1.5 rounded-2xl border p-3.5">
                  <div className="text-foreground flex items-center gap-2 text-xs font-bold">
                    <span className="bg-primary/15 text-primary flex size-5 items-center justify-center rounded-full text-[11px]">
                      2
                    </span>
                    <span>Proposta Transparente</span>
                  </div>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    Receba orçamentos com divisão clara de mão de obra e materiais.
                  </p>
                </div>

                <div className="border-border/60 bg-muted/20 space-y-1.5 rounded-2xl border p-3.5">
                  <div className="text-foreground flex items-center gap-2 text-xs font-bold">
                    <span className="bg-primary/15 text-primary flex size-5 items-center justify-center rounded-full text-[11px]">
                      3
                    </span>
                    <span>Garantia & Escrow</span>
                  </div>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    Aprove e agende com pagamento protegido até a entrega do serviço.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
              <Button
                onClick={() => {
                  triggerHaptic("selection")
                  openQuote()
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 gap-2 rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-95"
              >
                <Plus className="size-4" />
                Pedir orçamento
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  triggerHaptic("selection")
                  navigate("client.providers")
                }}
                className="border-border/60 hover:bg-muted/60 h-10 gap-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
              >
                <MapPin className="text-primary size-4" />
                Explorar Prestadores
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {pageItems.map((q) => (
            <QuoteCard
              key={q.id}
              quote={q}
              onApprove={() => approveMutation.mutate(q.id)}
              onReject={() => rejectMutation.mutate(q.id)}
              onViewProvider={() => openProvider(q.provider.id)}
              onSchedule={() =>
                openBooking({ providerId: q.provider.id, serviceId: q.items[0]?.serviceId })
              }
              onMessage={() =>
                navigate("client.messages", {
                  with: q.provider.id,
                  peerId: q.provider.id,
                  providerId: q.provider.id,
                })
              }
              onViewBreakdown={(info) => setViewBreakdownItem(info)}
              isApproving={approveMutation.isPending}
              isRejecting={rejectMutation.isPending}
            />
          ))}
        </div>
      )}

      {total > PAGE_SIZE ? (
        <div className="border-border/50 flex flex-col items-center justify-between gap-2 border-t pt-4 sm:flex-row">
          <p className="text-muted-foreground text-xs tabular-nums">
            Página <strong className="text-foreground">{page}</strong> de{" "}
            <strong className="text-foreground">{totalPages}</strong> · {total} orçamentos
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                triggerHaptic("selection")
                setPage((p) => Math.max(1, p - 1))
              }}
              className="h-9 gap-1 rounded-xl"
            >
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <span className="text-muted-foreground px-2 text-xs font-semibold tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => {
                triggerHaptic("selection")
                setPage((p) => p + 1)
              }}
              className="h-9 gap-1 rounded-xl"
            >
              Próxima
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* Transparent Quote Breakdown Modal (Client View) */}
      {viewBreakdownItem && (
        <TransparentQuoteModal
          open={!!viewBreakdownItem}
          onOpenChange={(o) => !o && setViewBreakdownItem(null)}
          mode="view"
          serviceTitle={viewBreakdownItem.title}
          serviceCategory={viewBreakdownItem.category}
          initialBreakdown={viewBreakdownItem.breakdown}
        />
      )}
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
  onSchedule,
  onMessage,
  onViewBreakdown,
  isApproving,
  isRejecting,
}: {
  quote: QuoteRequest
  onApprove: () => void
  onReject: () => void
  onViewProvider: () => void
  onSchedule?: () => void
  onMessage: () => void
  onViewBreakdown?: (info: {
    title: string
    category?: string
    breakdown: TransparentQuoteBreakdown
  }) => void
  isApproving: boolean
  isRejecting: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const now = useNow()

  const provider = quote.provider
  const initials = providerInitials(provider.name)

  const status = quote.status as QuoteStatus
  const totalQuoted = quote.items.reduce((acc, i) => acc + (i.price ?? 0) * i.quantity, 0)
  const allQuoted = quote.items.every((i) => i.status === "QUOTED" || i.status === "ACCEPTED")
  const canApprove = status === "RESPONDED" || (status === "PENDING" && allQuoted)
  const canReject = status === "RESPONDED" || status === "PENDING" || status === "APPROVED"
  const isExpired =
    status === "EXPIRED" || (status !== "APPROVED" && new Date(quote.expiresAt).getTime() < now)

  const itemsCount = quote.items.length
  const firstServiceTitle = quote.items[0]?.service?.title ?? "—"

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 relative overflow-hidden rounded-2xl shadow-xs transition-all duration-200 hover:shadow-md">
      <CardContent className="space-y-4 p-4 sm:p-5">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            {/* Round Avatar */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-2 transition-transform duration-200 outline-none hover:scale-105 focus-visible:ring-2"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/40 size-13 rounded-full border shadow-xs">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials || "PR"}
                </AvatarFallback>
              </Avatar>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-base font-bold tracking-tight transition-colors focus-visible:underline"
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

              <p className="text-foreground/90 mt-1 truncate text-sm font-medium">
                {itemsCount} {itemsCount === 1 ? "serviço solicitado" : "serviços solicitados"} ·{" "}
                <span className="text-muted-foreground">{firstServiceTitle}</span>
                {itemsCount > 1 ? ` (+${itemsCount - 1})` : ""}
              </p>

              <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <Clock className="text-primary size-3.5" />
                  Solicitado em {formatDateTime(quote.createdAt)}
                </span>
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <CalendarClock className="text-primary size-3.5" />
                  Expira em {formatDate(quote.expiresAt)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="text-primary/70 size-3.5" />
                  <span className="max-w-[14rem] truncate">{quote.address}</span>
                </span>
              </div>
            </div>
          </div>

          {allQuoted && totalQuoted > 0 ? (
            <div className="flex shrink-0 flex-col sm:items-end">
              <span className="text-muted-foreground text-xs font-medium">Total orçado</span>
              <span className="text-foreground text-lg font-bold tracking-tight tabular-nums sm:text-xl">
                {formatBRL(totalQuoted)}
              </span>
            </div>
          ) : (
            <div className="flex shrink-0 flex-col sm:items-end">
              <span className="text-muted-foreground text-xs">Status da cotação</span>
              <span className="text-muted-foreground text-xs font-medium">Aguardando preços</span>
            </div>
          )}
        </div>

        {/* Contextual Reassurance Banner */}
        {status === "APPROVED" ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200/60 bg-emerald-50/50 p-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                Orçamento aprovado por você! Escolha o horário de atendimento para agendar.
              </span>
            </div>
            <span className="hidden font-bold text-emerald-700 sm:inline dark:text-emerald-300">
              Pronto para agendar
            </span>
          </div>
        ) : status === "RESPONDED" ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-blue-200/60 bg-blue-50/50 p-2.5 text-xs font-medium text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200">
            <div className="flex items-center gap-2">
              <FileText className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <span>
                O prestador enviou a proposta de valores. Revise os itens abaixo e aprove para
                agendar.
              </span>
            </div>
            <span className="font-bold text-blue-700 dark:text-blue-300">Aguardando aprovação</span>
          </div>
        ) : status === "PENDING" ? (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200/60 bg-amber-50/40 p-2.5 text-xs font-medium text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
            <Clock className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Aguardando o prestador analisar sua solicitação e formalizar a cotação com prazo e
              valores.
            </span>
          </div>
        ) : status === "REJECTED" ? (
          <div className="border-border/50 bg-muted/30 text-muted-foreground flex items-center gap-2 rounded-xl border p-2.5 text-xs font-medium">
            <XCircle className="size-4 shrink-0 text-rose-500" />
            <span>Orçamento rejeitado · Você pode solicitar uma nova cotação quando desejar.</span>
          </div>
        ) : null}

        {/* Expandable items with flow transparency */}
        <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => triggerHaptic("selection")}
              className="text-primary hover:bg-primary/10 h-8 gap-1.5 rounded-xl px-2.5 text-xs font-semibold"
            >
              <FileText className="size-3.5" />
              <span>
                {open
                  ? "Ocultar itens detalhados"
                  : `Ver ${itemsCount} ${itemsCount === 1 ? "item detalhado" : "itens detalhados"}`}
              </span>
              {open ? (
                <ChevronUp className="ml-0.5 size-3.5" />
              ) : (
                <ChevronDown className="ml-0.5 size-3.5" />
              )}
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-3 space-y-3">
            {/* Flow transparency — "what happens now" timeline */}
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <QuoteTimeline status={status} />
            </div>

            <ul className="divide-border/40 border-border/60 bg-muted/20 divide-y overflow-hidden rounded-2xl border">
              {quote.items.map((it) => {
                const subtotal = it.price != null ? it.price * it.quantity : null
                const itemStatus = it.status as QuoteItemStatus
                const unitStr = SERVICE_UNIT_SHORT[it.unit as ServiceUnit] || it.unit

                return (
                  <li key={it.id} className="grid gap-2 p-3.5 text-sm sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-foreground font-bold">{it.service.title}</p>
                        <StatusBadge tone="zinc" className="text-[10px]">
                          {QUOTE_ITEM_STATUS_LABELS[itemStatus] ?? it.status}
                        </StatusBadge>
                      </div>
                      <p className="text-muted-foreground text-xs font-medium tabular-nums">
                        {it.quantity} {unitStr} ·{" "}
                        {it.price != null
                          ? `${formatBRL(it.price)} / ${unitStr}`
                          : "Aguardando preço do prestador"}
                      </p>
                      <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                        {it.description}
                      </p>
                      {it.providerNote ? (
                        <div className="space-y-1.5 pt-1">
                          {(() => {
                            const breakdown = parseTransparentQuoteNote(it.providerNote)
                            const cleanNote = it.providerNote
                              .replace(/\[ORCAMENTO_TRANSPARENTE:.*?:ORCAMENTO_TRANSPARENTE\]/g, "")
                              .trim()

                            return (
                              <>
                                {breakdown ? (
                                  <div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        triggerHaptic("selection")
                                        onViewBreakdown?.({
                                          title: it.service.title,
                                          category: it.service.title,
                                          breakdown,
                                        })
                                      }}
                                      className="h-7.5 gap-1.5 rounded-xl border-blue-300 bg-blue-50/60 px-2.5 text-xs font-semibold text-blue-700 shadow-2xs hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                                    >
                                      <Package className="size-3.5 text-blue-600 dark:text-blue-400" />
                                      Ver Mão de Obra vs Materiais ({formatBRL(breakdown.laborCost)}{" "}
                                      + {formatBRL(breakdown.materialsCost)})
                                    </Button>
                                  </div>
                                ) : null}
                                {cleanNote ? (
                                  <p className="bg-background/80 border-border/40 text-muted-foreground rounded-xl border p-2.5 text-xs leading-relaxed">
                                    <strong className="text-foreground">Nota do prestador:</strong>{" "}
                                    {cleanNote}
                                  </p>
                                ) : null}
                              </>
                            )
                          })()}
                        </div>
                      ) : null}
                    </div>

                    <div className="self-start text-right text-sm">
                      {subtotal != null ? (
                        <>
                          <p className="text-muted-foreground text-xs font-medium">Subtotal</p>
                          <p className="text-foreground font-bold tabular-nums">
                            {formatBRL(subtotal)}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>

        {/* Actions Bar */}
        <div className="border-border/40 flex flex-wrap items-center gap-2 border-t pt-3.5">
          {/* Direct Schedule button when Approved */}
          {status === "APPROVED" && onSchedule && (
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onSchedule()
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 gap-1.5 rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-95"
            >
              <CalendarDays className="size-4" />
              Agendar Atendimento
            </Button>
          )}

          {/* Approve button when Responded or Quoted */}
          {canApprove && (
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onApprove()
              }}
              disabled={isApproving}
              className="h-9 gap-1.5 rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-95"
            >
              {isApproving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Aprovar orçamento
            </Button>
          )}

          {/* Standard Tools */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onViewProvider()
            }}
            className="border-border/60 hover:bg-muted/60 h-9 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
          >
            <MapPin className="text-primary size-3.5" />
            Ver prestador
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onMessage()
            }}
            className="border-border/60 hover:bg-muted/60 h-9 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
            title="Enviar mensagem na plataforma"
            aria-label="Enviar mensagem na plataforma"
          >
            <MessageSquare className="size-3.5" />
            Mensagem
          </Button>

          {/* Reject button */}
          {canReject && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onReject()
              }}
              disabled={isRejecting}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto h-9 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
            >
              {isRejecting ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              Rejeitar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
