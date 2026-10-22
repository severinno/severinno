"use client"

/**
 * AdminOperationsMap — Torre de Controle Operacional em Tempo Real para Governador Valadares (MG)
 *
 * Visualização tática e interativa com MapLibre GL:
 * - Prestadores ativos em campo com status e última posição
 * - Agendamentos em andamento com geofence de 50 metros
 * - Filtro dinâmico por bairros de GV (Centro, Ilha dos Araújos, Vila Bretas, São Pedro, Santa Rita, Grã-Duquesa)
 * - KPIs em tempo real de atendimentos e saldo retido em custódia (Escrow)
 * - Botão de intervenção e liberação manual de custódia pelo gestor
 */

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  MapPin,
  RefreshCw,
  Users,
  ShieldCheck,
  Banknote,
  Clock,
  Navigation,
  Activity,
  BarChart3,
  Layers,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { triggerHaptic } from "@/lib/haptics"
import { playCoinSound } from "@/lib/sounds"

type LiveOperationsData = {
  city: string
  state: string
  center: { lat: number; lng: number }
  kpis: {
    activeBookings: number
    onlineProviders: number
    escrowHeldAmount: number
    escrowHeldCount: number
    escrowReleasedToday: number
  }
  bookings: Array<{
    id: string
    clientId: string
    clientName: string
    clientPhone: string | null
    providerId: string
    providerName: string
    providerPhone: string | null
    serviceTitle: string
    status: string
    paymentStatus: string
    amount: number
    lat: number
    lng: number
    address: string
    neighborhood: string
    scheduledAt: string
    escrowReleasedAt: string | null
  }>
  providers: Array<{
    id: string
    name: string
    phone: string | null
    city: string
    state: string
    lat: number
    lng: number
    active: boolean
    verified: boolean
  }>
  neighborhoods: Record<
    string,
    { total: number; inProgress: number; heldAmount: number; lat?: number; lng?: number }
  >
}

export const GV_ALL_20_NEIGHBORHOODS: Array<{ name: string; lat: number; lng: number }> = [
  { name: "Centro", lat: -18.8511, lng: -41.9422 },
  { name: "Ilha dos Araújos", lat: -18.8584, lng: -41.9515 },
  { name: "Vila Isa", lat: -18.8701, lng: -41.9582 },
  { name: "Esplanada", lat: -18.8465, lng: -41.9458 },
  { name: "Grã-Duquesa", lat: -18.8385, lng: -41.9352 },
  { name: "São Pedro", lat: -18.8621, lng: -41.9392 },
  { name: "Lourdes", lat: -18.8492, lng: -41.9331 },
  { name: "Santa Rita", lat: -18.8752, lng: -41.9654 },
  { name: "Castanheiras", lat: -18.8312, lng: -41.9485 },
  { name: "Lagoa Santa", lat: -18.8415, lng: -41.9215 },
  { name: "Vila Bretas", lat: -18.8412, lng: -41.9542 },
  { name: "Altinópolis", lat: -18.868, lng: -41.936 },
  { name: "Santa Efigênia", lat: -18.871, lng: -41.948 },
  { name: "Esperança", lat: -18.859, lng: -41.968 },
  { name: "Carapina", lat: -18.851, lng: -41.932 },
  { name: "Jardim Pérola", lat: -18.835, lng: -41.972 },
  { name: "Morada do Vale", lat: -18.828, lng: -41.94 },
  { name: "Vila dos Montes", lat: -18.847, lng: -41.985 },
  { name: "Nova JK", lat: -18.832, lng: -41.965 },
  { name: "Santos Dumont", lat: -18.874, lng: -41.94 },
]

/** Escapa texto antes de interpolar em HTML de popups do MapLibre (anti-XSS). */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Filtros operacionais rápidos por status do agendamento / custódia. */
type StatusFilter = "TODOS" | "IN_PROGRESS" | "CONFIRMED" | "HELD"

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "TODOS", label: "Todos" },
  { key: "IN_PROGRESS", label: "Em execução" },
  { key: "CONFIRMED", label: "Aguardando check-in" },
  { key: "HELD", label: "Custódia retida" },
]

