"use client"

import {
  CheckCircle2,
  Clock,
  XCircle,
  ArrowRight,
  MapPin,
  Calendar,
  DollarSign,
  Navigation,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { formatBRL, formatDate } from "@/lib/format"
import { useEffect, useState } from "react"
import Map, { Marker, Source, Layer, NavigationControl } from "react-map-gl/maplibre"
import { useRealtime, TrackingPositionEvent } from "@/hooks/use-realtime"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import "maplibre-gl/dist/maplibre-gl.css"

const STATUS_FLOW = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED"]

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  PENDING: {
    label: "Pendente",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    icon: Clock,
  },
  CONFIRMED: {
    label: "Confirmado",
    color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    icon: CheckCircle2,
  },
  IN_PROGRESS: {
    label: "Em andamento",
    color: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    icon: ArrowRight,
  },
  COMPLETED: {
    label: "Concluído",
    color: "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900",
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: "Cancelado",
    color: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    icon: XCircle,
  },
}

type BookingData = {
  id: string
  status: string
  paymentStatus: string
  scheduledAt: string
  address: string
  createdAt: string
  amount: number
  lat: number
  lng: number
  provider: { id: string; name: string; avatarUrl?: string | null }
  client: { id: string; name: string }
  service: { id: string; title: string; basePrice: number }
}

