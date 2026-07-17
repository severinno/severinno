"use client"

/**
 * ClientFavorites — grid of favorited providers.
 *
 * Polish (Nielsen + trust/transparency):
 *  - Page header (text-2xl font-bold) with quick action "Buscar prestadores".
 *  - Grid of compact provider cards (mobile 1col, sm 2cols) reusing the
 *    vitrine visual style.
 *  - Each card: avatar, name, verified badge, rating (star), distance/city,
 *    bio (line-clamp-2), services count + "A partir de R$ X", and three
 *    actions: Orçamento (outline emerald), Agendar (emerald), Remover
 *    (ghost rose icon button).
 *  - Friendly empty state: "Você ainda não tem favoritos. Toque no coração
 *    nos prestadores para salvá-los aqui." + "Buscar prestadores" CTA.
 */

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  BadgeCheck,
  Heart,
  Loader2,
  MapPin,
  Star,
} from "lucide-react"
import { toast } from "sonner"

import {
  fetchFavorites,
  toggleFavorite,
  type ProviderCard as ProviderCardType,
} from "@/lib/api"
import { formatDistance } from "@/lib/geo-client"
import { useUIStore, useViewStore } from "@/store"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  EmptyState,
} from "@/components/shared/dashboard-shell"
import {
  PageHeader,
  StatusBadge,
} from "@/components/client/client-shared"
import { formatBRL } from "@/lib/format"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerInitials(name?: string | null): string {
  if (!name) return "P"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientFavorites() {
  const qc = useQueryClient()
  const navigate = useViewStore((s) => s.navigate)
  const openQuote = useUIStore((s) => s.openQuote)
  const openBooking = useUIStore((s) => s.openBooking)
  const openProvider = useUIStore((s) => s.openProvider)

  const query = useQuery<ProviderCardType[]>({
    queryKey: ["favorites"],
    queryFn: fetchFavorites,
  })

  const removeMutation = useMutation({
    mutationFn: (providerId: string) => toggleFavorite(providerId),
    onSuccess: (data, providerId) => {
      toast.success(
        data.favorited
          ? "Adicionado aos favoritos."
          : "Removido dos favoritos.",
      )
      qc.invalidateQueries({ queryKey: ["favorites"] })
      // providers/[id] caches the `favorited` flag too
      qc.invalidateQueries({ queryKey: ["provider", providerId] })
    },
    onError: () =>
      toast.error("Não foi possível atualizar favoritos. Tente novamente."),
  })

  const items = query.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Favoritos"
        subtitle="Prestadores que você salvou para contratar depois."
        action={
          <Button
            variant="outline"
            onClick={() => navigate("vitrine")}
            className="h-10 gap-2"
          >
            <MapPin className="size-4" />
            Buscar prestadores
          </Button>
        }
      />

      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Carregando favoritos…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Você ainda não tem favoritos"
          description="Toque no coração nos prestadores para salvá-los aqui e contratá-los depois com facilidade."
          action={
            <Button
              onClick={() => navigate("vitrine")}
              className="mt-2 gap-2"
            >
              <MapPin className="size-4" />
              Buscar prestadores
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((p) => (
            <FavoriteCard
              key={p.id}
              provider={p}
              onQuote={() => openQuote({ providerId: p.id })}
              onBook={(serviceId) =>
                openBooking({ providerId: p.id, serviceId })
              }
              onView={() => openProvider(p.id)}
              onRemove={() => removeMutation.mutate(p.id)}
              isRemoving={removeMutation.isPending}
              removingId={removeMutation.variables ?? null}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FavoriteCard
// ---------------------------------------------------------------------------

function FavoriteCard({
  provider,
  onQuote,
  onBook,
  onView,
  onRemove,
  isRemoving,
  removingId,
}: {
  provider: ProviderCardType
  onQuote: () => void
  onBook: (serviceId?: string) => void
  onView: () => void
  onRemove: () => void
  isRemoving: boolean
  removingId: string | null
}) {
  const initials = providerInitials(provider.name)
  const servicesCount = provider.services?.length ?? 0
  const minPrice = provider.services?.length
    ? Math.min(...provider.services.map((s) => s.basePrice))
    : null
  const isThisRemoving = isRemoving && removingId === provider.id

  return (
    <Card className="flex flex-col overflow-hidden rounded-xl shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex-1 py-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onView}
            className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Ver perfil de ${provider.name}`}
          >
            <Avatar className="size-12 border">
              {provider.avatarUrl ? (
                <AvatarImage src={provider.avatarUrl} alt={provider.name} />
              ) : null}
              <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
                {initials || "P"}
              </AvatarFallback>
            </Avatar>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onView}
                className="truncate text-sm font-semibold hover:text-primary focus-visible:underline"
              >
                {provider.name}
              </button>
              {provider.verified ? (
                <StatusBadge tone="emerald" icon={BadgeCheck}>
                  Verificado
                </StatusBadge>
              ) : null}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                {provider.rating > 0 ? provider.rating.toFixed(1) : "—"}
                <span className="font-normal text-muted-foreground tabular-nums">
                  ({provider.reviewCount})
                </span>
              </span>
              {typeof provider.distanceKm === "number" ? (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <MapPin className="size-3.5 text-primary" />
                  {formatDistance(provider.distanceKm)}
                </span>
              ) : provider.city ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {provider.city}
                </span>
              ) : null}
            </div>

            {provider.bio ? (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                {provider.bio}
              </p>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {servicesCount} {servicesCount === 1 ? "serviço" : "serviços"}
              </span>
              {minPrice != null ? (
                <span className="font-medium text-foreground tabular-nums">
                  A partir de {formatBRL(minPrice)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex items-center gap-2 border-t bg-muted/30 p-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onQuote}
          className="h-9 flex-1 gap-1.5 border-primary text-primary hover:bg-primary/10 hover:text-primary"
        >
          Orçamento
        </Button>
        <Button
          size="sm"
          onClick={() => onBook(undefined)}
          className="h-9 flex-1 gap-1.5"
        >
          Agendar
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={isThisRemoving}
          className="size-9 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
          aria-label="Remover dos favoritos"
          title="Remover dos favoritos"
        >
          {isThisRemoving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Heart className="size-4 fill-current" />
          )}
        </Button>
      </CardFooter>
    </Card>
  )
}
