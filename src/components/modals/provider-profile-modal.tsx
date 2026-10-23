"use client"

/**
 * ProviderProfileModal — Uniform, widescreen-ready, clean & minimalist desktop modal
 * with seamless Previous/Next provider navigation (buttons + keyboard arrows).
 *
 * Key guarantees:
 *   - Fixed uniform desktop dimensions (sm:max-w-3xl lg:max-w-4xl, h-[680px] max-h-[88vh])
 *     so switching tabs or navigating across providers NEVER causes height/width jumps.
 *   - Overrides Radix ScrollArea's internal `display: table` wrapper with `!block !w-full !min-w-0`
 *     so long text, map sliders, review dates, and badges NEVER overflow or clip on the right edge.
 *   - Built-in Previous / Next provider navigation bar + ArrowLeft / ArrowRight keyboard shortcuts.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BadgeCheck,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GitCompare,
  Heart,
  MapPin,
  Navigation,
  Quote,
  Share2,
  ShieldCheck,
  Star,
  Wrench,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"

import { useUIStore } from "@/store/ui"
import { useCompareStore, MAX_COMPARE } from "@/store/compare"
import { useRecentlyViewedStore } from "@/store/recently-viewed"
import { useIsMobile } from "@/hooks/use-mobile"
import { fetchProviderDetail, type ProviderDetail } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { StarRatingDisplay } from "./star-rating"
import { cn } from "@/lib/utils"
import { useGeoStore } from "@/store/geo"
import { decodeEntities, ServicesTab, AboutTab, ReviewsTab, HoursTab } from "./provider-profile"

// ---------------------------------------------------------------------------
// Main modal wrapper
// ---------------------------------------------------------------------------

export function ProviderProfileModal() {
  const open = useUIStore((s) => s.providerModal.open)
  const providerId = useUIStore((s) => s.providerModal.providerId)
  const openProvider = useUIStore((s) => s.openProvider)
  const close = useUIStore((s) => s.closeProvider)
  const openQuote = useUIStore((s) => s.openQuote)
  const openBooking = useUIStore((s) => s.openBooking)
  const addRecentlyViewed = useRecentlyViewedStore((s) => s.addView)
  const isMobile = useIsMobile()

  const { lat, lng } = useGeoStore()

  // Collect ordered provider IDs currently present on the Vitrine page for seamless Prev/Next navigation
  const [navigableIds, setNavigableIds] = React.useState<string[]>([])

  React.useEffect(() => {
    if (!open || typeof document === "undefined") return
    const raf = requestAnimationFrame(() => {
      const nodes = document.querySelectorAll<HTMLElement>("[data-provider-id]")
      const seen = new Set<string>()
      const list: string[] = []
      nodes.forEach((el) => {
        const id = el.getAttribute("data-provider-id")
        if (id && !seen.has(id)) {
          seen.add(id)
          list.push(id)
        }
      })
      if (providerId && !seen.has(providerId)) {
        list.unshift(providerId)
      }
      setNavigableIds(list)
    })
    return () => cancelAnimationFrame(raf)
  }, [open, providerId])

  const currentIndex = React.useMemo(() => {
    if (!providerId || navigableIds.length === 0) return -1
    return navigableIds.indexOf(providerId)
  }, [providerId, navigableIds])

  const hasNavigation = navigableIds.length > 1 && currentIndex !== -1

  const handlePrevProvider = React.useCallback(() => {
    if (!hasNavigation) return
    const prevIdx = (currentIndex - 1 + navigableIds.length) % navigableIds.length
    const targetId = navigableIds[prevIdx]
    if (targetId) openProvider(targetId)
  }, [hasNavigation, currentIndex, navigableIds, openProvider])

  const handleNextProvider = React.useCallback(() => {
    if (!hasNavigation) return
    const nextIdx = (currentIndex + 1) % navigableIds.length
    const targetId = navigableIds[nextIdx]
    if (targetId) openProvider(targetId)
  }, [hasNavigation, currentIndex, navigableIds, openProvider])

  // Keyboard navigation (ArrowLeft / ArrowRight)
  React.useEffect(() => {
    if (!open || !hasNavigation) return
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        handlePrevProvider()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        handleNextProvider()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, hasNavigation, handlePrevProvider, handleNextProvider])

  const query = useQuery({
    queryKey: ["provider", providerId, lat, lng],
    queryFn: async () => {
      const { lat: currentLat, lng: currentLng } = useGeoStore.getState()
      return fetchProviderDetail(providerId!, {
        lat: currentLat ?? undefined,
        lng: currentLng ?? undefined,
      })
    },
    enabled: open && !!providerId,
    staleTime: 60 * 1000,
  })

  const provider = query.data
  const [favorited, setFavorited] = React.useState(false)

  React.useEffect(() => {
    const id = requestAnimationFrame(() => setFavorited(false))
    return () => cancelAnimationFrame(id)
  }, [providerId])

  React.useEffect(() => {
    if (open && provider) addRecentlyViewed(provider)
  }, [open, provider, addRecentlyViewed])

  // Preload the mini-map bundle as soon as the modal opens (parallel with data fetch)
  React.useEffect(() => {
    if (open) {
      import("@/components/shared/provider-mini-map")
        .then((m) => m.preloadMaplibreGl?.())
        .catch(() => {
          /* preload may fail silently on slow networks */
        })
    }
  }, [open])

  const handleFavorite = async () => {
    setFavorited((v) => !v)
    toast.success(favorited ? "Removido dos favoritos." : "Adicionado aos favoritos!")
  }

  const handleShare = async () => {
    if (!provider) return
    const url = `${window.location.origin}/?provider=${provider.id}`
    try {
      if (navigator.share) {
        await navigator.share({
          title: provider.name,
          text: `Conheça ${provider.name} no Severinno`,
          url,
        })
      } else {
        await navigator.clipboard.writeText(url)
        toast.success("Link copiado.")
      }
    } catch {
      /* user dismissed */
    }
  }

  const startQuote = (serviceId?: string) => {
    if (!provider) return
    close()
    setTimeout(() => openQuote({ providerId: provider.id, serviceId }), 200)
  }
  const startBooking = (serviceId?: string) => {
    if (!provider) return
    close()
    setTimeout(() => openBooking({ providerId: provider.id, serviceId }), 200)
  }

  const content = (
    <ProfileBody
      provider={provider}
      loading={query.isLoading}
      favorited={favorited}
      onFavorite={handleFavorite}
      onShare={handleShare}
      onClose={close}
      onQuote={startQuote}
      onBooking={startBooking}
      hasNavigation={hasNavigation}
      currentIndex={currentIndex}
      totalNavigable={navigableIds.length}
      onPrevProvider={handlePrevProvider}
      onNextProvider={handleNextProvider}
      isMobile={isMobile}
    />
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && close()}>
        <SheetContent
          side="bottom"
          className="flex h-[100dvh] max-h-[100dvh] w-full flex-col gap-0 p-0 sm:max-w-full [&_[data-slot=sheet-close]]:hidden"
        >
          <SheetTitle className="sr-only">{provider?.name ?? "Perfil do prestador"}</SheetTitle>
          <SheetDescription className="sr-only">
            Detalhes do prestador de serviços.
          </SheetDescription>
          <div className="flex-1 overflow-hidden">{content}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="border-border/70 bg-background w-[95vw] max-w-[95vw] min-w-0 gap-0 overflow-hidden rounded-3xl border p-0 shadow-2xl sm:max-w-3xl lg:max-w-4xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">
          {decodeEntities(provider?.name) || "Perfil do prestador"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Detalhes do prestador de serviços.
        </DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Profile Body — Fixed uniform dimensions on desktop, zero layout shift
// ---------------------------------------------------------------------------

function ProfileBody({
  provider,
  loading,
  favorited,
  onFavorite,
  onShare,
  onClose,
  onQuote,
  onBooking,
  hasNavigation,
  currentIndex,
  totalNavigable,
  onPrevProvider,
  onNextProvider,
  isMobile,
}: {
  provider?: ProviderDetail
  loading: boolean
  favorited: boolean
  onFavorite: () => void
  onShare: () => void
  onClose: () => void
  onQuote: (serviceId?: string) => void
  onBooking: (serviceId?: string) => void
  hasNavigation: boolean
  currentIndex: number
  totalNavigable: number
  onPrevProvider: () => void
  onNextProvider: () => void
  isMobile: boolean
}) {
  const compareIds = useCompareStore((s) => s.ids) ?? []
  const toggleCompare = useCompareStore((s) => s.toggle)
  const inCompare = Boolean(provider?.id && compareIds.includes(provider.id))

  const handleCompare = () => {
    if (!provider) return
    if (!inCompare && compareIds.length >= MAX_COMPARE) {
      toast.info(`Você pode comparar até ${MAX_COMPARE} prestadores por vez.`)
      return
    }
    toggleCompare(provider.id)
    toast.success(
      inCompare ? "Removido do comparador." : "Adicionado ao comparador de prestadores!",
    )
  }

  // Resolve memberSince year from either `memberSince` or API's `createdAt`
  const memberYear = React.useMemo(() => {
    if (!provider) return "—"
    const rawDate =
      provider.memberSince ??
      ((provider as unknown as { createdAt?: string }).createdAt || undefined)
    if (!rawDate) return "Verificado"
    const year = new Date(rawDate).getFullYear()
    return Number.isFinite(year) ? String(year) : "Verificado"
  }, [provider])

  // Minimum service price for quick summary
  const minServicePrice = React.useMemo(() => {
    if (!provider?.services || provider.services.length === 0) return null
    const prices = provider.services
      .map((s) => Number(s.basePrice))
      .filter((n) => Number.isFinite(n) && n > 0)
    return prices.length > 0 ? Math.min(...prices) : null
  }, [provider])

  return (
    <div
      className={cn(
        "bg-background flex w-full min-w-0 flex-col overflow-hidden",
        isMobile ? "h-full" : "h-[700px] max-h-[90vh]",
      )}
    >
      {/* ── Top Navigation & Window Controls Bar ── */}
      <div className="bg-muted/20 border-border/40 flex shrink-0 items-center justify-between gap-2 border-b px-5 py-2.5 sm:px-7">
        <div className="flex min-w-0 items-center gap-2">
          {hasNavigation ? (
            <div data-testid="provider-modal-nav" className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="provider-nav-prev"
                onClick={onPrevProvider}
                aria-label="Prestador anterior"
                title="Prestador anterior (Tecla ←)"
                className="border-border/60 bg-background hover:bg-muted text-foreground inline-flex h-7.5 cursor-pointer items-center gap-1 rounded-full border px-3 text-xs font-semibold shadow-2xs transition-all hover:scale-[1.02] active:scale-98"
              >
                <ChevronLeft className="size-3.5" />
                <span className="hidden sm:inline">Anterior</span>
              </button>

              <span className="text-muted-foreground px-2 text-xs font-semibold tabular-nums">
                <span className="text-foreground">{currentIndex + 1}</span> de {totalNavigable}
              </span>

              <button
                type="button"
                data-testid="provider-nav-next"
                onClick={onNextProvider}
                aria-label="Próximo prestador"
                title="Próximo prestador (Tecla →)"
                className="border-border/60 bg-background hover:bg-muted text-foreground inline-flex h-7.5 cursor-pointer items-center gap-1 rounded-full border px-3 text-xs font-semibold shadow-2xs transition-all hover:scale-[1.02] active:scale-98"
              >
                <span className="hidden sm:inline">Próximo</span>
                <ChevronRight className="size-3.5" />
              </button>

              <span className="text-muted-foreground/60 hidden items-center gap-1 pl-2 text-[11px] lg:inline-flex">
                Use as setas{" "}
                <kbd className="border-border/60 bg-muted/50 rounded border px-1 py-0.5 font-mono text-[10px]">
                  ←
                </kbd>{" "}
                <kbd className="border-border/60 bg-muted/50 rounded border px-1 py-0.5 font-mono text-[10px]">
                  →
                </kbd>{" "}
                para navegar
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold">
              <ShieldCheck className="size-4 text-emerald-600" />
              Perfil Oficial Verificado · Severinno
            </span>
          )}
        </div>

        {/* Action buttons — rounded-full, clean, never clipped */}
        <div className="flex shrink-0 items-center gap-1.5">
          {provider && (
            <button
              type="button"
              onClick={handleCompare}
              aria-label={inCompare ? "Remover da comparação" : "Comparar prestador"}
              title="Comparar prestador"
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold shadow-2xs transition-all",
                inCompare
                  ? "bg-emerald-600 text-white"
                  : "border-border/50 bg-background text-muted-foreground hover:bg-muted hover:text-foreground border",
              )}
            >
              <GitCompare className="size-3.5" />
              <span className="hidden sm:inline">{inCompare ? "Comparando" : "Comparar"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onShare}
            aria-label="Compartilhar"
            title="Compartilhar perfil"
            className="border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground bg-background inline-flex size-8 cursor-pointer items-center justify-center rounded-full border shadow-2xs transition-colors"
          >
            <Share2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onFavorite}
            aria-label={favorited ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            aria-pressed={favorited}
            title="Favoritar"
            className={cn(
              "border-border/50 bg-background inline-flex size-8 cursor-pointer items-center justify-center rounded-full border shadow-2xs transition-colors",
              favorited
                ? "border-rose-200 bg-rose-50/50 text-rose-500 dark:border-rose-900/50 dark:bg-rose-950/30"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Heart className={cn("size-3.5", favorited && "fill-current")} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
            className="border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground bg-background inline-flex size-8 cursor-pointer items-center justify-center rounded-full border shadow-2xs transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* ── Compact Identity Header ── */}
      <div className="shrink-0 px-5 pt-5 pb-4 sm:px-7">
        <div className="flex items-start gap-4 sm:gap-5">
          {/* Avatar - 100% Redondo (Requisito Explícito do Usuário) */}
          <div className="relative shrink-0">
            <Avatar className="border-background size-16 overflow-hidden !rounded-full rounded-full border-2 shadow-md ring-4 ring-emerald-500/15 transition-all sm:size-20">
              {provider?.avatarUrl ? (
                <AvatarImage
                  src={provider.avatarUrl}
                  alt={provider.name}
                  className="aspect-square !rounded-full rounded-full object-cover"
                />
              ) : null}
              <AvatarFallback className="!rounded-full rounded-full bg-gradient-to-br from-emerald-100 to-teal-200 text-xl font-black text-emerald-800 dark:from-emerald-950 dark:to-teal-900 dark:text-emerald-200">
                {provider?.name?.[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            {provider?.verified && (
              <span
                className="ring-background absolute -right-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs ring-2"
                title="Perfil Verificado"
              >
                <BadgeCheck className="size-3.5" />
              </span>
            )}
          </div>

          {/* Name + Unified Metadata */}
          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-48 rounded-lg" />
                <Skeleton className="h-4 w-32 rounded-lg" />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-foreground text-lg leading-tight font-black tracking-tight sm:text-xl lg:text-2xl">
                    {decodeEntities(provider?.name)}
                  </h2>
                  {provider?.verified && (
                    <Badge
                      data-testid="badge"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300"
                    >
                      <BadgeCheck className="size-3" /> Verificado
                    </Badge>
                  )}
                </div>

                <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs">
                  {provider && (
                    <StarRatingDisplay
                      value={provider.rating}
                      count={provider.reviewCount}
                      size={13}
                    />
                  )}
                  <span className="text-muted-foreground/30 hidden sm:inline">•</span>
                  {(provider?.district || provider?.city) && (
                    <span className="text-foreground/80 inline-flex items-center gap-1 font-medium">
                      <MapPin className="text-muted-foreground size-3.5 shrink-0" />
                      <span className="truncate">
                        {provider.district ? `${provider.district}, ` : ""}
                        {provider.city}
                        {provider.state ? `/${provider.state}` : ""}
                      </span>
                    </span>
                  )}
                  {provider?.distanceKm != null && (
                    <>
                      <span className="text-muted-foreground/30 hidden sm:inline">•</span>
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                        <Navigation className="size-3 shrink-0" />
                        {provider.distanceKm < 1
                          ? `${Math.round(provider.distanceKm * 1000)} m`
                          : `${provider.distanceKm.toFixed(1)} km`}
                      </span>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Modern Clean Highlight Strip ── */}
        {!loading && provider && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="border-border/40 bg-muted/20 hover:bg-muted/30 flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Wrench className="size-3.5" />
              </span>
              <div className="min-w-0 leading-tight">
                <p className="text-foreground text-xs font-extrabold tabular-nums sm:text-sm">
                  {provider.services.length}
                </p>
                <p className="text-muted-foreground truncate text-[10px]">Serviços ativos</p>
              </div>
            </div>

            <div className="border-border/40 bg-muted/20 hover:bg-muted/30 flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Navigation className="size-3.5" />
              </span>
              <div className="min-w-0 leading-tight">
                <p className="text-foreground text-xs font-extrabold tabular-nums sm:text-sm">
                  {provider.distanceKm != null
                    ? provider.distanceKm < 1
                      ? `${Math.round(provider.distanceKm * 1000)} m`
                      : `${provider.distanceKm.toFixed(1)} km`
                    : `${provider.radiusKm ?? 25} km`}
                </p>
                <p className="text-muted-foreground truncate text-[10px]">
                  {provider.distanceKm != null ? "Distância" : "Cobertura GV"}
                </p>
              </div>
            </div>

            <div className="border-border/40 bg-muted/20 hover:bg-muted/30 flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Calendar className="size-3.5" />
              </span>
              <div className="min-w-0 leading-tight">
                <p className="text-foreground text-xs font-extrabold tabular-nums sm:text-sm">
                  {memberYear}
                </p>
                <p className="text-muted-foreground truncate text-[10px]">Membro desde</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 transition-colors hover:bg-emerald-500/10">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-2xs">
                <ShieldCheck className="size-3.5" />
              </span>
              <div className="min-w-0 leading-tight">
                <p className="text-xs font-extrabold text-emerald-700 sm:text-sm dark:text-emerald-400">
                  Escrow PIX
                </p>
                <p className="text-muted-foreground truncate text-[10px]">Garantia 90 dias</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Tabs with Fixed Scrollable Viewport ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Tabs defaultValue="services" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="bg-background shrink-0 px-5 pt-1 pb-2.5 sm:px-7">
            <TabsList className="bg-muted/40 border-border/50 flex h-auto w-full justify-between gap-1 rounded-2xl border p-1.5 sm:justify-start">
              {(["services", "about", "reviews", "hours"] as const).map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  data-testid="tab-trigger"
                  className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:border-border/60 h-9 flex-1 cursor-pointer rounded-xl px-4 text-xs font-semibold transition-all data-[state=active]:border data-[state=active]:font-bold data-[state=active]:shadow-xs sm:flex-initial"
                >
                  <span className="flex items-center gap-1.5">
                    {tab === "services" && <Wrench className="size-3.5 text-emerald-600" />}
                    {tab === "about" && <ShieldCheck className="size-3.5 text-emerald-600" />}
                    {tab === "reviews" && (
                      <Star className="size-3.5 fill-amber-500/20 text-amber-500" />
                    )}
                    {tab === "hours" && <Clock className="size-3.5 text-blue-500" />}
                    <span>
                      {tab === "services"
                        ? "Serviços"
                        : tab === "about"
                          ? "Sobre"
                          : tab === "reviews"
                            ? "Avaliações"
                            : "Expediente"}
                    </span>
                    {tab === "services" && provider && provider.services.length > 0 && (
                      <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300">
                        ({provider.services.length})
                      </span>
                    )}
                    {tab === "reviews" && provider && provider.reviewCount > 0 && (
                      <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                        ({provider.reviewCount})
                      </span>
                    )}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <ScrollArea className="min-h-0 w-full flex-1 overflow-x-hidden [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full [&_[data-slot=scroll-area-viewport]>div]:!min-w-0">
            <TabsContent
              value="services"
              className="m-0 w-full min-w-0 px-5 py-4 focus-visible:outline-none sm:px-7"
            >
              <ServicesTab
                providerId={provider?.id}
                services={provider?.services ?? []}
                loading={loading}
                onQuote={onQuote}
                onBooking={onBooking}
              />
            </TabsContent>
            <TabsContent
              value="about"
              className="m-0 w-full min-w-0 px-5 py-4 focus-visible:outline-none sm:px-7"
            >
              <AboutTab provider={provider} loading={loading} />
            </TabsContent>
            <TabsContent
              value="reviews"
              className="m-0 w-full min-w-0 px-5 py-4 focus-visible:outline-none sm:px-7"
            >
              <ReviewsTab
                providerName={provider?.name}
                reviews={provider?.reviews ?? []}
                rating={provider?.rating}
                reviewCount={provider?.reviewCount}
                loading={loading}
              />
            </TabsContent>
            <TabsContent
              value="hours"
              className="m-0 w-full min-w-0 px-5 py-4 focus-visible:outline-none sm:px-7"
            >
              <HoursTab
                providerId={provider?.id}
                availability={provider?.availability ?? []}
                loading={loading}
                onBooking={() => onBooking(provider?.services?.[0]?.id)}
                onQuote={() => onQuote(provider?.services?.[0]?.id)}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {/* ── Sticky Footer CTA ── */}
      <div className="bg-background/95 border-border/60 shrink-0 border-t px-5 py-3 backdrop-blur-md sm:px-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="hidden min-w-0 sm:block">
            <div className="flex items-center gap-2.5">
              {minServicePrice != null ? (
                <span className="text-foreground text-sm font-black sm:text-base">
                  A partir de {formatBRL(minServicePrice)}
                </span>
              ) : (
                <span className="text-foreground text-sm font-bold">Orçamento sob medida</span>
              )}
              <span className="text-muted-foreground/40">•</span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5 shrink-0" />
                Pagamento só após aprovação
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              Custódia PIX 100% protegida: seu valor fica retido com segurança até o término do
              serviço.
            </p>
          </div>

          <div className="flex flex-1 gap-2.5 sm:max-w-md">
            <Button
              onClick={() => onQuote()}
              variant="outline"
              className="border-border/80 hover:bg-muted/70 h-10.5 flex-1 cursor-pointer rounded-xl text-xs font-bold shadow-2xs transition-all"
            >
              <Quote className="mr-1.5 size-3.5" />
              Pedir orçamento
            </Button>
            <Button
              onClick={() => onBooking()}
              className="h-10.5 flex-1 cursor-pointer rounded-xl bg-emerald-600 text-xs font-bold text-white shadow-sm shadow-emerald-600/15 transition-all hover:bg-emerald-700 active:scale-98"
            >
              <Calendar className="mr-1.5 size-3.5" />
              Agendar serviço
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
