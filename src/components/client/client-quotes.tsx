"use client"

/**
 * ClientQuotes — Clean, minimalist in-panel quote request management.
 *
 * Allows clients to request, compare, approve and schedule custom service
 * quotes with transparent labor/materials breakdown and Escrow guarantee.
 *
 * Capabilities:
 *  - Modern Hero Banner with platform guarantee and quick actions
 *  - 3 Ultra-compact Bento StatCards (~68px) with status overview
 *  - Segmented status tabs with live counts (Todos, Pendentes, Respondidos, Aprovados, Rejeitados, Expirados)
 *  - View mode switcher (Lista / Grade) with haptic feedback
 *  - Quick in-list search by provider or service title with instant clear "X"
 *  - List View: Ultra-compact rows (~80px) with round avatars and quick actions
 *  - Grid View: Balanced Bento cards with timeline, breakdown and reassurance banners
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
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  LayoutGrid,
  LayoutList,
  Loader2,
  MapPin,
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
import type { TransparentQuoteBreakdown } from "@/lib/materials-breakdown"
import type { QuoteStatus, ServiceUnit } from "@/lib/constants"
import { triggerHaptic } from "@/lib/haptics"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { StatCard } from "@/components/shared/shell"
import { QuoteListCard, QuoteCard } from "./client-quote-cards"

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
// Component
// ---------------------------------------------------------------------------

export function ClientQuotes() {
  const qc = useQueryClient()
  const navigate = useViewStore((s) => s.navigate)
  const openProvider = useUIStore((s) => s.openProvider)
  const openQuote = useUIStore((s) => s.openQuote)
  const openBooking = useUIStore((s) => s.openBooking)

  const [tab, setTab] = React.useState("ALL")
  const [viewMode, setViewMode] = React.useState<"list" | "grid">("list")
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
      triggerHaptic("success")
      toast.success("Orçamento aprovado! Você já pode agendar o atendimento.")
      qc.invalidateQueries({ queryKey: ["quotes"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })

      const q = allQuotes.find((it) => it.id === id)
      if (q && q.items[0]?.serviceId) {
        openBooking({ providerId: q.provider.id, serviceId: q.items[0].serviceId })
      }
    },
    onError: (e: { message?: string }) => {
      triggerHaptic("error")
      toast.error(e?.message || "Não foi possível aprovar o orçamento.")
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiPatch(`/api/quotes/${id}`, { status: "REJECTED" }),
    onSuccess: () => {
      triggerHaptic("selection")
      toast.info("Orçamento rejeitado.")
      qc.invalidateQueries({ queryKey: ["quotes"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
    },
    onError: (e: { message?: string }) => {
      triggerHaptic("error")
      toast.error(e?.message || "Não foi possível rejeitar o orçamento.")
    },
  })

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Signature Hero Banner */}
      <div className="border-border/60 from-card via-card/95 to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-2xs sm:p-5">
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium">
              <FileText className="size-3" />
              <span>Cotações Inteligentes & Orçamento Transparente</span>
            </div>
            <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
              Orçamentos
            </h1>
            <p className="text-muted-foreground max-w-2xl text-xs sm:text-sm">
              Acompanhe as cotações que você solicitou e aprove a melhor oferta.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <Button
              onClick={() => {
                triggerHaptic("selection")
                openQuote()
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold shadow-2xs"
            >
              <Plus className="size-3.5" />
              Pedir orçamento
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.providers")
              }}
              className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold shadow-2xs"
            >
              <MapPin className="text-primary size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      {/* 3 Ultra-Compact Bento StatCards (~68px) */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <StatCard
          compact={true}
          icon={Clock}
          label="Aguardando Decisão"
          value={String(counts.RESPONDED ?? 0)}
          tone={counts.RESPONDED > 0 ? "amber" : "zinc"}
          hint="Propostas prontas para sua análise e aprovação"
        />
        <StatCard
          compact={true}
          icon={CalendarClock}
          label="Em Análise"
          value={String(counts.PENDING ?? 0)}
          tone="primary"
          hint="Aguardando envio de valores formalizados pelos prestadores"
        />
        <StatCard
          compact={true}
          icon={Sparkles}
          label="Aprovados / Total"
          value={`${counts.APPROVED ?? 0} de ${counts.ALL ?? 0}`}
          tone="sky"
          hint="Orçamentos confirmados para atendimento"
        />
      </div>

      {/* Modern Filter, Tabs & View Mode Toolbar */}
      <div className="bg-card border-border/60 flex flex-col gap-2.5 rounded-xl border p-2.5 shadow-2xs sm:p-3">
        {/* Status Segmented Rail */}
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
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all active:scale-95",
                  active
                    ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                    : "border-border/60 bg-muted/30 hover:bg-muted/70 text-muted-foreground hover:text-foreground border",
                )}
              >
                <Icon
                  className={cn(
                    "size-3",
                    active ? "text-primary-foreground" : "text-muted-foreground",
                  )}
                />
                <span>{t.label}</span>
                <span
                  className={cn(
                    "inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold tabular-nums",
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

        {/* Search Input + View Mode Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t pt-2">
          {/* Quick Search */}
          <div className="relative min-w-[200px] flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <Input
              type="text"
              placeholder="Filtrar por prestador ou serviço..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-8.5 rounded-lg pr-8 pl-8.5 text-xs"
            />
            {filterText ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  setFilterText("")
                }}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5"
                title="Limpar busca"
                aria-label="Limpar busca"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          {/* View mode switcher */}
          <div className="bg-muted/40 flex items-center rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setViewMode("list")
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                viewMode === "list"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Visualização em Lista"
              aria-pressed={viewMode === "list"}
            >
              <LayoutList className="size-3.5" />
              <span className="hidden sm:inline">Lista</span>
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setViewMode("grid")
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                viewMode === "grid"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Visualização em Grade"
              aria-pressed={viewMode === "grid"}
            >
              <LayoutGrid className="size-3.5" />
              <span className="hidden sm:inline">Grade</span>
            </button>
          </div>
        </div>
      </div>

      {/* Results Counter & Reassurance Badge */}
      <div className="text-muted-foreground flex flex-col justify-between gap-1.5 px-1 text-xs sm:flex-row sm:items-center">
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
        <div className="grid gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-border/60 rounded-xl p-4 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="bg-muted size-11 animate-pulse rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="bg-muted h-3.5 w-40 rounded" />
                  <div className="bg-muted h-3 w-28 rounded" />
                </div>
                <div className="bg-muted h-6 w-16 rounded" />
              </div>
            </Card>
          ))}
        </div>
      ) : pageItems.length === 0 ? (
        /* Empty State */
        <Card className="border-border/70 rounded-2xl border-dashed p-6 text-center sm:p-8">
          <CardContent className="flex flex-col items-center justify-center space-y-3.5 p-0">
            <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl shadow-2xs">
              <FileText className="size-6" />
            </div>
            <div className="space-y-1 text-center">
              <h3 className="text-foreground text-sm font-bold sm:text-base">
                {filterText
                  ? "Nenhum orçamento encontrado"
                  : tab === "ALL"
                    ? "Você ainda não tem orçamentos"
                    : "Nenhum orçamento nesta categoria"}
              </h3>
              <p className="text-muted-foreground max-w-lg text-xs leading-relaxed">
                {filterText
                  ? `Nenhum orçamento corresponde à busca "${filterText}".`
                  : tab === "ALL"
                    ? "Que tal pedir o primeiro? Encontre um prestador e solicite uma cotação personalizada."
                    : "Não há orçamentos com este status no momento. Tente outra categoria ou solicite uma nova cotação."}
              </p>
            </div>

            {filterText ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  setFilterText("")
                }}
                className="mt-2 h-8 gap-1.5 text-xs"
              >
                Limpar filtro
              </Button>
            ) : tab === "ALL" ? (
              <div className="grid w-full max-w-2xl gap-2.5 pt-2 text-left sm:grid-cols-3">
                <div className="border-border/60 bg-muted/20 space-y-1 rounded-xl border p-3">
                  <div className="text-foreground flex items-center gap-1.5 text-xs font-bold">
                    <span className="bg-primary/15 text-primary flex size-4.5 items-center justify-center rounded-full text-[10px]">
                      1
                    </span>
                    <span>Descreva o que precisa</span>
                  </div>
                  <p className="text-muted-foreground text-[10.5px] leading-relaxed">
                    Indique o serviço, endereço e detalhes do trabalho a ser realizado.
                  </p>
                </div>

                <div className="border-border/60 bg-muted/20 space-y-1 rounded-xl border p-3">
                  <div className="text-foreground flex items-center gap-1.5 text-xs font-bold">
                    <span className="bg-primary/15 text-primary flex size-4.5 items-center justify-center rounded-full text-[10px]">
                      2
                    </span>
                    <span>Proposta Transparente</span>
                  </div>
                  <p className="text-muted-foreground text-[10.5px] leading-relaxed">
                    O profissional avalia e envia prazo com divisão transparente dos custos.
                  </p>
                </div>

                <div className="border-border/60 bg-muted/20 space-y-1 rounded-xl border p-3">
                  <div className="text-foreground flex items-center gap-1.5 text-xs font-bold">
                    <span className="bg-primary/15 text-primary flex size-4.5 items-center justify-center rounded-full text-[10px]">
                      3
                    </span>
                    <span>Garantia & Escrow</span>
                  </div>
                  <p className="text-muted-foreground text-[10.5px] leading-relaxed">
                    Você só libera o pagamento após o serviço concluído e aprovado por você.
                  </p>
                </div>
              </div>
            ) : null}

            {!filterText && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <Button
                  onClick={() => {
                    triggerHaptic("selection")
                    openQuote()
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold"
                >
                  <Plus className="size-3.5" />
                  Pedir Orçamento Agora
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    triggerHaptic("selection")
                    navigate("client.providers")
                  }}
                  className="h-8 gap-1.5 rounded-xl text-xs font-medium"
                >
                  <MapPin className="text-primary size-3.5" />
                  Explorar Prestadores
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : viewMode === "list" ? (
        /* MODO LISTA: Ultra-compact rows (~80px) */
        <div className="space-y-2.5">
          {pageItems.map((q) => (
            <QuoteListCard
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
      ) : (
        /* MODO GRADE: Bento cards (~160px) */
        <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="border-border/50 flex flex-col items-center justify-between gap-2 border-t pt-3 sm:flex-row">
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
              className="h-8 gap-1 rounded-lg text-xs"
            >
              <ChevronLeft className="size-3.5" />
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
              className="h-8 gap-1 rounded-lg text-xs"
            >
              Próxima
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* Transparent Quote Breakdown Modal */}
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
