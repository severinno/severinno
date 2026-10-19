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
  LayoutGrid,
  LayoutList,
  Loader2,
  MapPin,
  MessageSquare,
  RotateCcw,
  Search,
  Star,
  Users,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { fetchFavorites, toggleFavorite, type ProviderCard as ProviderCardType } from "@/lib/api"
import { formatDistance } from "@/lib/geo-client"
import { formatBRL } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
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
  const [viewMode, setViewMode] = React.useState<"list" | "grid">("list")

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
    <div className="space-y-4 sm:space-y-5">
      {/* Hero Banner — Compact, Clean & Minimalist */}
      <div className="border-border/60 from-card via-card/95 relative overflow-hidden rounded-2xl border bg-gradient-to-br to-rose-500/5 p-4 shadow-2xs sm:p-5">
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
              <Heart className="size-3 fill-rose-500 text-rose-500" />
              <span>Seus Profissionais de Confiança</span>
            </div>
            <h1 className="text-foreground mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">
              Favoritos
            </h1>
            <p className="text-muted-foreground mt-0.5 max-w-2xl text-xs sm:text-sm">
              Acesse rapidamente seus prestadores favoritos para novos agendamentos e orçamentos em
              Governador Valadares.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.bookings")
              }}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <Calendar className="size-3.5" />
              Ver agendamentos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.providers")
              }}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <MapPin className="size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      {/* Ultra-Compact Bento StatCards */}
      {rawItems.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-3">
          <StatCard
            compact={true}
            icon={Users}
            label="Prestadores Salvos"
            value={String(summary.totalCount)}
            tone="rose"
            hint="Salvos na sua lista"
          />
          <StatCard
            compact={true}
            icon={CheckCircle2}
            label="Verificados"
            value={String(summary.verifiedCount)}
            tone="primary"
            hint="Com selo de verificação"
          />
          <StatCard
            compact={true}
            icon={Star}
            label="Nota Média"
            value={`${summary.avgRating.toFixed(1)} ★`}
            tone="amber"
            hint="Avaliação dos favoritos"
          />
        </div>
      )}

      {/* Modern Filter & View Mode Toolbar */}
      {rawItems.length > 0 && (
        <div className="bg-card border-border/60 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border p-2.5 shadow-2xs sm:p-3">
          {/* Search Input with quick clear */}
          <div className="relative min-w-[200px] flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <Input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filtrar por nome, serviço ou bairro..."
              className="h-8.5 rounded-lg pr-8 pl-8.5 text-xs"
            />
            {filterText ? (
              <button
                type="button"
                onClick={() => setFilterText("")}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5"
                title="Limpar busca"
                aria-label="Limpar busca"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sort Select */}
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground hidden text-[11px] font-medium tracking-wide sm:inline">
                Ordenar:
              </span>
              <Select
                value={sortBy}
                onValueChange={(val) => setSortBy(val as "rating" | "services" | "name")}
              >
                <SelectTrigger
                  className="h-8.5 w-36 text-xs"
                  size="sm"
                  aria-label="Ordenar favoritos por"
                >
                  <SelectValue placeholder="Ordenar por" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rating">Melhor avaliados</SelectItem>
                  <SelectItem value="services">Mais serviços</SelectItem>
                  <SelectItem value="name">Nome (A-Z)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* View Mode Toggle: Lista / Grade */}
            <div className="border-border/60 bg-muted/30 flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  setViewMode("list")
                }}
                aria-label="Visualização em lista"
                title="Visualização em lista"
                className={cn(
                  "flex h-7.5 w-7.5 items-center justify-center rounded-md text-xs transition-all active:scale-95",
                  viewMode === "list"
                    ? "bg-card text-foreground ring-border/40 font-semibold shadow-2xs ring-1"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutList className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  setViewMode("grid")
                }}
                aria-label="Visualização em grade"
                title="Visualização em grade"
                className={cn(
                  "flex h-7.5 w-7.5 items-center justify-center rounded-md text-xs transition-all active:scale-95",
                  viewMode === "grid"
                    ? "bg-card text-foreground ring-border/40 font-semibold shadow-2xs ring-1"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutGrid className="size-3.5" />
              </button>
            </div>

            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterText("")
                  setSortBy("rating")
                }}
                className="text-muted-foreground hover:text-foreground h-8.5 gap-1 px-2 text-xs"
              >
                <RotateCcw className="size-3" />
                <span>Limpar</span>
              </Button>
            ) : null}

            <p className="text-muted-foreground text-xs tabular-nums">
              {items.length === 0
                ? "Sem resultados"
                : `${items.length} prestador${items.length !== 1 ? "es" : ""}`}
            </p>
          </div>
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
      ) : viewMode === "list" ? (
        <div className="grid gap-2.5">
          {items.map((p) => (
            <FavoriteListCard
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
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <FavoriteGridCard
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
// FavoriteCardProps
// ---------------------------------------------------------------------------

type FavoriteCardProps = {
  provider: ProviderCardType
  onQuote: () => void
  onBook: (serviceId?: string) => void
  onView: () => void
  onMessage: () => void
  onRemove: () => void
  isRemoving: boolean
  removingId: string | null
}

// ---------------------------------------------------------------------------
// FavoriteListCard — Ultra-compact, clean & minimalist horizontal row
// ---------------------------------------------------------------------------

function FavoriteListCard({
  provider,
  onQuote,
  onBook,
  onView,
  onMessage,
  onRemove,
  isRemoving,
  removingId,
}: FavoriteCardProps) {
  const initials = providerInitials(provider.name)
  const servicesCount = provider.services?.length ?? 0
  const minPrice = provider.services?.length
    ? Math.min(...provider.services.map((s) => s.basePrice))
    : null
  const isThisRemoving = isRemoving && removingId === provider.id

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 relative overflow-hidden rounded-xl shadow-2xs transition-all duration-150 hover:shadow-xs">
      <CardContent className="p-3 sm:p-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Left section: Avatar + Provider Info */}
          <div className="flex min-w-0 items-start gap-3 sm:items-center">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onView()
              }}
              className="ring-background shrink-0 rounded-full ring-1 transition-transform outline-none hover:scale-105 focus-visible:ring-2"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/40 size-11 rounded-full border shadow-2xs sm:size-12">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-semibold">
                  {initials || "P"}
                </AvatarFallback>
              </Avatar>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onView()
                  }}
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

              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                  <Star className="size-3 fill-amber-400 text-amber-400" />
                  {provider.rating > 0 ? provider.rating.toFixed(1) : "—"}
                  <span className="text-muted-foreground font-normal tabular-nums">
                    ({provider.reviewCount})
                  </span>
                </span>
                <span className="text-border">·</span>
                {typeof provider.distanceKm === "number" ? (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <MapPin className="text-primary size-3" />
                    {formatDistance(provider.distanceKm)}
                  </span>
                ) : provider.city ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {provider.city}
                  </span>
                ) : null}
                <span className="text-border">·</span>
                <span className="tabular-nums">
                  {servicesCount} {servicesCount === 1 ? "serviço" : "serviços"}
                </span>
                {minPrice != null ? (
                  <>
                    <span className="text-border">·</span>
                    <span className="text-foreground font-medium tabular-nums">
                      A partir de {formatBRL(minPrice)}
                    </span>
                  </>
                ) : null}
              </div>

              {provider.bio ? (
                <p className="text-muted-foreground mt-1 line-clamp-1 max-w-xl text-xs">
                  {provider.bio}
                </p>
              ) : null}
            </div>
          </div>

          {/* Right section: Action Buttons */}
          <div className="border-border/40 flex shrink-0 items-center justify-end gap-1.5 border-t pt-2 sm:border-t-0 sm:pt-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onQuote()
              }}
              className="border-primary/40 text-primary hover:bg-primary/10 h-7.5 px-2.5 text-xs font-medium"
            >
              Orçamento
            </Button>
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onBook(undefined)
              }}
              className="h-7.5 px-3 text-xs font-medium"
            >
              Agendar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onMessage()
              }}
              className="text-muted-foreground hover:text-foreground h-7.5 gap-1 px-2 text-xs"
              title="Conversar na plataforma"
              aria-label="Mensagem na plataforma para o prestador"
            >
              <MessageSquare className="size-3.5" />
              <span className="hidden md:inline">Mensagem</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                triggerHaptic("selection")
                onRemove()
              }}
              disabled={isThisRemoving}
              className="size-7.5 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
              aria-label="Remover dos favoritos"
              title="Remover dos favoritos"
            >
              {isThisRemoving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Heart className="size-3.5 fill-current" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// FavoriteGridCard — Bento-style compact grid card
// ---------------------------------------------------------------------------

function FavoriteGridCard({
  provider,
  onQuote,
  onBook,
  onView,
  onMessage,
  onRemove,
  isRemoving,
  removingId,
}: FavoriteCardProps) {
  const initials = providerInitials(provider.name)
  const servicesCount = provider.services?.length ?? 0
  const minPrice = provider.services?.length
    ? Math.min(...provider.services.map((s) => s.basePrice))
    : null
  const isThisRemoving = isRemoving && removingId === provider.id

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 flex flex-col justify-between overflow-hidden rounded-xl shadow-2xs transition-all duration-150 hover:shadow-xs">
      <CardContent className="flex flex-col justify-between p-3.5">
        <div className="space-y-2.5">
          {/* Header: Avatar, Name, Verified, and Heart Remove button */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  onView()
                }}
                className="shrink-0 rounded-full transition-transform outline-none hover:scale-105"
                aria-label={`Ver perfil de ${provider.name}`}
              >
                <Avatar className="border-border/40 size-10 rounded-full border shadow-2xs">
                  {provider.avatarUrl ? (
                    <AvatarImage
                      src={provider.avatarUrl}
                      alt={provider.name}
                      className="rounded-full object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-semibold">
                    {initials || "P"}
                  </AvatarFallback>
                </Avatar>
              </button>

              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onView()
                  }}
                  className="hover:text-primary text-foreground block truncate text-left text-sm font-semibold transition-colors hover:underline"
                >
                  {provider.name}
                </button>
                {provider.verified ? (
                  <StatusBadge tone="emerald" icon={BadgeCheck}>
                    Verificado
                  </StatusBadge>
                ) : null}
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                triggerHaptic("selection")
                onRemove()
              }}
              disabled={isThisRemoving}
              className="size-7.5 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
              aria-label="Remover dos favoritos"
              title="Remover dos favoritos"
            >
              {isThisRemoving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Heart className="size-3.5 fill-current" />
              )}
            </Button>
          </div>

          {/* Rating & Location pill row */}
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              {provider.rating > 0 ? provider.rating.toFixed(1) : "—"}
              <span className="text-muted-foreground font-normal tabular-nums">
                ({provider.reviewCount})
              </span>
            </span>
            <span className="text-border">·</span>
            {typeof provider.distanceKm === "number" ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <MapPin className="text-primary size-3" />
                {formatDistance(provider.distanceKm)}
              </span>
            ) : provider.city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                {provider.city}
              </span>
            ) : null}
          </div>

          {/* Bio snippet */}
          {provider.bio ? (
            <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
              {provider.bio}
            </p>
          ) : null}

          {/* Services & Min Price */}
          <div className="border-border/40 text-muted-foreground flex items-center justify-between border-t pt-2 text-xs">
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

        {/* Footer actions */}
        <div className="border-border/40 mt-3 flex items-center gap-1.5 border-t pt-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onQuote()
            }}
            className="border-primary/40 text-primary hover:bg-primary/10 h-7.5 flex-1 px-2 text-xs font-medium"
          >
            Orçamento
          </Button>
          <Button
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onBook(undefined)
            }}
            className="h-7.5 flex-1 px-2 text-xs font-medium"
          >
            Agendar
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              triggerHaptic("selection")
              onMessage()
            }}
            className="text-muted-foreground hover:text-foreground size-7.5 shrink-0"
            title="Conversar na plataforma"
            aria-label="Mensagem na plataforma para o prestador"
          >
            <MessageSquare className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// Backward-compatibility alias
export const FavoriteCard = FavoriteListCard
