"use client"
import Image from "next/image"

/**
 * ProviderProfileModal — compact, clean, minimalist redesign.
 *
 * Design principles:
 *   - Minimal chrome, maximum content
 *   - Compact header with inline identity
 *   - Horizontal stat pills
 *   - Clean tabs with subtle underline
 *   - Tight service cards with minimal decoration
 *   - Simple review cards
 *   - Compact hours grid
 *   - Fixed bottom CTA
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BadgeCheck,
  Calendar,
  ChevronDown,
  ChevronUp,
  Heart,
  MapPin,
  Navigation,
  Phone,
  Quote,
  Share2,
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

// ---------------------------------------------------------------------------
// Main modal wrapper
// ---------------------------------------------------------------------------

export function ProviderProfileModal() {
  const open = useUIStore((s) => s.providerModal.open)
  const providerId = useUIStore((s) => s.providerModal.providerId)
  const close = useUIStore((s) => s.closeProvider)
  const openQuote = useUIStore((s) => s.openQuote)
  const openBooking = useUIStore((s) => s.openBooking)
  const addRecentlyViewed = useRecentlyViewedStore((s) => s.addView)
  const isMobile = useIsMobile()

  const { lat, lng } = useGeoStore()

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
  // so the map appears instantly when the user navigates to the "About" tab.
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
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
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
// Profile Body — compact layout
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
}: {
  provider?: ProviderDetail
  loading: boolean
  favorited: boolean
  onFavorite: () => void
  onShare: () => void
  onClose: () => void
  onQuote: (serviceId?: string) => void
  onBooking: (serviceId?: string) => void
}) {
  return (
    <div className="flex max-h-[90vh] flex-col">
      {/* ── Compact Header ── */}
      <div className="shrink-0 px-5 pt-4 pb-3 sm:px-6">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="relative shrink-0">
            <Avatar className="border-border size-14 rounded-xl border shadow-sm">
              {provider?.avatarUrl ? (
                <AvatarImage src={provider.avatarUrl} alt={provider.name} />
              ) : null}
              <AvatarFallback className="rounded-xl bg-emerald-100 text-lg font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {provider?.name?.[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            {provider?.verified && (
              <span className="ring-background absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white ring-2">
                <BadgeCheck className="size-3" />
              </span>
            )}
          </div>

          {/* Name + meta */}
          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-40 rounded" />
                <Skeleton className="h-3.5 w-28 rounded" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <h2 className="truncate text-base leading-tight font-semibold">
                    {provider?.name}
                  </h2>
                  {provider?.verified && (
                    <Badge
                      data-testid="badge"
                      className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0 text-[9px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800"
                    >
                      <BadgeCheck className="size-2.5" /> Verificado
                    </Badge>
                  )}
                </div>
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
                  {provider && (
                    <StarRatingDisplay
                      value={provider.rating}
                      count={provider.reviewCount}
                      size={11}
                    />
                  )}
                  {provider?.city && (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="size-3" />
                      {provider.city}
                      {provider.state ? `/${provider.state}` : ""}
                    </span>
                  )}
                  {provider?.distanceKm != null && (
                    <span className="inline-flex items-center gap-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                      <Navigation className="size-3" />
                      {provider.distanceKm < 1
                        ? `${Math.round(provider.distanceKm * 1000)} m`
                        : `${provider.distanceKm.toFixed(1)} km`}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={onShare}
              aria-label="Compartilhar"
              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-8 items-center justify-center rounded-lg transition-colors"
            >
              <Share2 className="size-4" />
            </button>
            <button
              onClick={onFavorite}
              aria-label={favorited ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              aria-pressed={favorited}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
                favorited
                  ? "text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Heart className={cn("size-4", favorited && "fill-current")} />
            </button>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-8 items-center justify-center rounded-lg transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* ── Inline stat pills ── */}
        {!loading && provider && (
          <div className="mt-3 flex flex-wrap gap-2">
            <StatPill
              icon={<Wrench className="size-3" />}
              value={provider.services.length}
              label="Serviços"
            />
            {provider.distanceKm != null && (
              <StatPill
                icon={<Navigation className="size-3" />}
                value={
                  provider.distanceKm < 1
                    ? `${Math.round(provider.distanceKm * 1000)} m`
                    : `${provider.distanceKm.toFixed(1)} km`
                }
                label="Distância"
              />
            )}
            <StatPill
              icon={<Calendar className="size-3" />}
              value={
                provider.memberSince ? new Date(provider.memberSince).getFullYear().toString() : "—"
              }
              label="Membro desde"
            />
          </div>
        )}
      </div>

      <Separator />

      {/* ── Tabs ── */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="services" className="flex h-full flex-col">
          <div className="shrink-0 px-5 sm:px-6">
            <TabsList className="border-border flex h-auto w-full justify-start gap-0 border-b bg-transparent p-0">
              {(["services", "about", "reviews", "hours"] as const).map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="text-muted-foreground data-[state=active]:text-foreground hover:text-foreground relative rounded-none border-b-2 border-transparent px-3 pt-1.5 pb-2 text-xs font-medium transition-colors data-[state=active]:border-emerald-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
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

          <ScrollArea className="flex-1">
            <TabsContent
              value="services"
              className="m-0 px-5 py-4 focus-visible:outline-none sm:px-6"
            >
              <ServicesTab
                services={provider?.services ?? []}
                loading={loading}
                onQuote={onQuote}
                onBooking={onBooking}
              />
            </TabsContent>
            <TabsContent value="about" className="m-0 px-5 py-4 focus-visible:outline-none sm:px-6">
              <AboutTab provider={provider} loading={loading} />
            </TabsContent>
            <TabsContent
              value="reviews"
              className="m-0 px-5 py-4 focus-visible:outline-none sm:px-6"
            >
              <ReviewsTab
                reviews={provider?.reviews ?? []}
                rating={provider?.rating}
                reviewCount={provider?.reviewCount}
                loading={loading}
              />
            </TabsContent>
            <TabsContent value="hours" className="m-0 px-5 py-4 focus-visible:outline-none sm:px-6">
              <HoursTab availability={provider?.availability ?? []} loading={loading} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {/* ── Sticky Footer CTA ── */}
      <div className="bg-background shrink-0 border-t px-5 py-2.5 sm:px-6">
        <div className="flex gap-2">
          <Button
            onClick={() => onQuote()}
            variant="outline"
            className="h-10 flex-1 rounded-lg text-xs font-semibold transition-colors"
          >
            <Quote className="size-3.5" />
            Pedir orçamento
          </Button>
          <Button
            onClick={() => onBooking()}
            className="h-10 flex-1 rounded-lg bg-emerald-600 text-xs font-semibold transition-colors hover:bg-emerald-700"
          >
            <Calendar className="size-3.5" />
            Agendar serviço
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat Pill — inline compact metric
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
    <span className="bg-muted/60 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-foreground font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Services tab — flat list, compact cards grouped by category
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
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
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
    <div className="space-y-3">
      {Array.from(groups.entries()).map(([categoryName, items]) => {
        const expanded = expandedCats.has(categoryName)
        return (
          <div key={categoryName}>
            {/* Category header */}
            <button
              type="button"
              onClick={() => toggleCat(categoryName)}
              className="hover:bg-muted/50 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <Wrench className="size-3" />
                </span>
                <span className="text-xs font-semibold">{categoryName}</span>
                <span className="text-muted-foreground text-[10px]">({items.length})</span>
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
                  <div className="space-y-1.5 pb-1">
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
    <div className="group bg-card overflow-hidden rounded-lg border transition-colors hover:border-emerald-200 dark:hover:border-emerald-800">
      <div className="flex items-center gap-3 p-3">
        {/* Photo thumbnail */}
        {photos.length > 0 ? (
          <div className="bg-muted relative size-12 shrink-0 overflow-hidden rounded-md">
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
          <div className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-md">
            <Wrench className="size-4" />
          </div>
        )}

        {/* Info */}
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-xs leading-tight font-semibold transition-colors group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
            {service.title}
          </h4>
          {service.description && (
            <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px] leading-relaxed">
              {service.description}
            </p>
          )}
          <div className="mt-1 inline-flex items-baseline gap-0.5">
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
              {formatBRL(service.basePrice)}
            </span>
            <span className="text-muted-foreground text-[10px]">
              /{SERVICE_UNIT_SHORT[service.unit as keyof typeof SERVICE_UNIT_SHORT] ?? "un"}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onQuote}
            className="h-7 rounded-md px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
          >
            <Quote className="size-3" /> Orçamento
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onBooking}
            className="h-7 rounded-md px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
          >
            <Calendar className="size-3" /> Agendar
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// About tab — clean info sections
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

  const radius = provider?.radiusKm
  const hasProviderCoords =
    typeof provider?.lat === "number" &&
    typeof provider?.lng === "number" &&
    Number.isFinite(provider.lat) &&
    Number.isFinite(provider.lng)

  return (
    <div className="space-y-4 text-sm">
      {/* Bio */}
      {provider?.bio ? (
        <p className="text-foreground/90 text-sm leading-relaxed whitespace-pre-line">
          {provider.bio}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs italic">Sem descrição cadastrada.</p>
      )}

      {/* Mini map with radius circle */}
      {hasProviderCoords ? (
        <ProviderMiniMap
          providerLat={provider!.lat!}
          providerLng={provider!.lng!}
          providerName={provider!.name}
          userLat={userLat}
          userLng={userLng}
          radiusKm={previewRadius ?? radius}
          onRadiusChange={handleRadiusChange}
          height={200}
          className="w-full"
        />
      ) : null}

      <Separator />

      {/* Info grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Address */}
        <div className="flex items-start gap-2.5">
          <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
            <MapPin className="size-3.5" />
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              Endereço
            </p>
            <p className="mt-0.5 text-xs leading-relaxed">
              {provider?.address ?? "—"}
              {provider?.district ? `, ${provider.district}` : ""}
              <br />
              {provider?.city}
              {provider?.state ? `/${provider.state}` : ""}
              {provider?.cep ? ` · CEP ${provider.cep}` : ""}
            </p>
          </div>
        </div>

        {/* Coverage */}
        <div className="flex items-start gap-2.5">
          <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
            <Navigation className="size-3.5" />
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              Área de cobertura
            </p>
            <p className="mt-0.5 text-xs leading-relaxed">
              Raio de{" "}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {radius != null ? `${radius} km` : "—"}
              </strong>
            </p>
          </div>
        </div>
      </div>

      {/* Contact */}
      {provider?.whatsapp && (
        <>
          <Separator />
          <div className="flex items-center gap-2.5">
            <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
              <Phone className="size-3.5" />
            </div>
            <div>
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                WhatsApp
              </p>
              <p className="mt-0.5 text-xs">{provider.whatsapp}</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reviews tab — compact
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
        <Skeleton className="h-16 w-full rounded-lg" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
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
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex items-center gap-4">
        <div className="shrink-0 text-center">
          <p className="text-2xl font-bold tabular-nums">{avg.toFixed(1)}</p>
          <StarRatingDisplay
            value={avg}
            showCount={false}
            size={11}
            className="mt-0.5 justify-center"
          />
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            {reviewCount ?? reviews.length}{" "}
            {(reviewCount ?? reviews.length) === 1 ? "avaliação" : "avaliações"}
          </p>
        </div>
        <div className="grid flex-1 gap-1.5">
          {distribution.map((d) => (
            <div key={d.star} className="flex items-center gap-1.5 text-[10px]">
              <span className="text-muted-foreground w-2 tabular-nums">{d.star}</span>
              <Star className="size-2.5 fill-amber-400 text-amber-400" strokeWidth={0} />
              <div className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${d.pct}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="absolute inset-y-0 left-0 rounded-full bg-amber-400"
                />
              </div>
              <span className="text-muted-foreground w-4 text-right tabular-nums">{d.count}</span>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* Review cards */}
      <div className="space-y-2">
        {reviews.map((r, idx) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04, duration: 0.2 }}
            className="bg-card rounded-lg border p-3"
          >
            <div className="flex items-center gap-2.5">
              <Avatar className="size-8 rounded-lg">
                {r.author?.avatarUrl ? (
                  <AvatarImage src={r.author.avatarUrl} alt={r.author.name} />
                ) : null}
                <AvatarFallback className="bg-muted rounded-lg text-[10px] font-semibold">
                  {r.author?.name?.[0]?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="truncate text-xs font-medium">{r.author?.name ?? "Cliente"}</p>
                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <StarRatingDisplay
                  value={r.rating}
                  size={10}
                  showCount={false}
                  className="mt-0.5"
                />
              </div>
            </div>
            {r.comment && (
              <p className="text-muted-foreground mt-2 pl-[42px] text-xs leading-relaxed">
                {r.comment}
              </p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hours tab — compact grid
// ---------------------------------------------------------------------------

function HoursTab({
  availability,
  loading,
}: {
  availability: ProviderDetail["availability"]
  loading: boolean
}) {
  if (loading) return <Skeleton className="h-40 w-full rounded-lg" />

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
    <div className="space-y-3">
      {/* Status pill */}
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold",
          currentlyOpen
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
            : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
        )}
      >
        <span
          className={cn("size-1.5 rounded-full", currentlyOpen ? "bg-emerald-500" : "bg-red-500")}
        />
        {currentlyOpen ? "Aberto agora" : "Fechado agora"}
      </div>

      {/* Compact day rows */}
      <div className="divide-y overflow-hidden rounded-lg border">
        {WEEKDAYS.map((day, i) => {
          const slots = byDay.get(i) ?? []
          const open = slots.length > 0
          const isToday = i === today
          return (
            <div
              key={day}
              className={cn(
                "flex items-center justify-between px-3 py-2 text-xs transition-colors",
                isToday && "bg-emerald-50/50 dark:bg-emerald-950/20",
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">
                  <span className="hidden sm:inline">{day}</span>
                  <span className="sm:hidden">{WEEKDAYS_SHORT[i]}</span>
                </span>
                {isToday && (
                  <Badge className="rounded bg-emerald-100 px-1 py-0 text-[8px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                    hoje
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {slots.length === 0 ? (
                  <span className="text-muted-foreground text-[11px]">—</span>
                ) : (
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {slots.map((s) => `${s.start}–${s.end}`).join(", ")}
                  </span>
                )}
                <Badge
                  variant={open ? "default" : "outline"}
                  className={cn(
                    "rounded px-1.5 py-0 text-[9px]",
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
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
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
