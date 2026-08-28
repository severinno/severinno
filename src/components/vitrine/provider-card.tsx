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
        "group relative flex flex-col justify-between rounded-xl border border-border/60 bg-card p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
        className,
      )}
    >
      <div>
        {/* Header Row: Avatar + Name + Badges + Actions */}
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar className="size-11 shrink-0 rounded-xl border border-border/60 shadow-xs">
              <AvatarImage src={avatarUrl} alt={provider.name} />
              <AvatarFallback className="rounded-xl bg-primary/10 text-xs font-bold text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3
                  onClick={() => onView?.(provider.id)}
                  className="cursor-pointer text-sm font-semibold tracking-tight hover:text-primary transition-colors truncate"
                >
                  {provider.name}
                </h3>
                {provider.verified && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="size-3" />
                    Verificado
                  </span>
                )}
                {isNearby && (
                  <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-950/60 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                    Perto de você
                  </span>
                )}
              </div>

              {/* City + Distance */}
              <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
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
          <div className="flex items-center gap-1 shrink-0">
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
              {inCompare ? <CheckCircle2 className="size-3.5" /> : <GitCompare className="size-3.5" />}
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
        <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2.5 text-xs">
          <div className="flex items-center gap-1.5 font-medium">
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
            <span className="font-semibold text-foreground">
              {provider.rating > 0 ? provider.rating.toFixed(1) : "Novo"}
            </span>
            <span className="text-muted-foreground text-[11px]">
              ({provider.reviewCount} {provider.reviewCount === 1 ? "avaliação" : "avaliações"})
            </span>
          </div>

          <div>
            <span className="text-muted-foreground text-[10px] mr-1">a partir de</span>
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
                className="rounded-md bg-muted/60 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground"
              >
                {s.title}
              </span>
            ))}
            {provider.services.length > 2 && (
              <span className="rounded-md bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                +{provider.services.length - 2}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-3.5 flex items-center gap-2 border-t border-border/40 pt-3">
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
          className="h-8 flex-1 bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Agendar
          <ChevronRight className="size-3.5 ml-1" />
        </Button>
      </div>
    </Card>
  )
})

export function ProviderCardSkeleton() {
  return (
    <Card className="flex flex-col justify-between rounded-xl border border-border/50 bg-card p-4 shadow-xs animate-pulse">
      <div>
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-xl animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32 animate-pulse" />
            <Skeleton className="h-3 w-20 animate-pulse" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2.5">
          <Skeleton className="h-3.5 w-24 animate-pulse" />
          <Skeleton className="h-3.5 w-20 animate-pulse" />
        </div>
        <Skeleton className="mt-2.5 h-3 w-full animate-pulse" />
        <Skeleton className="mt-1.5 h-3 w-3/4 animate-pulse" />
      </div>
      <div className="mt-4 flex gap-2 border-t border-border/40 pt-3">
        <Skeleton className="h-8 flex-1 rounded-lg animate-pulse" />
        <Skeleton className="h-8 flex-1 rounded-lg animate-pulse" />
      </div>
    </Card>
  )
}
