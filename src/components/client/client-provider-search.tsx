"use client"

/**
 * ClientProviderSearch — Clean, minimalist in-panel provider search.
 *
 * Allows clients to find, filter and book verified providers near them
 * in Governador Valadares without ever leaving their client dashboard.
 *
 * Capabilities:
 *  - Debounced search by provider name, specialty, bio or service
 *  - Proximity filtering by radius (5km, 10km, 25km, 50km, todos)
 *  - Neighborhood selector for Governador Valadares (Centro, Ilha, etc.)
 *  - Category pills with horizontal scroll
 *  - Verified-only and minimum rating toggles
 *  - Sort by proximity (distance) or reputation (rating)
 *  - In-panel actions: Request Quote, Book, View Full Profile, Message
 */

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight,
  Heart,
  Loader2,
  MapPin,
  MessageSquare,
  Navigation,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from "lucide-react"
import { toast } from "sonner"

import {
  apiGet,
  fetchFavorites,
  fetchProviders,
  toggleFavorite,
  type Category,
  type ProviderCard,
} from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { formatDistance } from "@/lib/geo-client"
import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { useGeoStore } from "@/store/geo"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GV_NEIGHBORHOODS = [
  "Centro",
  "Ilha dos Araújos",
  "Grã-Duquesa",
  "São Pedro",
  "Vila Bretas",
  "Vila Isa",
  "Santa Rita",
  "Esplanada",
  "Lourdes",
  "Morada do Vale",
  "Esperança",
  "Altinópolis",
] as const

const RADIUS_OPTIONS = [
  { label: "5 km", value: 5 },
  { label: "10 km", value: 10 },
  { label: "25 km", value: 25 },
  { label: "50 km", value: 50 },
  { label: "Todos", value: null },
] as const

