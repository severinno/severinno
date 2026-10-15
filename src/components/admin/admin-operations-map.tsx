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
  Layers,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"

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
  neighborhoods: Record<string, { total: number; inProgress: number; heldAmount: number }>
}

export function AdminOperationsMap() {
  const queryClient = useQueryClient()
  const mapContainerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<unknown>(null)
  const markersRef = React.useRef<unknown[]>([])

  const [selectedNeighborhood, setSelectedNeighborhood] = React.useState<string>("TODOS")

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
      toast.success("Custódia liberada com sucesso!")
      queryClient.invalidateQueries({ queryKey: ["admin-operations-live"] })
    },
    onError: () => {
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

    const renderMarkers = async () => {
      const maplibregl = await import("maplibre-gl")
      const map = mapRef.current as InstanceType<typeof maplibregl.Map>

      // Limpa marcadores anteriores
      markersRef.current.forEach((m) => {
        ;(m as { remove: () => void }).remove()
      })
      markersRef.current = []

      // Filtra agendamentos pelo bairro selecionado
      const filteredBookings =
        selectedNeighborhood === "TODOS"
          ? data.bookings
          : data.bookings.filter((b) => b.neighborhood === selectedNeighborhood)

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
            <p class="font-bold text-sm text-foreground mb-1">${b.serviceTitle}</p>
            <p class="text-muted-foreground mb-1">📍 ${b.address}</p>
            <p class="text-muted-foreground mb-1">👤 Cliente: <b>${b.clientName}</b></p>
            <p class="text-muted-foreground mb-1">🛠️ Prestador: <b>${b.providerName}</b></p>
            <p class="mt-2 font-semibold">Valor: R$ ${b.amount.toFixed(2)} | Status: <span class="text-emerald-600">${b.status}</span></p>
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
            <p class="font-bold text-sm text-foreground mb-1">🛠️ ${p.name}</p>
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
    }

    renderMarkers()
  }, [data, selectedNeighborhood])

  const filteredBookings =
    data?.bookings.filter((b) =>
      selectedNeighborhood === "TODOS" ? true : b.neighborhood === selectedNeighborhood,
    ) ?? []

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
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5"
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

      {/* Filtro por Bairros de Valadares */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground mr-1 flex items-center gap-1 text-xs font-semibold uppercase">
          <Layers className="h-3.5 w-3.5" /> Bairros:
        </span>
        {[
          "TODOS",
          "Centro",
          "Ilha dos Araújos",
          "Vila Bretas",
          "São Pedro",
          "Santa Rita",
          "Grã-Duquesa",
          "Esplanada",
        ].map((bairro) => (
          <Button
            key={bairro}
            variant={selectedNeighborhood === bairro ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedNeighborhood(bairro)}
            className="h-7 px-3 text-xs"
          >
            {bairro}
            {bairro !== "TODOS" && data?.neighborhoods[bairro] ? (
              <span className="ml-1.5 opacity-70">({data.neighborhoods[bairro].total})</span>
            ) : null}
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
                            onClick={() => releaseEscrowMutation.mutate(b.id)}
                            disabled={releaseEscrowMutation.isPending}
                            className="h-7 bg-emerald-600 text-xs hover:bg-emerald-700"
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
