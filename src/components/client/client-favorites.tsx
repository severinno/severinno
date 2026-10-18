"use client"

/**
 * ClientFavorites — grid of favorited providers.
 *
 * Polish & Service Design:
 *  - Modern Hero Banner with subtle rose/card gradient & Trust Favorites Badge.
 *  - Quick access actions: "Buscar prestadores" & "Ver agendamentos".
 *  - 3 High-impact StatCards (Prestadores Salvos, Verificados, Nota Média).
 *  - Real-time search filter and sorting options.
 *  - Redesigned Favorite Cards:
 *    - 100% round provider avatars (rounded-full).
 *    - Clickable provider name opening provider profile.
 *    - Verified badge, star rating display, location/distance.
 *    - Services count & starting price.
 *    - Actions: "Orçamento", "Agendar", "Mensagem" (client.messages — zero WhatsApp leak!), and "Remover".
 *  - Persuasive Empty State with direct search CTA.
 */

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  BadgeCheck,
  Calendar,
  CheckCircle2,
  Heart,
  Loader2,
  MapPin,
  MessageSquare,
  RotateCcw,
  Search,
  Star,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { fetchFavorites, toggleFavorite, type ProviderCard as ProviderCardType } from "@/lib/api"
import { formatDistance } from "@/lib/geo-client"
import { formatBRL } from "@/lib/format"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState, StatCard } from "@/components/shared/dashboard-shell"
import { StatusBadge } from "@/components/client/client-shared"

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

  const [filterText, setFilterText] = React.useState("")
  const [sortBy, setSortBy] = React.useState<"rating" | "services" | "name">("rating")

  const query = useQuery<ProviderCardType[]>({
    queryKey: ["favorites"],
    queryFn: fetchFavorites,
  })

  const removeMutation = useMutation({
    mutationFn: (providerId: string) => toggleFavorite(providerId),
    onSuccess: (data, providerId) => {
      toast.success(data.favorited ? "Adicionado aos favoritos." : "Removido dos favoritos.")
      qc.invalidateQueries({ queryKey: ["favorites"] })
      qc.invalidateQueries({ queryKey: ["provider", providerId] })
    },
    onError: () => toast.error("Não foi possível atualizar favoritos. Tente novamente."),
  })

  const rawItems = React.useMemo(() => query.data ?? [], [query.data])

  // Metrics summary
  const summary = React.useMemo(() => {
    const totalCount = rawItems.length
    const verifiedCount = rawItems.filter((p) => p.verified).length
    const ratedItems = rawItems.filter((p) => p.rating > 0)
    const avgRating = ratedItems.length
      ? ratedItems.reduce((acc, p) => acc + p.rating, 0) / ratedItems.length
      : 5.0
    return {
      totalCount,
      verifiedCount,
      avgRating,
    }
  }, [rawItems])

  // Filter and sort items
  const items = React.useMemo(() => {
    let list = [...rawItems]

    if (filterText.trim()) {
      const search = filterText.trim().toLowerCase()
      list = list.filter((p) => {
        const matchName = p.name.toLowerCase().includes(search)
        const matchBio = p.bio?.toLowerCase().includes(search) ?? false
        const matchServices =
          p.services?.some((s) => s.title.toLowerCase().includes(search)) ?? false
        const matchCity = p.city?.toLowerCase().includes(search) ?? false
        return matchName || matchBio || matchServices || matchCity
      })
    }

    return list.sort((a, b) => {
      if (sortBy === "rating") {
        return b.rating - a.rating
      }
      if (sortBy === "services") {
        return (b.services?.length ?? 0) - (a.services?.length ?? 0)
      }
      if (sortBy === "name") {
        return a.name.localeCompare(b.name)
      }
      return 0
    })
  }, [rawItems, filterText, sortBy])

  const hasFilters = filterText !== "" || sortBy !== "rating"

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="border-border/60 from-card via-card/95 relative overflow-hidden rounded-2xl border bg-gradient-to-br to-rose-500/5 p-6 shadow-sm">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-600 dark:text-rose-400">
              <Heart className="size-3.5 fill-rose-500 text-rose-500" />
              <span>Seus Profissionais de Confiança</span>
            </div>
            <h1 className="text-foreground mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              Favoritos
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Acesse rapidamente seus prestadores favoritos para novos agendamentos e orçamentos em
              Governador Valadares.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("client.bookings")}
              className="gap-1.5 text-xs font-medium"
            >
              <Calendar className="size-3.5" />
              Ver agendamentos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("client.providers")}
              className="gap-1.5 text-xs font-medium"
            >
              <MapPin className="size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      {/* Impact StatCards */}
      {rawItems.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            icon={Users}
            label="Prestadores Salvos"
            value={String(summary.totalCount)}
            tone="rose"
            hint="Salvos na sua lista"
          />
          <StatCard
            icon={CheckCircle2}
            label="Verificados"
            value={String(summary.verifiedCount)}
            tone="primary"
            hint="Com selo de verificação"
          />
          <StatCard
            icon={Star}
            label="Nota Média"
            value={`${summary.avgRating.toFixed(1)} ★`}
            tone="amber"
            hint="Avaliação dos favoritos"
          />
        </div>
      )}

      {/* Filter bar */}
      {rawItems.length > 0 && (
        <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filtrar por nome, serviço ou bairro..."
              className="h-9 pl-9 text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
              Ordenar
            </span>
            <Select
              value={sortBy}
              onValueChange={(val) => setSortBy(val as "rating" | "services" | "name")}
            >
              <SelectTrigger className="h-9 w-40" size="sm" aria-label="Ordenar favoritos por">
                <SelectValue placeholder="Ordenar por" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rating">Melhor avaliados</SelectItem>
                <SelectItem value="services">Mais serviços</SelectItem>
                <SelectItem value="name">Nome (A-Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterText("")
                setSortBy("rating")
              }}
              className="text-muted-foreground hover:text-foreground h-9 gap-1.5 self-end"
            >
              <RotateCcw className="size-3.5" />
              Limpar
            </Button>
          ) : null}

          <p className="text-muted-foreground ml-auto self-end text-xs tabular-nums">
            {items.length === 0
              ? "Sem resultados"
              : `${items.length} prestador${items.length !== 1 ? "es" : ""}`}
          </p>
        </div>
      )}

      {/* Content */}
      {query.isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 p-10 text-sm">
          <Loader2 className="size-5 animate-spin" />
          Carregando favoritos…
        </div>
      ) : rawItems.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Você ainda não tem favoritos"
          description="Toque no coração nos prestadores para salvá-los aqui e contratá-los depois com facilidade."
          action={
            <Button onClick={() => navigate("client.providers")} className="mt-2 gap-2">
              <MapPin className="size-4" />
              Buscar prestadores
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhum favorito encontrado"
          description="Tente ajustar os termos de busca para encontrar o prestador salvo."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setFilterText("")
                setSortBy("rating")
              }}
              className="mt-2 gap-2"
            >
              <RotateCcw className="size-4" />
              Limpar filtro
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
              onBook={(serviceId) => openBooking({ providerId: p.id, serviceId })}
              onView={() => openProvider(p.id)}
              onMessage={() => navigate("client.messages", { providerId: p.id })}
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
  onMessage,
  onRemove,
  isRemoving,
  removingId,
}: {
  provider: ProviderCardType
  onQuote: () => void
  onBook: (serviceId?: string) => void
  onView: () => void
  onMessage: () => void
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
            className="focus-visible:ring-ring shrink-0 rounded-full outline-none focus-visible:ring-2"
            aria-label={`Ver perfil de ${provider.name}`}
          >
            <Avatar className="ring-border/50 size-12 rounded-full border ring-1">
              {provider.avatarUrl ? (
                <AvatarImage
                  src={provider.avatarUrl}
                  alt={provider.name}
                  className="rounded-full object-cover"
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary rounded-full text-sm font-semibold">
                {initials || "P"}
              </AvatarFallback>
            </Avatar>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onView}
                className="hover:text-primary text-foreground truncate text-left text-sm font-semibold transition-colors hover:underline"
              >
                {provider.name}
              </button>
              {provider.verified ? (
                <StatusBadge tone="emerald" icon={BadgeCheck}>
                  Verificado
                </StatusBadge>
              ) : null}
            </div>

            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                {provider.rating > 0 ? provider.rating.toFixed(1) : "—"}
                <span className="text-muted-foreground font-normal tabular-nums">
                  ({provider.reviewCount})
                </span>
              </span>
              {typeof provider.distanceKm === "number" ? (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <MapPin className="text-primary size-3.5" />
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
              <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">{provider.bio}</p>
            ) : null}

            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="tabular-nums">
                {servicesCount} {servicesCount === 1 ? "serviço" : "serviços"}
              </span>
              {minPrice != null ? (
                <span className="text-foreground font-medium tabular-nums">
                  A partir de {formatBRL(minPrice)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="bg-muted/30 flex flex-wrap items-center gap-2 border-t p-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onQuote}
          className="border-primary/40 text-primary hover:bg-primary/10 h-8 flex-1 gap-1 text-xs font-medium"
        >
          Orçamento
        </Button>
        <Button
          size="sm"
          onClick={() => onBook(undefined)}
          className="h-8 flex-1 gap-1 text-xs font-medium"
        >
          Agendar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onMessage}
          className="text-muted-foreground hover:text-foreground h-8 gap-1 px-2.5 text-xs"
          title="Conversar na plataforma"
          aria-label="Mensagem na plataforma para o prestador"
        >
          <MessageSquare className="size-3.5" />
          <span className="hidden sm:inline">Mensagem</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={isThisRemoving}
          className="size-8 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
          aria-label="Remover dos favoritos"
          title="Remover dos favoritos"
        >
          {isThisRemoving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Heart className="size-3.5 fill-current" />
          )}
        </Button>
      </CardFooter>
    </Card>
  )
}
