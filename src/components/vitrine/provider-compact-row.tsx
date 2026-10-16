"use client"

/**
 * ProviderCompactRow — Linha compacta horizontal para exibição em modo lista na Vitrine.
 *
 * Permite aos usuários desktop e mobile escanear múltiplos profissionais rapidamente
 * com informações de preço, distância, tempo estimado, bairro e CTAs diretos.
 */

import * as React from "react"
import {
  Star,
  MapPin,
  Heart,
  GitCompare,
  CheckCircle2,
  Sparkles,
  MessageCircle,
  ChevronRight,
  ShieldCheck,
  FileText,
  X,
} from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { triggerHaptic } from "@/lib/haptics"
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
import { EscrowPopover } from "./escrow-popover"
import { playPopSound } from "@/lib/sounds"

import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export type ProviderCompactRowProps = {
  provider: ProviderCardType
  favorited?: boolean
  onQuote?: (id: string) => void
  onBook?: (id: string, serviceId?: string) => void
  onView?: (id: string) => void
  className?: string
}

export default React.memo(function ProviderCompactRow({
  provider,
  favorited: favoritedProp,
  onQuote,
  onBook,
  onView,
  className,
}: ProviderCompactRowProps) {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const openAuth = useUIStore((s) => s.openAuth)
  const userDistrict = useGeoStore((s) => s.district)

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
      toast.error("Erro ao favoritar. Tente novamente.")
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["favorites"] })
    },
  })

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    triggerHaptic("selection")
    if (!user) {
      openAuth("login")
      return
    }
    favMutation.mutate()
  }

  const handleCompareClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    triggerHaptic("selection")
    if (!inCompare && compareIds.length >= MAX_COMPARE) {
      toast.warning(`Você pode comparar no máximo ${MAX_COMPARE} prestadores.`, {
        action: {
          label: "Ver comparativo",
          onClick: () => useCompareStore.getState().openCompare(),
        },
      })
      return
    }
    toggleCompare(provider.id)
  }

  const handleWhatsApp = (e: React.MouseEvent) => {
    e.stopPropagation()
    triggerHaptic("selection")
    if (provider.whatsapp) {
      const digits = provider.whatsapp.replace(/\D/g, "")
      const num = digits.startsWith("55") ? digits : `55${digits}`
      const text = encodeURIComponent(
        `Olá ${provider.name}, vi seu perfil no Severinno e gostaria de solicitar um orçamento.`,
      )
      window.open(`https://wa.me/${num}?text=${text}`, "_blank", "noopener,noreferrer")
    } else {
      onView?.(provider.id)
    }
  }

  const isNearby =
    typeof provider.distanceKm === "number" &&
    typeof provider.radiusKm === "number" &&
    provider.distanceKm <= provider.radiusKm

  const isSameNeighborhood = Boolean(
    userDistrict &&
    provider.district &&
    provider.district.trim().toLowerCase() === userDistrict.trim().toLowerCase(),
  )

  const driveTimeMin =
    typeof provider.distanceKm === "number" && provider.distanceKm > 0
      ? Math.max(3, Math.round(provider.distanceKm * 2.2))
      : null

  const minPrice = provider.services?.[0]?.basePrice

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
    <div
      onClick={() => onView?.(provider.id)}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onTouchStart={handlePrefetch}
      className={cn(
        "group border-border/60 bg-card hover:border-primary/40 relative flex cursor-pointer flex-col justify-between gap-3.5 rounded-2xl border p-4 shadow-2xs transition-all duration-150 hover:shadow-sm md:flex-row md:items-center",
        className,
      )}
    >
      {/* Identity & Meta */}
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <Avatar className="border-border/50 size-11 shrink-0 rounded-xl border sm:size-12">
          <AvatarImage src={avatarUrl} alt={provider.name} className="object-cover" />
          <AvatarFallback className="bg-muted rounded-xl text-xs font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-foreground hover:text-primary truncate text-sm font-bold transition-colors sm:text-base">
              {provider.name}
            </h3>
            {provider.verified && <VerifiedBadge size="sm" />}
            {typeof provider.matchScore === "number" && provider.matchScore > 0 && (
              <span className="text-primary bg-primary/10 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                <Sparkles className="size-2.5" />
                {Math.round(provider.matchScore)}%
              </span>
            )}
          </div>

          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="text-foreground inline-flex items-center gap-1 font-semibold">
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
              <span>{provider.rating > 0 ? provider.rating.toFixed(1) : "Novo"}</span>
              <span className="text-muted-foreground font-normal">({provider.reviewCount})</span>
            </span>

            {typeof provider.distanceKm === "number" && (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="text-muted-foreground/70 size-3" />
                {formatDistance(provider.distanceKm)}
                {driveTimeMin && (
                  <span className="text-muted-foreground/80 font-normal">
                    (~{driveTimeMin} min)
                  </span>
                )}
              </span>
            )}

            {provider.city && <span className="truncate">· {provider.city}</span>}

            {isSameNeighborhood ? (
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                <span>·</span>
                <span>No seu bairro ({provider.district})</span>
              </span>
            ) : isNearby ? (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                <span>·</span>
                <span>Perto de você</span>
              </span>
            ) : provider.district ? (
              <span className="truncate">· {provider.district}</span>
            ) : null}

            <EscrowPopover>
              <span className="inline-flex cursor-pointer items-center gap-1 font-medium text-emerald-700 transition-colors hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300">
                <span>·</span>
                <ShieldCheck className="size-3 text-emerald-600" />
                <span>Escrow PIX</span>
              </span>
            </EscrowPopover>
          </div>
        </div>
      </div>

      {/* Middle: Services pills */}
      {provider.services && provider.services.length > 0 && (
        <div className="hidden max-w-xs shrink-0 items-center gap-1.5 overflow-hidden lg:flex">
          {provider.services.slice(0, 2).map((s) => (
            <span
              key={s.id}
              className="bg-muted/50 border-border/40 text-foreground/80 truncate rounded-lg border px-2.5 py-1 text-xs font-medium"
            >
              {s.title}
            </span>
          ))}
          {provider.services.length > 2 && (
            <span className="text-muted-foreground text-xs font-medium">
              +{provider.services.length - 2}
            </span>
          )}
        </div>
      )}

      {/* Right: Price + Quick CTAs */}
      <div className="border-border/30 flex shrink-0 items-center justify-between gap-3 border-t pt-2 md:justify-end md:border-t-0 md:pt-0">
        <div className="pr-1 text-left md:text-right">
          <span className="text-muted-foreground block text-[10px] leading-none">a partir de</span>
          <span className="text-foreground text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
            {minPrice != null && Number.isFinite(Number(minPrice))
              ? formatBRL(Number(minPrice))
              : "Sob consulta"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="provider-quick-view-btn"
            onClick={(e) => {
              e.stopPropagation()
              playPopSound()
              setQuickViewOpen((v) => !v)
            }}
            aria-label="Espiar tabela de preços e credenciais"
            title="Ver tabela de preços"
            className={cn(
              "flex size-8.5 cursor-pointer items-center justify-center rounded-xl border transition-colors",
              quickViewOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <FileText className="size-4" />
          </button>

          <button
            type="button"
            onClick={handleCompareClick}
            aria-label={inCompare ? "Remover da comparação" : "Comparar prestador"}
            title="Comparar"
            className={cn(
              "flex size-8.5 cursor-pointer items-center justify-center rounded-xl border transition-colors",
              inCompare
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {inCompare ? <CheckCircle2 className="size-4" /> : <GitCompare className="size-4" />}
          </button>

          <button
            type="button"
            onClick={handleWhatsApp}
            className="flex size-8.5 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-50 text-emerald-700 shadow-2xs transition-colors hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300"
            title={`Chamar ${provider.name} no WhatsApp`}
            aria-label={`Chamar ${provider.name} no WhatsApp`}
          >
            <MessageCircle className="size-4" />
          </button>

          {onQuote && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                triggerHaptic("selection")
                onQuote(provider.id)
              }}
              className="border-border/60 hover:bg-muted/60 h-8.5 rounded-xl px-3 text-xs font-semibold"
            >
              Orçar
            </Button>
          )}

          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              triggerHaptic("selection")
              onBook ? onBook(provider.id) : onView?.(provider.id)
            }}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-8.5 rounded-xl px-3 text-xs font-bold shadow-2xs"
          >
            Agendar
            <ChevronRight className="ml-1 size-3.5" />
          </Button>

          <button
            type="button"
            onClick={handleFavoriteClick}
            aria-label={favorited ? "Remover dos favoritos" : "Salvar nos favoritos"}
            title="Favoritar"
            className={cn(
              "flex size-8.5 cursor-pointer items-center justify-center rounded-xl border transition-colors",
              favorited
                ? "border-rose-200 bg-rose-50 text-rose-500 dark:border-rose-900/50 dark:bg-rose-950/30"
                : "border-border/60 text-muted-foreground/60 hover:bg-muted hover:text-foreground",
            )}
          >
            <Heart className={cn("size-3.5", favorited && "fill-current")} />
          </button>
        </div>
      </div>

      {/* Gaveta Rápida de Espiar Perfil (Quick-View Drawer in-card overlay) */}
      {quickViewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Resumo rápido de ${provider.name}`}
          data-testid="provider-quick-view-drawer"
          className="bg-card/98 border-border animate-in fade-in zoom-in-95 absolute inset-0 z-20 flex flex-col justify-between rounded-2xl border p-4 shadow-xl backdrop-blur-md duration-150"
        >
          <div>
            <div className="border-border/50 flex items-center justify-between border-b pb-2">
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
                  playPopSound()
                  setQuickViewOpen(false)
                }}
                aria-label="Fechar resumo rápido"
                className="text-muted-foreground hover:bg-muted flex size-7 cursor-pointer items-center justify-center rounded-full"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="bg-muted text-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium">
                <CheckCircle2 className="size-3 text-emerald-600" />
                CPF/CNPJ Verificado
              </span>
              <span className="bg-muted text-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium">
                <ShieldCheck className="size-3 text-emerald-600" />
                Custódia PIX + 90d
              </span>
            </div>

            <div className="mt-2.5 space-y-1">
              {provider.services && provider.services.length > 0 ? (
                <div className="max-h-24 space-y-1 overflow-y-auto pr-1">
                  {provider.services.map((s) => (
                    <div
                      key={s.id}
                      className="border-border/40 flex items-center justify-between border-b py-1 text-xs last:border-0"
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

          <div className="border-border/40 mt-2 flex items-center gap-2 border-t pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuickViewOpen(false)
                onView?.(provider.id)
              }}
              className="h-7.5 flex-1 text-xs font-medium"
            >
              Ver perfil
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setQuickViewOpen(false)
                onBook ? onBook(provider.id) : onView?.(provider.id)
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-7.5 flex-1 text-xs font-semibold"
            >
              Agendar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
})
