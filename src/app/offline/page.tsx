"use client"

/**
 * OfflinePage — Central de Socorro Emergencial & Modo Offline PWA
 *
 * Aplicação das Heurísticas de Nielsen:
 * - H1 Visibilidade do status: Avisa com precisão que o dispositivo está sem internet e exibe dados locais.
 * - H9 Recuperação de erros e crises: Não deixa o usuário em beco sem saída. Permite disparar
 *   SOS via SMS ou WhatsApp mesmo sem conexão de dados móveis ativa.
 */

import * as React from "react"
import {
  WifiOff,
  RefreshCw,
  Siren,
  Smartphone,
  MessageSquare,
  PhoneCall,
  MapPin,
  CheckCircle2,
  Sparkles,
  Calendar,
  KeyRound,
  ShieldCheck,
  UserCheck,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  EMERGENCY_OPTIONS,
  EMERGENCY_PHONE,
  buildSosDispatchMessage,
  type EmergencyType,
} from "@/components/shared/emergency-sos-modal"
import { useGeoStore } from "@/store/geo"
import { queueMutation } from "@/lib/offline-sync"
import { useOfflineBookings } from "@/hooks/use-offline-bookings"
import { cn } from "@/lib/utils"

export default function OfflinePage() {
  const { bookings } = useOfflineBookings()
  const [selectedType, setSelectedType] = React.useState<EmergencyType>("hidraulica")
  const [dispatchedChannel, setDispatchedChannel] = React.useState<
    "sms" | "whatsapp" | "call" | null
  >(null)
  const [reloading, setReloading] = React.useState(false)

  const { city: storedCity, lat, lng } = useGeoStore()
  const city = storedCity || "Governador Valadares"
  const neighborhood = "Ilha dos Araújos / Centro"

  const selectedOpt = EMERGENCY_OPTIONS.find((o) => o.id === selectedType) ?? EMERGENCY_OPTIONS[0]!

  const handleDispatch = (channel: "sms" | "whatsapp" | "call") => {
    const textMsg = buildSosDispatchMessage({
      emergencyTitle: selectedOpt.title,
      price: selectedOpt.basePrice,
      city,
      neighborhood,
      lat,
      lng,
    })

    // Enfileira localmente no PWA para persistência e sincronização pós-reconexão
    queueMutation({
      action: "EMERGENCY_SOS",
      entityId: `sos-offline-${Date.now()}`,
      payload: {
        type: selectedType,
        channel,
        city,
        neighborhood,
        lat,
        lng,
        textMsg,
      },
    })

    setDispatchedChannel(channel)

    if (channel === "sms") {
      const smsUrl = `sms:+${EMERGENCY_PHONE}?body=${encodeURIComponent(textMsg)}`
      window.location.href = smsUrl
      toast.success("Mensagem SMS aberta no seu aparelho!")
    } else if (channel === "whatsapp") {
      const waUrl = `https://wa.me/${EMERGENCY_PHONE}?text=${encodeURIComponent(textMsg)}`
      window.open(waUrl, "_blank", "noopener,noreferrer")
      toast.success("Abrindo WhatsApp com dados de socorro!")
    } else if (channel === "call") {
      window.location.href = `tel:+${EMERGENCY_PHONE}`
      toast.info("Discando para a Central 24h...")
    }
  }

  const handleReload = () => {
    setReloading(true)
    setTimeout(() => {
      window.location.reload()
    }, 500)
  }

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg space-y-6">
        {/* Card de Aviso de Conexão */}
        <div className="bg-card border-border/80 relative overflow-hidden rounded-3xl border p-6 text-center shadow-lg sm:p-8">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <WifiOff className="size-7 animate-pulse" />
          </div>

          <Badge
            variant="outline"
            className="mb-2 border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-300"
          >
            MODO OFFLINE PWA ATIVO
          </Badge>

          <h1 className="text-foreground text-2xl font-black tracking-tight sm:text-3xl">
            Você está sem conexão
          </h1>

          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-xs sm:text-sm">
            Sem internet móvel ou WiFi no momento? Não se preocupe. O Severinno PWA armazena seus
            dados em cache e permite acionar socorro imediato via <strong>SMS</strong> ou{" "}
            <strong>WhatsApp</strong> sem depender da rede de dados.
          </p>

          <div className="mt-5 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReload}
              disabled={reloading}
              className="gap-2 text-xs font-semibold"
            >
              <RefreshCw className={cn("size-3.5", reloading && "animate-spin")} />
              {reloading ? "Verificando sinal..." : "Tentar Reconectar"}
            </Button>
          </div>
        </div>

        {/* Módulo de Agendamentos Ativos em Cache Offline */}
        {bookings.length > 0 && (
          <div className="bg-card border-border/80 overflow-hidden rounded-3xl border shadow-lg">
            <div className="border-b border-emerald-500/20 bg-emerald-600/10 px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="size-4.5 text-emerald-600 dark:text-emerald-400" />
                  <h2 className="text-foreground text-sm font-bold">
                    Agendamentos Ativos em Cache ({bookings.length})
                  </h2>
                </div>
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                >
                  OFFLINE DISPONÍVEL
                </Badge>
              </div>
            </div>

            <div className="divide-border/60 divide-y p-2 sm:p-3">
              {bookings.map((booking) => (
                <div key={booking.id} className="space-y-3 p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-muted-foreground font-mono text-[10px] font-bold uppercase">
                        #{booking.code}
                      </span>
                      <h3 className="text-foreground text-sm font-bold">{booking.serviceTitle}</h3>
                    </div>
                    <Badge variant="secondary" className="text-[10px] font-semibold">
                      {booking.status === "IN_PROGRESS"
                        ? "Em Execução"
                        : booking.status === "CONFIRMED"
                          ? "Confirmado"
                          : booking.status}
                    </Badge>
                  </div>

                  <div className="text-muted-foreground space-y-1">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0 text-emerald-600" />
                      <span>
                        {booking.address}, {booking.neighborhood} - {booking.city}
                      </span>
                    </div>
                    {booking.contactName && (
                      <div className="flex items-center gap-1.5">
                        <UserCheck className="size-3.5 shrink-0" />
                        <span>
                          {booking.contactRole === "PROVIDER" ? "Prestador: " : "Cliente: "}
                          <strong className="text-foreground">{booking.contactName}</strong>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* PIN de Conclusão / Escrow Safe Handshake */}
                  {booking.completionPin && (
                    <div className="bg-muted/60 flex items-center justify-between rounded-xl p-2.5">
                      <div className="flex items-center gap-2">
                        <KeyRound className="size-4 text-amber-600 dark:text-amber-400" />
                        <span className="text-[11px] font-semibold">PIN de Liberação:</span>
                      </div>
                      <span className="text-foreground font-mono text-sm font-black tracking-widest">
                        {booking.completionPin}
                      </span>
                    </div>
                  )}

                  {/* Ação de Ligação Direta Sem Internet */}
                  {booking.contactPhone && (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="w-full gap-2 border-emerald-500/30 font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >
                      <a href={`tel:${booking.contactPhone}`}>
                        <PhoneCall className="size-3.5" />
                        Ligar Diretamente ({booking.contactPhone})
                      </a>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Módulo de SOS Emergência 24h Offline */}
        <div className="bg-card overflow-hidden rounded-3xl border border-rose-500/30 shadow-xl">
          <div className="bg-gradient-to-r from-rose-600 via-red-600 to-orange-600 p-4 text-white sm:p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur-xs">
                  <Siren className="size-5 animate-pulse text-white" />
                </span>
                <div>
                  <h2 className="text-base font-bold tracking-tight text-white sm:text-lg">
                    SOS Emergência 24h Offline
                  </h2>
                  <p className="text-xs text-white/80">
                    Acione eletricista, encanador ou chaveiro em {city}
                  </p>
                </div>
              </div>
              <Badge className="border-0 bg-white/20 text-[10px] font-bold text-white">
                SMS DISPONÍVEL
              </Badge>
            </div>
          </div>

          <div className="space-y-4 p-5 sm:p-6">
            {dispatchedChannel ? (
              <div className="flex flex-col items-center py-4 text-center">
                <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60">
                  <CheckCircle2 className="size-7" />
                </div>
                <h3 className="text-foreground text-base font-bold">
                  {dispatchedChannel === "sms"
                    ? "SOS Gerado via SMS!"
                    : dispatchedChannel === "whatsapp"
                      ? "SOS Aberto no WhatsApp!"
                      : "Chamada Telefônica Iniciada!"}
                </h3>
                <p className="text-muted-foreground mt-1 text-xs">
                  Os dados do seu atendimento (com GPS em cache) foram preparados para envio
                  prioritário à nossa rede de plantão.
                </p>

                <div className="bg-muted/40 mt-4 w-full rounded-2xl border p-3.5 text-left text-xs">
                  <div className="flex items-center justify-between font-semibold">
                    <span>{selectedOpt.title}</span>
                    <span className="text-emerald-600">{selectedOpt.basePrice}</span>
                  </div>
                  <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-[11px]">
                    <MapPin className="size-3 text-rose-600" />
                    Local: {neighborhood}, {city}
                  </p>
                  {lat && lng && (
                    <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[10px]">
                      <Sparkles className="size-2.5 text-amber-500" />
                      Coordenadas: {lat.toFixed(4)}, {lng.toFixed(4)}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex w-full flex-col gap-2">
                  <Button
                    onClick={() => setDispatchedChannel(null)}
                    variant="outline"
                    className="w-full text-xs"
                  >
                    Trocar de canal ou solicitar outro socorro
                  </Button>
                  <Button
                    onClick={() => handleDispatch("call")}
                    className="w-full gap-2 bg-rose-600 text-white hover:bg-rose-500"
                  >
                    <PhoneCall className="size-4" />
                    Ligar Central 24h: (33) 99999-9999
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-foreground text-xs font-semibold">
                    Escolha a emergência:
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {EMERGENCY_OPTIONS.map((opt) => {
                      const isSelected = selectedType === opt.id
                      const Icon = opt.icon
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setSelectedType(opt.id)}
                          className={cn(
                            "flex flex-col items-start rounded-2xl border p-3 text-left transition-all",
                            isSelected
                              ? "border-rose-500 bg-rose-500/10 shadow-xs ring-1 ring-rose-500/30"
                              : "border-border/60 hover:bg-muted/40",
                          )}
                        >
                          <div className="mb-1 flex w-full items-center justify-between">
                            <span
                              className={cn(
                                "flex size-7 items-center justify-center rounded-lg bg-gradient-to-br text-white",
                                opt.color,
                              )}
                            >
                              <Icon className="size-3.5" />
                            </span>
                            <span className="text-muted-foreground text-[10px] font-bold">
                              {opt.basePrice}
                            </span>
                          </div>
                          <span className="text-foreground line-clamp-1 text-xs font-bold">
                            {opt.title}
                          </span>
                          <span className="text-muted-foreground line-clamp-1 text-[10px]">
                            {opt.etaMin}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Localização GPS salva */}
                <div className="bg-muted/40 flex items-center justify-between rounded-xl border p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 text-rose-600" />
                    <div>
                      <span className="font-semibold">{neighborhood}</span>
                      <span className="text-muted-foreground block text-[10px]">{city}</span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 text-[10px] text-amber-600"
                  >
                    GPS em Cache
                  </Badge>
                </div>

                {/* Botões de Ação Imediata Offline */}
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    size="lg"
                    onClick={() => handleDispatch("sms")}
                    className="h-12 w-full gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-rose-600 font-bold text-white shadow-md hover:from-amber-500 hover:to-rose-500"
                  >
                    <Smartphone className="size-4.5" />
                    Enviar SOS via SMS (100% Sem Internet)
                  </Button>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleDispatch("whatsapp")}
                      className="gap-1.5 border-emerald-500/40 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                    >
                      <MessageSquare className="size-3.5" />
                      Via WhatsApp
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleDispatch("call")}
                      className="gap-1.5 border-rose-500/40 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                      <PhoneCall className="size-3.5" />
                      Ligar Central 24h
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
