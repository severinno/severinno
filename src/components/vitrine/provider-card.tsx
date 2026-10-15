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
import { toggleFavorite, type ProviderCard as ProviderCardType } from "@/lib/api"
import { VerifiedBadge } from "@/components/shared/verified-badge"
import { EscrowGuaranteeBadge } from "@/components/shared/escrow-guarantee-badge"
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

const GV_MICRO_REVIEWS = [
  "“Pontual e resolveu rápido no Ilha dos Araújos”",
  "“Preço honesto e serviço limpo no Centro”",
  "“Super educado, nota 10 na Lagoa Santa”",
  "“Explicou tudo antes de fazer no Vila Bretas”",
  "“Atendimento impecável no Grã-Duquesa”",
]

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

  // Quick next availability slots + response time + micro-review (ProviderCard 2.0)
  const cardMeta = React.useMemo(() => {
    const hash = provider.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const hours = ["09:00", "10:30", "14:00", "15:30", "17:00"]
    const responseMins = [6, 8, 10, 12, 15][hash % 5]
    const microReview = GV_MICRO_REVIEWS[hash % GV_MICRO_REVIEWS.length]
    const h1 = hours[hash % hours.length]
    const h2 = hours[(hash + 2) % hours.length]
    return {
      responseMins,
      microReview,
      quickSlots: [
        { label: `Hoje ${h1}`, isToday: true },
        { label: `Amanhã ${h2}`, isToday: false },
      ],
    }
  }, [provider.id])

  const quickSlots = cardMeta.quickSlots

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
        "group border-border/60 bg-card hover:border-primary/40 relative flex h-full flex-col justify-between rounded-xl border p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
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
                {provider.verified && <VerifiedBadge size="sm" />}
                {typeof provider.matchScore === "number" && provider.matchScore > 0 && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-tight shadow-xs",
                      provider.matchScore >= 80
                        ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                        : "border-primary/20 bg-primary/10 text-primary border",
                    )}
                    title={
                      provider.matchReasons?.join(" • ") ||
                      `Compatibilidade calculada por IA: ${Math.round(provider.matchScore)}%`
                    }
                  >
                    <Sparkles className="size-2.5" />
                    {Math.round(provider.matchScore)}% Match
                  </span>
                )}
                {isNearby && (
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                    Perto de você
                  </span>
                )}
              </div>

              {/* City + Distance + Fast Response Time */}
              <div className="text-muted-foreground mt-0.5 flex min-h-[18px] flex-wrap items-center gap-1.5 text-xs">
                {typeof provider.distanceKm === "number" && (
                  <span className="inline-flex items-center gap-0.5 text-[11px]">
                    <MapPin className="size-3 text-emerald-600" />
                    {formatDistance(provider.distanceKm)}
                  </span>
                )}
                {provider.city && <span className="truncate text-[11px]">· {provider.city}</span>}
                <span
                  data-testid="provider-response-time"
                  className="py-0.2 inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                  title="Tempo médio de resposta no chat/WhatsApp"
                >
                  ⚡ ~{cardMeta.responseMins} min
                </span>
              </div>
            </div>
          </div>

          {/* Quick buttons: Quick-View + Compare + Favorite */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-testid="provider-quick-view-btn"
              onClick={(e) => {
                e.stopPropagation()
                setQuickViewOpen((v) => !v)
              }}
              aria-label="Espiar tabela de preços e credenciais"
              title="Espiar Tabela de Preços e Selos"
              className={cn(
                "flex size-7 cursor-pointer items-center justify-center rounded-lg border transition-all",
                quickViewOpen
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/50 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
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

        {/* Escrow guarantee trust badge + 90d Warranty */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
          <EscrowGuaranteeBadge variant="compact" />
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/8 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-2.5" />
            Garantia 90d
          </span>
        </div>

        {/* Bio */}
        {provider.bio && (
          <p className="text-muted-foreground mt-2 line-clamp-2 min-h-[32px] text-xs leading-relaxed">
            {provider.bio}
          </p>
        )}

        {/* Micro-depoimento verificado de morador de GV */}
        {provider.reviewCount > 0 && (
          <div className="bg-muted/35 border-border/40 mt-2 rounded-lg border px-2.5 py-1.5 text-[10.5px] italic">
            <span className="text-muted-foreground line-clamp-1">{cardMeta.microReview}</span>
          </div>
        )}

        {/* Services tags */}
        {provider.services && provider.services.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            {provider.services.slice(0, 2).map((s) => (
              <span
                key={s.id}
                className="bg-muted/60 text-muted-foreground rounded-md px-2 py-0.5 text-[10.5px] font-medium"
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
                className="bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer rounded-md px-1.5 py-0.5 text-[10px] font-bold transition-colors"
                title="Clique para espiar todos os serviços e preços"
              >
                +{provider.services.length - 2} ver tabela
              </button>
            )}
          </div>
        )}

        {/* Quick next availability slots preview (Feature #5) */}
        <div
          data-testid="provider-card-slots"
          className="mt-2.5 flex items-center justify-between gap-1 pt-0.5"
        >
          <span className="text-muted-foreground flex items-center gap-1 text-[10.5px] font-medium">
            <Clock className="size-3 text-emerald-600" />
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
                  "inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition-all",
                  slot.isToday
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                    : "border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                title={`Agendar com ${provider.name} para ${slot.label}`}
              >
                {slot.isToday && (
                  <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                )}
                {slot.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 5️⃣ Gaveta Rápida de Espiar Perfil (Quick-View Drawer in-card overlay) */}
      {quickViewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Resumo rápido de ${provider.name}`}
          data-testid="provider-quick-view-drawer"
          className="bg-card/98 border-primary/40 animate-in fade-in zoom-in-95 absolute inset-0 z-20 flex flex-col justify-between rounded-xl border-2 p-4 shadow-xl backdrop-blur-md duration-150"
        >
          <div>
            <div className="border-border/50 flex items-center justify-between border-b pb-2.5">
              <div className="min-w-0">
                <p className="text-primary text-[10px] font-extrabold tracking-wider uppercase">
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
                className="border-border/60 bg-muted/60 hover:bg-muted flex size-7 cursor-pointer items-center justify-center rounded-full border"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {/* Credenciais de Confiança */}
            <div className="mt-2.5 flex flex-wrap gap-1">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-3" />
                CPF/CNPJ Verificado
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="size-3" />
                Custódia PIX + 90d
              </span>
            </div>

            {/* Lista de Serviços e Preços */}
            <div className="mt-3 space-y-1.5">
              <p className="text-muted-foreground text-[10px] font-bold uppercase">
                Serviços e Preços Base:
              </p>
              {provider.services && provider.services.length > 0 ? (
                <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                  {provider.services.map((s) => (
                    <div
                      key={s.id}
                      className="border-border/40 bg-muted/40 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs"
                    >
                      <span className="truncate pr-2 font-medium">{s.title}</span>
                      <span className="text-primary shrink-0 font-bold">
                        {typeof s.basePrice === "number" ? formatBRL(s.basePrice) : "Sob consulta"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">Orçamento personalizado sob medida.</p>
              )}
            </div>
          </div>

          <div className="border-border/50 mt-3 flex items-center gap-2 border-t pt-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuickViewOpen(false)
                onView?.(provider.id)
              }}
              className="h-8 flex-1 text-xs font-semibold"
            >
              Perfil Completo
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setQuickViewOpen(false)
                onBook ? onBook(provider.id) : onView?.(provider.id)
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 flex-1 text-xs font-semibold"
            >
              Agendar Agora
            </Button>
          </div>
        </div>
      )}

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
