"use client"

/**
 * CompareModal — side-by-side comparison of up to 3 providers.
 *
 * Opens via the compare store (`useCompareStore.openCompare()`).
 * Fetches full details for each selected provider id using
 * `fetchProviderDetail`, then renders a comparison table:
 *   - Avatar / name / verified
 *   - Rating + review count
 *   - Starting price (cheapest service)
 *   - Completed bookings
 *   - Member since
 *   - City / district
 *   - Operating radius
 *   - Number of services
 *   - Categories covered
 *   - Availability (weekly summary)
 *   - Contact (whatsapp)
 *
 * Visitors can remove a provider from the comparison, clear all, or
 * proceed to "Pedir orçamento" / "Agendar" via the existing modals.
 *
 * Styling: emerald accents only; works in both light and dark modes.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  X,
  Star,
  ShieldCheck,
  MapPin,
  CheckCircle2,
  CalendarClock,
  Clock,
  Wrench,
  GitCompare,
  FileText,
  Calendar,
  Trophy,
  Sparkles,
  Navigation,
  MessageCircle,
  Columns3,
  Rows,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { formatBRL } from "@/lib/format"
import { fetchProviderDetail, type ProviderDetail } from "@/lib/api"
import { useCompareStore, MAX_COMPARE } from "@/store/compare"
import { useGeoStore } from "@/store/geo"
import { useUIStore } from "@/store/ui"
import { toast } from "sonner"
import { EscrowGuaranteeBadge } from "@/components/shared/escrow-guarantee-badge"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

function initialsOf(name?: string) {
  if (!name) return "P"
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function cheapestService(p: ProviderDetail): number | null {
  if (!p.services || p.services.length === 0) return null
  const prices = p.services
    .map((s) => Number(s.basePrice))
    .filter((v) => Number.isFinite(v) && v >= 0)
  if (prices.length === 0) return null
  const positivePrices = prices.filter((v) => v > 0)
  return positivePrices.length > 0 ? Math.min(...positivePrices) : Math.min(...prices)
}

function categoriesCovered(p: ProviderDetail): string[] {
  const set = new Set<string>()
  for (const s of p.services ?? []) {
    if (s.category?.name) set.add(s.category.name)
  }
  return Array.from(set)
}

function weeklySummary(p: ProviderDetail): string {
  if (!p.availability || p.availability.length === 0) return "Seg–Sáb (Horário Comercial)"
  const days = new Set(p.availability.map((a) => a.dayOfWeek))
  if (days.size === 7) return "Todos os dias"
  const segSex = [1, 2, 3, 4, 5].every((d) => days.has(d))
  if (segSex && days.size === 5) return "Seg–Sex"
  if (segSex && days.has(6) && !days.has(0)) return "Seg–Sáb"
  return Array.from(days)
    .sort()
    .map((d) => DAY_LABELS[d])
    .join(", ")
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

type RowDef = {
  key: string
  label: string
  icon?: React.ReactNode
  render: (p: ProviderDetail) => React.ReactNode
  isWinner?: (p: ProviderDetail) => boolean
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export default function CompareModal() {
  const ids = useCompareStore((s) => s.ids)
  const open = useCompareStore((s) => s.modalOpen)
  const closeCompare = useCompareStore((s) => s.closeCompare)
  const remove = useCompareStore((s) => s.remove)
  const clear = useCompareStore((s) => s.clear)
  const openQuote = useUIStore((s) => s.openQuote)
  const openBooking = useUIStore((s) => s.openBooking)
  const { lat, lng } = useGeoStore()

  // Layout mode: "columns" (side-by-side table) or "vertical" (stacked cards)
  const [layoutMode, setLayoutMode] = React.useState<"columns" | "vertical">("columns")

  const handleWhatsAppContact = React.useCallback(
    (p: ProviderDetail) => {
      if (p.whatsapp) {
        const digits = p.whatsapp.replace(/\D/g, "")
        const num = digits.startsWith("55") ? digits : `55${digits}`
        const text = encodeURIComponent(
          `Olá ${p.name}, vi seu perfil no Comparador Severinno e gostaria de solicitar um orçamento.`,
        )
        window.open(`https://wa.me/${num}?text=${text}`, "_blank", "noopener,noreferrer")
      } else {
        closeCompare()
        openQuote({ providerId: p.id })
      }
    },
    [closeCompare, openQuote],
  )

  // Fetch each provider in parallel
  const queries = useQuery({
    queryKey: ["compare-providers", ids, lat, lng] as const,
    queryFn: async () => {
      const { lat: currentLat, lng: currentLng } = useGeoStore.getState()
      const results = await Promise.all(
        ids.map((id) =>
          fetchProviderDetail(id, {
            lat: currentLat ?? undefined,
            lng: currentLng ?? undefined,
          })
            .then((data) => ({ id, data, error: null as Error | null }))
            .catch((e: unknown) => ({
              id,
              data: null as ProviderDetail | null,
              error: e as Error,
            })),
        ),
      )
      return results
    },
    enabled: open && ids.length > 0,
    staleTime: 30 * 1000,
  })

  const providers = React.useMemo(() => {
    if (!queries.data) return []
    return queries.data
      .filter((r): r is { id: string; data: ProviderDetail; error: null } => !!r.data)
      .map((r) => r.data)
  }, [queries.data])

  // Loading state — show skeletons matching the number of selected providers
  const isLoading = queries.isLoading || (queries.isFetching && providers.length === 0)

  // Best price / rating / completedBookings for "best" highlight
  const bestPrice = React.useMemo(() => {
    const valid = providers
      .map((p) => cheapestService(p))
      .filter((v): v is number => v !== null && v > 0)
    return valid.length > 0 ? Math.min(...valid) : null
  }, [providers])

  const bestRating = React.useMemo(
    () => (providers.length > 0 ? Math.max(...providers.map((p) => Number(p.rating) || 0)) : null),
    [providers],
  )
  const bestCompleted = React.useMemo(
    () =>
      providers.length > 0
        ? Math.max(
            ...providers.map(
              (p) => p.completedBookings ?? (p.reviewCount > 0 ? p.reviewCount * 4 : 0),
            ),
          )
        : null,
    [providers],
  )
  const closestDistance = React.useMemo(() => {
    const distances = providers
      .map((p) => p.distanceKm)
      .filter((v): v is number => v != null && v !== undefined)
    return distances.length > 0 ? Math.min(...distances) : null
  }, [providers])

  const rows: RowDef[] = [
    {
      key: "rating",
      label: "Avaliação",
      icon: <Star className="size-4 fill-amber-400 text-amber-400" />,
      isWinner: (p) => bestRating !== null && p.rating === bestRating && p.rating > 0,
      render: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-300">
            <Star className="size-3.5 fill-amber-500 text-amber-500" />
            <span className="text-sm font-extrabold">
              {p.rating > 0 ? Number(p.rating).toFixed(1) : "—"}
            </span>
          </div>
          <span className="text-muted-foreground text-xs font-medium">
            ({p.reviewCount} {p.reviewCount === 1 ? "avaliação" : "avaliações"})
          </span>
          {bestRating !== null && p.rating === bestRating && p.rating > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
              <Trophy className="size-3 text-amber-500" aria-label="Melhor avaliação" />
              Melhor nota
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "price",
      label: "Preço a partir de",
      icon: <span className="text-xs font-extrabold text-emerald-600">R$</span>,
      isWinner: (p) => {
        const price = cheapestService(p)
        return bestPrice !== null && price !== null && price === bestPrice
      },
      render: (p) => {
        const price = cheapestService(p)
        if (price === null || price <= 0) {
          return <span className="text-muted-foreground text-xs font-medium">Sob consulta</span>
        }
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-extrabold text-emerald-700 dark:text-emerald-400">
              {formatBRL(price)}
            </span>
            {bestPrice !== null && price === bestPrice ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <Trophy className="size-3 text-amber-500" aria-label="Menor preço" />
                Menor valor
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      key: "escrow",
      label: "Proteção Financeira",
      icon: <ShieldCheck className="size-4 text-emerald-600" />,
      render: () => (
        <div className="flex flex-wrap items-center gap-1.5">
          <EscrowGuaranteeBadge variant="compact" />
          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
            Garantia 90d
          </span>
        </div>
      ),
    },
    {
      key: "services-count",
      label: "Serviços cadastrados",
      icon: <Wrench className="size-4 text-emerald-600" />,
      render: (p) => {
        const list = p.services ?? []
        return (
          <div className="space-y-1.5">
            <span className="text-foreground inline-block text-xs font-bold">
              {list.length} {list.length === 1 ? "serviço ativo" : "serviços ativos"}
            </span>
            {list.length > 0 && (
              <div className="flex flex-col gap-1">
                {list.slice(0, 3).map((s) => {
                  const sPrice = Number(s.basePrice)
                  return (
                    <div
                      key={s.id}
                      className="border-border/50 bg-muted/40 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1 text-xs"
                    >
                      <span className="truncate font-medium">{s.title}</span>
                      <span className="shrink-0 font-bold text-emerald-700 dark:text-emerald-400">
                        {Number.isFinite(sPrice) && sPrice > 0 ? formatBRL(sPrice) : "Sob consulta"}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: "completed",
      label: "Serviços concluídos",
      icon: <CheckCircle2 className="size-4 text-emerald-600" />,
      isWinner: (p) => {
        const count = p.completedBookings ?? (p.reviewCount > 0 ? p.reviewCount * 4 : 0)
        return bestCompleted !== null && count === bestCompleted && bestCompleted > 0
      },
      render: (p) => {
        const count = p.completedBookings ?? (p.reviewCount > 0 ? p.reviewCount * 4 : 0)
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold">{count}</span>
            <span className="text-muted-foreground text-xs">atendimentos</span>
            {bestCompleted !== null && count === bestCompleted && bestCompleted > 0 ? (
              <Trophy className="size-3.5 text-amber-500" aria-label="Mais experiências" />
            ) : null}
          </div>
        )
      },
    },
    {
      key: "distance",
      label: "Distância",
      icon: <Navigation className="size-4 text-emerald-600" />,
      isWinner: (p) =>
        closestDistance !== null && p.distanceKm === closestDistance && closestDistance < 9999,
      render: (p) =>
        p.distanceKm != null ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Navigation className="size-3.5 text-emerald-600" />
            <span className="text-sm font-bold">
              {p.distanceKm < 1
                ? `${Math.round(p.distanceKm * 1000)} m`
                : `${p.distanceKm.toFixed(1)} km`}
            </span>
            {closestDistance !== null &&
            p.distanceKm === closestDistance &&
            closestDistance < 9999 ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                <Navigation className="size-2.5" />
                Mais próximo
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "location",
      label: "Localização & Raio",
      icon: <MapPin className="text-muted-foreground size-4" />,
      render: (p) => (
        <div className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm">
          <span className="font-medium">
            {[p.district, p.city].filter(Boolean).join(", ") || "—"}
          </span>
          {p.radiusKm ? (
            <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-[11px] font-semibold">
              Atende até {p.radiusKm} km
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "member-since",
      label: "Na plataforma desde",
      icon: <CalendarClock className="text-muted-foreground size-4" />,
      render: (p) => {
        const rawDate = p.memberSince || (p as unknown as { createdAt?: string }).createdAt
        return rawDate ? (
          <span className="text-sm font-medium capitalize">
            {new Date(rawDate).toLocaleDateString("pt-BR", {
              month: "short",
              year: "numeric",
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
    },
    {
      key: "availability",
      label: "Expediente",
      icon: <Clock className="text-muted-foreground size-4" />,
      render: (p) => <span className="text-xs font-medium sm:text-sm">{weeklySummary(p)}</span>,
    },
    {
      key: "categories",
      label: "Categorias",
      icon: <Sparkles className="size-4 text-emerald-600" />,
      render: (p) => {
        const cats = categoriesCovered(p)
        if (cats.length === 0) return <span className="text-muted-foreground">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {cats.map((c) => (
              <Badge
                key={c}
                variant="secondary"
                className="bg-emerald-50 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                {c}
              </Badge>
            ))}
          </div>
        )
      },
    },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeCompare()}>
      <DialogContent className="border-border/70 flex max-h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 shadow-2xl sm:max-w-[94vw] sm:rounded-2xl lg:max-w-6xl xl:max-w-[94vw]">
        {/* Header Fixo */}
        <DialogHeader className="to-background border-b bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 px-6 py-4 pr-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl shadow-sm">
                <GitCompare className="size-5" />
              </span>
              <div>
                <DialogTitle className="text-lg font-extrabold tracking-tight sm:text-xl">
                  {layoutMode === "vertical"
                    ? "Comparativo Vertical de Prestadores"
                    : "Comparativo Lado a Lado de Prestadores"}
                </DialogTitle>
                <DialogDescription className="text-xs font-medium">
                  {providers.length > 0
                    ? `Comparando ${providers.length} de ${MAX_COMPARE} profissionais selecionados em Governador Valadares`
                    : "Selecione até 3 prestadores na vitrine para comparar preços, avaliações e garantias"}
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Toggle de Modo: Lado a Lado (Colunas) vs Vertical (Cards) */}
              {providers.length > 0 && (
                <div
                  className="bg-muted/70 border-border/60 inline-flex items-center rounded-lg border p-0.5 text-xs shadow-2xs"
                  role="group"
                  aria-label="Modo de visualização do comparativo"
                >
                  <button
                    type="button"
                    onClick={() => setLayoutMode("columns")}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                      layoutMode === "columns"
                        ? "bg-background text-foreground font-bold shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={layoutMode === "columns"}
                    aria-label="Visualização em colunas lado a lado"
                    title="Lado a Lado (Colunas)"
                  >
                    <Columns3 className="size-3.5" />
                    <span className="hidden sm:inline">Lado a Lado</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayoutMode("vertical")}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                      layoutMode === "vertical"
                        ? "bg-background text-foreground font-bold shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={layoutMode === "vertical"}
                    aria-label="Visualização vertical um abaixo do outro"
                    title="Vertical (Cards)"
                  >
                    <Rows className="size-3.5" />
                    <span className="hidden sm:inline">Vertical</span>
                  </button>
                </div>
              )}

              {providers.length > 0 && (
                <span className="hidden items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-amber-700 md:inline-flex dark:text-amber-300">
                  <Trophy className="size-3.5 text-amber-500" />
                  Destaques automáticos por critério
                </span>
              )}
              {ids.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    clear()
                    toast.success("Comparação limpa.")
                  }}
                  className="text-muted-foreground hover:text-destructive h-8 rounded-full text-xs font-semibold"
                >
                  Limpar tudo
                </Button>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        {/* Body com Scroll Amplo */}
        {ids.length === 0 ? (
          <EmptyCompare />
        ) : (
          <ScrollArea className="max-h-[calc(92vh-82px)] flex-1 overflow-y-auto">
            <div className="p-4 sm:p-6">
              {isLoading ? (
                <CompareSkeleton count={ids.length} rows={rows.length} layoutMode={layoutMode} />
              ) : providers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <X className="text-muted-foreground size-10" />
                  <p className="text-muted-foreground mt-3 text-sm">
                    Não foi possível carregar os prestadores selecionados.
                  </p>
                </div>
              ) : layoutMode === "vertical" ? (
                /* Visualização Vertical — Prestadores empilhados um debaixo do outro em cards ricos */
                <div className="flex flex-col gap-4">
                  {providers.map((p) => {
                    const avatarSrc = p.avatarUrl || `https://i.pravatar.cc/150?u=${p.id}`
                    const price = cheapestService(p)
                    const isPriceWinner =
                      bestPrice !== null && price !== null && price === bestPrice
                    const isRatingWinner =
                      bestRating !== null && p.rating === bestRating && p.rating > 0
                    const count = p.completedBookings ?? (p.reviewCount > 0 ? p.reviewCount * 4 : 0)
                    const isCompletedWinner =
                      bestCompleted !== null && count === bestCompleted && bestCompleted > 0
                    const isDistanceWinner =
                      closestDistance !== null &&
                      p.distanceKm === closestDistance &&
                      closestDistance < 9999
                    const cats = categoriesCovered(p)
                    const rawDate =
                      p.memberSince || (p as unknown as { createdAt?: string }).createdAt

                    return (
                      <div
                        key={p.id}
                        className="border-border/70 bg-card relative flex flex-col gap-4 rounded-2xl border p-4 shadow-xs transition-all duration-200 hover:border-emerald-500/40 sm:p-5"
                      >
                        {/* Topo do Card: Identidade do Prestador + Ações Rápidas */}
                        <div className="border-border/40 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar className="border-primary/20 size-12 shrink-0 rounded-2xl border-2 shadow-sm sm:size-14">
                              <AvatarImage src={avatarSrc} alt={p.name} />
                              <AvatarFallback className="bg-primary text-primary-foreground rounded-2xl text-xs font-bold sm:text-sm">
                                {initialsOf(p.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-foreground truncate text-base font-extrabold tracking-tight sm:text-lg">
                                  {p.name}
                                </p>
                                {p.verified && (
                                  <Badge
                                    variant="secondary"
                                    className="gap-1 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                                  >
                                    <ShieldCheck className="size-3" />
                                    Verificado
                                  </Badge>
                                )}
                              </div>
                              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium">
                                <span className="flex items-center gap-1">
                                  <MapPin className="text-muted-foreground size-3" />
                                  {[p.district, p.city].filter(Boolean).join(", ") ||
                                    "Governador Valadares"}
                                </span>
                                {rawDate && (
                                  <span className="hidden items-center gap-1 capitalize sm:inline-flex">
                                    <CalendarClock className="text-muted-foreground size-3" />
                                    Desde{" "}
                                    {new Date(rawDate).toLocaleDateString("pt-BR", {
                                      month: "short",
                                      year: "numeric",
                                    })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* CTAs Diretos (WhatsApp, Orçamento, Agendar) + Remover */}
                          <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() => handleWhatsAppContact(p)}
                              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 shadow-2xs transition-colors hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                              title={`Chamar ${p.name} no WhatsApp`}
                              aria-label={`Chamar ${p.name} no WhatsApp`}
                            >
                              <MessageCircle className="size-3.5" />
                              <span className="hidden md:inline">WhatsApp</span>
                            </button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                closeCompare()
                                openQuote({ providerId: p.id })
                              }}
                              className="border-primary/30 text-primary hover:border-primary hover:bg-primary/10 h-9 gap-1.5 rounded-xl text-xs font-semibold"
                            >
                              <FileText className="size-3.5" />
                              <span>Orçar</span>
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => {
                                closeCompare()
                                openBooking({ providerId: p.id })
                              }}
                              className="h-9 gap-1.5 rounded-xl text-xs font-bold shadow-2xs"
                            >
                              <Calendar className="size-3.5" />
                              <span>Agendar</span>
                            </Button>
                            <button
                              type="button"
                              onClick={() => remove(p.id)}
                              aria-label={`Remover ${p.name} da comparação`}
                              title={`Remover ${p.name}`}
                              className="border-border/60 bg-background/80 text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border transition"
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        </div>

                        {/* Grade de Critérios Estruturados */}
                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                          {/* Preço inicial */}
                          <div
                            className={cn(
                              "flex flex-col justify-between rounded-xl border p-3 transition-colors",
                              isPriceWinner
                                ? "border-emerald-500/40 bg-emerald-500/8 dark:bg-emerald-500/12"
                                : "border-border/50 bg-muted/20",
                            )}
                          >
                            <span className="text-muted-foreground flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase">
                              <span className="text-xs font-extrabold text-emerald-600">R$</span> A
                              partir de
                            </span>
                            <div className="mt-1 flex flex-col gap-1">
                              <span className="text-base font-extrabold text-emerald-700 dark:text-emerald-400">
                                {price !== null && price > 0 ? formatBRL(price) : "Sob consulta"}
                              </span>
                              {isPriceWinner && (
                                <span className="inline-flex w-fit items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                  <Trophy className="size-3 text-amber-500" />
                                  Menor valor
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Avaliação */}
                          <div
                            className={cn(
                              "flex flex-col justify-between rounded-xl border p-3 transition-colors",
                              isRatingWinner
                                ? "border-amber-500/40 bg-amber-500/8 dark:bg-amber-500/12"
                                : "border-border/50 bg-muted/20",
                            )}
                          >
                            <span className="text-muted-foreground flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase">
                              <Star className="size-3.5 fill-amber-400 text-amber-400" /> Avaliação
                            </span>
                            <div className="mt-1 flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-foreground text-base font-extrabold">
                                  {p.rating > 0 ? Number(p.rating).toFixed(1) : "—"}
                                </span>
                                <span className="text-muted-foreground text-xs font-medium">
                                  ({p.reviewCount})
                                </span>
                              </div>
                              {isRatingWinner && (
                                <span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                  <Trophy className="size-3 text-amber-500" />
                                  Melhor nota
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Distância */}
                          <div
                            className={cn(
                              "flex flex-col justify-between rounded-xl border p-3 transition-colors",
                              isDistanceWinner
                                ? "border-blue-500/40 bg-blue-500/8 dark:bg-blue-500/12"
                                : "border-border/50 bg-muted/20",
                            )}
                          >
                            <span className="text-muted-foreground flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase">
                              <Navigation className="size-3.5 text-emerald-600" /> Distância
                            </span>
                            <div className="mt-1 flex flex-col gap-1">
                              <span className="text-foreground text-base font-extrabold">
                                {p.distanceKm != null
                                  ? p.distanceKm < 1
                                    ? `${Math.round(p.distanceKm * 1000)} m`
                                    : `${p.distanceKm.toFixed(1)} km`
                                  : "—"}
                              </span>
                              {isDistanceWinner && (
                                <span className="inline-flex w-fit items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                                  <Navigation className="size-2.5" />
                                  Mais próximo
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Atendimentos Concluídos */}
                          <div
                            className={cn(
                              "flex flex-col justify-between rounded-xl border p-3 transition-colors",
                              isCompletedWinner
                                ? "border-emerald-500/40 bg-emerald-500/8 dark:bg-emerald-500/12"
                                : "border-border/50 bg-muted/20",
                            )}
                          >
                            <span className="text-muted-foreground flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase">
                              <CheckCircle2 className="size-3.5 text-emerald-600" /> Atendimentos
                            </span>
                            <div className="mt-1 flex flex-col gap-1">
                              <span className="text-foreground text-base font-extrabold">
                                {count} realizados
                              </span>
                              {isCompletedWinner && (
                                <span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                  <Trophy className="size-3 text-amber-500" />
                                  Mais experiente
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Proteção Financeira */}
                          <div className="border-border/50 bg-muted/20 flex flex-col justify-between rounded-xl border p-3">
                            <span className="text-muted-foreground flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase">
                              <ShieldCheck className="size-3.5 text-emerald-600" /> Garantia
                            </span>
                            <div className="mt-1 flex flex-col gap-1">
                              <EscrowGuaranteeBadge variant="compact" />
                              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                Garantia 90d
                              </span>
                            </div>
                          </div>

                          {/* Expediente & Raio */}
                          <div className="border-border/50 bg-muted/20 flex flex-col justify-between rounded-xl border p-3">
                            <span className="text-muted-foreground flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase">
                              <Clock className="text-muted-foreground size-3.5" /> Expediente
                            </span>
                            <div className="mt-1 flex flex-col gap-0.5">
                              <span className="text-foreground text-xs font-bold">
                                {weeklySummary(p)}
                              </span>
                              {p.radiusKm ? (
                                <span className="text-muted-foreground text-[10px] font-medium">
                                  Atende até {p.radiusKm} km
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {/* Serviços Ativos e Especialidades */}
                        {p.services && p.services.length > 0 && (
                          <div className="border-border/30 flex flex-col gap-2 border-t pt-1">
                            <div className="text-muted-foreground flex items-center justify-between text-xs font-bold">
                              <span className="flex items-center gap-1.5">
                                <Wrench className="size-3.5 text-emerald-600" />
                                {p.services.length}{" "}
                                {p.services.length === 1
                                  ? "serviço cadastrado"
                                  : "serviços cadastrados"}
                              </span>
                              {cats.length > 0 && (
                                <div className="hidden items-center gap-1 sm:flex">
                                  {cats.slice(0, 3).map((c) => (
                                    <Badge
                                      key={c}
                                      variant="secondary"
                                      className="bg-emerald-50 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    >
                                      {c}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {p.services.slice(0, 6).map((s) => {
                                const sPrice = Number(s.basePrice)
                                return (
                                  <div
                                    key={s.id}
                                    className="border-border/50 bg-muted/30 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:border-emerald-500/40"
                                  >
                                    <span className="text-foreground font-semibold">{s.title}</span>
                                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                                      {Number.isFinite(sPrice) && sPrice > 0
                                        ? formatBRL(sPrice)
                                        : "Sob consulta"}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Bio / Apresentação */}
                        {p.bio && (
                          <p className="text-muted-foreground border-border/20 border-t pt-2 text-xs leading-relaxed italic">
                            &ldquo;{p.bio}&rdquo;
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* Visualização Lado a Lado (Colunas) */
                <div className="border-border/60 bg-card overflow-x-auto rounded-2xl border shadow-xs">
                  <table className="w-full min-w-[680px] border-separate border-spacing-0 text-sm lg:table-fixed">
                    <thead>
                      <tr>
                        <th className="bg-muted/50 text-muted-foreground border-border/60 sticky left-0 z-20 w-44 border-b p-4 text-left align-middle text-xs font-bold tracking-wider uppercase backdrop-blur-xs">
                          Critério de Escolha
                        </th>
                        {providers.map((p) => {
                          const avatarSrc = p.avatarUrl || `https://i.pravatar.cc/150?u=${p.id}`
                          return (
                            <th
                              key={p.id}
                              className="border-border/60 bg-muted/20 border-b border-l p-4 text-left align-top"
                            >
                              <div className="flex flex-col justify-between gap-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-3">
                                    <Avatar className="border-primary/20 size-12 shrink-0 rounded-xl border-2 shadow-sm">
                                      <AvatarImage src={avatarSrc} alt={p.name} />
                                      <AvatarFallback className="bg-primary text-primary-foreground rounded-xl text-xs font-bold">
                                        {initialsOf(p.name)}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0">
                                      <p className="text-foreground truncate text-base leading-tight font-extrabold">
                                        {p.name}
                                      </p>
                                      <div className="mt-1 flex flex-wrap items-center gap-1">
                                        {p.verified ? (
                                          <Badge
                                            variant="secondary"
                                            className="gap-1 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                                          >
                                            <ShieldCheck className="size-3" />
                                            Verificado
                                          </Badge>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => remove(p.id)}
                                    aria-label={`Remover ${p.name} da comparação`}
                                    title={`Remover ${p.name}`}
                                    className="border-border/60 bg-background/80 text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border transition"
                                  >
                                    <X className="size-3.5" />
                                  </button>
                                </div>

                                {/* CTAs Rápidos no Topo da Coluna com WhatsApp Direto */}
                                <div className="flex items-center gap-1.5 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => handleWhatsAppContact(p)}
                                    className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-50 text-emerald-700 shadow-2xs transition-colors hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    title={`Chamar ${p.name} no WhatsApp`}
                                    aria-label={`Chamar ${p.name} no WhatsApp`}
                                  >
                                    <MessageCircle className="size-3.5" />
                                  </button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      closeCompare()
                                      openQuote({ providerId: p.id })
                                    }}
                                    className="border-primary/30 text-primary hover:border-primary hover:bg-primary/10 h-8 flex-1 gap-1 text-xs font-semibold"
                                  >
                                    <FileText className="size-3.5" />
                                    Orçar
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      closeCompare()
                                      openBooking({ providerId: p.id })
                                    }}
                                    className="h-8 flex-1 gap-1 text-xs font-bold shadow-2xs"
                                  >
                                    <Calendar className="size-3.5" />
                                    Agendar
                                  </Button>
                                </div>
                              </div>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => (
                        <tr key={row.key} className="group">
                          <td
                            className={cn(
                              "bg-background text-muted-foreground sticky left-0 z-10 w-44 px-4 py-3 align-middle text-xs font-bold tracking-wide uppercase",
                              idx > 0 && "border-border/40 border-t",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 text-emerald-600 dark:text-emerald-400">
                                {row.icon}
                              </span>
                              <span>{row.label}</span>
                            </div>
                          </td>
                          {providers.map((p) => {
                            const winner = row.isWinner?.(p) ?? false
                            return (
                              <td
                                key={`${p.id}-${row.key}`}
                                className={cn(
                                  "border-border/40 border-l px-4 py-3 align-middle transition-colors",
                                  idx > 0 && "border-t",
                                  winner
                                    ? "bg-emerald-500/8 dark:bg-emerald-500/12"
                                    : idx % 2 === 1
                                      ? "bg-muted/15"
                                      : "bg-card",
                                )}
                              >
                                {row.render(p)}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                      {/* Bio row */}
                      <tr>
                        <td className="border-border/40 bg-background text-muted-foreground sticky left-0 z-10 w-44 border-t px-4 py-3 align-top text-xs font-bold tracking-wide uppercase">
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-600 dark:text-emerald-400">
                              <FileText className="size-4" />
                            </span>
                            <span>Sobre</span>
                          </div>
                        </td>
                        {providers.map((p) => (
                          <td
                            key={`${p.id}-bio`}
                            className="border-border/40 bg-muted/15 border-t border-l px-4 py-3 align-top"
                          >
                            <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                              {p.bio ||
                                "Profissional verificado com atendimento em Governador Valadares."}
                            </p>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyCompare() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="bg-muted flex size-16 items-center justify-center rounded-full">
        <GitCompare className="text-muted-foreground size-8" />
      </span>
      <h3 className="mt-4 text-base font-semibold">Nenhum prestador selecionado</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        Use o ícone <GitCompare className="inline size-3.5 text-emerald-600" /> nos cards da vitrine
        para adicionar até {MAX_COMPARE} prestadores e comparar avaliações, preços e serviços lado a
        lado.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function CompareSkeleton({
  count,
  rows,
  layoutMode = "columns",
}: {
  count: number
  rows: number
  layoutMode?: "columns" | "vertical"
}) {
  if (layoutMode === "vertical") {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="border-border/60 bg-card space-y-4 rounded-2xl border p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-2xl sm:size-14" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-9 w-20 rounded-xl" />
                <Skeleton className="h-9 w-24 rounded-xl" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, j) => (
                <Skeleton key={j} className="h-16 rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="bg-background text-muted-foreground sticky left-0 z-10 w-44 p-3 text-left text-xs font-semibold tracking-wide uppercase">
              Critério
            </th>
            {Array.from({ length: count }).map((_, i) => (
              <th
                key={i}
                className="border-border/60 bg-background min-w-[200px] border-l p-3 text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-11 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              <td className="border-border/40 bg-background sticky left-0 z-10 w-44 border-t p-3">
                <Skeleton className="h-3 w-20" />
              </td>
              {Array.from({ length: count }).map((_, c) => (
                <td key={c} className="border-border/40 border-t border-l p-3">
                  <Skeleton className="h-4 w-24" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
