"use client"
import Image from "next/image"

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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  GitCompare,
  Heart,
  MapPin,
  Navigation,
  Phone,
  Quote,
  Share2,
  ShieldCheck,
  Star,
  Wrench,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"

import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"

import { useUIStore } from "@/store/ui"
import { useCompareStore, MAX_COMPARE } from "@/store/compare"
import { useRecentlyViewedStore } from "@/store/recently-viewed"
import { useIsMobile } from "@/hooks/use-mobile"
import { fetchProviderDetail, type ProviderDetail, type ProviderService } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { SERVICE_UNIT_SHORT, WEEKDAYS, WEEKDAYS_SHORT } from "@/lib/constants"
import { StarRatingDisplay } from "./star-rating"
import { cn } from "@/lib/utils"
import { useGeoStore } from "@/store/geo"
import dynamic from "next/dynamic"

// Mini map — client-only, lazy loaded
const ProviderMiniMap = dynamic(() => import("@/components/shared/provider-mini-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-48 w-full rounded-xl" />,
})

function formatPhoneBR(raw?: string | null): string {
  if (!raw) return ""
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 13 && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4)
    const part1 = digits.slice(4, 9)
    const part2 = digits.slice(9, 13)
    return `+55 (${ddd}) ${part1}-${part2}`
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  }
  return raw
}

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
        className="w-[95vw] max-w-[95vw] min-w-0 gap-0 overflow-hidden rounded-2xl border p-0 shadow-2xl sm:max-w-3xl lg:max-w-4xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{provider?.name ?? "Perfil do prestador"}</DialogTitle>
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
        isMobile ? "h-full" : "h-[680px] max-h-[88vh]",
      )}
    >
      {/* ── Top Navigation & Window Controls Bar ── */}
      <div className="bg-muted/30 border-border/50 flex shrink-0 items-center justify-between gap-2 border-b px-5 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-1.5">
          {hasNavigation ? (
            <div data-testid="provider-modal-nav" className="flex items-center gap-1">
              <button
                type="button"
                data-testid="provider-nav-prev"
                onClick={onPrevProvider}
                aria-label="Prestador anterior"
                title="Prestador anterior (Tecla ←)"
                className="border-border/60 bg-background hover:bg-muted text-foreground inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border px-2.5 text-xs font-medium shadow-2xs transition-colors"
              >
                <ChevronLeft className="size-3.5" />
                <span className="hidden sm:inline">Anterior</span>
              </button>

              <span className="text-muted-foreground px-2 text-[11px] font-medium tabular-nums">
                {currentIndex + 1} de {totalNavigable}
              </span>

              <button
                type="button"
                data-testid="provider-nav-next"
                onClick={onNextProvider}
                aria-label="Próximo prestador"
                title="Próximo prestador (Tecla →)"
                className="border-border/60 bg-background hover:bg-muted text-foreground inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border px-2.5 text-xs font-medium shadow-2xs transition-colors"
              >
                <span className="hidden sm:inline">Próximo</span>
                <ChevronRight className="size-3.5" />
              </button>

              <span className="text-muted-foreground/70 hidden pl-2 text-[11px] lg:inline">
                Use as setas ← → do teclado para navegar
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck className="size-3.5 text-emerald-600" />
              Perfil Oficial Verificado · Severinno GV
            </span>
          )}
        </div>

        {/* Action buttons — always inside bounds, never clipped */}
        <div className="flex shrink-0 items-center gap-1">
          {provider && (
            <button
              type="button"
              onClick={handleCompare}
              aria-label={inCompare ? "Remover da comparação" : "Comparar prestador"}
              title="Comparar prestador"
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors",
                inCompare
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors"
          >
            <Share2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={onFavorite}
            aria-label={favorited ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            aria-pressed={favorited}
            title="Favoritar"
            className={cn(
              "inline-flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors",
              favorited
                ? "text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Heart className={cn("size-4", favorited && "fill-current")} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* ── Compact Identity Header ── */}
      <div className="shrink-0 px-5 pt-4 pb-3.5 sm:px-6">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="relative shrink-0">
            <Avatar className="border-border/60 size-15 rounded-2xl border shadow-xs">
              {provider?.avatarUrl ? (
                <AvatarImage
                  src={provider.avatarUrl}
                  alt={provider.name}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback className="rounded-2xl bg-emerald-100 text-lg font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {provider?.name?.[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            {provider?.verified && (
              <span className="ring-background absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white ring-2">
                <BadgeCheck className="size-3" />
              </span>
            )}
          </div>

          {/* Name + Unified Metadata */}
          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-48 rounded" />
                <Skeleton className="h-3.5 w-32 rounded" />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-foreground truncate text-base leading-tight font-bold sm:text-lg">
                    {provider?.name}
                  </h2>
                  {provider?.verified && (
                    <Badge
                      data-testid="badge"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800"
                    >
                      <BadgeCheck className="size-3" /> Verificado
                    </Badge>
                  )}
                </div>

                <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {provider && (
                    <StarRatingDisplay
                      value={provider.rating}
                      count={provider.reviewCount}
                      size={12}
                    />
                  )}
                  {(provider?.district || provider?.city) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="text-muted-foreground/70 size-3.5 shrink-0" />
                      <span className="truncate">
                        {provider.district ? `${provider.district}, ` : ""}
                        {provider.city}
                        {provider.state ? `/${provider.state}` : ""}
                      </span>
                    </span>
                  )}
                  {provider?.distanceKm != null && (
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                      <Navigation className="size-3 shrink-0" />
                      {provider.distanceKm < 1
                        ? `${Math.round(provider.distanceKm * 1000)} m`
                        : `${provider.distanceKm.toFixed(1)} km`}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Uniform 4-Column Stat Strip ── */}
        {!loading && provider && (
          <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatPill
              icon={<Wrench className="size-3.5" />}
              value={provider.services.length}
              label="Serviços"
            />
            <StatPill
              icon={<Navigation className="size-3.5" />}
              value={
                provider.distanceKm != null
                  ? provider.distanceKm < 1
                    ? `${Math.round(provider.distanceKm * 1000)} m`
                    : `${provider.distanceKm.toFixed(1)} km`
                  : `${provider.radiusKm ?? 25} km`
              }
              label={provider.distanceKm != null ? "Distância" : "Cobertura"}
            />
            <StatPill
              icon={<Calendar className="size-3.5" />}
              value={memberYear}
              label="Membro desde"
            />
            <StatPill
              icon={<ShieldCheck className="size-3.5 text-emerald-600" />}
              value="Escrow PIX"
              label="Garantia 90d"
            />
          </div>
        )}
      </div>

      <Separator />

      {/* ── Tabs with Fixed Scrollable Viewport ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Tabs defaultValue="services" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="bg-background shrink-0 px-5 sm:px-6">
            <TabsList className="border-border flex h-auto w-full justify-start gap-1 border-b bg-transparent p-0">
              {(["services", "about", "reviews", "hours"] as const).map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="text-muted-foreground data-[state=active]:text-foreground hover:text-foreground relative cursor-pointer rounded-none border-b-2 border-transparent px-4 pt-2 pb-2.5 text-xs font-semibold transition-colors data-[state=active]:border-emerald-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  {tab === "services"
                    ? "Serviços"
                    : tab === "about"
                      ? "Sobre"
                      : tab === "reviews"
                        ? "Avaliações"
                        : "Expediente"}
                  {tab === "services" && provider && provider.services.length > 0 && (
                    <span className="text-muted-foreground ml-1 text-[10px]">
                      ({provider.services.length})
                    </span>
                  )}
                  {tab === "reviews" && provider && provider.reviewCount > 0 && (
                    <span className="text-muted-foreground ml-1 text-[10px]">
                      ({provider.reviewCount})
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <ScrollArea className="min-h-0 w-full flex-1 overflow-x-hidden [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full [&_[data-slot=scroll-area-viewport]>div]:!min-w-0">
            <TabsContent
              value="services"
              className="m-0 w-full min-w-0 px-5 py-4 focus-visible:outline-none sm:px-6"
            >
              <ServicesTab
                services={provider?.services ?? []}
                loading={loading}
                onQuote={onQuote}
                onBooking={onBooking}
              />
            </TabsContent>
            <TabsContent
              value="about"
              className="m-0 w-full min-w-0 px-5 py-4 focus-visible:outline-none sm:px-6"
            >
              <AboutTab provider={provider} loading={loading} />
            </TabsContent>
            <TabsContent
              value="reviews"
              className="m-0 w-full min-w-0 px-5 py-4 focus-visible:outline-none sm:px-6"
            >
              <ReviewsTab
                reviews={provider?.reviews ?? []}
                rating={provider?.rating}
                reviewCount={provider?.reviewCount}
                loading={loading}
              />
            </TabsContent>
            <TabsContent
              value="hours"
              className="m-0 w-full min-w-0 px-5 py-4 focus-visible:outline-none sm:px-6"
            >
              <HoursTab availability={provider?.availability ?? []} loading={loading} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {/* ── Sticky Footer CTA ── */}
      <div className="bg-background border-border/60 shrink-0 border-t px-5 py-3 sm:px-6">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="hidden min-w-0 sm:block">
            <div className="flex items-center gap-2">
              {minServicePrice != null ? (
                <span className="text-foreground text-sm font-bold">
                  A partir de {formatBRL(minServicePrice)}
                </span>
              ) : (
                <span className="text-foreground text-sm font-semibold">Orçamento sob medida</span>
              )}
              <span className="text-muted-foreground text-xs">·</span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                Pagamento só após aprovação
              </span>
            </div>
          </div>

          <div className="flex flex-1 gap-2.5 sm:max-w-md">
            <Button
              onClick={() => onQuote()}
              variant="outline"
              className="border-border/70 hover:bg-muted/60 h-10 flex-1 cursor-pointer rounded-xl text-xs font-semibold transition-colors"
            >
              <Quote className="mr-1.5 size-3.5" />
              Pedir orçamento
            </Button>
            <Button
              onClick={() => onBooking()}
              className="h-10 flex-1 cursor-pointer rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
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

// ---------------------------------------------------------------------------
// Stat Pill — uniform metric card
// ---------------------------------------------------------------------------

function StatPill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode
  value: string | number
  label: string
}) {
  return (
    <div className="bg-muted/40 border-border/50 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0 truncate">
        <span className="text-foreground font-bold tabular-nums">{value}</span>{" "}
        <span className="text-muted-foreground text-[11px]">{label}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Services tab — clean grouped service cards with aligned actions
// ---------------------------------------------------------------------------

function ServicesTab({
  services,
  loading,
  onQuote,
  onBooking,
}: {
  services: ProviderService[]
  loading: boolean
  onQuote: (serviceId?: string) => void
  onBooking: (serviceId?: string) => void
}) {
  // Group by category
  const groups = React.useMemo(() => {
    const g = new Map<string, ProviderService[]>()
    for (const s of services) {
      const key = s.category?.name ?? "Outros"
      const arr = g.get(key) ?? []
      arr.push(s)
      g.set(key, arr)
    }
    return g
  }, [services])

  const [expandedCats, setExpandedCats] = React.useState<Set<string>>(() => new Set(groups.keys()))

  // Sync when services change
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setExpandedCats(new Set(groups.keys())))
    return () => cancelAnimationFrame(id)
  }, [groups])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (services.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="Nenhum serviço"
        description="Este prestador ainda não publicou serviços."
      />
    )
  }

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <div className="w-full min-w-0 space-y-3.5">
      {Array.from(groups.entries()).map(([categoryName, items]) => {
        const expanded = expandedCats.has(categoryName)
        return (
          <div key={categoryName} className="w-full min-w-0">
            {/* Category header */}
            <button
              type="button"
              onClick={() => toggleCat(categoryName)}
              className="hover:bg-muted/50 mb-1.5 flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <Wrench className="size-3.5" />
                </span>
                <span className="text-xs font-bold">{categoryName}</span>
                <span className="text-muted-foreground text-[11px]">({items.length})</span>
              </div>
              {expanded ? (
                <ChevronUp className="text-muted-foreground size-3.5" />
              ) : (
                <ChevronDown className="text-muted-foreground size-3.5" />
              )}
            </button>

            {/* Service items */}
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2 pb-1">
                    {items.map((s) => (
                      <ServiceCard
                        key={s.id}
                        service={s}
                        onQuote={() => onQuote(s.id)}
                        onBooking={() => onBooking(s.id)}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

function ServiceCard({
  service,
  onQuote,
  onBooking,
}: {
  service: ProviderService
  onQuote: () => void
  onBooking: () => void
}) {
  const photos = service.photos ?? []

  return (
    <div className="group border-border/60 bg-card hover:border-border w-full min-w-0 overflow-hidden rounded-xl border transition-all hover:shadow-2xs">
      <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* Photo thumbnail */}
          {photos.length > 0 ? (
            <div className="bg-muted relative size-12 shrink-0 overflow-hidden rounded-lg">
              <Image
                src={photos[0]}
                alt={service.title}
                fill
                sizes="48px"
                className="object-cover"
                loading="lazy"
              />
            </div>
          ) : (
            <div className="bg-muted/70 text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-lg">
              <Wrench className="size-4" />
            </div>
          )}

          {/* Info */}
          <div className="min-w-0 flex-1">
            <h4 className="text-foreground truncate text-sm leading-tight font-semibold transition-colors group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
              {service.title}
            </h4>
            {service.description && (
              <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-relaxed">
                {service.description}
              </p>
            )}
            <div className="mt-1.5 inline-flex items-baseline gap-1">
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                {formatBRL(Number(service.basePrice))}
              </span>
              <span className="text-muted-foreground text-[11px]">
                /{SERVICE_UNIT_SHORT[service.unit as keyof typeof SERVICE_UNIT_SHORT] ?? "un"}
              </span>
            </div>
          </div>
        </div>

        {/* Actions — side-by-side on desktop, never clipped */}
        <div className="flex shrink-0 items-center gap-2 sm:pl-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onQuote}
            className="border-border/60 hover:bg-muted/60 h-8 cursor-pointer rounded-lg px-3 text-xs font-medium"
          >
            <Quote className="mr-1 size-3" /> Orçamento
          </Button>
          <Button
            size="sm"
            onClick={onBooking}
            className="bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground h-8 cursor-pointer rounded-lg px-3 text-xs font-semibold shadow-none transition-colors"
          >
            <Calendar className="mr-1 size-3" /> Agendar
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// About tab — clean info sections & properly contained map
// ---------------------------------------------------------------------------

function AboutTab({ provider, loading }: { provider?: ProviderDetail; loading: boolean }) {
  const userLat = useGeoStore((s) => s.lat)
  const userLng = useGeoStore((s) => s.lng)
  const [previewRadius, setPreviewRadius] = React.useState<number | null>(null)

  const handleRadiusChange = React.useCallback((km: number) => {
    setPreviewRadius(km)
  }, [])

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-3 w-3/4 rounded" />
        <Skeleton className="h-3 w-2/3 rounded" />
      </div>
    )
  }

  const effectiveRadius = previewRadius ?? provider?.radiusKm ?? 25
  const hasProviderCoords =
    typeof provider?.lat === "number" &&
    typeof provider?.lng === "number" &&
    Number.isFinite(provider.lat) &&
    Number.isFinite(provider.lng)

  const formattedAddress = [provider?.address, provider?.district].filter(Boolean).join(", ")

  return (
    <div className="w-full min-w-0 space-y-4 text-sm">
      {/* Bio Card */}
      <div className="bg-muted/30 border-border/50 rounded-xl border p-4">
        <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
          Apresentação Profissional
        </p>
        {provider?.bio ? (
          <p className="text-foreground/90 text-xs leading-relaxed whitespace-pre-line sm:text-sm">
            {provider.bio}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs italic">Sem descrição cadastrada.</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="bg-background border-border/50 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium">
            <CheckCircle2 className="size-3 text-emerald-600" />
            Antecedentes & CPF/CNPJ Verificados
          </span>
          <span className="bg-background border-border/50 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium">
            <ShieldCheck className="size-3 text-emerald-600" />
            Custódia PIX + Garantia 90 dias
          </span>
        </div>
      </div>

      {/* Mini map with radius circle — strictly contained so slider never overflows */}
      {hasProviderCoords ? (
        <div className="border-border/50 bg-card w-full min-w-0 overflow-hidden rounded-xl border p-3">
          <ProviderMiniMap
            providerLat={provider!.lat!}
            providerLng={provider!.lng!}
            providerName={provider!.name}
            userLat={userLat}
            userLng={userLng}
            radiusKm={effectiveRadius}
            accuracyM={provider!.gpsAccuracyM}
            onRadiusChange={handleRadiusChange}
            height={190}
            className="w-full max-w-full overflow-hidden"
          />
          {provider!.gpsAccuracyM != null && provider!.gpsAccuracyM > 0 ? (
            <p className="text-muted-foreground mt-1.5 text-[11px]">
              Círculo pontilhado âmbar = precisão do último GPS (±
              {provider!.gpsAccuracyM >= 1000
                ? ` ${(provider!.gpsAccuracyM / 1000).toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })} km`
                : ` ${Math.round(provider!.gpsAccuracyM)} m`}
              ).
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Info grid */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Address */}
        <div className="border-border/50 bg-card flex items-start gap-2.5 rounded-xl border p-3">
          <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
            <MapPin className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              Endereço
            </p>
            <p className="mt-0.5 text-xs leading-relaxed font-medium">
              {formattedAddress || "Atendimento em Domicílio"}
              <br />
              <span className="text-muted-foreground font-normal">
                {provider?.city}
                {provider?.state ? `/${provider.state}` : ""}
                {provider?.cep ? ` · CEP ${provider.cep}` : ""}
              </span>
            </p>
          </div>
        </div>

        {/* Coverage */}
        <div className="border-border/50 bg-card flex items-start gap-2.5 rounded-xl border p-3">
          <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Navigation className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              Área de cobertura
            </p>
            <p className="mt-0.5 text-xs leading-relaxed">
              Raio de{" "}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {effectiveRadius} km
              </strong>
              <br />
              <span className="text-muted-foreground text-[11px]">
                Atende todos os bairros no raio
              </span>
            </p>
          </div>
        </div>

        {/* Contact */}
        <div className="border-border/50 bg-card flex items-start gap-2.5 rounded-xl border p-3">
          <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Phone className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              WhatsApp
            </p>
            <p className="mt-0.5 truncate text-xs font-medium">
              {provider?.whatsapp ? formatPhoneBR(provider.whatsapp) : "Via Plataforma"}
            </p>
            <span className="text-muted-foreground text-[11px]">Contato verificado</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reviews tab — clean, unclipped cards
// ---------------------------------------------------------------------------

function ReviewsTab({
  reviews,
  rating,
  reviewCount,
  loading,
}: {
  reviews: ProviderDetail["reviews"]
  rating?: number
  reviewCount?: number
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-xl" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (!reviews || reviews.length === 0) {
    return (
      <EmptyState
        icon={Star}
        title="Sem avaliações"
        description="As avaliações aparecerão aqui após a conclusão de serviços."
      />
    )
  }

  const distribution = [5, 4, 3, 2, 1].map((star) => {
    const count = reviews.filter((r) => Math.round(r.rating) === star).length
    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0
    return { star, count, pct }
  })
  const avg = rating ?? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Summary row */}
      <div className="bg-muted/30 border-border/50 flex items-center gap-5 rounded-xl border p-4">
        <div className="shrink-0 text-center">
          <p className="text-3xl font-extrabold tabular-nums">{avg.toFixed(1)}</p>
          <StarRatingDisplay
            value={avg}
            showCount={false}
            size={12}
            className="mt-1 justify-center"
          />
          <p className="text-muted-foreground mt-1 text-[11px]">
            {reviewCount ?? reviews.length}{" "}
            {(reviewCount ?? reviews.length) === 1 ? "avaliação" : "avaliações"}
          </p>
        </div>
        <div className="grid min-w-0 flex-1 gap-1.5">
          {distribution.map((d) => (
            <div key={d.star} className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground w-2.5 text-right tabular-nums">{d.star}</span>
              <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" strokeWidth={0} />
              <div className="bg-muted relative h-2 flex-1 overflow-hidden rounded-full">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${d.pct}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="absolute inset-y-0 left-0 rounded-full bg-amber-400"
                />
              </div>
              <span className="text-muted-foreground w-5 text-right text-[11px] tabular-nums">
                {d.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Review cards */}
      <div className="space-y-2.5">
        {reviews.map((r, idx) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04, duration: 0.2 }}
            className="border-border/60 bg-card w-full min-w-0 rounded-xl border p-3.5"
          >
            <div className="flex items-center gap-3">
              <Avatar className="size-9 shrink-0 rounded-full">
                {r.author?.avatarUrl ? (
                  <AvatarImage src={r.author.avatarUrl} alt={r.author.name} />
                ) : null}
                <AvatarFallback className="bg-muted rounded-full text-xs font-semibold">
                  {r.author?.name?.[0]?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold">{r.author?.name ?? "Cliente"}</p>
                  <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <StarRatingDisplay
                  value={r.rating}
                  size={11}
                  showCount={false}
                  className="mt-0.5"
                />
              </div>
            </div>
            {r.comment && (
              <p className="text-muted-foreground mt-2.5 text-xs leading-relaxed">{r.comment}</p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hours tab — clean 7-day schedule table
// ---------------------------------------------------------------------------

function HoursTab({
  availability,
  loading,
}: {
  availability: ProviderDetail["availability"]
  loading: boolean
}) {
  if (loading) return <Skeleton className="h-40 w-full rounded-xl" />

  const byDay = new Map<number, { start: string; end: string }[]>()
  for (const a of availability ?? []) {
    const arr = byDay.get(a.dayOfWeek) ?? []
    arr.push({ start: a.startTime, end: a.endTime })
    byDay.set(a.dayOfWeek, arr)
  }

  const today = new Date().getDay()

  // Currently open?
  const now = new Date()
  const todaySlots = byDay.get(today) ?? []
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const currentlyOpen = todaySlots.some((s) => {
    const [sh, sm] = s.start.split(":").map(Number)
    const [eh, em] = s.end.split(":").map(Number)
    return currentMinutes >= sh * 60 + sm && currentMinutes <= eh * 60 + em
  })

  return (
    <div className="w-full min-w-0 space-y-3.5">
      {/* Status banner */}
      <div className="bg-muted/30 border-border/50 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5">
        <div
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
            currentlyOpen
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
          )}
        >
          <span
            className={cn("size-2 rounded-full", currentlyOpen ? "bg-emerald-500" : "bg-amber-500")}
          />
          {currentlyOpen ? "Aberto agora" : "Fechado agora"}
        </div>

        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <Clock className="size-3.5" />
          Agendamento online disponível 24h
        </span>
      </div>

      {/* Compact day rows */}
      <div className="border-border/60 divide-y overflow-hidden rounded-xl border">
        {WEEKDAYS.map((day, i) => {
          const slots = byDay.get(i) ?? []
          const open = slots.length > 0
          const isToday = i === today
          return (
            <div
              key={day}
              className={cn(
                "flex items-center justify-between gap-3 px-4 py-2.5 text-xs transition-colors",
                isToday ? "bg-emerald-50/60 dark:bg-emerald-950/20" : "bg-card",
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn("truncate font-medium", isToday && "font-bold")}>
                  <span className="hidden sm:inline">{day}</span>
                  <span className="sm:hidden">{WEEKDAYS_SHORT[i]}</span>
                </span>
                {isToday && (
                  <Badge className="rounded bg-emerald-100 px-1.5 py-0 text-[9px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                    hoje
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {slots.length === 0 ? (
                  <span className="text-muted-foreground text-xs">—</span>
                ) : (
                  <span className="text-foreground font-mono text-xs font-medium">
                    {slots.map((s) => `${s.start}–${s.end}`).join(", ")}
                  </span>
                )}
                <Badge
                  variant={open ? "default" : "outline"}
                  className={cn(
                    "min-w-16 justify-center rounded-md px-2 py-0.5 text-[10px]",
                    open
                      ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "text-muted-foreground",
                  )}
                >
                  {open ? "Aberto" : "Fechado"}
                </Badge>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="bg-muted text-muted-foreground rounded-xl p-3">
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 max-w-xs text-[11px]">{description}</p>
      </div>
    </div>
  )
}
