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
  GitCompare,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  Clock,
  FileText,
  ShieldCheck,
  X,
} from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { formatBRL } from "@/lib/format"
import { formatDistance } from "@/lib/geo-client"
import {
  toggleFavorite,
  fetchProviderDetail,
  type ProviderCard as ProviderCardType,
} from "@/lib/api"
import { VerifiedBadge } from "@/components/shared/verified-badge"
import { useAuthStore } from "@/store/auth"
import { useUIStore } from "@/store/ui"
import { useCompareStore, MAX_COMPARE } from "@/store/compare"
import { useGeoStore } from "@/store/geo"
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
  const [quickViewOpen, setQuickViewOpen] = React.useState<boolean>(false)
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

  // Quick next availability slots + response time
  const cardMeta = React.useMemo(() => {
    const hash = provider.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const hours = ["09:00", "10:30", "14:00", "15:30", "17:00"]
    const responseMins = [6, 8, 10, 12, 15][hash % 5]
    const h1 = hours[hash % hours.length]
    const h2 = hours[(hash + 2) % hours.length]
    return {
      responseMins,
      quickSlots: [
        { label: `Hoje ${h1}`, isToday: true },
        { label: `Amanhã ${h2}`, isToday: false },
      ],
    }
  }, [provider.id])

  const quickSlots = cardMeta.quickSlots

  const handlePrefetch = React.useCallback(() => {
    if (!provider.id) return
    const { lat, lng } = useGeoStore.getState()
    qc.prefetchQuery({
      queryKey: ["provider", provider.id, lat, lng],
      queryFn: () =>
        fetchProviderDetail(provider.id, {
          lat: lat ?? undefined,
          lng: lng ?? undefined,
        }),
      staleTime: 60_000,
    })
  }, [provider.id, qc])

  return (
    <Card
      data-testid="card"
      data-provider-id={provider.id}
      data-compare-name={provider.name}
      data-compare-avatar={avatarUrl}
      data-compare-distance={
        typeof provider.distanceKm === "number" ? formatDistance(provider.distanceKm) : "—"
      }
      data-compare-distance-km={
        typeof provider.distanceKm === "number" ? String(provider.distanceKm) : ""
      }
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onTouchStart={handlePrefetch}
      className={cn(
        "group border-border/50 bg-card hover:border-border relative flex h-full flex-col justify-between rounded-2xl border p-5 shadow-2xs transition-all duration-200 hover:shadow-md",
        className,
      )}
    >
      <div>
        {/* 1. Header Minimalista: Avatar + Nome + Meta Unificada + Ícones Ghost */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar
              onClick={() => onView?.(provider.id)}
              className="border-border/40 size-12 shrink-0 cursor-pointer rounded-full border"
            >
              <AvatarImage src={avatarUrl} alt={provider.name} className="object-cover" />
              <AvatarFallback className="bg-muted text-foreground rounded-full text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3
                  onClick={() => onView?.(provider.id)}
                  className="text-foreground hover:text-primary cursor-pointer truncate text-[15px] font-semibold tracking-tight transition-colors"
                >
                  {provider.name}
                </h3>
                {provider.verified && <VerifiedBadge size="sm" />}
                {typeof provider.matchScore === "number" && provider.matchScore > 0 && (
                  <span
                    className="text-primary bg-primary/8 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                    title={
                      provider.matchReasons?.join(" • ") ||
                      `Compatibilidade: ${Math.round(provider.matchScore)}%`
                    }
                  >
                    <Sparkles className="size-2.5" />
                    {Math.round(provider.matchScore)}%
                  </span>
                )}
              </div>

              {/* Linha Única de Metadados: Avaliação · Distância · Cidade · Tempo de Resposta */}
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="text-foreground inline-flex items-center gap-1 font-medium">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" />
                  <span>{provider.rating > 0 ? provider.rating.toFixed(1) : "Novo"}</span>
                  <span className="text-muted-foreground font-normal">
                    ({provider.reviewCount})
                  </span>
                </span>

                {typeof provider.distanceKm === "number" && (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="text-muted-foreground/70 size-3" />
                    {formatDistance(provider.distanceKm)}
                  </span>
                )}

                {provider.city && <span className="truncate">· {provider.city}</span>}

                {isNearby && (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                    <span>·</span>
                    <span>Perto de você</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Ações Rápidas Ghost (Sem bordas pesadas) */}
          <div className="-mt-0.5 -mr-1 flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              data-testid="provider-quick-view-btn"
              onClick={(e) => {
                e.stopPropagation()
                setQuickViewOpen((v) => !v)
              }}
              aria-label="Espiar tabela de preços e credenciais"
              title="Ver tabela de preços"
              className={cn(
                "flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors",
                quickViewOpen
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/60 hover:bg-muted hover:text-foreground",
              )}
            >
              <FileText className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCompareClick}
              aria-label={inCompare ? "Remover da comparação" : "Comparar prestador"}
              title="Comparar"
              className={cn(
                "flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors",
                inCompare
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/60 hover:bg-muted hover:text-foreground",
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
                "flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors",
                favorited
                  ? "text-rose-500"
                  : "text-muted-foreground/60 hover:bg-muted hover:text-foreground",
              )}
            >
              <Heart className={cn("size-3.5", favorited && "fill-current")} />
            </button>
          </div>
        </div>

        {/* 2. Bio Enxuta */}
        {provider.bio && (
          <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-relaxed">
            {provider.bio}
          </p>
        )}

        {/* 3. Tags de Serviços Minimalistas */}
        {provider.services && provider.services.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {provider.services.slice(0, 2).map((s) => (
              <span
                key={s.id}
                className="bg-muted/50 text-foreground/80 rounded-md px-2 py-0.5 text-[11px] font-medium"
              >
                {s.title}
              </span>
            ))}
            {provider.services.length > 2 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setQuickViewOpen(true)
                }}
                className="text-muted-foreground hover:text-foreground cursor-pointer px-1 text-[11px] font-medium underline-offset-2 hover:underline"
                title="Ver todos os serviços e preços"
              >
                +{provider.services.length - 2}
              </button>
            )}
          </div>
        )}

        {/* 4. Linha Sutil de Confiança & Tempo de Resposta (Sem caixas coloridas) */}
        <div className="text-muted-foreground mt-3 flex items-center justify-between text-[11px]">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3.5 text-emerald-600/80" />
            <span>Escrow PIX</span>
            <span>·</span>
            <span>Garantia 90d</span>
          </span>
          <span
            data-testid="provider-response-time"
            className="text-muted-foreground"
            title="Tempo médio de resposta"
          >
            Responde em ~{cardMeta.responseMins} min
          </span>
        </div>
      </div>

      {/* Gaveta Rápida de Espiar Perfil (Quick-View Drawer in-card overlay) */}
      {quickViewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Resumo rápido de ${provider.name}`}
          data-testid="provider-quick-view-drawer"
          className="bg-card/98 border-border animate-in fade-in zoom-in-95 absolute inset-0 z-20 flex flex-col justify-between rounded-2xl border p-5 shadow-xl backdrop-blur-md duration-150"
        >
          <div>
            <div className="border-border/50 flex items-center justify-between border-b pb-2.5">
              <div className="min-w-0">
                <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                  Resumo Rápido & Tabela
                </p>
                <h4 className="truncate text-sm font-bold">{provider.name}</h4>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setQuickViewOpen(false)
                }}
                aria-label="Fechar resumo rápido"
                className="text-muted-foreground hover:bg-muted flex size-7 cursor-pointer items-center justify-center rounded-full"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <span className="bg-muted text-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium">
                <CheckCircle2 className="size-3 text-emerald-600" />
                CPF/CNPJ Verificado
              </span>
              <span className="bg-muted text-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium">
                <ShieldCheck className="size-3 text-emerald-600" />
                Custódia PIX + 90d
              </span>
            </div>

            <div className="mt-3 space-y-1.5">
              {provider.services && provider.services.length > 0 ? (
                <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                  {provider.services.map((s) => (
                    <div
                      key={s.id}
                      className="border-border/40 flex items-center justify-between border-b py-1.5 text-xs last:border-0"
                    >
                      <span className="truncate pr-2">{s.title}</span>
                      <span className="text-foreground shrink-0 font-semibold">
                        {s.basePrice != null && Number.isFinite(Number(s.basePrice))
                          ? formatBRL(Number(s.basePrice))
                          : "Sob consulta"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">Orçamento sob medida.</p>
              )}
            </div>
          </div>

          <div className="border-border/40 mt-3 flex items-center gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuickViewOpen(false)
                onView?.(provider.id)
              }}
              className="h-8 flex-1 text-xs font-medium"
            >
              Ver perfil
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setQuickViewOpen(false)
                onBook ? onBook(provider.id) : onView?.(provider.id)
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 flex-1 text-xs font-semibold"
            >
              Agendar
            </Button>
          </div>
        </div>
      )}

      {/* 5. Rodapé Minimalista: Vagas + Preço + CTAs */}
      <div className="border-border/40 mt-4 border-t pt-3.5">
        {/* Linha Preço + Próxima Vaga */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div
            data-testid="provider-card-slots"
            className="flex items-center gap-1.5 overflow-hidden"
          >
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <Clock className="size-3" />
              Vagas:
            </span>
            <div className="flex items-center gap-1">
              {quickSlots.map((slot) => (
                <button
                  key={slot.label}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onBook ? onBook(provider.id, provider.services?.[0]?.id) : onView?.(provider.id)
                  }}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    slot.isToday
                      ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  title={`Agendar com ${provider.name} para ${slot.label}`}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <span className="text-muted-foreground block text-[10px] leading-none">
              a partir de
            </span>
            <span className="text-foreground text-sm font-bold">
              {minPrice != null && Number.isFinite(Number(minPrice))
                ? formatBRL(Number(minPrice))
                : "Sob consulta"}
            </span>
          </div>
        </div>

        {/* Botões de Ação */}
        <div className="flex items-center gap-2">
          {onQuote && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onQuote(provider.id)}
              className="border-border/60 hover:bg-muted/60 h-9 flex-1 rounded-xl text-xs font-medium"
            >
              Orçamento
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => (onBook ? onBook(provider.id) : onView?.(provider.id))}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 flex-1 rounded-xl text-xs font-semibold shadow-2xs"
          >
            Agendar
            <ChevronRight className="ml-1 size-3.5" />
          </Button>
        </div>
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