export function TrackingPageClient({ booking }: { booking: BookingData }) {
  const cfg = STATUS_CONFIG[booking.status] ?? STATUS_CONFIG.PENDING
  const StatusIcon = cfg.icon
  const isCancelled = booking.status === "CANCELLED"

  const [providerLocation, setProviderLocation] = useState<[number, number] | null>(null)
  const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null)
  const [etaInfo, setEtaInfo] = useState<{ distanceKm: number; durationMin: number } | null>(null)
  const [proximityAlerted, setProximityAlerted] = useState(false)

  const { isConnected, join, on } = useRealtime()

  useEffect(() => {
    if (!isConnected) return

    join({ userId: booking.client.id, role: "client" })

    const unsubscribe = on<TrackingPositionEvent>("tracking:position", (data) => {
      if (data.bookingId === booking.id) {
        setProviderLocation([data.lng, data.lat])
      }
    })

    return () => {
      unsubscribe()
    }
  }, [isConnected, join, on, booking.id, booking.client.id])

  useEffect(() => {
    if (!providerLocation) return

    let active = true
    apiGet<{
      route?: {
        polyline: [number, number][] | null
        distanceKm: number
        durationMin: number
      } | null
    }>(`/api/tracking/${booking.id}`, { lat: providerLocation[1], lng: providerLocation[0] })
      .then((res) => {
        if (!active) return
        if (res.route?.polyline) {
          try {
            const coords = res.route.polyline as [number, number][]
            // OSRM returns [lng, lat] — convert to [lng, lat] for MapLibre
            setRouteCoords(coords)
            setEtaInfo({
              distanceKm: res.route.distanceKm,
              durationMin: res.route.durationMin,
            })

            // Geofencing Check
            const dist = res.route.distanceKm
            const dur = res.route.durationMin
            if ((dist < 0.5 || dur < 3) && !proximityAlerted) {
              setProximityAlerted(true)

              // Audio chime
              try {
                const ctx = new (
                  window.AudioContext ||
                  (window as Window & { webkitAudioContext?: typeof AudioContext })
                    .webkitAudioContext
                )()
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.connect(gain)
                gain.connect(ctx.destination)
                osc.type = "sine"

                osc.frequency.setValueAtTime(880, ctx.currentTime)
                gain.gain.setValueAtTime(0.3, ctx.currentTime)
                osc.start()
                osc.stop(ctx.currentTime + 0.1)

                const osc2 = ctx.createOscillator()
                osc2.connect(gain)
                osc2.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.15)
                osc2.start(ctx.currentTime + 0.15)
                osc2.stop(ctx.currentTime + 0.3)
              } catch {}

              // Toast alert
              toast.success("O prestador está chegando!", {
                description: "Ele está a menos de 500 metros ou 3 minutos de você.",
                duration: 6000,
              })

              // Persist as in-app notification
              apiPost("/api/notifications", {
                type: "PROXIMITY_ALERT",
                title: "Prestador a caminho!",
                body: `O prestador ${booking.provider.name} está a menos de 500m ou 3min do seu endereço.`,
              }).catch((err) => {
                console.warn("[tracking] failed to persist proximity alert:", err)
              })
            }
          } catch {
            setRouteCoords(null)
          }
        }
      })
      .catch((err) => {
        console.warn("[tracking] failed to fetch route:", err)
      })

    return () => {
      active = false
    }
  }, [providerLocation, booking.id, proximityAlerted, booking.provider.name])

  return (
    <div className="from-background to-muted/30 min-h-screen bg-gradient-to-b">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Header */}
        <div className="mb-8 text-center">
          <div
            className={cn(
              "mx-auto mb-4 flex size-16 items-center justify-center rounded-full",
              cfg.color,
            )}
          >
            <StatusIcon className="size-8" />
          </div>
          <h1 className="text-2xl font-bold">{cfg.label}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{booking.service.title}</p>
        </div>

        {/* Status timeline (only if not cancelled) */}
        {!isCancelled && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                {STATUS_FLOW.map((s, i) => {
                  const idx = STATUS_FLOW.indexOf(booking.status)
                  const done = i <= idx
                  const current = i === idx
                  const Icon = STATUS_CONFIG[s].icon
                  return (
                    <div key={s} className="flex flex-col items-center gap-1.5">
                      <div
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full text-xs font-bold",
                          done
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                          current ? "ring-primary ring-2 ring-offset-2" : "",
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                      <span
                        className={cn(
                          "text-[10px]",
                          done ? "text-foreground font-semibold" : "text-muted-foreground",
                        )}
                      >
                        {STATUS_CONFIG[s].label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Map Card */}
        {!isCancelled && typeof booking.lat === "number" && typeof booking.lng === "number" && (
          <Card className="mb-6 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm font-semibold">
                <span>Localização em tempo real</span>
                {etaInfo && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-normal text-emerald-600 dark:bg-emerald-950/30">
                    Chegada em {etaInfo.durationMin} min ({etaInfo.distanceKm} km)
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="bg-muted/20 relative h-80 w-full">
                {/* Visual Proximity Alert Banner */}
                {etaInfo && (etaInfo.distanceKm < 0.5 || etaInfo.durationMin < 3) && (
                  <div className="absolute top-3 right-12 left-3 z-20 flex animate-bounce items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-lg">
                    <Navigation className="size-4 rotate-45" />
                    <span>O prestador está muito próximo!</span>
                  </div>
                )}
                <Map
                  initialViewState={{
                    latitude: booking.lat,
                    longitude: booking.lng,
                    zoom: 13,
                  }}
                  mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
                  style={{ width: "100%", height: "100%" }}
                >
                  <NavigationControl position="top-right" visualizePitch={false} />

                  {/* Client Destination Marker */}
                  <Marker latitude={booking.lat} longitude={booking.lng}>
                    <div className="flex flex-col items-center">
                      <div className="bg-primary text-primary-foreground border-background flex size-8 items-center justify-center rounded-full border-2 shadow-lg">
                        <MapPin className="size-4" />
                      </div>
                      <span className="bg-background mt-0.5 max-w-[80px] truncate rounded px-1.5 py-0.5 text-[10px] font-semibold shadow">
                        Você
                      </span>
                    </div>
                  </Marker>

                  {/* Provider Live Location Marker */}
                  {providerLocation && (
                    <Marker latitude={providerLocation[1]} longitude={providerLocation[0]}>
                      <div className="flex flex-col items-center">
                        <div className="border-background flex size-8 animate-pulse items-center justify-center rounded-full border-2 bg-emerald-600 text-white shadow-lg">
                          <Navigation className="size-4 rotate-45" />
                        </div>
                        <span className="bg-background mt-0.5 max-w-[80px] truncate rounded px-1.5 py-0.5 text-[10px] font-semibold shadow">
                          {booking.provider.name}
                        </span>
                      </div>
                    </Marker>
                  )}

                  {/* OSRM Route Line */}
                  {routeCoords && (
                    <Source
                      id="tracking-route"
                      type="geojson"
                      data={{
                        type: "Feature",
                        properties: {},
                        geometry: {
                          type: "LineString",
                          coordinates: routeCoords,
                        },
                      }}
                    >
                      <Layer
                        id="tracking-route-layer"
                        type="line"
                        layout={{ "line-join": "round", "line-cap": "round" }}
                        paint={{
                          "line-color": "#059669",
                          "line-width": 4,
                        }}
                      />
                    </Source>
                  )}
                </Map>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info cards */}
        <div className="grid gap-4">
          {/* Provider */}
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Avatar className="size-12">
                {booking.provider.avatarUrl ? (
                  <AvatarImage src={booking.provider.avatarUrl} />
                ) : null}
                <AvatarFallback>{booking.provider.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-muted-foreground text-xs">Prestador</p>
                <p className="font-semibold">{booking.provider.name}</p>
              </div>
            </CardContent>
          </Card>

          {/* Schedule */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Calendar className="text-muted-foreground size-4" />
                  <div>
                    <p className="text-muted-foreground text-xs">Data</p>
                    <p className="text-sm font-medium">{formatDate(booking.scheduledAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="text-muted-foreground size-4" />
                  <div>
                    <p className="text-muted-foreground text-xs">Valor</p>
                    <p className="text-sm font-medium">{formatBRL(booking.amount)}</p>
                  </div>
                </div>
              </div>
              {booking.address && (
                <div className="mt-3 flex items-start gap-2">
                  <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">Endereço</p>
                    <p className="text-sm">{booking.address}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment status */}
          <Card>
            <CardContent className="p-4">
              <p className="text-muted-foreground text-xs">Pagamento</p>
              <Badge
                className={cn(
                  "mt-1",
                  booking.paymentStatus === "PAID"
                    ? "bg-emerald-100 text-emerald-800"
                    : booking.paymentStatus === "REFUNDED"
                      ? "bg-rose-100 text-rose-800"
                      : "bg-amber-100 text-amber-800",
                )}
              >
                {booking.paymentStatus === "PAID"
                  ? "Pago"
                  : booking.paymentStatus === "REFUNDED"
                    ? "Reembolsado"
                    : "Pendente"}
              </Badge>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <p className="text-muted-foreground mt-8 text-center text-xs">
          <a
            href={process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com.br"}
            className="hover:text-foreground"
          >
            Severinno
          </a>{" "}
          — Agende serviços online
        </p>
      </div>
    </div>
  )
}
