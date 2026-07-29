"use client"

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
  Clock,
  Heart,
  Loader2,
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

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"

import { useUIStore } from "@/store/ui"
import { useRecentlyViewedStore } from "@/store/recently-viewed"
import { useIsMobile } from "@/hooks/use-mobile"
import { apiGet, type ProviderDetail, type ProviderService } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import {
  SERVICE_UNIT_SHORT,
  WEEKDAYS,
  WEEKDAYS_SHORT,
} from "@/lib/constants"
import { StarRatingDisplay } from "./star-rating"
import { cn } from "@/lib/utils"
import { useGeoStore } from "@/store/geo"
import dynamic from "next/dynamic"

// Mini map — client-only, lazy loaded
const ProviderMiniMap = dynamic(
  () => import("@/components/shared/provider-mini-map"),
  { ssr: false, loading: () => <Skeleton className="h-48 w-full rounded-xl" /> },
)

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

  const query = useQuery({
    queryKey: ["provider", providerId],
    queryFn: () => apiGet<ProviderDetail>(`/api/providers/${providerId}`),
    enabled: open && !!providerId,
    staleTime: 60 * 1000,
  })

  const provider = query.data
  const [favorited, setFavorited] = React.useState(false)

  React.useEffect(() => { setFavorited(false) }, [providerId])

  React.useEffect(() => {
    if (open && provider) addRecentlyViewed(provider)
  }, [open, provider, addRecentlyViewed])

  const handleFavorite = async () => {
    setFavorited((v) => !v)
    toast.success(favorited ? "Removido dos favoritos." : "Adicionado aos favoritos!")
  }

  const handleShare = async () => {
    if (!provider) return
    const url = `${window.location.origin}/?provider=${provider.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: provider.name, text: `Conheça ${provider.name} no Severinno`, url })
      } else {
        await navigator.clipboard.writeText(url)
        toast.success("Link copiado.")
      }
    } catch { /* user dismissed */ }
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
        <SheetContent side="bottom" className="h-[100dvh] max-h-[100dvh] w-full p-0 sm:max-w-full gap-0 flex flex-col [&_[data-slot=sheet-close]]:hidden">
          <SheetTitle className="sr-only">{provider?.name ?? "Perfil do prestador"}</SheetTitle>
          <SheetDescription className="sr-only">Detalhes do prestador de serviços.</SheetDescription>
          <div className="flex-1 overflow-hidden">{content}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden" showCloseButton={false}>
        <DialogTitle className="sr-only">{provider?.name ?? "Perfil do prestador"}</DialogTitle>
        <DialogDescription className="sr-only">Detalhes do prestador de serviços.</DialogDescription>
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
            <Avatar className="size-14 rounded-xl border border-border shadow-sm">
              {provider?.avatarUrl ? (
                <AvatarImage src={provider.avatarUrl} alt={provider.name} />
              ) : null}
              <AvatarFallback className="rounded-xl bg-emerald-100 text-emerald-700 text-lg font-bold dark:bg-emerald-950 dark:text-emerald-300">
                {provider?.name?.[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            {provider?.verified && (
              <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-background">
                <BadgeCheck className="size-3" />
              </span>
            )}
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-40 rounded" />
                <Skeleton className="h-3.5 w-28 rounded" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-base font-semibold leading-tight truncate">
                    {provider?.name}
                  </h2>
                  {provider?.verified && (
                    <Badge className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0 text-[9px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800">
                      <BadgeCheck className="size-2.5" /> Verificado
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  {provider && (
                    <StarRatingDisplay value={provider.rating} count={provider.reviewCount} size={11} />
                  )}
                  {provider?.city && (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="size-3" />
                      {provider.city}{provider.state ? `/${provider.state}` : ""}
                    </span>
                  )}
                  {provider?.distanceKm != null && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
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
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onShare} aria-label="Compartilhar" className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <Share2 className="size-4" />
            </button>
            <button onClick={onFavorite} aria-label={favorited ? "Remover dos favoritos" : "Adicionar aos favoritos"} aria-pressed={favorited} className={cn("inline-flex size-8 items-center justify-center rounded-lg transition-colors", favorited ? "text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <Heart className={cn("size-4", favorited && "fill-current")} />
            </button>
            <button onClick={onClose} aria-label="Fechar" className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
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
                value={provider.distanceKm < 1 ? `${Math.round(provider.distanceKm * 1000)} m` : `${provider.distanceKm.toFixed(1)} km`}
                label="Distância"
              />
            )}
            <StatPill
              icon={<Calendar className="size-3" />}
              value={provider.memberSince ? new Date(provider.memberSince).getFullYear().toString() : "—"}
              label="Membro desde"
            />
          </div>
        )}
      </div>

      <Separator />

      {/* ── Tabs ── */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="services" className="flex h-full flex-col">
          <div className="px-5 sm:px-6 shrink-0">
            <TabsList className="flex w-full justify-start gap-0 h-auto bg-transparent p-0 border-b border-border">
              {(["services", "about", "reviews", "hours"] as const).map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="relative rounded-none border-b-2 border-transparent px-3 pb-2 pt-1.5 text-xs font-medium text-muted-foreground transition-colors data-[state=active]:border-emerald-600 data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground"
                >
                  {tab === "services" ? "Serviços" : tab === "about" ? "Sobre" : tab === "reviews" ? "Avaliações" : "Expediente"}
                  {tab === "services" && provider && provider.services.length > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      ({provider.services.length})
                    </span>
                  )}
                  {tab === "reviews" && provider && provider.reviewCount > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      ({provider.reviewCount})
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <ScrollArea className="flex-1">
            <TabsContent value="services" className="px-5 py-4 sm:px-6 m-0 focus-visible:outline-none">
              <ServicesTab services={provider?.services ?? []} loading={loading} onQuote={onQuote} onBooking={onBooking} />
            </TabsContent>
            <TabsContent value="about" className="px-5 py-4 sm:px-6 m-0 focus-visible:outline-none">
              <AboutTab provider={provider} loading={loading} />
            </TabsContent>
            <TabsContent value="reviews" className="px-5 py-4 sm:px-6 m-0 focus-visible:outline-none">
              <ReviewsTab reviews={provider?.reviews ?? []} rating={provider?.rating} reviewCount={provider?.reviewCount} loading={loading} />
            </TabsContent>
            <TabsContent value="hours" className="px-5 py-4 sm:px-6 m-0 focus-visible:outline-none">
              <HoursTab availability={provider?.availability ?? []} loading={loading} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {/* ── Sticky Footer CTA ── */}
      <div className="shrink-0 border-t bg-background px-5 py-2.5 sm:px-6">
        <div className="flex gap-2">
          <Button
            onClick={() => onQuote()}
            variant="outline"
            className="flex-1 h-10 rounded-lg text-xs font-semibold transition-colors"
          >
            <Quote className="size-3.5" />
            Pedir orçamento
          </Button>
          <Button
            onClick={() => onBooking()}
            className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold transition-colors"
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
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-[11px] ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
      <span className="text-muted-foreground">{icon}</span>
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
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
    setExpandedCats(new Set(groups.keys()))
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
    return <EmptyState icon={Wrench} title="Nenhum serviço" description="Este prestador ainda não publicou serviços." />
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
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <Wrench className="size-3" />
                </span>
                <span className="text-xs font-semibold">{categoryName}</span>
                <span className="text-[10px] text-muted-foreground">({items.length})</span>
              </div>
              {expanded ? (
                <ChevronUp className="size-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-3.5 text-muted-foreground" />
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
                      <ServiceCard key={s.id} service={s} onQuote={() => onQuote(s.id)} onBooking={() => onBooking(s.id)} />
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
    <div className="group rounded-lg border bg-card overflow-hidden hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors">
      <div className="flex items-center gap-3 p-3">
        {/* Photo thumbnail */}
        {photos.length > 0 ? (
          <div className="size-12 shrink-0 overflow-hidden rounded-md bg-muted">
            <img src={photos[0]} alt={service.title} className="size-full object-cover" loading="lazy" />
          </div>
        ) : (
          <div className="size-12 shrink-0 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
            <Wrench className="size-4" />
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-semibold leading-tight truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
            {service.title}
          </h4>
          {service.description && (
            <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1 leading-relaxed">
              {service.description}
            </p>
          )}
          <div className="mt-1 inline-flex items-baseline gap-0.5">
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
              {formatBRL(service.basePrice)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              /{SERVICE_UNIT_SHORT[service.unit as keyof typeof SERVICE_UNIT_SHORT] ?? "un"}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onQuote} className="h-7 rounded-md px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40">
            <Quote className="size-3" /> Orçamento
          </Button>
          <Button size="sm" variant="ghost" onClick={onBooking} className="h-7 rounded-md px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40">
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
        <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">
          {provider.bio}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground italic">Sem descrição cadastrada.</p>
      )}

      {/* Mini map with radius circle */}
      {hasProviderCoords ? (
        <ProviderMiniMap
          providerLat={provider!.lat!}
          providerLng={provider!.lng!}
          providerName={provider!.name}
          userLat={userLat}
          userLng={userLng}
          radiusKm={radius}
          height={200}
          className="w-full"
        />
      ) : null}

      <Separator />

      {/* Info grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Address */}
        <div className="flex items-start gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <MapPin className="size-3.5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Endereço</p>
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
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Navigation className="size-3.5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Área de cobertura</p>
            <p className="mt-0.5 text-xs leading-relaxed">
              Raio de <strong className="text-emerald-700 dark:text-emerald-400">{radius != null ? `${radius} km` : "—"}</strong>
            </p>
          </div>
        </div>
      </div>

      {/* Contact */}
      {provider?.whatsapp && (
        <>
          <Separator />
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Phone className="size-3.5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">WhatsApp</p>
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
    return <EmptyState icon={Star} title="Sem avaliações" description="As avaliações aparecerão aqui após a conclusão de serviços." />
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
        <div className="text-center shrink-0">
          <p className="text-2xl font-bold tabular-nums">{avg.toFixed(1)}</p>
          <StarRatingDisplay value={avg} showCount={false} size={11} className="mt-0.5 justify-center" />
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {reviewCount ?? reviews.length} {(reviewCount ?? reviews.length) === 1 ? "avaliação" : "avaliações"}
          </p>
        </div>
        <div className="flex-1 grid gap-1.5">
          {distribution.map((d) => (
            <div key={d.star} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 text-muted-foreground tabular-nums">{d.star}</span>
              <Star className="size-2.5 fill-amber-400 text-amber-400" strokeWidth={0} />
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${d.pct}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="absolute inset-y-0 left-0 rounded-full bg-amber-400"
                />
              </div>
              <span className="w-4 text-right text-muted-foreground tabular-nums">{d.count}</span>
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
            className="rounded-lg border bg-card p-3"
          >
            <div className="flex items-center gap-2.5">
              <Avatar className="size-8 rounded-lg">
                {r.author?.avatarUrl ? (
                  <AvatarImage src={r.author.avatarUrl} alt={r.author.name} />
                ) : null}
                <AvatarFallback className="rounded-lg bg-muted text-[10px] font-semibold">
                  {r.author?.name?.[0]?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium truncate">{r.author?.name ?? "Cliente"}</p>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <StarRatingDisplay value={r.rating} size={10} showCount={false} className="mt-0.5" />
              </div>
            </div>
            {r.comment && (
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed pl-[42px]">
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
      <div className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold",
        currentlyOpen
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
          : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
      )}>
        <span className={cn("size-1.5 rounded-full", currentlyOpen ? "bg-emerald-500" : "bg-red-500")} />
        {currentlyOpen ? "Aberto agora" : "Fechado agora"}
      </div>

      {/* Compact day rows */}
      <div className="rounded-lg border overflow-hidden divide-y">
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
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate">
                  <span className="hidden sm:inline">{day}</span>
                  <span className="sm:hidden">{WEEKDAYS_SHORT[i]}</span>
                </span>
                {isToday && (
                  <Badge className="rounded px-1 py-0 text-[8px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                    hoje
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {slots.length === 0 ? (
                  <span className="text-muted-foreground text-[11px]">—</span>
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {slots.map((s) => `${s.start}–${s.end}`).join(", ")}
                  </span>
                )}
                <Badge
                  variant={open ? "default" : "outline"}
                  className={cn(
                    "text-[9px] px-1.5 py-0 rounded",
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
      <div className="rounded-xl bg-muted p-3 text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground max-w-xs">{description}</p>
      </div>
    </div>
  )
}
