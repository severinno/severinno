"use client"

/**
 * ProviderCard — the core unit of the vitrine grid.
 *
 * Layout (top → bottom):
 *   1. Cover image (16:9, picsum fallback) with verified badge + favorite heart
 *   2. Avatar (with reviewCount counter) overlapping cover bottom-left
 *   3. Name (clickable, hover-underline + chevron) + rating + "a partir de R$" hint + distance + city
 *   4. Bio (2-line clamp)
 *   5. Compact preview row (cheapest service, "a partir de R$") above a collapsed-by-default
 *      accordion of services grouped by category (each row: title + price + "Agendar")
 *   6. Footer: "Orçamento" (outline) + "Agendar" (solid) — the name/cover click opens the profile
 *
 * Hover: subtle lift (CSS transitions). Accessible: keyboard focusable, ARIA.
 */

import * as React from "react"
import Image from "next/image"
import {
  Star,
  MapPin,
  Heart,
  FileText,
  Calendar,
  ChevronRight,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  CalendarClock,
  Wrench,
  GitCompare,
  X,
  Navigation,
} from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { formatBRL } from "@/lib/format"
import { formatDistance } from "@/lib/geo-client"
import { SERVICE_UNIT_SHORT, type ServiceUnit } from "@/lib/constants"
import { toggleFavorite, type ProviderCard as ProviderCardType } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useUIStore } from "@/store/ui"
import { useCompareStore, MAX_COMPARE } from "@/store/compare"
import { useTilt } from "@/hooks/use-animation"
import { toast } from "sonner"

import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { ScrollArea } from "@/components/ui/scroll-area"

export type ProviderCardProps = {
  provider: ProviderCardType
  favorited?: boolean
  onQuote?: (id: string) => void
  onBook?: (id: string, serviceId?: string) => void
  onView?: (id: string) => void
  className?: string
}

