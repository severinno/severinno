"use client"

import * as React from "react"
import {
  Navigation,
  MapPin,
  CheckCircle2,
  Phone,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  X,
  Radio,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { vibrateSuccess, vibrateWarning } from "@/lib/haptics"
import { haversineKm } from "@/lib/geo-server"

export interface ProviderTransitHudProps {
  bookingId: string
  clientName: string
  clientPhone?: string | null
  clientAddress: string
  destinationLat: number
  destinationLng: number
  serviceTitle: string
  onClose: () => void
  onCheckinSuccess?: () => void
}

export function ProviderTransitHud({
  bookingId,
  clientName,
  clientPhone,
  clientAddress,
  destinationLat,
  destinationLng,
  serviceTitle,
  onClose,
  onCheckinSuccess,
}: ProviderTransitHudProps) {
  const [currentCoords, setCurrentCoords] = React.useState<{
    lat: number
    lng: number
    accuracy: number | null
  } | null>(null)
  const [isCheckingIn, setIsCheckingIn] = React.useState(false)
  const [hasCheckedIn, setHasCheckedIn] = React.useState(false)
  const [showTokenInput, setShowTokenInput] = React.useState(false)
  const [presenceToken, setPresenceToken] = React.useState("")

  // Watch GPS do prestador com alta precisão
  React.useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setCurrentCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
      },
      (err) => {
        console.warn("[TransitHud] GPS Watch error:", err.message)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      },
    )

    return () => {
      if (typeof navigator !== "undefined" && navigator?.geolocation?.clearWatch) {
        navigator.geolocation.clearWatch(watchId)
      }
    }
  }, [])

  // Distância atual em metros até o cliente
  const currentDistanceMeters = React.useMemo(() => {
    if (!currentCoords) return null
    const distKm = haversineKm(currentCoords.lat, currentCoords.lng, destinationLat, destinationLng)
    return Math.round(distKm * 1000)
  }, [currentCoords, destinationLat, destinationLng])

  const isSignalAccurate = (currentCoords?.accuracy ?? 999) <= 35
  const isWithinArrivalZone = currentDistanceMeters !== null && currentDistanceMeters <= 150
  const isWithinStrictGate = currentDistanceMeters !== null && currentDistanceMeters <= 50

  const handleCheckin = async () => {
    if (!currentCoords) {
      toast.error("Aguardando sinal de GPS para validar check-in")
      vibrateWarning()
      return
    }

    if (currentDistanceMeters !== null && currentDistanceMeters > 150) {
      toast.warning(
        `Você está a ${currentDistanceMeters}m do local. Aproxime-se para validar o check-in presencial (máx 150m).`,
      )
      vibrateWarning()
      return
    }

    setIsCheckingIn(true)
    try {
      const res = await fetch("/api/bookings/checkin-escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "checkin",
          bookingId,
          providerId: "current",
          providerLat: currentCoords.lat,
          providerLng: currentCoords.lng,
          clientAddressLat: destinationLat,
          clientAddressLng: destinationLng,
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setHasCheckedIn(true)
        vibrateSuccess()
        toast.success("✅ Presença física confirmada! O cliente foi notificado.")
        onCheckinSuccess?.()
      } else {
        toast.error(data.data?.reason ?? "Falha ao registrar check-in.")
        vibrateWarning()
      }
    } catch {
      toast.error("Erro de conexão ao enviar check-in.")
      vibrateWarning()
    } finally {
      setIsCheckingIn(false)
    }
  }

  const handlePresenceTokenCheckin = async () => {
    if (presenceToken.trim().length !== 6) {
      toast.warning("Informe os 6 dígitos do token de presença.")
      return
    }

    setIsCheckingIn(true)
    try {
      const res = await fetch("/api/bookings/checkin-escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "presence-checkin",
          bookingId,
          providerId: "current",
          token: presenceToken.trim(),
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setHasCheckedIn(true)
        vibrateSuccess()
        toast.success("✅ Presença confirmada via token do cliente!")
        onCheckinSuccess?.()
      } else {
        toast.error(data.data?.reason ?? data.error ?? "Código de presença inválido.")
        vibrateWarning()
      }
    } catch {
      toast.error("Erro ao validar código de presença.")
      vibrateWarning()
    } finally {
      setIsCheckingIn(false)
    }
  }

  const wazeUrl = `https://waze.com/ul?ll=${destinationLat},${destinationLng}&navigate=yes`
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destinationLat},${destinationLng}`
  const waUrl = clientPhone
    ? `https://wa.me/${clientPhone.replace(/\D/g, "")}?text=${encodeURIComponent("Olá! Sou o profissional Severinno e estou a caminho do seu endereço.")}`
    : null

  return (
    <div
      role="dialog"
      aria-label="Modo Trânsito HUD"
      className="fixed inset-0 z-50 flex flex-col justify-between bg-zinc-950 p-4 text-white sm:p-6"
    >
      {/* ── Top Bar: Status GPS + Botão Fechar ─────────────────────────── */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 animate-pulse text-emerald-400" />
          <span className="text-xs font-semibold tracking-wider text-zinc-400 uppercase sm:text-sm">
            Modo Trânsito • HUD Seguro
          </span>
        </div>

        <div className="flex items-center gap-3">
          {currentCoords ? (
            <Badge
              variant="outline"
              className={
                isSignalAccurate
                  ? "border-emerald-500/50 bg-emerald-950/60 text-emerald-300"
                  : "border-amber-500/50 bg-amber-950/60 text-amber-300"
              }
            >
              GPS: ±{Math.round(currentCoords.accuracy ?? 0)}m
            </Badge>
          ) : (
            <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-400">
              Buscando GPS...
            </Badge>
          )}

          <button
            onClick={onClose}
            aria-label="Fechar modo trânsito"
            className="rounded-full bg-zinc-800 p-2 text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* ── Centro: Card Grande do Destino ────────────────────────────── */}
      <div className="my-auto flex flex-col items-center text-center">
        <div className="mb-2 flex items-center gap-2 text-emerald-400">
          <MapPin className="h-8 w-8" />
          <span className="text-lg font-bold sm:text-xl">{serviceTitle}</span>
        </div>

        <h1 className="max-w-xl text-2xl font-black tracking-tight text-white sm:text-4xl">
          {clientAddress}
        </h1>

        <p className="mt-2 text-base font-medium text-zinc-400 sm:text-lg">
          Cliente: <span className="text-zinc-200">{clientName}</span>
        </p>

        {/* Medidor de Distância */}
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/80 px-6 py-4 shadow-2xl backdrop-blur-md">
          <div className="text-xs tracking-widest text-zinc-400 uppercase">Distância Restante</div>
          <div className="text-3xl font-black text-emerald-400 sm:text-5xl">
            {currentDistanceMeters !== null
              ? currentDistanceMeters >= 1000
                ? `${(currentDistanceMeters / 1000).toFixed(1)} km`
                : `${currentDistanceMeters} metros`
              : "--"}
          </div>
          {isWithinStrictGate && (
            <div className="mt-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-400">
              <ShieldCheck className="h-4 w-4" /> No perímetro do cliente (Geofence 50m)
            </div>
          )}
        </div>
      </div>

      {/* ── Base: Botões Gigantes para Toque Fácil ─────────────────────── */}
      <div className="space-y-3">
        {/* Botão de Check-in Presencial */}
        {hasCheckedIn ? (
          <div className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500 bg-emerald-600/30 py-5 text-xl font-bold text-emerald-400">
            <CheckCircle2 className="h-7 w-7" />
            Check-in Registrado com Sucesso!
          </div>
        ) : (
          <Button
            onClick={handleCheckin}
            disabled={isCheckingIn}
            className={`w-full rounded-2xl py-6 text-xl font-black tracking-wide shadow-lg transition-all sm:py-8 sm:text-2xl ${
              isWithinArrivalZone
                ? "animate-pulse bg-emerald-600 text-white shadow-emerald-900/50 hover:bg-emerald-500"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {isCheckingIn ? (
              <>
                <Loader2 className="mr-3 h-7 w-7 animate-spin" /> Validando Presença...
              </>
            ) : isWithinArrivalZone ? (
              <>
                <CheckCircle2 className="mr-3 h-7 w-7 text-white" /> CHEGUEI NO LOCAL (CONFIRMAR)
              </>
            ) : (
              <>
                <AlertTriangle className="mr-3 h-6 w-6 text-amber-400" /> Aproxime-se para Check-in
              </>
            )}
          </Button>
        )}

        {/* Fallback de Presença sem Sinal GPS */}
        {!hasCheckedIn && (
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => setShowTokenInput((v) => !v)}
              className="w-full text-center text-xs text-zinc-400 underline hover:text-zinc-200"
            >
              Sem sinal GPS no subsolo ou prédio? Digitar Token de Presença (6 dígitos)
            </button>

            {showTokenInput && (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/90 p-2">
                <input
                  type="text"
                  placeholder="Código de 6 dígitos"
                  maxLength={6}
                  value={presenceToken}
                  onChange={(e) => setPresenceToken(e.target.value.replace(/\D/g, ""))}
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-center font-mono text-sm tracking-widest text-white focus:border-emerald-500 focus:outline-none"
                />
                <Button
                  size="sm"
                  onClick={handlePresenceTokenCheckin}
                  disabled={isCheckingIn || presenceToken.length < 6}
                  className="bg-emerald-600 px-3 text-xs font-bold hover:bg-emerald-700"
                >
                  Confirmar
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Botões de Navegação Externa (Waze e Google Maps) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <a
            href={wazeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl border border-cyan-800 bg-cyan-950/80 py-3.5 text-base font-bold text-cyan-300 transition-colors hover:bg-cyan-900 sm:text-lg"
          >
            <Navigation className="h-5 w-5" />
            Waze
            <ExternalLink className="h-4 w-4 opacity-70" />
          </a>

          <a
            href={gmapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl border border-blue-800 bg-blue-950/80 py-3.5 text-base font-bold text-blue-300 transition-colors hover:bg-blue-900 sm:text-lg"
          >
            <MapPin className="h-5 w-5" />
            Maps
            <ExternalLink className="h-4 w-4 opacity-70" />
          </a>

          {waUrl ? (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-emerald-800 bg-emerald-950/80 py-3.5 text-base font-bold text-emerald-300 transition-colors hover:bg-emerald-900 sm:col-span-1 sm:text-lg"
            >
              <Phone className="h-5 w-5" />
              WhatsApp
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}
