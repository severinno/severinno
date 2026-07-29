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
  Loader2,
  Trophy,
  Sparkles,
  Navigation,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { formatBRL } from "@/lib/format"
import { fetchProviderDetail, type ProviderDetail } from "@/lib/api"
import { useCompareStore, MAX_COMPARE } from "@/store/compare"
import { useGeoStore } from "@/store/geo"
import { useUIStore } from "@/store/ui"
import { toast } from "sonner"

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
import { Separator } from "@/components/ui/separator"

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
  return p.services.reduce(
    (min, s) => (s.basePrice < min ? s.basePrice : min),
    p.services[0]!.basePrice,
  )
}

function categoriesCovered(p: ProviderDetail): string[] {
  const set = new Set<string>()
  for (const s of p.services ?? []) {
    if (s.category?.name) set.add(s.category.name)
  }
  return Array.from(set)
}

function weeklySummary(p: ProviderDetail): string {
  if (!p.availability || p.availability.length === 0) return "Sem expediente"
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
  highlight?: "best" | "neutral"
  best?: (p: ProviderDetail) => boolean
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

  // Fetch each provider in parallel
  const queries = useQuery({
    queryKey: ["compare-providers", ids] as const,
    queryFn: async () => {
      const results = await Promise.all(
        ids.map((id) =>
          fetchProviderDetail(id, {
            lat: lat ?? undefined,
            lng: lng ?? undefined,
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
  const bestPrice = React.useMemo(
    () =>
      providers.length > 0
        ? Math.min(
            ...providers.map((p) => cheapestService(p)).filter((v): v is number => v !== null),
          )
        : null,
    [providers],
  )
  const bestRating = React.useMemo(
    () => (providers.length > 0 ? Math.max(...providers.map((p) => p.rating)) : null),
    [providers],
  )
  const bestCompleted = React.useMemo(
    () =>
      providers.length > 0 ? Math.max(...providers.map((p) => p.completedBookings ?? 0)) : null,
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
      render: (p) => (
        <div className="flex items-center gap-1.5">
          <Star className="size-4 fill-amber-400 text-amber-400" />
          <span className="font-semibold">{p.rating > 0 ? p.rating.toFixed(1) : "—"}</span>
          <span className="text-muted-foreground text-xs">({p.reviewCount})</span>
          {bestRating !== null && p.rating === bestRating && p.rating > 0 ? (
            <Trophy className="size-3.5 text-amber-500" aria-label="Melhor avaliação" />
          ) : null}
        </div>
      ),
    },
    {
      key: "price",
      label: "Preço a partir de",
      icon: <span className="text-xs font-bold text-emerald-600">R$</span>,
      render: (p) => {
        const price = cheapestService(p)
        if (price === null) return <span className="text-muted-foreground">—</span>
        return (
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {formatBRL(price)}
            </span>
            {bestPrice !== null && price === bestPrice ? (
              <Trophy className="size-3.5 text-amber-500" aria-label="Menor preço" />
            ) : null}
          </div>
        )
      },
    },
    {
      key: "completed",
      label: "Serviços concluídos",
      icon: <CheckCircle2 className="size-4 text-emerald-600" />,
      render: (p) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{p.completedBookings ?? 0}</span>
          {bestCompleted !== null &&
          (p.completedBookings ?? 0) === bestCompleted &&
          bestCompleted > 0 ? (
            <Trophy className="size-3.5 text-amber-500" aria-label="Mais experiências" />
          ) : null}
        </div>
      ),
    },
    {
      key: "services-count",
      label: "Serviços cadastrados",
      icon: <Wrench className="size-4 text-emerald-600" />,
      render: (p) => <span className="font-medium">{p.services?.length ?? 0}</span>,
    },
    {
      key: "member-since",
      label: "Na plataforma desde",
      icon: <CalendarClock className="text-muted-foreground size-4" />,
      render: (p) =>
        p.memberSince ? (
          <span className="text-sm">
            {new Date(p.memberSince).toLocaleDateString("pt-BR", {
              month: "short",
              year: "numeric",
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "distance",
      label: "Distância",
      icon: <Navigation className="size-4 text-emerald-600" />,
      render: (p) =>
        p.distanceKm != null ? (
          <div className="flex items-center gap-1.5">
            <Navigation className="size-3.5 text-emerald-600" />
            <span className="text-sm font-medium">
              {p.distanceKm < 1
                ? `${Math.round(p.distanceKm * 1000)} m`
                : `${p.distanceKm.toFixed(1)} km`}
            </span>
            {closestDistance !== null &&
            p.distanceKm === closestDistance &&
            closestDistance < 9999 ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
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
      label: "Localização",
      icon: <MapPin className="text-muted-foreground size-4" />,
      render: (p) => (
        <span className="text-sm">{[p.district, p.city].filter(Boolean).join(", ") || "—"}</span>
      ),
    },
    {
      key: "radius",
      label: "Raio de atendimento",
      icon: <MapPin className="text-muted-foreground size-4" />,
      render: (p) =>
        p.radiusKm ? (
          <span className="text-sm">{p.radiusKm} km</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "availability",
      label: "Expediente",
      icon: <Clock className="text-muted-foreground size-4" />,
      render: (p) => <span className="text-sm">{weeklySummary(p)}</span>,
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
                className="bg-emerald-50 text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                {c}
              </Badge>
            ))}
          </div>
        )
      },
    },
    {
      key: "whatsapp",
      label: "WhatsApp",
      icon: <span className="text-xs font-bold text-emerald-600">W</span>,
      render: (p) =>
        p.whatsapp ? (
          <span className="text-sm">{p.whatsapp}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeCompare()}>
      <DialogContent className="max-w-6xl gap-0 overflow-hidden p-0 sm:rounded-xl">
        {/* Header */}
        <DialogHeader className="to-background border-b bg-gradient-to-r from-emerald-50 px-5 py-4 dark:from-emerald-950/30">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg shadow-sm">
                <GitCompare className="size-5" />
              </span>
              <div>
                <DialogTitle className="text-lg font-bold">Comparar prestadores</DialogTitle>
                <DialogDescription className="text-xs">
                  {providers.length > 0
                    ? `${providers.length} prestador(es) selecionado(s) — limite ${MAX_COMPARE}`
                    : "Selecione prestadores na vitrine para comparar"}
                </DialogDescription>
              </div>
            </div>
            {ids.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clear()
                  toast.success("Comparação limpa.")
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                Limpar tudo
              </Button>
            ) : null}
          </div>
        </DialogHeader>

        {/* Body */}
        {ids.length === 0 ? (
          <EmptyCompare />
        ) : (
          <ScrollArea className="max-h-[70vh]">
            <div className="px-5 py-5">
              {isLoading ? (
                <CompareSkeleton count={ids.length} rows={rows.length} />
              ) : providers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <X className="text-muted-foreground size-10" />
                  <p className="text-muted-foreground mt-3 text-sm">
                    Não foi possível carregar os prestadores selecionados.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <th className="bg-background text-muted-foreground sticky left-0 z-10 w-44 p-3 text-left align-top text-xs font-semibold tracking-wide uppercase">
                          Critério
                        </th>
                        {providers.map((p) => (
                          <th
                            key={p.id}
                            className="border-border/60 bg-background min-w-[200px] border-l p-3 text-left align-top"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5">
                                <Avatar className="border-card size-11 border-2 shadow-sm">
                                  {p.avatarUrl ? (
                                    <AvatarImage src={p.avatarUrl} alt={p.name} />
                                  ) : null}
                                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                                    {initialsOf(p.name)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="truncate text-sm leading-tight font-bold">
                                    {p.name}
                                  </p>
                                  {p.verified ? (
                                    <Badge
                                      variant="secondary"
                                      className="mt-1 gap-1 bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                    >
                                      <ShieldCheck className="size-3" />
                                      Verificado
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => remove(p.id)}
                                aria-label={`Remover ${p.name} da comparação`}
                                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-6 shrink-0 items-center justify-center rounded-full transition"
                              >
                                <X className="size-4" />
                              </button>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => (
                        <tr key={row.key} className="group">
                          <td
                            className={cn(
                              "bg-background text-muted-foreground sticky left-0 z-10 w-44 p-3 align-top text-xs font-medium tracking-wide uppercase",
                              idx > 0 && "border-border/40 border-t",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-600 dark:text-emerald-400">
                                {row.icon}
                              </span>
                              <span>{row.label}</span>
                            </div>
                          </td>
                          {providers.map((p) => (
                            <td
                              key={`${p.id}-${row.key}`}
                              className={cn(
                                "border-border/40 border-t border-l p-3 align-top",
                                idx % 2 === 1 && "bg-muted/20",
                              )}
                            >
                              {row.render(p)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {/* Bio row — spans full width */}
                      <tr>
                        <td className="border-border/40 bg-background text-muted-foreground sticky left-0 z-10 w-44 border-t p-3 align-top text-xs font-medium tracking-wide uppercase">
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
                            className="border-border/40 bg-muted/20 border-t border-l p-3 align-top"
                          >
                            <p className="text-muted-foreground line-clamp-3 text-xs">
                              {p.bio || "Sem descrição."}
                            </p>
                          </td>
                        ))}
                      </tr>
                      {/* Actions row */}
                      <tr>
                        <td className="border-border/40 bg-background text-muted-foreground sticky left-0 z-10 w-44 border-t p-3 align-top text-xs font-medium tracking-wide uppercase">
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-600 dark:text-emerald-400">
                              <Calendar className="size-4" />
                            </span>
                            <span>Ações</span>
                          </div>
                        </td>
                        {providers.map((p) => (
                          <td
                            key={`${p.id}-actions`}
                            className="border-border/40 border-t border-l p-3 align-top"
                          >
                            <div className="flex flex-col gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  closeCompare()
                                  openQuote({ providerId: p.id })
                                }}
                                className="border-primary/30 text-primary hover:border-primary hover:bg-primary/10 h-8 w-full gap-1.5 text-xs"
                              >
                                <FileText className="size-3.5" />
                                Orçamento
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => {
                                  closeCompare()
                                  openBooking({ providerId: p.id })
                                }}
                                className="h-8 w-full gap-1.5 text-xs"
                              >
                                <Calendar className="size-3.5" />
                                Agendar
                              </Button>
                            </div>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Helper note */}
              {providers.length > 0 ? (
                <p className="text-muted-foreground mt-4 flex items-center gap-1.5 text-xs">
                  <Trophy className="size-3.5 text-amber-500" />
                  Destaque nos critérios: melhor avaliação, menor preço, mais experiências e mais
                  próximo.
                </p>
              ) : null}
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

function CompareSkeleton({ count, rows }: { count: number; rows: number }) {
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