export default function ProviderCard({
  provider,
  favorited: favoritedProp,
  onQuote,
  onBook,
  onView,
  className,
}: ProviderCardProps) {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const openAuth = useUIStore((s) => s.openAuth)

  // Optimistic favorite state (initialized from prop; synced if prop changes)
  // Uses a ref-based guard to only call setFavorited when the prop actually
  // changes, avoiding unnecessary set-state-in-effect renders.
  const [favorited, setFavorited] = React.useState<boolean>(!!favoritedProp)
  const prevFavoritedProp = React.useRef<boolean>(!!favoritedProp)

  React.useEffect(() => {
    const next = !!favoritedProp
    if (prevFavoritedProp.current !== next) {
      prevFavoritedProp.current = next
      setFavorited(next)
    }
  }, [favoritedProp])

  const coverUrl = provider.coverUrl || `https://picsum.photos/seed/provider-${provider.id}/800/450`
  const avatarUrl = provider.avatarUrl || `https://i.pravatar.cc/150?u=${provider.id}`

  const initials = provider.name
    ? provider
        .name!.split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "P"

  const favMutation = useMutation({
    mutationFn: () => toggleFavorite(provider.id),
    onMutate: () => {
      // optimistic
      setFavorited((v) => !v)
    },
    onSuccess: (data) => {
      setFavorited(data.favorited)
      qc.invalidateQueries({ queryKey: ["favorites"] })
      toast.success(
        data.favorited
          ? `${provider.name} adicionado aos favoritos.`
          : `${provider.name} removido dos favoritos.`,
      )
    },
    onError: () => {
      // revert
      setFavorited(!!favoritedProp)
      toast.error("Não foi possível atualizar favoritos. Tente novamente.")
    },
  })

  const handleFavorite = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user) {
      openAuth("login")
      toast.info("Entre para salvar favoritos.")
      return
    }
    favMutation.mutate()
  }

  // Compare — visitors can compare without auth (selection is local-only)
  const compareIds = useCompareStore((s) => s.ids)
  const toggleCompare = useCompareStore((s) => s.toggle)
  const isComparing = compareIds.includes(provider.id)

  const handleCompareToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isComparing && compareIds.length >= MAX_COMPARE) {
      toast.warning(`Você pode comparar no máximo ${MAX_COMPARE} prestadores.`)
      return
    }
    toggleCompare(provider.id)
    toast.success(
      isComparing
        ? `${provider.name} removido da comparação.`
        : `${provider.name} adicionado à comparação (${!isComparing ? compareIds.length + 1 : compareIds.length - 1}/${MAX_COMPARE}).`,
    )
  }

  const handleBook = (serviceId?: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onBook?.(provider.id, serviceId)
  }

  const handleQuote = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onQuote?.(provider.id)
  }

  const handleView = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onView?.(provider.id)
  }

  const servicesByCategory = React.useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; services: ProviderCardType["services"] }
    >()
    for (const s of provider.services ?? []) {
      const catId = s.category?.id ?? "outros"
      const catName = s.category?.name ?? "Outros serviços"
      if (!map.has(catId)) {
        map.set(catId, { id: catId, name: catName, services: [] })
      }
      map.get(catId)!.services.push(s)
    }
    return Array.from(map.values())
  }, [provider.services])

  // Cheapest service — used for both the header "a partir de" hint and the
  // compact preview row above the (now collapsed-by-default) accordion.
  const cheapestService = React.useMemo(() => {
    const services = provider.services ?? []
    if (services.length === 0) return null
    return services.reduce(
      (min, s) => ((s.basePrice ?? 0) < (min.basePrice ?? 0) ? s : min),
      services[0]!,
    )
  }, [provider.services])
  const minPrice = cheapestService?.basePrice ?? null

  // 3D tilt effect on hover (respects reduced motion)
  const tiltProps = useTilt<HTMLDivElement>({ max: 4, scale: 1.005 })

  return (
    <div {...tiltProps} className="will-change-transform [transform-style:preserve-3d]">
      <Card
        data-provider-id={provider.id}
        data-compare-name={provider.name}
        data-compare-avatar={provider.avatarUrl ?? ""}
        data-compare-distance={formatDistance(provider.distanceKm)}
        data-compare-distance-km={
          typeof provider.distanceKm === "number" ? String(provider.distanceKm) : ""
        }
        className={cn(
          "group relative gap-0 overflow-hidden rounded-xl border py-0 shadow-sm transition-all duration-200",
          "focus-within:shadow-md hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md",
          isComparing && "ring-2 ring-emerald-500/50",
          className,
        )}
      >
        {/* Cover */}
        <div className="bg-muted relative h-32 w-full overflow-hidden md:h-36">
          <Image
            src={coverUrl}
            alt={`Capa de ${provider.name}`}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            loading="lazy"
          />
          {/* Bottom gradient for legibility */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/40 to-transparent"
          />

          {/* Verified badge + Perto de você badge */}
          <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
            {provider.verified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-white shadow-sm">
                <ShieldCheck className="size-3.5" />
                Verificado
              </span>
            ) : null}
            {provider.radiusKm != null &&
            typeof provider.distanceKm === "number" &&
            provider.distanceKm >= 0 &&
            provider.distanceKm <= provider.radiusKm ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                <Navigation className="size-3" />
                Perto de você
              </span>
            ) : null}
          </div>

          {/* Favorite heart + Compare button */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCompareToggle}
              aria-pressed={isComparing}
              aria-label={
                isComparing
                  ? `Remover ${provider.name} da comparação`
                  : `Adicionar ${provider.name} à comparação`
              }
              title={
                isComparing
                  ? "Remover da comparação"
                  : `Comparar (${compareIds.length}/${MAX_COMPARE})`
              }
              className={cn(
                "flex size-9 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition",
                "focus-visible:ring-ring hover:bg-white focus-visible:ring-2 focus-visible:outline-none",
                isComparing ? "text-emerald-600 ring-2 ring-emerald-500/40" : "text-foreground/70",
              )}
            >
              {isComparing ? <X className="size-4" /> : <GitCompare className="size-4" />}
            </button>
            <button
              type="button"
              onClick={handleFavorite}
              disabled={favMutation.isPending}
              aria-pressed={favorited}
              aria-label={
                favorited
                  ? `Remover ${provider.name} dos favoritos`
                  : `Adicionar ${provider.name} aos favoritos`
              }
              className={cn(
                "flex size-9 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition",
                "focus-visible:ring-ring hover:bg-white focus-visible:ring-2 focus-visible:outline-none",
                favorited && "text-rose-500",
              )}
            >
              {favMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Heart
                  className={cn(
                    "size-4 transition-colors",
                    favorited && "fill-rose-500 text-rose-500",
                  )}
                />
              )}
            </button>
          </div>

          {/* Avatar overlapping cover bottom-left */}
          <div className="absolute -bottom-7 left-4 flex items-end gap-2">
            <Avatar className="border-card bg-card size-14 border-4 shadow-md">
              <AvatarImage src={avatarUrl} alt={provider.name} />
              <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>

        {/* Header info */}
        <CardContent className="pt-3">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={handleView}
              className="group/name min-w-0 flex-1 text-left outline-none focus-visible:underline"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <h3 className="hover:text-primary flex items-center gap-1 text-base leading-tight font-semibold transition-colors">
                <span className="min-w-0 truncate group-hover/name:underline">{provider.name}</span>
                <ChevronRight
                  aria-hidden
                  className="text-muted-foreground size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                />
              </h3>
            </button>
            <span
              className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold"
              title="Avaliação média"
            >
              <Star className="size-4 fill-amber-400 text-amber-400" />
              {provider.rating > 0 ? provider.rating.toFixed(1) : "—"}
              <span className="text-muted-foreground text-xs font-normal">
                ({provider.reviewCount})
              </span>
            </span>
          </div>

          {minPrice !== null ? (
            <p className="text-muted-foreground mt-1.5 text-xs">
              a partir de{" "}
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                {formatBRL(minPrice)}
              </span>
            </p>
          ) : null}

          <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {typeof provider.distanceKm === "number" ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5 text-emerald-600" />
                {formatDistance(provider.distanceKm)}
              </span>
            ) : null}
            {provider.city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                {provider.city}
              </span>
            ) : null}
          </div>

          {provider.bio ? (
            <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{provider.bio}</p>
          ) : null}

          {/* Trust signals — recognition over recall (Nielsen H6) */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {typeof provider.completedBookings === "number" && provider.completedBookings > 0 && (
              <span
                className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400"
                title="Serviços concluídos com sucesso"
              >
                <CheckCircle2 className="size-3.5" />
                {provider.completedBookings} serviços concluídos
              </span>
            )}
            {provider.memberSince && (
              <span
                className="text-muted-foreground inline-flex items-center gap-1"
                title="Na plataforma desde"
              >
                <CalendarClock className="size-3.5" />
                desde{" "}
                {new Date(provider.memberSince).toLocaleDateString("pt-BR", {
                  month: "short",
                  year: "numeric",
                })}
              </span>
            )}
          </div>
        </CardContent>

        {/* Services — compact preview row + collapsible accordion */}
        <CardContent className="pt-0">
          {servicesByCategory.length === 0 ? (
            <p className="bg-muted/40 text-muted-foreground rounded-lg border border-dashed px-3 py-3 text-center text-xs">
              Nenhum serviço cadastrado.
            </p>
          ) : (
            <>
              {/* Compact preview: cheapest service, visible while accordion is collapsed */}
              {cheapestService ? (
                <div className="bg-muted/40 mb-2.5 flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
                  <Wrench
                    aria-hidden
                    className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-foreground/80">{cheapestService.title}</span>
                    <span className="text-muted-foreground"> · a partir de </span>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatBRL(cheapestService.basePrice)}
                    </span>
                  </span>
                </div>
              ) : null}

              <Accordion type="multiple" defaultValue={[]} className="rounded-lg border">
                {servicesByCategory.map((group) => (
                  <AccordionItem
                    key={group.id}
                    value={group.id}
                    className="border-b last:border-b-0"
                  >
                    <AccordionTrigger className="px-3 py-3 hover:no-underline">
                      <div className="flex w-full items-center justify-between gap-2 pr-2">
                        <div className="min-w-0 text-left">
                          <p className="truncate text-sm font-medium">{group.name}</p>
                          <p className="text-muted-foreground text-xs">
                            {group.services.length}{" "}
                            {group.services.length === 1 ? "serviço" : "serviços"}
                          </p>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-1">
                      <ScrollArea className="max-h-60">
                        <ul>
                          {group.services.map((s) => {
                            const unit = s.unit as ServiceUnit
                            return (
                              <li
                                key={s.id}
                                className="flex items-center justify-between gap-2 border-b px-3 py-2.5 last:border-b-0"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{s.title}</p>
                                  <p className="text-sm font-medium text-emerald-700">
                                    {formatBRL(s.basePrice)}
                                    {unit ? ` / ${SERVICE_UNIT_SHORT[unit]}` : ""}
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={handleBook(s.id)}
                                  className="h-8 shrink-0 gap-1.5"
                                >
                                  <Calendar className="size-3.5" />
                                  Agendar
                                </Button>
                              </li>
                            )
                          })}
                        </ul>
                      </ScrollArea>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </>
          )}
        </CardContent>

        {/* Footer actions — clean 2-button layout. The whole card (name + cover)
          is clickable to open the profile, so we no longer need a redundant
          "Ver perfil" button here. */}
        <CardFooter className="bg-muted/30 flex items-center gap-2 border-t p-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleQuote}
            className="border-primary/30 text-primary hover:border-primary hover:bg-primary/10 hover:text-primary h-9 flex-1 gap-1.5"
          >
            <FileText className="size-4" />
            Orçamento
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleBook(undefined)}
            className="h-9 flex-1 gap-1.5"
          >
            <Calendar className="size-4" />
            Agendar
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton (used by vitrine-results while loading)
// ---------------------------------------------------------------------------

export function ProviderCardSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-sm">
      <div className="bg-muted relative h-32 w-full md:h-36">
        <div className="border-card bg-muted absolute -bottom-7 left-4 size-14 rounded-full border-4" />
      </div>
      <CardContent className="pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="bg-muted h-4 w-28 animate-pulse rounded" />
          <div className="bg-muted h-4 w-12 animate-pulse rounded" />
        </div>
        <div className="bg-muted mt-2 h-3 w-40 animate-pulse rounded" />
        <div className="bg-muted mt-3 h-3 w-full animate-pulse rounded" />
        <div className="bg-muted mt-1.5 h-3 w-2/3 animate-pulse rounded" />
        <div className="bg-muted mt-4 h-24 animate-pulse rounded-lg border" />
      </CardContent>
      <CardFooter className="bg-muted/30 gap-2 border-t p-3">
        <div className="bg-muted h-9 flex-1 animate-pulse rounded" />
        <div className="bg-muted h-9 flex-1 animate-pulse rounded" />
      </CardFooter>
    </Card>
  )
}
