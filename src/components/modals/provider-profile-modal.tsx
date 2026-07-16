"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BadgeCheck,
  Calendar,
  ChevronRight,
  Heart,
  Loader2,
  MapPin,
  Navigation,
  Share2,
  Star,
  Wrench,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { motion } from "framer-motion"

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
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { useUIStore } from "@/store/ui"
import { useAuthStore } from "@/store/auth"
import { useRecentlyViewedStore } from "@/store/recently-viewed"
import { useIsMobile } from "@/hooks/use-mobile"
import { apiGet, type ProviderDetail, type ProviderService } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import {
  SERVICE_UNIT_LABELS,
  WEEKDAYS,
  WEEKDAYS_SHORT,
} from "@/lib/constants"
import { StarRatingDisplay } from "./star-rating"
import { cn } from "@/lib/utils"

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

  // Reset favorite state when provider changes.
  React.useEffect(() => {
    setFavorited(false)
  }, [providerId])

  // Track recently viewed (Nielsen H6 — recognition over recall).
  // Only track once per provider when the modal opens with loaded data.
  React.useEffect(() => {
    if (open && provider) {
      addRecentlyViewed(provider)
    }
  }, [open, provider, addRecentlyViewed])

  const handleFavorite = async () => {
    setFavorited((v) => !v)
    toast.success(
      favorited ? "Removido dos favoritos." : "Adicionado aos favoritos!",
    )
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
        toast.success("Link copiado para a área de transferência.")
      }
    } catch {
      // user dismissed share dialog — silent
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
          className="h-[100dvh] max-h-[100dvh] w-full p-0 sm:max-w-full gap-0 flex flex-col [&_[data-slot=sheet-close]]:hidden"
        >
          <SheetTitle className="sr-only">
            {provider?.name ?? "Perfil do prestador"}
          </SheetTitle>
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
        className="sm:max-w-3xl p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">
          {provider?.name ?? "Perfil do prestador"}
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
// Body
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
    <div className="flex max-h-[85vh] flex-col sm:max-h-[85vh]">
      {/* Cover + identity */}
      <div className="relative shrink-0">
        <div className="relative h-32 w-full overflow-hidden bg-gradient-to-r from-emerald-700 to-emerald-500 sm:h-40">
          {provider?.coverUrl && (
            <img
              src={provider.coverUrl}
              alt=""
              className="size-full object-cover"
              loading="lazy"
            />
          )}
          {/* Gradient overlay for legible buttons */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/10" />
        </div>

        {/* Top-right actions: close, share, favorite */}
        <div className="absolute top-3 right-3 flex gap-2">
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="inline-flex size-9 items-center justify-center rounded-full bg-white/90 text-zinc-700 backdrop-blur transition-colors hover:bg-white dark:bg-zinc-900/80 dark:text-zinc-200"
          >
            <X className="size-4" />
          </button>
          <button
            onClick={onShare}
            aria-label="Compartilhar"
            className="inline-flex size-9 items-center justify-center rounded-full bg-white/90 text-zinc-700 backdrop-blur transition-colors hover:bg-white dark:bg-zinc-900/80 dark:text-zinc-200"
          >
            <Share2 className="size-4" />
          </button>
          <button
            onClick={onFavorite}
            aria-label={favorited ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            aria-pressed={favorited}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-full backdrop-blur transition-colors",
              favorited
                ? "bg-rose-500 text-white hover:bg-rose-600"
                : "bg-white/90 text-zinc-700 hover:bg-white dark:bg-zinc-900/80 dark:text-zinc-200",
            )}
          >
            <Heart className={cn("size-4", favorited && "fill-current")} />
          </button>
        </div>

        {/* Avatar + identity */}
        <div className="px-4 sm:px-6 -mt-10 sm:-mt-12 relative z-10 flex items-end gap-4">
          <Avatar className="size-20 sm:size-24 rounded-xl border-4 border-card shadow-sm">
            {provider?.avatarUrl ? (
              <AvatarImage src={provider.avatarUrl} alt={provider.name} />
            ) : null}
            <AvatarFallback className="rounded-xl bg-emerald-100 text-emerald-700 text-2xl font-semibold dark:bg-emerald-950 dark:text-emerald-300">
              {provider?.name?.[0]?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0 pb-1">
            {loading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h2 className="text-xl font-bold leading-tight truncate">
                    {provider?.name}
                  </h2>
                  {provider?.verified && (
                    <BadgeCheck
                      className="size-5 shrink-0 text-emerald-600"
                      aria-label="Prestador verificado"
                    />
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  {provider && (
                    <StarRatingDisplay
                      value={provider.rating}
                      count={provider.reviewCount}
                      size={14}
                    />
                  )}
                  {provider?.city && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {provider.city}
                      {provider.state ? `/${provider.state}` : ""}
                    </span>
                  )}
                  {provider?.distanceKm != null && (
                    <span className="inline-flex items-center gap-1">
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
        </div>
      </div>

      {/* Tabs — pill style, scrollable on mobile */}
      <div className="flex-1 overflow-hidden border-t mt-3">
        <Tabs defaultValue="services" className="flex h-full flex-col">
          <div className="px-4 sm:px-6 pt-2 shrink-0">
            <TabsList className="flex w-full justify-start gap-1 h-auto overflow-x-auto bg-muted/50 p-1 rounded-lg">
              <TabsTrigger
                value="services"
                className="text-xs sm:text-sm rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm flex-1 sm:flex-none"
              >
                Serviços
              </TabsTrigger>
              <TabsTrigger
                value="about"
                className="text-xs sm:text-sm rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm flex-1 sm:flex-none"
              >
                Sobre
              </TabsTrigger>
              <TabsTrigger
                value="reviews"
                className="text-xs sm:text-sm rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm flex-1 sm:flex-none"
              >
                Avaliações
              </TabsTrigger>
              <TabsTrigger
                value="hours"
                className="text-xs sm:text-sm rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm flex-1 sm:flex-none"
              >
                Expediente
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1">
            <TabsContent
              value="services"
              className="p-4 sm:p-6 pt-4 m-0 focus-visible:outline-none"
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
              className="p-4 sm:p-6 pt-4 m-0 focus-visible:outline-none"
            >
              <AboutTab provider={provider} loading={loading} />
            </TabsContent>

            <TabsContent
              value="reviews"
              className="p-4 sm:p-6 pt-4 m-0 focus-visible:outline-none"
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
              className="p-4 sm:p-6 pt-4 m-0 focus-visible:outline-none"
            >
              <HoursTab
                availability={provider?.availability ?? []}
                loading={loading}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {/* Sticky footer actions */}
      <div className="shrink-0 border-t bg-background/95 backdrop-blur px-4 py-3 sm:px-6">
        <div className="flex gap-2">
          <Button
            onClick={() => onQuote()}
            variant="outline"
            className="flex-1 border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
          >
            <Wrench className="size-4" />
            Pedir orçamento
          </Button>
          <Button
            onClick={() => onBooking()}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
          >
            <Calendar className="size-4" />
            Agendar serviço
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Services tab — grouped by category, accordion
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
        title="Nenhum serviço cadastrado"
        description="Este prestador ainda não publicou serviços."
      />
    )
  }

  // Group by category name
  const groups = new Map<string, ProviderService[]>()
  for (const s of services) {
    const key = s.category?.name ?? "Outros"
    const arr = groups.get(key) ?? []
    arr.push(s)
    groups.set(key, arr)
  }
  const groupEntries = Array.from(groups.entries())

  return (
    <Accordion
      type="multiple"
      defaultValue={groupEntries.map(([k]) => k)}
      className="w-full"
    >
      {groupEntries.map(([categoryName, items]) => (
        <AccordionItem key={categoryName} value={categoryName}>
          <AccordionTrigger className="hover:no-underline">
            <div className="flex w-full items-center justify-between pr-2">
              <span className="font-medium">{categoryName}</span>
              <Badge variant="secondary" className="mr-1">
                {items.length}
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid gap-3">
              {items.map((s) => (
                <ServiceCard
                  key={s.id}
                  service={s}
                  onQuote={() => onQuote(s.id)}
                  onBooking={() => onBooking(s.id)}
                />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
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
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="rounded-lg border bg-card overflow-hidden"
    >
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium leading-tight">{service.title}</h4>
          <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
            {service.description ?? "—"}
          </p>
          <p className="mt-2 text-emerald-700 font-semibold dark:text-emerald-400">
            {formatBRL(service.basePrice)}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              / {SERVICE_UNIT_LABELS[service.unit] ?? "un"}
            </span>
          </p>
        </div>

        {photos.length > 0 && (
          <div className="w-full sm:w-32 shrink-0">
            <Carousel
              opts={{ loop: false, dragFree: false }}
              className="w-full"
            >
              <CarouselContent>
                {photos.map((url, i) => (
                  <CarouselItem key={i} className="basis-full">
                    <div className="aspect-video sm:aspect-square w-full overflow-hidden rounded-md bg-muted">
                      <img
                        src={url}
                        alt={`${service.title} — foto ${i + 1}`}
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {photos.length > 1 && (
                <>
                  <CarouselPrevious className="size-7 -left-2" />
                  <CarouselNext className="size-7 -right-2" />
                </>
              )}
            </Carousel>
          </div>
        )}
      </div>

      <Separator />
      <div className="grid grid-cols-2 gap-2 p-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onQuote}
          className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
        >
          Orçamento
          <ChevronRight className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onBooking}
          className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
        >
          Agendar
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// About tab
// ---------------------------------------------------------------------------

function AboutTab({
  provider,
  loading,
}: {
  provider?: ProviderDetail
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }
  const radius = provider?.radiusKm
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Sobre
        </h3>
        <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">
          {provider?.bio || "Sem descrição cadastrada."}
        </p>
      </section>
      <Separator />
      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Endereço
          </h3>
          <p className="mt-2 flex items-start gap-2 text-sm">
            <MapPin className="size-4 mt-0.5 shrink-0 text-emerald-600" />
            <span>
              {provider?.address ?? "—"}
              {provider?.district ? `, ${provider.district}` : ""}
              <br />
              {provider?.city}
              {provider?.state ? `/${provider.state}` : ""}
              {provider?.cep ? ` · CEP ${provider.cep}` : ""}
            </span>
          </p>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Área de cobertura
          </h3>
          <div className="mt-2 flex items-start gap-3 text-sm">
            <div className="relative mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-emerald-50 ring-2 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-900">
              <div className="absolute size-3 rounded-full bg-emerald-500" />
              <div
                className="absolute rounded-full border border-emerald-400/60 dark:border-emerald-700/60"
                style={{
                  width: 32,
                  height: 32,
                }}
              />
            </div>
            <span>
              Atende em um raio de{" "}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {radius != null ? `${radius} km` : "—"}
              </strong>{" "}
              da sua base.
            </span>
          </div>
        </div>
      </section>
      {provider?.whatsapp && (
        <>
          <Separator />
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Contato
            </h3>
            <p className="mt-2 text-sm">WhatsApp: {provider.whatsapp}</p>
          </section>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reviews tab
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
        <Skeleton className="h-24 w-full rounded-lg" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (!reviews || reviews.length === 0) {
    return (
      <EmptyState
        icon={Star}
        title="Sem avaliações ainda"
        description="Quando este prestador concluir serviços, as avaliações dos clientes aparecerão aqui."
      />
    )
  }

  // Distribution: count reviews per star (1..5)
  const distribution = [5, 4, 3, 2, 1].map((star) => {
    const count = reviews.filter((r) => Math.round(r.rating) === star).length
    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0
    return { star, count, pct }
  })
  const avg = rating ?? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 rounded-lg border bg-card p-4">
        <div className="text-center">
          <p className="text-3xl font-bold leading-none tabular-nums">
            {avg.toFixed(1)}
          </p>
          <StarRatingDisplay
            value={avg}
            showCount={false}
            size={12}
            className="mt-1.5 justify-center"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {reviewCount ?? reviews.length}{" "}
            avaliação{(reviewCount ?? reviews.length) === 1 ? "" : "ões"}
          </p>
        </div>
        <Separator orientation="vertical" className="h-16" />
        <div className="flex-1 grid gap-1.5">
          {distribution.map((d) => (
            <div key={d.star} className="flex items-center gap-2 text-xs">
              <span className="w-3 text-muted-foreground tabular-nums">{d.star}</span>
              <Star className="size-3 fill-amber-400 text-amber-400" strokeWidth={0} />
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-amber-400"
                  style={{ width: `${d.pct}%` }}
                />
              </div>
              <span className="w-6 text-right text-muted-foreground tabular-nums">
                {d.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {reviews.map((r) => (
          <div key={r.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-3">
              <Avatar className="size-9">
                {r.author?.avatarUrl ? (
                  <AvatarImage src={r.author.avatarUrl} alt={r.author.name} />
                ) : null}
                <AvatarFallback className="bg-emerald-100 text-emerald-700 text-xs dark:bg-emerald-950 dark:text-emerald-300">
                  {r.author?.name?.[0]?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {r.author?.name ?? "Cliente"}
                </p>
                <div className="flex items-center gap-2">
                  <StarRatingDisplay value={r.rating} size={12} showCount={false} />
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </div>
            </div>
            {r.comment && (
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {r.comment}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hours tab
// ---------------------------------------------------------------------------

function HoursTab({
  availability,
  loading,
}: {
  availability: ProviderDetail["availability"]
  loading: boolean
}) {
  if (loading) {
    return <Skeleton className="h-32 w-full rounded-lg" />
  }

  // Build full week, even days without availability.
  const byDay = new Map<number, { start: string; end: string }[]>()
  for (const a of availability ?? []) {
    const arr = byDay.get(a.dayOfWeek) ?? []
    arr.push({ start: a.startTime, end: a.endTime })
    byDay.set(a.dayOfWeek, arr)
  }

  // Today (for highlighting open/closed)
  const today = new Date().getDay()

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/3">Dia</TableHead>
            <TableHead>Horários</TableHead>
            <TableHead className="w-24 text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {WEEKDAYS.map((day, i) => {
            const slots = byDay.get(i) ?? []
            const open = slots.length > 0
            const isToday = i === today
            return (
              <TableRow key={day} className={isToday ? "bg-emerald-50/40 dark:bg-emerald-950/20" : ""}>
                <TableCell className="font-medium">
                  <span className="hidden sm:inline">{day}</span>
                  <span className="sm:hidden">{WEEKDAYS_SHORT[i]}</span>
                  {isToday && (
                    <span className="ml-1.5 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400">
                      hoje
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {slots.length === 0 ? (
                    <span className="text-muted-foreground text-xs">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {slots.map((s, idx) => (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="font-mono text-xs"
                        >
                          {s.start}–{s.end}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Badge
                    variant={open ? "default" : "outline"}
                    className={cn(
                      open
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : "text-muted-foreground",
                    )}
                  >
                    {open ? "Aberto" : "Fechado"}
                  </Badge>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
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
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="rounded-full bg-emerald-50 p-3 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
        <Icon className="size-6" />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">
          {description}
        </p>
      </div>
    </div>
  )
}
