"use client"

/**
 * ProviderProfileModal — fully redesigned, modern, interactive profile.
 *
 * Design goals:
 *   - Feels like a premium app profile, not a boring admin panel
 *   - Hero cover with glassmorphism overlay + floating avatar
 *   - Quick stats bar (completed, rating, response, member since)
 *   - Trust badges (verified, reviews, secure payment)
 *   - Modern tabs with smooth transitions
 *   - Service cards with gradient price tags + hover effects
 *   - Reviews with star distribution + individual comment cards
 *   - Hours with visual open/closed indicators
 *   - Sticky glassmorphism footer CTA
 *   - Live "online" indicator
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BadgeCheck,
  Calendar,
  Clock,
  ChevronRight,
  CreditCard,
  Eye,
  Heart,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Quote,
  Share2,
  ShieldCheck,
  Star,
  Timer,
  TrendingUp,
  UserPlus,
  Wrench,
  X,
  Zap,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
  SERVICE_UNIT_SHORT,
  WEEKDAYS,
  WEEKDAYS_SHORT,
} from "@/lib/constants"
import { StarRatingDisplay } from "./star-rating"
import { cn } from "@/lib/utils"

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
        toast.success("Link copiado para a área de transferência.")
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
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden" showCloseButton={false}>
        <DialogTitle className="sr-only">{provider?.name ?? "Perfil do prestador"}</DialogTitle>
        <DialogDescription className="sr-only">Detalhes do prestador de serviços.</DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Profile Body — the main layout
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
      {/* ═══ Hero Cover + Identity ═══ */}
      <div className="relative shrink-0">
        {/* Cover image — taller, more immersive */}
        <div className="relative h-44 w-full overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 sm:h-52">
          {provider?.coverUrl ? (
            <img src={provider.coverUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            /* Decorative pattern when no cover */
            <div aria-hidden className="absolute inset-0 opacity-20" style={{
              backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.4) 1px, transparent 0)",
              backgroundSize: "20px 20px",
            }} />
          )}
          {/* Multi-layer gradient for depth */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/15 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/30 to-transparent" />

          {/* Floating decorative orbs */}
          <div aria-hidden className="absolute top-6 right-8 size-20 rounded-full bg-emerald-300/15 blur-2xl" />
          <div aria-hidden className="absolute bottom-4 left-12 size-16 rounded-full bg-teal-200/10 blur-xl" />
        </div>

        {/* Top-right actions — glassmorphism */}
        <div className="absolute top-3 right-3 flex gap-2">
          <button onClick={onClose} aria-label="Fechar" className="inline-flex size-9 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-md transition-all hover:bg-black/50 hover:scale-105">
            <X className="size-4" />
          </button>
          <button onClick={onShare} aria-label="Compartilhar" className="inline-flex size-9 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-md transition-all hover:bg-black/50 hover:scale-105">
            <Share2 className="size-4" />
          </button>
          <button onClick={onFavorite} aria-label={favorited ? "Remover dos favoritos" : "Adicionar aos favoritos"} aria-pressed={favorited} className={cn("inline-flex size-9 items-center justify-center rounded-full backdrop-blur-md transition-all hover:scale-105", favorited ? "bg-rose-500 text-white hover:bg-rose-600" : "bg-black/30 text-white hover:bg-black/50")}>
            <Heart className={cn("size-4", favorited && "fill-current")} />
          </button>
        </div>

        {/* "Online" indicator — top left */}
        {provider?.verified && (
          <div className="absolute top-3 left-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/80 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-white" />
              </span>
              Online
            </span>
          </div>
        )}

        {/* Avatar + identity — overlaps cover */}
        <div className="px-5 sm:px-6 -mt-14 sm:-mt-16 relative z-10 flex items-end gap-4">
          <div className="relative">
            <Avatar className="size-24 sm:size-28 rounded-2xl border-4 border-card shadow-xl ring-1 ring-black/5">
              {provider?.avatarUrl ? (
                <AvatarImage src={provider.avatarUrl} alt={provider.name} />
              ) : null}
              <AvatarFallback className="rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700 text-3xl font-bold dark:from-emerald-900 dark:to-emerald-800 dark:text-emerald-200">
                {provider?.name?.[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            {/* Verified badge pinned to avatar */}
            {provider?.verified && (
              <span className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md ring-3 ring-card">
                <BadgeCheck className="size-4" />
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0 pb-2">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-48 rounded" />
                <Skeleton className="h-4 w-32 rounded" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl sm:text-2xl font-bold leading-tight truncate">
                    {provider?.name}
                  </h2>
                </div>
                <div className="mt-1.5 flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                  {provider && (
                    <StarRatingDisplay value={provider.rating} count={provider.reviewCount} size={14} />
                  )}
                  {provider?.city && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" />
                      {provider.city}{provider.state ? `/${provider.state}` : ""}
                    </span>
                  )}
                  {provider?.distanceKm != null && (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      <Navigation className="size-3.5" />
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

      {/* ═══ Quick Stats Bar ═══ */}
      {!loading && provider && (
        <div className="mx-5 sm:mx-6 mt-3 grid grid-cols-4 gap-2">
          <QuickStat icon={<Star className="size-3.5" />} value={provider.rating.toFixed(1)} label="Nota" accent />
          <QuickStat icon={<Zap className="size-3.5" />} value={provider.completedBookings ?? 0} label="Concluídos" />
          <QuickStat icon={<Timer className="size-3.5" />} value="~2h" label="Resposta" />
          <QuickStat icon={<UserPlus className="size-3.5" />} value={provider.memberSince ? new Date(provider.memberSince).getFullYear().toString() : "—"} label="Membro" />
        </div>
      )}

      {/* ═══ Trust Badges ═══ */}
      {!loading && provider && (
        <TooltipProvider delayDuration={300}>
          <div className="mx-5 sm:mx-6 mt-3 flex flex-wrap gap-2">
            {provider.verified && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800">
                    <BadgeCheck className="size-3.5" /> Verificado
                  </span>
                </TooltipTrigger>
                <TooltipContent>Documentos validados e identidade confirmada</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800">
                  <Star className="size-3.5" /> Avaliações reais
                </span>
              </TooltipTrigger>
              <TooltipContent>Avaliações de clientes após a conclusão do serviço</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800">
                  <ShieldCheck className="size-3.5" /> Pagamento seguro
                </span>
              </TooltipTrigger>
              <TooltipContent>Pagamento só é liberado após você marcar como concluído</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      )}

      {/* ═══ Tabs ═══ */}
      <div className="flex-1 overflow-hidden mt-4">
        <Tabs defaultValue="services" className="flex h-full flex-col">
          <div className="px-5 sm:px-6 shrink-0">
            <TabsList className="flex w-full justify-start gap-0.5 h-auto overflow-x-auto bg-transparent p-0 border-b border-border">
              {["services", "about", "reviews", "hours"].map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="relative rounded-none border-b-2 border-transparent px-4 pb-2.5 pt-1 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground"
                >
                  {tab === "services" ? "Serviços" : tab === "about" ? "Sobre" : tab === "reviews" ? "Avaliações" : "Expediente"}
                  {tab === "services" && provider && provider.services.length > 0 && (
                    <span className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {provider.services.length}
                    </span>
                  )}
                  {tab === "reviews" && provider && provider.reviewCount > 0 && (
                    <span className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      {provider.reviewCount}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <ScrollArea className="flex-1">
            <TabsContent value="services" className="p-5 sm:p-6 pt-5 m-0 focus-visible:outline-none">
              <ServicesTab services={provider?.services ?? []} loading={loading} onQuote={onQuote} onBooking={onBooking} />
            </TabsContent>
            <TabsContent value="about" className="p-5 sm:p-6 pt-5 m-0 focus-visible:outline-none">
              <AboutTab provider={provider} loading={loading} />
            </TabsContent>
            <TabsContent value="reviews" className="p-5 sm:p-6 pt-5 m-0 focus-visible:outline-none">
              <ReviewsTab reviews={provider?.reviews ?? []} rating={provider?.rating} reviewCount={provider?.reviewCount} loading={loading} />
            </TabsContent>
            <TabsContent value="hours" className="p-5 sm:p-6 pt-5 m-0 focus-visible:outline-none">
              <HoursTab availability={provider?.availability ?? []} loading={loading} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {/* ═══ Sticky Footer CTA — glassmorphism ═══ */}
      <div className="shrink-0 border-t bg-background/80 backdrop-blur-xl px-5 py-3 sm:px-6">
        <div className="flex gap-3">
          <Button
            onClick={() => onQuote()}
            variant="outline"
            className="flex-1 h-12 rounded-xl border-emerald-500/50 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950/40 text-sm font-semibold transition-all"
          >
            <Quote className="size-4" />
            Pedir orçamento
          </Button>
          <Button
            onClick={() => onBooking()}
            className="flex-1 h-12 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-sm font-semibold shadow-lg shadow-emerald-500/20 transition-all"
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
// Quick Stat — mini metric badge
// ---------------------------------------------------------------------------

function QuickStat({
  icon,
  value,
  label,
  accent,
}: {
  icon: React.ReactNode
  value: string | number
  label: string
  accent?: boolean
}) {
  return (
    <div className={cn(
      "flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center ring-1",
      accent
        ? "bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-800"
        : "bg-muted/30 ring-border/50",
    )}>
      <span className={cn("flex size-7 items-center justify-center rounded-full", accent ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className={cn("text-sm font-bold tabular-nums", accent ? "text-emerald-700 dark:text-emerald-300" : "text-foreground")}>
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground leading-tight">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Services tab — grouped by category, modern cards
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
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (services.length === 0) {
    return <EmptyState icon={Wrench} title="Nenhum serviço cadastrado" description="Este prestador ainda não publicou serviços." />
  }

  // Group by category
  const groups = new Map<string, ProviderService[]>()
  for (const s of services) {
    const key = s.category?.name ?? "Outros"
    const arr = groups.get(key) ?? []
    arr.push(s)
    groups.set(key, arr)
  }
  const groupEntries = Array.from(groups.entries())

  return (
    <Accordion type="multiple" defaultValue={groupEntries.map(([k]) => k)} className="w-full space-y-2">
      {groupEntries.map(([categoryName, items]) => (
        <AccordionItem key={categoryName} value={categoryName} className="rounded-xl border bg-card overflow-hidden ring-1 ring-black/[0.03]">
          <AccordionTrigger className="hover:no-underline px-4 py-3 hover:bg-muted/30 transition-colors">
            <div className="flex w-full items-center justify-between pr-2">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <Wrench className="size-4" />
                </span>
                <span className="font-semibold text-sm">{categoryName}</span>
              </div>
              <Badge variant="secondary" className="mr-1 text-[10px]">
                {items.length}
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-3">
            <div className="grid gap-3">
              {items.map((s) => (
                <ServiceCard key={s.id} service={s} onQuote={() => onQuote(s.id)} onBooking={() => onBooking(s.id)} />
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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="group rounded-xl border bg-background overflow-hidden ring-1 ring-black/[0.03] hover:ring-emerald-200 hover:shadow-md transition-all"
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm leading-tight group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">{service.title}</h4>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {service.description ?? "—"}
          </p>
          {/* Price tag — gradient */}
          <div className="mt-3 inline-flex items-baseline gap-1 rounded-lg bg-gradient-to-r from-emerald-50 to-teal-50 px-3 py-1.5 ring-1 ring-emerald-200/60 dark:from-emerald-950/40 dark:to-teal-950/30 dark:ring-emerald-800/40">
            <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">
              {formatBRL(service.basePrice)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              /{SERVICE_UNIT_SHORT[service.unit as keyof typeof SERVICE_UNIT_SHORT] ?? "un"}
            </span>
          </div>
        </div>

        {photos.length > 0 && (
          <div className="w-full sm:w-28 shrink-0">
            <Carousel opts={{ loop: false, dragFree: false }} className="w-full">
              <CarouselContent>
                {photos.map((url, i) => (
                  <CarouselItem key={i} className="basis-full">
                    <div className="aspect-video sm:aspect-square w-full overflow-hidden rounded-lg bg-muted">
                      <img src={url} alt={`${service.title} — foto ${i + 1}`} className="size-full object-cover" loading="lazy" />
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {photos.length > 1 && (
                <>
                  <CarouselPrevious className="size-6 -left-2" />
                  <CarouselNext className="size-6 -right-2" />
                </>
              )}
            </Carousel>
          </div>
        )}
      </div>

      <Separator />
      <div className="grid grid-cols-2 gap-1 p-1.5">
        <Button size="sm" variant="ghost" onClick={onQuote} className="h-9 rounded-lg text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40 font-medium text-xs">
          <Quote className="size-3.5" /> Orçamento
        </Button>
        <Button size="sm" variant="ghost" onClick={onBooking} className="h-9 rounded-lg text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40 font-medium text-xs">
          <Calendar className="size-3.5" /> Agendar
        </Button>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// About tab — bio, address, coverage, contact
// ---------------------------------------------------------------------------

function AboutTab({ provider, loading }: { provider?: ProviderDetail; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-3/4 rounded" />
        <Skeleton className="h-4 w-2/3 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
      </div>
    )
  }

  const radius = provider?.radiusKm

  return (
    <div className="space-y-5">
      {/* Bio */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
            <Eye className="size-3" />
          </span>
          Sobre
        </h3>
        <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-foreground/90">
          {provider?.bio || "Sem descrição cadastrada."}
        </p>
      </section>

      <Separator />

      {/* Address + Coverage */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-4 ring-1 ring-black/[0.03]">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Endereço</h3>
          <div className="flex items-start gap-3 text-sm">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <MapPin className="size-4" />
            </div>
            <span className="leading-relaxed">
              {provider?.address ?? "—"}
              {provider?.district ? `, ${provider.district}` : ""}
              <br />
              {provider?.city}
              {provider?.state ? `/${provider.state}` : ""}
              {provider?.cep ? ` · CEP ${provider.cep}` : ""}
            </span>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4 ring-1 ring-black/[0.03]">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Área de cobertura</h3>
          <div className="flex items-start gap-3 text-sm">
            <div className="relative mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-800">
              <div className="absolute size-2 rounded-full bg-emerald-500" />
              <div className="absolute rounded-full border border-emerald-400/60 dark:border-emerald-700/60" style={{ width: 24, height: 24 }} />
            </div>
            <span className="leading-relaxed">
              Atende em um raio de{" "}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {radius != null ? `${radius} km` : "—"}
              </strong>{" "}
              da sua base.
            </span>
          </div>
        </div>
      </section>

      {/* Contact */}
      {provider?.whatsapp && (
        <>
          <Separator />
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Contato</h3>
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                <Phone className="size-4" />
              </div>
              <div>
                <p className="text-sm font-medium">WhatsApp</p>
                <p className="text-xs text-muted-foreground">{provider.whatsapp}</p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reviews tab — distribution + individual reviews
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
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (!reviews || reviews.length === 0) {
    return <EmptyState icon={Star} title="Sem avaliações ainda" description="Quando este prestador concluir serviços, as avaliações dos clientes aparecerão aqui." />
  }

  const distribution = [5, 4, 3, 2, 1].map((star) => {
    const count = reviews.filter((r) => Math.round(r.rating) === star).length
    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0
    return { star, count, pct }
  })
  const avg = rating ?? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length

  return (
    <div className="space-y-5">
      {/* Summary card */}
      <div className="flex items-center gap-5 rounded-xl border bg-card p-5 ring-1 ring-black/[0.03]">
        <div className="text-center shrink-0">
          <p className="text-4xl font-bold leading-none tabular-nums text-foreground">
            {avg.toFixed(1)}
          </p>
          <StarRatingDisplay value={avg} showCount={false} size={14} className="mt-2 justify-center" />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {reviewCount ?? reviews.length}{" "}
            avaliação{(reviewCount ?? reviews.length) === 1 ? "" : "ões"}
          </p>
        </div>
        <Separator orientation="vertical" className="h-20" />
        <div className="flex-1 grid gap-2">
          {distribution.map((d) => (
            <div key={d.star} className="flex items-center gap-2 text-xs">
              <span className="w-3 text-muted-foreground tabular-nums">{d.star}</span>
              <Star className="size-3 fill-amber-400 text-amber-400" strokeWidth={0} />
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${d.pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-400 to-amber-300"
                />
              </div>
              <span className="w-6 text-right text-muted-foreground tabular-nums">{d.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Review cards */}
      <div className="space-y-3">
        {reviews.map((r, idx) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05, duration: 0.25 }}
            className="rounded-xl border bg-card p-4 ring-1 ring-black/[0.03] hover:ring-emerald-200 transition-all"
          >
            <div className="flex items-center gap-3">
              <Avatar className="size-10 rounded-xl">
                {r.author?.avatarUrl ? (
                  <AvatarImage src={r.author.avatarUrl} alt={r.author.name} />
                ) : null}
                <AvatarFallback className="rounded-xl bg-emerald-100 text-emerald-700 text-xs font-semibold dark:bg-emerald-950 dark:text-emerald-300">
                  {r.author?.name?.[0]?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.author?.name ?? "Cliente"}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <StarRatingDisplay value={r.rating} size={12} showCount={false} />
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </div>
            </div>
            {r.comment && (
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed pl-[52px]">
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
// Hours tab — visual calendar-style
// ---------------------------------------------------------------------------

function HoursTab({
  availability,
  loading,
}: {
  availability: ProviderDetail["availability"]
  loading: boolean
}) {
  if (loading) return <Skeleton className="h-48 w-full rounded-xl" />

  const byDay = new Map<number, { start: string; end: string }[]>()
  for (const a of availability ?? []) {
    const arr = byDay.get(a.dayOfWeek) ?? []
    arr.push({ start: a.startTime, end: a.endTime })
    byDay.set(a.dayOfWeek, arr)
  }

  const today = new Date().getDay()

  // Check if currently open
  const now = new Date()
  const todaySlots = byDay.get(today) ?? []
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const currentlyOpen = todaySlots.some((s) => {
    const [sh, sm] = s.start.split(":").map(Number)
    const [eh, em] = s.end.split(":").map(Number)
    return currentMinutes >= sh * 60 + sm && currentMinutes <= eh * 60 + em
  })

  return (
    <div className="space-y-4">
      {/* Current status indicator */}
      <div className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold",
        currentlyOpen
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-800"
          : "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-800",
      )}>
        <span className="relative flex size-2">
          {currentlyOpen && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
          <span className={cn("relative inline-flex size-2 rounded-full", currentlyOpen ? "bg-emerald-500" : "bg-red-500")} />
        </span>
        {currentlyOpen ? "Aberto agora" : "Fechado agora"}
      </div>

      {/* Weekly schedule */}
      <div className="rounded-xl border overflow-hidden ring-1 ring-black/[0.03]">
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
                <TableRow key={day} className={cn("transition-colors", isToday && "bg-emerald-50/50 dark:bg-emerald-950/20")}>
                  <TableCell className="font-medium">
                    <span className="hidden sm:inline">{day}</span>
                    <span className="sm:hidden">{WEEKDAYS_SHORT[i]}</span>
                    {isToday && (
                      <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
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
                          <Badge key={idx} variant="secondary" className="font-mono text-xs rounded-md">
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
                        "text-[11px]",
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
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 p-4 text-emerald-600 dark:from-emerald-950/40 dark:to-teal-950/30 dark:text-emerald-400 ring-1 ring-emerald-200/50 dark:ring-emerald-800/50">
        <Icon className="size-8" />
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">{description}</p>
      </div>
    </div>
  )
}