function matchesStatusFilter(
  b: { status: string; paymentStatus: string },
  filter: StatusFilter,
): boolean {
  if (filter === "TODOS") return true
  if (filter === "HELD") return b.paymentStatus === "HELD"
  return b.status === filter
}

export function AdminOperationsMap() {
  const queryClient = useQueryClient()
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<unknown>(null)
  const markersRef = React.useRef<unknown[]>([])

  const [selectedNeighborhood, setSelectedNeighborhood] = React.useState<string>("TODOS")
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("TODOS")

  const handleSelectNeighborhood = React.useCallback((bairro: string) => {
    triggerHaptic("selection")
    setSelectedNeighborhood(bairro)
  }, [])

  React.useEffect(() => {
    const map = mapRef.current as {
      flyTo?: (opts: { center: [number, number]; zoom: number; duration?: number }) => void
    } | null
    if (!map || typeof map.flyTo !== "function") return
    if (selectedNeighborhood === "TODOS") {
      map.flyTo({ center: [-41.9482, -18.8548], zoom: 13, duration: 1200 })
    } else {
      const found = GV_ALL_20_NEIGHBORHOODS.find((n) => n.name === selectedNeighborhood)
      if (found) {
        map.flyTo({ center: [found.lng, found.lat], zoom: 14.5, duration: 1200 })
      }
    }
  }, [selectedNeighborhood])

  const { data, isLoading, isFetching, refetch } = useQuery<LiveOperationsData>({
    queryKey: ["admin-operations-live"],
    queryFn: async () => {
      const res = await fetch("/api/admin/operations/live")
      if (!res.ok) throw new Error("Erro ao carregar operações ao vivo")
      return res.json()
    },
    refetchInterval: 15000, // Auto-refresh a cada 15s
  })

  // Mutação para liberação manual de custódia
  const releaseEscrowMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await fetch("/api/admin/operations/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, action: "release_escrow" }),
      })
      if (!res.ok) throw new Error("Falha ao liberar custódia")
      return res.json()
    },
    onSuccess: () => {
      triggerHaptic("success")
      playCoinSound({ vibrate: true })
      toast.success("Custódia liberada com sucesso!")
      queryClient.invalidateQueries({ queryKey: ["admin-operations-live"] })
    },
    onError: () => {
      triggerHaptic("error")
      toast.error("Erro ao liberar custódia")
    },
  })

  // Inicialização do mapa MapLibre
  React.useEffect(() => {
    let cancelled = false

    const initMap = async () => {
      if (!mapContainerRef.current || mapRef.current) return

      try {
        const maplibregl = await import("maplibre-gl")
        if (cancelled || !mapContainerRef.current) return

        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
              },
            },
            layers: [
              {
                id: "osm-tiles",
                type: "raster",
                source: "osm",
                minzoom: 0,
                maxzoom: 19,
              },
            ],
          },
          center: [-41.9482, -18.8548], // Governador Valadares Centro
          zoom: 13,
        })

        map.addControl(new maplibregl.NavigationControl(), "top-right")
        mapRef.current = map
      } catch (err) {
        console.warn("[AdminOperationsMap] Erro ao carregar MapLibre:", err)
      }
    }

    initMap()

    return () => {
      cancelled = true
      if (mapRef.current) {
        const map = mapRef.current as { remove: () => void }
        map.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Atualização dos Marcadores no Mapa
  React.useEffect(() => {
    if (!mapRef.current || !data) return
    // Evita corrida: um render antigo (import assíncrono) não pode sobrescrever o atual
    let stale = false

    const renderMarkers = async () => {
      const maplibregl = await import("maplibre-gl")
      if (stale || !mapRef.current) return
      const map = mapRef.current as InstanceType<typeof maplibregl.Map>

      // Limpa marcadores anteriores
      markersRef.current.forEach((m) => {
        ;(m as { remove: () => void }).remove()
      })
      markersRef.current = []

      // Filtra agendamentos pelo bairro selecionado
      const filteredBookings = data.bookings.filter(
        (b) =>
          (selectedNeighborhood === "TODOS" || b.neighborhood === selectedNeighborhood) &&
          matchesStatusFilter(b, statusFilter),
      )

      // 1. Marcadores de Agendamentos / Serviços
      filteredBookings.forEach((b) => {
        const el = document.createElement("div")
        el.className =
          "flex items-center justify-center w-8 h-8 rounded-full border-2 border-white shadow-lg cursor-pointer transform hover:scale-110 transition-transform " +
          (b.status === "IN_PROGRESS"
            ? "bg-amber-500 text-white"
            : b.status === "COMPLETED"
              ? "bg-emerald-600 text-white"
              : "bg-blue-600 text-white")

        el.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`

        const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`
          <div class="p-2 text-xs">
            <p class="font-bold text-sm text-foreground mb-1">${escapeHtml(b.serviceTitle)}</p>
            <p class="text-muted-foreground mb-1">📍 ${escapeHtml(b.address)}</p>
            <p class="text-muted-foreground mb-1">👤 Cliente: <b>${escapeHtml(b.clientName)}</b></p>
            <p class="text-muted-foreground mb-1">🛠️ Prestador: <b>${escapeHtml(b.providerName)}</b></p>
            <p class="mt-2 font-semibold">Valor: R$ ${Number(b.amount).toFixed(2)} | Status: <span class="text-emerald-600">${escapeHtml(b.status)}</span></p>
          </div>
        `)

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([b.lng, b.lat])
          .setPopup(popup)
          .addTo(map)

        markersRef.current.push(marker)
      })

      // 2. Marcadores de Prestadores em Campo
      data.providers.forEach((p) => {
        const el = document.createElement("div")
        el.className =
          "flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white border-2 border-white shadow-md cursor-pointer transform hover:scale-110 transition-transform"
        el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>`

        const popup = new maplibregl.Popup({ offset: 20 }).setHTML(`
          <div class="p-2 text-xs">
            <p class="font-bold text-sm text-foreground mb-1">🛠️ ${escapeHtml(p.name)}</p>
            <p class="text-muted-foreground">Prestador Ativo em Governador Valadares</p>
            <p class="text-emerald-600 font-medium mt-1">● Online em Campo</p>
          </div>
        `)

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .setPopup(popup)
          .addTo(map)

        markersRef.current.push(marker)
      })

      // 3. Marcadores de Polos Operacionais nos 20 Bairros de GV
      GV_ALL_20_NEIGHBORHOODS.forEach((n) => {
        const stat = data.neighborhoods[n.name]
        if (stat && stat.total > 0 && selectedNeighborhood === "TODOS") {
          const el = document.createElement("div")
          el.className =
            "flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900/85 text-white text-[10px] font-bold border border-slate-600 shadow-lg pointer-events-none"
          el.innerHTML = `<span>📍 ${escapeHtml(n.name)}</span> <span class="text-amber-400 font-extrabold">(${Number(stat.total)})</span>`

          const marker = new maplibregl.Marker({ element: el }).setLngLat([n.lng, n.lat]).addTo(map)

          markersRef.current.push(marker)
        }
      })
    }

    renderMarkers()
    return () => {
      stale = true
    }
  }, [data, selectedNeighborhood, statusFilter])

  const filteredBookings =
    data?.bookings.filter(
      (b) =>
        (selectedNeighborhood === "TODOS" || b.neighborhood === selectedNeighborhood) &&
        matchesStatusFilter(b, statusFilter),
    ) ?? []

  const statusCounts = React.useMemo(() => {
    const list = data?.bookings ?? []
    const counts: Record<StatusFilter, number> = { TODOS: 0, IN_PROGRESS: 0, CONFIRMED: 0, HELD: 0 }
    for (const b of list) {
      if (selectedNeighborhood !== "TODOS" && b.neighborhood !== selectedNeighborhood) continue
      counts.TODOS++
      if (b.status === "IN_PROGRESS") counts.IN_PROGRESS++
      if (b.status === "CONFIRMED") counts.CONFIRMED++
      if (b.paymentStatus === "HELD") counts.HELD++
    }
    return counts
  }, [data?.bookings, selectedNeighborhood])

  // Top bairros com atendimentos para o gráfico
  const neighborhoods = data?.neighborhoods
  const topNeighborhoods = React.useMemo(() => {
    if (!neighborhoods) return []
    const list = Object.entries(neighborhoods).map(([name, stats]) => ({
      name,
      total: stats.total,
      inProgress: stats.inProgress,
      heldAmount: stats.heldAmount,
    }))
    list.sort((a, b) => b.total - a.total || b.heldAmount - a.heldAmount)
    return list.slice(0, 6)
  }, [neighborhoods])

  const maxNeighborhoodTotal = Math.max(1, ...topNeighborhoods.map((n) => n.total))

  const totalEscrowVolume =
    (data?.kpis.escrowHeldAmount ?? 0) + (data?.kpis.escrowReleasedToday ?? 0)
  const heldPercentage =
    totalEscrowVolume > 0
      ? Math.round(((data?.kpis.escrowHeldAmount ?? 0) / totalEscrowVolume) * 100)
      : 0
  const releasedPercentage =
    totalEscrowVolume > 0
      ? Math.round(((data?.kpis.escrowReleasedToday ?? 0) / totalEscrowVolume) * 100)
      : 0

  return (
    <div className="space-y-6">
      {/* Cabeçalho e Ações */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Navigation className="h-6 w-6 text-emerald-600" />
            Torre de Controle Operacional — Governador Valadares (MG)
          </h2>
          <p className="text-muted-foreground text-sm">
            Monitoramento em tempo real de prestadores em campo, roteamento viário e liberação de
            custódia.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              refetch()
            }}
            disabled={isFetching}
            className="flex items-center gap-1.5 transition-all active:scale-95"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin text-emerald-600" : ""}`} />
            Atualizar
          </Button>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
            ● GPS Ao Vivo (15s)
          </Badge>
        </div>
      </div>

      {/* Cards de KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Atendimentos Ativos em GV</CardTitle>
            <Activity className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">{data?.kpis.activeBookings ?? 0}</div>
            )}
            <p className="text-muted-foreground mt-1 text-xs">Em execução ou confirmados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Prestadores na Região</CardTitle>
            <Users className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">{data?.kpis.onlineProviders ?? 0}</div>
            )}
            <p className="text-muted-foreground mt-1 text-xs">Profissionais ativos cadastrados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Custódia Retida (Escrow HELD)</CardTitle>
            <Banknote className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold text-amber-600">
                R$ {(data?.kpis.escrowHeldAmount ?? 0).toFixed(2)}
              </div>
            )}
            <p className="text-muted-foreground mt-1 text-xs">
              {data?.kpis.escrowHeldCount ?? 0} agendamento(s) aguardando 24h
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Custódia Liquidada Hoje</CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold text-emerald-600">
                R$ {(data?.kpis.escrowReleasedToday ?? 0).toFixed(2)}
              </div>
            )}
            <p className="text-muted-foreground mt-1 text-xs">Repasses liberados após validação</p>
          </CardContent>
        </Card>
      </div>

      {/* Visual Analytics: Balanço de Custódia Escrow & Ranking Operacional dos Bairros */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Balanço de Custódia Escrow */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Banknote className="h-4 w-4 text-amber-600" />
              Balanço de Custódia Escrow (GV)
            </CardTitle>
            <CardDescription className="text-xs">
              Distribuição proporcional de fundos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-1">
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium">
                <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Retido em Custódia ({heldPercentage}%)
                </span>
                <span className="font-bold text-amber-600 tabular-nums">
                  R$ {(data?.kpis.escrowHeldAmount ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-xs font-medium">
                <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Liberado Hoje ({releasedPercentage}%)
                </span>
                <span className="font-bold text-emerald-600 tabular-nums">
                  R$ {(data?.kpis.escrowReleasedToday ?? 0).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Barra Visual de Proporção Escrow */}
            <div className="bg-muted flex h-3 w-full overflow-hidden rounded-full">
              <div
                style={{ width: `${heldPercentage}%` }}
                className="bg-amber-500 transition-all duration-500"
                title={`Retido: ${heldPercentage}%`}
              />
              <div
                style={{ width: `${releasedPercentage}%` }}
                className="bg-emerald-500 transition-all duration-500"
                title={`Liberado: ${releasedPercentage}%`}
              />
            </div>

            <div className="border-muted bg-muted/30 space-y-1 rounded-lg border p-2.5 text-xs">
              <div className="text-muted-foreground flex justify-between text-[11px]">
                <span>Volume Total em Operação:</span>
                <span className="text-foreground font-semibold">
                  R$ {totalEscrowVolume.toFixed(2)}
                </span>
              </div>
              <div className="text-muted-foreground flex justify-between text-[11px]">
                <span>Taxa de Liquidação:</span>
                <span className="font-semibold text-emerald-600">
                  {releasedPercentage}% aprovado
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Concentração de Demandas por Bairro */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-semibold">
              <span className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-emerald-600" />
                Concentração Operacional por Bairro
              </span>
              <span className="text-muted-foreground text-xs font-normal">
                Clique para focar no mapa
              </span>
            </CardTitle>
            <CardDescription className="text-xs">
              Densidade de chamados e volume financeiro em Governador Valadares
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-1">
            {topNeighborhoods.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Nenhum dado por bairro disponível no momento.
              </p>
            ) : (
              topNeighborhoods.map((b) => {
                const pct = Math.max(8, Math.round((b.total / maxNeighborhoodTotal) * 100))
                const isSelected = selectedNeighborhood === b.name
                return (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => handleSelectNeighborhood(b.name)}
                    className={`w-full rounded-lg p-1.5 text-left transition-all active:scale-[0.98] ${
                      isSelected
                        ? "border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/30"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-foreground flex items-center gap-1.5 font-medium">
                        <MapPin className="h-3 w-3 text-emerald-600" />
                        {b.name}
                      </span>
                      <span className="text-muted-foreground text-[11px] tabular-nums">
                        {b.total} chamado(s){" "}
                        {b.heldAmount > 0 ? `· R$ ${b.heldAmount.toFixed(0)} retido` : ""}
                      </span>
                    </div>
                    <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                      <div
                        style={{ width: `${pct}%` }}
                        className={`h-full rounded-full transition-all duration-500 ${
                          b.inProgress > 0 ? "bg-amber-500" : "bg-emerald-600"
                        }`}
                      />
                    </div>
                  </button>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filtro por 20 Bairros de Governador Valadares */}
      <div className="flex scrollbar-thin items-center gap-1.5 overflow-x-auto pb-1.5">
        <span className="text-muted-foreground mr-1 flex shrink-0 items-center gap-1 text-xs font-semibold uppercase">
          <Layers className="h-3.5 w-3.5 text-emerald-600" /> 20 Bairros de GV:
        </span>
        {["TODOS", ...GV_ALL_20_NEIGHBORHOODS.map((n) => n.name)].map((bairro) => (
          <Button
            key={bairro}
            variant={selectedNeighborhood === bairro ? "default" : "outline"}
            size="sm"
            onClick={() => handleSelectNeighborhood(bairro)}
            className="h-7 shrink-0 px-2.5 text-xs font-medium transition-all active:scale-95"
          >
            {bairro}
            {bairro !== "TODOS" && data?.neighborhoods[bairro]?.total ? (
              <span className="ml-1 font-bold text-amber-500">
                ({data.neighborhoods[bairro].total})
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      {/* Filtros operacionais rápidos por status */}
      <div
        className="flex scrollbar-thin items-center gap-1.5 overflow-x-auto pb-1.5"
        role="group"
        aria-label="Filtrar por status operacional"
      >
        <span className="text-muted-foreground mr-1 flex shrink-0 items-center gap-1 text-xs font-semibold uppercase">
          <Activity className="h-3.5 w-3.5 text-emerald-600" /> Status:
        </span>
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={statusFilter === f.key ? "default" : "outline"}
            size="sm"
            aria-pressed={statusFilter === f.key}
            onClick={() => {
              triggerHaptic("selection")
              setStatusFilter(f.key)
            }}
            className="h-7 shrink-0 px-2.5 text-xs font-medium transition-all active:scale-95"
          >
            {f.label}
            <span className="ml-1 font-bold tabular-nums opacity-80">({statusCounts[f.key]})</span>
          </Button>
        ))}
      </div>

      {/* Mapa Tático MapLibre */}
      <Card className="overflow-hidden border-2">
        <CardHeader className="bg-muted/40 flex flex-row items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MapPin className="h-4 w-4 text-emerald-600" />
            Mapa Operacional de Governador Valadares
          </div>
          <div className="text-muted-foreground flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Em Execução
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> Concluído
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-600" /> Prestador em Campo
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div ref={mapContainerRef} className="bg-muted/20 h-[460px] w-full" />
        </CardContent>
      </Card>

      {/* Tabela de Agendamentos e Gestão de Custódia */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="text-muted-foreground h-4 w-4" />
            Agendamentos na Região de Valadares ({filteredBookings.length})
          </CardTitle>
          <CardDescription>
            Gerencie o status de presença presencial (50m) e libere fundos retidos em custódia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredBookings.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Nenhum agendamento encontrado para o filtro selecionado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground border-b">
                  <tr>
                    <th className="px-3 py-2.5">Agendamento</th>
                    <th className="px-3 py-2.5">Serviço</th>
                    <th className="px-3 py-2.5">Bairro / Local</th>
                    <th className="px-3 py-2.5">Cliente</th>
                    <th className="px-3 py-2.5">Prestador</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Custódia</th>
                    <th className="px-3 py-2.5 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredBookings.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2.5 font-mono font-medium">#{b.id.slice(0, 8)}</td>
                      <td className="px-3 py-2.5 font-medium">{b.serviceTitle}</td>
                      <td className="text-muted-foreground px-3 py-2.5">
                        <span className="text-foreground font-medium">{b.neighborhood}</span>
                        <br />
                        {b.address.slice(0, 30)}...
                      </td>
                      <td className="px-3 py-2.5">{b.clientName}</td>
                      <td className="px-3 py-2.5">{b.providerName}</td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className={
                            b.status === "IN_PROGRESS"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : b.status === "COMPLETED"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-blue-200 bg-blue-50 text-blue-700"
                          }
                        >
                          {b.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-semibold">R$ {b.amount.toFixed(2)}</span>
                        <br />
                        <Badge
                          variant="outline"
                          className={
                            b.paymentStatus === "HELD"
                              ? "bg-amber-100 text-[10px] text-amber-800"
                              : b.paymentStatus === "PAID"
                                ? "bg-emerald-100 text-[10px] text-emerald-800"
                                : "text-[10px]"
                          }
                        >
                          {b.paymentStatus}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {b.paymentStatus === "HELD" ? (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => {
                              triggerHaptic("medium")
                              releaseEscrowMutation.mutate(b.id)
                            }}
                            disabled={releaseEscrowMutation.isPending}
                            className="h-7 bg-emerald-600 text-xs transition-all hover:bg-emerald-700 active:scale-95"
                          >
                            <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                            Liberar Custódia
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
