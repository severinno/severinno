"use client"

/**
 * ProviderCard — Clean, compact, minimal provider card (no background cover image).
 *
 * Displays provider credentials, rating, distance, price, and actions
 * in an elegant, compact, high-contrast layout.
 */

import * as React from "react"
import {
  Star,
  MapPin,
  Heart,
  ShieldCheck,
  GitCompare,
  ChevronRight,
  CheckCircle2,
} from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { formatBRL } from "@/lib/format"
import { formatDistance } from "@/lib/geo-client"
import { toggleFavorite, type ProviderCard as ProviderCardType } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useUIStore } from "@/store/ui"
import { useCompareStore, MAX_COMPARE } from "@/store/compare"
import { toast } from "sonner"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"

export type ProviderCardProps = {
  provider: ProviderCardType
  favorited?: boolean
  onQuote?: (id: string) => void
  onBook?: (id: string, serviceId?: string) => void
  onView?: (id: string) => void
  className?: string
}

export default React.memo(function ProviderCard({
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

  const [favorited, setFavorited] = React.useState<boolean>(!!favoritedProp)
  const prevFavoritedProp = React.useRef<boolean>(!!favoritedProp)

  React.useEffect(() => {
    const next = !!favoritedProp
    if (prevFavoritedProp.current !== next) {
      prevFavoritedProp.current = next
      setFavorited(next)
    }
  }, [favoritedProp])

  const avatarUrl = provider.avatarUrl || `https://i.pravatar.cc/150?u=${provider.id}`

  const initials = provider.name
    ? provider.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "PR"

  const compareIds = useCompareStore((s) => s.ids) ?? []
  const toggleCompare = useCompareStore((s) => s.toggle)
  const inCompare = Array.isArray(compareIds) && compareIds.includes(provider.id)

  const favMutation = useMutation({
    mutationFn: () => toggleFavorite(provider.id),
    onMutate: () => {
      const next = !favorited
      setFavorited(next)
      return { prev: favorited }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) setFavorited(ctx.prev)
      toast.error("Não foi possível atualizar favoritos.")
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["favorites"] })
      toast.success(res.favorited ? "Adicionado aos favoritos" : "Removido dos favoritos")
    },
  })

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user) {
      openAuth("login", "CLIENT")
      return
    }
    favMutation.mutate()
  }

  const handleCompareClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!inCompare && compareIds.length >= MAX_COMPARE) {
      toast.info(`Você só pode comparar até ${MAX_COMPARE} prestadores ao mesmo tempo.`)
      return
    }
    toggleCompare(provider.id)
  }

  // Geolocation check for "Perto de você" badge
  const isNearby =
    typeof provider.distanceKm === "number" &&
    typeof provider.radiusKm === "number" &&
    provider.distanceKm <= provider.radiusKm

  const minPrice = provider.services?.[0]?.basePrice

  return (
    <Card
      data-testid="card"
      data-provider-id={provider.id}
      data-compare-distance={
        typeof provider.distanceKm === "number" ? formatDistance(provider.distanceKm) : "—"
      }
      data-compare-distance-km={
        typeof provider.distanceKm === "number" ? String(provider.distanceKm) : ""
      }
      className={cn(
        "group border-border/60 bg-card hover:border-primary/40 relative flex flex-col justify-between rounded-xl border p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
        className,
      )}
    >
      <div>
        {/* Header Row: Avatar + Name + Badges + Actions */}
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar className="border-border/60 size-11 shrink-0 rounded-xl border shadow-xs">
              <AvatarImage src={avatarUrl} alt={provider.name} />
              <AvatarFallback className="bg-primary/10 text-primary rounded-xl text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3
                  onClick={() => onView?.(provider.id)}
                  className="hover:text-primary cursor-pointer truncate text-sm font-semibold tracking-tight transition-colors"
                >
                  {provider.name}
                </h3>
                {provider.verified && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <ShieldCheck className="size-3" />
                    Verificado
                  </span>
                )}
                {isNearby && (
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                    Perto de você
                  </span>
                )}
              </div>

              {/* City + Distance */}
              <div className="text-muted-foreground mt-0.5 flex min-h-[18px] items-center gap-2 text-xs">
                {typeof provider.distanceKm === "number" && (
                  <span className="inline-flex items-center gap-0.5 text-[11px]">
                    <MapPin className="size-3 text-emerald-600" />
                    {formatDistance(provider.distanceKm)}
                  </span>
                )}
                {provider.city && <span className="truncate text-[11px]">· {provider.city}</span>}
              </div>
            </div>
          </div>

          {/* Quick buttons: Compare + Favorite */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleCompareClick}
              aria-label={inCompare ? "Remover da comparação" : "Comparar prestador"}
              title="Comparar"
              className={cn(
                "flex size-7 items-center justify-center rounded-lg border transition-all",
                inCompare
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/50 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
              )}
            >
              {inCompare ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <GitCompare className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleFavoriteClick}
              aria-label={favorited ? "Remover dos favoritos" : "Salvar nos favoritos"}
              title="Favoritar"
              className={cn(
                "flex size-7 items-center justify-center rounded-lg border transition-all",
                favorited
                  ? "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-400"
                  : "border-border/50 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
              )}
            >
              <Heart className={cn("size-3.5", favorited && "fill-current")} />
            </button>
          </div>
        </div>

        {/* Rating & Price Row */}
        <div className="border-border/40 mt-3 flex items-center justify-between border-t pt-2.5 text-xs">
          <div className="flex items-center gap-1.5 font-medium">
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
            <span className="text-foreground font-semibold">
              {provider.rating > 0 ? provider.rating.toFixed(1) : "Novo"}
            </span>
            <span className="text-muted-foreground text-[11px]">
              ({provider.reviewCount} {provider.reviewCount === 1 ? "avaliação" : "avaliações"})
            </span>
          </div>

          <div>
            <span className="text-muted-foreground mr-1 text-[10px]">a partir de</span>
            <span className="text-primary text-xs font-bold">
              {typeof minPrice === "number" ? formatBRL(minPrice) : "Sob consulta"}
            </span>
          </div>
        </div>

        {/* Bio */}
        {provider.bio && (
          <p className="text-muted-foreground mt-2 line-clamp-2 text-xs leading-relaxed">
            {provider.bio}
          </p>
        )}

        {/* Services tags */}
        {provider.services && provider.services.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {provider.services.slice(0, 2).map((s) => (
              <span
                key={s.id}
                className="bg-muted/60 text-muted-foreground rounded-md px-2 py-0.5 text-[10.5px] font-medium"
              >
                {s.title}
              </span>
            ))}
            {provider.services.length > 2 && (
              <span className="bg-muted/30 text-muted-foreground rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                +{provider.services.length - 2}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="border-border/40 mt-3.5 flex items-center gap-2 border-t pt-3">
        {onQuote && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onQuote(provider.id)}
            className="h-8 flex-1 text-xs font-medium"
          >
            Orçamento
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => (onBook ? onBook(provider.id) : onView?.(provider.id))}
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 flex-1 text-xs font-semibold"
        >
          Agendar
          <ChevronRight className="ml-1 size-3.5" />
        </Button>
      </div>
    </Card>
  )
})

export function ProviderCardSkeleton() {
  return (
    <Card className="border-border/50 bg-card flex animate-pulse flex-col justify-between rounded-xl border p-4 shadow-xs">
      <div>
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 animate-pulse rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32 animate-pulse" />
            <Skeleton className="h-3 w-20 animate-pulse" />
          </div>
        </div>
        <div className="border-border/40 mt-3 flex items-center justify-between border-t pt-2.5">
          <Skeleton className="h-3.5 w-24 animate-pulse" />
          <Skeleton className="h-3.5 w-20 animate-pulse" />
        </div>
        <Skeleton className="mt-2.5 h-3 w-full animate-pulse" />
        <Skeleton className="mt-1.5 h-3 w-3/4 animate-pulse" />
      </div>
      <div className="border-border/40 mt-4 flex gap-2 border-t pt-3">
        <Skeleton className="h-8 flex-1 animate-pulse rounded-lg" />
        <Skeleton className="h-8 flex-1 animate-pulse rounded-lg" />
      </div>
    </Card>
  )
}