function getInitials(name?: string | null): string {
  if (!name) return "PR"
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

export function ClientProviderSearch() {
  const qc = useQueryClient()
  const params = useViewStore((s) => s.params)
  const navigate = useViewStore((s) => s.navigate)
  const user = useAuthStore((s) => s.user)

  const openQuote = useUIStore((s) => s.openQuote)
  const openBooking = useUIStore((s) => s.openBooking)
  const openProvider = useUIStore((s) => s.openProvider)

  // Geo store
  const geoLat = useGeoStore((s) => s.lat)
  const geoLng = useGeoStore((s) => s.lng)
  const geoDistrict = useGeoStore((s) => s.district)
  const geoCity = useGeoStore((s) => s.city)
  const geoStatus = useGeoStore((s) => s.status)
  const setFromGPS = useGeoStore((s) => s.setFromGPS)

  // Local search & filter states (initialized from view params if provided)
  const [searchInput, setSearchInput] = React.useState<string>(
    typeof params?.q === "string" ? params.q : "",
  )
  const [debouncedQuery, setDebouncedQuery] = React.useState<string>(searchInput)
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string | null>(
    typeof params?.categoryId === "string" ? params.categoryId : null,
  )
  const [selectedNeighborhood, setSelectedNeighborhood] = React.useState<string | null>(
    typeof params?.district === "string" ? params.district : null,
  )
  const [radiusKm, setRadiusKm] = React.useState<number | null>(15)
  const [sortBy, setSortBy] = React.useState<"distance" | "rating">(
    geoLat && geoLng ? "distance" : "rating",
  )
  const [onlyVerified, setOnlyVerified] = React.useState<boolean>(false)
  const [minRating, setMinRating] = React.useState<number | null>(null)

  // Debounce search input
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim())
    }, 280)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Sync state if params change during in-app navigation
  const [syncedQ, setSyncedQ] = React.useState<unknown>(params?.q)
  const [syncedCat, setSyncedCat] = React.useState<unknown>(params?.categoryId)

  if (params?.q !== syncedQ) {
    setSyncedQ(params?.q)
    const nextQ = typeof params?.q === "string" ? params.q : ""
    setSearchInput(nextQ)
    setDebouncedQuery(nextQ)
  }

  if (params?.categoryId !== syncedCat) {
    setSyncedCat(params?.categoryId)
    setSelectedCategoryId(typeof params?.categoryId === "string" ? params.categoryId : null)
  }

  // Categories query
  const categoriesQuery = useQuery<Category[]>({
    queryKey: ["categories-flat"],
    queryFn: () => apiGet<Category[]>("/api/categories?flat=true"),
    staleTime: 5 * 60 * 1000,
  })

  // Favorites query
  const favoritesQuery = useQuery<ProviderCard[]>({
    queryKey: ["favorites"],
    queryFn: fetchFavorites,
    enabled: !!user,
  })

  const favoriteIds = React.useMemo(() => {
    return new Set((favoritesQuery.data ?? []).map((p) => p.id))
  }, [favoritesQuery.data])

  // Favorite toggle mutation
  const favMutation = useMutation({
    mutationFn: (providerId: string) => toggleFavorite(providerId),
    onSuccess: (res, providerId) => {
      qc.invalidateQueries({ queryKey: ["favorites"] })
      qc.invalidateQueries({ queryKey: ["provider", providerId] })
      toast.success(res.favorited ? "Adicionado aos favoritos" : "Removido dos favoritos")
    },
    onError: () => {
      toast.error("Não foi possível atualizar favoritos.")
    },
  })

  // Providers query
  const providersQuery = useQuery({
    queryKey: [
      "client-search-providers",
      debouncedQuery,
      selectedCategoryId,
      radiusKm,
      sortBy,
      onlyVerified,
      minRating,
      geoLat,
      geoLng,
    ],
    queryFn: () =>
      fetchProviders({
        q: debouncedQuery || undefined,
        categoryId: selectedCategoryId || undefined,
        radius: radiusKm ?? undefined,
        sort: sortBy,
        verified: onlyVerified ? true : undefined,
        minRating: minRating ?? undefined,
        lat: geoLat,
        lng: geoLng,
        limit: 40,
      }),
  })

  // Neighborhood filter in-memory if selected
  const providers = React.useMemo(() => {
    const raw = providersQuery.data?.items ?? []
    if (!selectedNeighborhood) return raw
    const target = selectedNeighborhood.trim().toLowerCase()
    return raw.filter((p) => {
      const dist = (p.district ?? "").trim().toLowerCase()
      return dist.includes(target)
    })
  }, [providersQuery.data?.items, selectedNeighborhood])

  // Active filters count
  const hasActiveFilters = Boolean(
    debouncedQuery ||
    selectedCategoryId ||
    selectedNeighborhood ||
    radiusKm !== 15 ||
    onlyVerified ||
    minRating !== null,
  )

  const handleResetFilters = () => {
    triggerHaptic("selection")
    setSearchInput("")
    setDebouncedQuery("")
    setSelectedCategoryId(null)
    setSelectedNeighborhood(null)
    setRadiusKm(15)
    setOnlyVerified(false)
    setMinRating(null)
  }

  const handleUseGps = async () => {
    triggerHaptic("selection")
    try {
      await setFromGPS()
      setSortBy("distance")
      toast.success("Localização atualizada com sucesso!")
    } catch {
      toast.error("Não foi possível obter sua localização.")
    }
  }

  const categories = categoriesQuery.data ?? []

  return (
    <div className="space-y-6">
      {/* Search Header Banner */}
      <div className="border-border/60 from-card via-card to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-2xs sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-lg">
                <Search className="size-4" />
              </span>
              <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
                Buscar Prestadores
              </h1>
            </div>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Encontre profissionais avaliados e verificados próximos a você em Governador
              Valadares.
            </p>
          </div>

          {/* Quick GPS Location Badge */}
          <div className="flex items-center gap-2 self-start md:self-auto">
            <div className="border-border/60 bg-background/80 text-foreground flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs shadow-2xs">
              <MapPin className="text-primary size-3.5 shrink-0" />
              <span className="max-w-[170px] truncate font-medium sm:max-w-[220px]">
                {geoDistrict ? `${geoDistrict}, ` : ""}
                {geoCity || "Governador Valadares - MG"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUseGps}
              disabled={geoStatus === "locating"}
              title="Atualizar localização via GPS"
              aria-label="Atualizar localização via GPS"
              className="border-border/60 hover:bg-muted/60 h-8 gap-1.5 rounded-xl px-2.5 text-xs font-medium"
            >
              {geoStatus === "locating" ? (
                <Loader2 className="text-primary size-3.5 animate-spin" />
              ) : (
                <Navigation className="text-primary size-3.5" />
              )}
              <span className="hidden sm:inline">Meu GPS</span>
            </Button>
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="relative mt-5">
          <div className="relative flex items-center">
            <Search className="text-muted-foreground pointer-events-none absolute left-3.5 size-4" />
            <Input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por eletricista, pintor, encanador, ar-condicionado ou nome..."
              className="border-border/70 bg-background placeholder:text-muted-foreground/70 focus-visible:ring-primary h-11 rounded-xl pr-20 pl-10 text-sm shadow-2xs focus-visible:ring-1"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  setSearchInput("")
                }}
                className="text-muted-foreground hover:text-foreground absolute right-10 p-1 transition-colors"
                title="Limpar texto"
                aria-label="Limpar texto"
              >
                <X className="size-4" />
              </button>
            )}
            <div className="text-muted-foreground/60 pointer-events-none absolute right-3 text-xs select-none">
              {providersQuery.isFetching ? (
                <Loader2 className="text-primary size-4 animate-spin" />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Category Pills Strip */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Categorias populares
          </span>
          {selectedCategoryId && (
            <button
              onClick={() => {
                triggerHaptic("selection")
                setSelectedCategoryId(null)
              }}
              className="text-primary text-xs font-medium hover:underline"
            >
              Ver todas
            </button>
          )}
        </div>
        <div className="flex scrollbar-none gap-2 overflow-x-auto pb-1">
          <Button
            size="sm"
            variant={selectedCategoryId === null ? "default" : "outline"}
            onClick={() => {
              triggerHaptic("selection")
              setSelectedCategoryId(null)
            }}
            className={cn(
              "h-8 shrink-0 rounded-full px-3.5 text-xs font-medium transition-all",
              selectedCategoryId === null
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "border-border/60 hover:bg-muted/60 text-muted-foreground hover:text-foreground",
            )}
          >
            Todas as categorias
          </Button>
          {categories.slice(0, 14).map((cat) => {
            const isSelected = selectedCategoryId === cat.id
            return (
              <Button
                key={cat.id}
                size="sm"
                variant={isSelected ? "default" : "outline"}
                onClick={() => {
                  triggerHaptic("selection")
                  setSelectedCategoryId(isSelected ? null : cat.id)
                }}
                className={cn(
                  "h-8 shrink-0 rounded-full px-3.5 text-xs font-medium transition-all",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "border-border/60 hover:bg-muted/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {cat.name}
              </Button>
            )
          })}
        </div>
      </div>

      {/* Controls & Filter Toolbar */}
      <div className="border-border/60 bg-card flex flex-col gap-3 rounded-2xl border p-3 shadow-2xs sm:p-4 md:flex-row md:items-center md:justify-between">
        {/* Left side filters: Neighborhood + Radius */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Neighborhood Select */}
          <div className="w-full min-w-[160px] sm:w-auto">
            <Select
              value={selectedNeighborhood ?? "all"}
              onValueChange={(val) => {
                triggerHaptic("selection")
                setSelectedNeighborhood(val === "all" ? null : val)
              }}
            >
              <SelectTrigger
                aria-label="Filtrar por bairro em Governador Valadares"
                className="border-border/60 bg-background h-9 rounded-xl text-xs font-medium"
              >
                <MapPin className="text-primary mr-1.5 size-3.5 shrink-0" />
                <SelectValue placeholder="Bairro em GV" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  Todos os bairros (GV)
                </SelectItem>
                {GV_NEIGHBORHOODS.map((nh) => (
                  <SelectItem key={nh} value={nh} className="text-xs">
                    {nh}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Radius pills */}
          <div className="border-border/60 bg-muted/30 flex items-center gap-1 rounded-xl border p-0.5">
            {RADIUS_OPTIONS.map((opt) => {
              const active = radiusKm === opt.value
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    setRadiusKm(opt.value)
                  }}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                    active
                      ? "bg-background text-foreground font-semibold shadow-2xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>

          {/* Verified toggle pill */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              setOnlyVerified((prev) => !prev)
            }}
            className={cn(
              "flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium shadow-2xs transition-all",
              onlyVerified
                ? "border-emerald-500/40 bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-border/60 bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            <ShieldCheck className="size-3.5" />
            <span>Verificados</span>
          </button>

          {/* Min Rating 4.5+ pill */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              setMinRating((prev) => (prev === 4.5 ? null : 4.5))
            }}
            className={cn(
              "flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium shadow-2xs transition-all",
              minRating === 4.5
                ? "border-amber-500/40 bg-amber-50 font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                : "border-border/60 bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
            <span>4.5+</span>
          </button>
        </div>

        {/* Right side: Sort By & Reset */}
        <div className="border-border/40 flex items-center justify-between gap-2 border-t pt-2 sm:justify-end md:border-t-0 md:pt-0">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <SlidersHorizontal className="size-3.5" />
            <span>Ordenar:</span>
          </div>

          <div className="border-border/60 bg-muted/30 flex items-center gap-1 rounded-xl border p-0.5">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setSortBy("distance")
              }}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                sortBy === "distance"
                  ? "bg-background text-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Distância
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setSortBy("rating")
              }}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                sortBy === "rating"
                  ? "bg-background text-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Avaliação
            </button>
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className="text-muted-foreground hover:text-foreground h-8 gap-1 px-2 text-xs"
              title="Limpar todos os filtros"
            >
              <RotateCcw className="size-3.5" />
              <span className="hidden sm:inline">Limpar</span>
            </Button>
          )}
        </div>
      </div>

      {/* Results Counter & Active Criteria */}
      <div className="text-muted-foreground flex items-center justify-between px-1 text-xs">
        <div>
          {providersQuery.isLoading ? (
            <span>Buscando prestadores...</span>
          ) : (
            <span>
              Mostrando <strong className="text-foreground">{providers.length}</strong>{" "}
              {providers.length === 1 ? "prestador encontrado" : "prestadores encontrados"}
              {selectedNeighborhood ? ` em ${selectedNeighborhood}` : ""}
            </span>
          )}
        </div>
        {providersQuery.data?.expandedRadius && providersQuery.data.expandedRadius > 0 && (
          <span className="text-primary bg-primary/10 rounded-full px-2 py-0.5 text-[11px] font-medium">
            Raio expandido para {providersQuery.data.expandedRadius} km
          </span>
        )}
      </div>

      {/* Grid of Provider Cards */}
      {providersQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-border/60 space-y-4 rounded-2xl p-5 shadow-2xs">
              <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-10 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-8 flex-1 rounded-xl" />
                <Skeleton className="h-8 flex-1 rounded-xl" />
              </div>
            </Card>
          ))}
        </div>
      ) : providers.length === 0 ? (
        <Card className="border-border/70 rounded-2xl border-dashed p-8 text-center sm:p-12">
          <CardContent className="flex flex-col items-center justify-center space-y-3 p-0">
            <div className="bg-muted/80 text-muted-foreground flex size-14 items-center justify-center rounded-full">
              <Search className="size-6" />
            </div>
            <h3 className="text-foreground text-base font-semibold">Nenhum prestador encontrado</h3>
            <p className="text-muted-foreground max-w-md text-xs sm:text-sm">
              Não encontramos nenhum profissional correspondente aos filtros selecionados. Tente
              expandir o raio de distância ou pesquisar por outra categoria.
            </p>
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                className="border-border/60 mt-2 h-9 gap-1.5 rounded-xl text-xs font-semibold"
              >
                <RotateCcw className="size-3.5" />
                Limpar todos os filtros
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => {
            const isFav = favoriteIds.has(p.id)
            const minPrice = p.services?.[0]?.basePrice
            const isLocalNeighborhood = Boolean(
              geoDistrict &&
              p.district &&
              p.district.trim().toLowerCase() === geoDistrict.trim().toLowerCase(),
            )

            return (
              <Card
                key={p.id}
                className="group border-border/60 bg-card hover:border-primary/40 relative flex flex-col justify-between overflow-hidden rounded-2xl p-4 transition-all hover:shadow-md sm:p-5"
              >
                <div className="space-y-3">
                  {/* Top Header: Avatar + Info + Favorite */}
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className="flex min-w-0 cursor-pointer items-center gap-3"
                      onClick={() => {
                        triggerHaptic("selection")
                        openProvider(p.id)
                      }}
                    >
                      <div className="relative">
                        <Avatar className="border-border/40 size-12 rounded-full border shadow-2xs">
                          <AvatarImage src={p.avatarUrl || undefined} alt={p.name} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                            {getInitials(p.name)}
                          </AvatarFallback>
                        </Avatar>
                        {p.verified && (
                          <span
                            className="ring-background absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-2xs ring-2"
                            title="Profissional Verificado"
                          >
                            <ShieldCheck className="size-3" />
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-foreground group-hover:text-primary truncate text-sm font-semibold transition-colors">
                            {p.name}
                          </h4>
                        </div>

                        {/* Rating + Location */}
                        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="text-foreground flex items-center gap-1 font-semibold">
                            <Star className="size-3.5 fill-amber-400 text-amber-400" />
                            {p.rating > 0 ? p.rating.toFixed(1) : "Novo"}
                            {p.reviewCount > 0 && (
                              <span className="text-muted-foreground text-[11px] font-normal">
                                ({p.reviewCount})
                              </span>
                            )}
                          </span>

                          <span>•</span>

                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="text-muted-foreground size-3 shrink-0" />
                            {typeof p.distanceKm === "number" && p.distanceKm >= 0
                              ? formatDistance(p.distanceKm)
                              : p.district || p.city || "Governador Valadares"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Favorite Heart Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        triggerHaptic("selection")
                        favMutation.mutate(p.id)
                      }}
                      className="text-muted-foreground hover:bg-muted/50 rounded-lg p-1.5 transition-colors hover:text-rose-500"
                      title={isFav ? "Remover dos favoritos" : "Salvar nos favoritos"}
                      aria-label={isFav ? "Remover dos favoritos" : "Salvar nos favoritos"}
                    >
                      <Heart
                        className={cn(
                          "size-4 transition-transform active:scale-125",
                          isFav ? "fill-rose-500 text-rose-500" : "text-muted-foreground",
                        )}
                      />
                    </button>
                  </div>

                  {/* Neighborhood badge if matched */}
                  {isLocalNeighborhood && (
                    <div className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <Sparkles className="size-3 shrink-0" />
                      <span>Atende no seu bairro ({p.district})</span>
                    </div>
                  )}

                  {/* Bio snippet */}
                  {p.bio && (
                    <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                      {p.bio}
                    </p>
                  )}

                  {/* Services tags */}
                  {p.services && p.services.length > 0 && (
                    <div className="border-border/40 space-y-1.5 border-t pt-1">
                      <div className="flex flex-wrap gap-1">
                        {p.services.slice(0, 2).map((srv) => (
                          <Badge
                            key={srv.id}
                            variant="secondary"
                            className="bg-muted/60 text-muted-foreground rounded-md px-2 py-0.5 text-[10px] font-normal"
                          >
                            {srv.title}
                          </Badge>
                        ))}
                        {p.services.length > 2 && (
                          <span className="text-muted-foreground self-center text-[10px]">
                            +{p.services.length - 2}
                          </span>
                        )}
                      </div>

                      {typeof minPrice === "number" && minPrice > 0 && (
                        <div className="text-muted-foreground text-xs">
                          A partir de{" "}
                          <strong className="text-foreground font-semibold">
                            {formatBRL(minPrice)}
                          </strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Actions: In-Panel Direct CTAs */}
                <div className="border-border/40 mt-4 flex items-center gap-2 border-t pt-3">
                  <Button
                    size="sm"
                    onClick={() => {
                      triggerHaptic("selection")
                      openQuote({ providerId: p.id })
                    }}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 flex-1 rounded-xl text-xs font-semibold shadow-2xs"
                  >
                    Orçamento
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      triggerHaptic("selection")
                      openBooking({ providerId: p.id })
                    }}
                    className="border-border/60 hover:bg-muted/60 h-8 flex-1 rounded-xl text-xs font-medium"
                  >
                    Agendar
                  </Button>

                  {/* Direct Message in-panel */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      triggerHaptic("selection")
                      navigate("client.messages", { providerId: p.id })
                    }}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted/60 h-8 w-8 shrink-0 rounded-xl p-0"
                    title="Enviar mensagem"
                    aria-label="Enviar mensagem"
                  >
                    <MessageSquare className="size-4" />
                  </Button>

                  {/* Direct Profile Modal */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      triggerHaptic("selection")
                      openProvider(p.id)
                    }}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted/60 h-8 w-8 shrink-0 rounded-xl p-0"
                    title="Ver detalhes do perfil"
                    aria-label="Ver detalhes do perfil"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
