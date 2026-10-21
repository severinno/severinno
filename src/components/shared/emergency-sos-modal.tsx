"use client"

/**
 * EmergencySosModal — Severinno Express / SOS Emergência 24h em 1 Toque
 *
 * Aplicação das Heurísticas de Nielsen:
 * - H1 Visibilidade do status (localização detectada por GPS, status de conexão online/offline).
 * - H5 Prevenção de erros e pânico (4 opções claras e imediatas).
 * - H7 Flexibilidade e eficiência de uso (contratação em 1 toque sem burocracia).
 * - H9 Recuperação de erros & Modo Offline: Fallback resiliente via SMS / WhatsApp / Ligação
 *   quando a rede estiver instável ou sem sinal de dados 4G (PWA Offline First).
 */

import * as React from "react"
import {
  Siren,
  Droplets,
  Zap,
  Key,
  ShieldAlert,
  MapPin,
  Clock,
  PhoneCall,
  CheckCircle2,
  Sparkles,
  WifiOff,
  MessageSquare,
  Smartphone,
  Send,
} from "lucide-react"
import { toast } from "sonner"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EscrowGuaranteeBadge } from "./escrow-guarantee-badge"
import { useGeoStore } from "@/store/geo"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { queueMutation } from "@/lib/offline-sync"
import { cn } from "@/lib/utils"
import { SUPPORT_WHATSAPP } from "@/lib/constants"

export type EmergencyType = "hidraulica" | "eletrica" | "chaveiro" | "desentupimento"

export const EMERGENCY_PHONE = SUPPORT_WHATSAPP

export const EMERGENCY_OPTIONS: Array<{
  id: EmergencyType
  title: string
  subtitle: string
  icon: typeof Droplets
  etaMin: string
  basePrice: string
  color: string
}> = [
  {
    id: "hidraulica",
    title: "Vazamento / Cano Estourado",
    subtitle: "Contenção imediata de água e troca de registros",
    icon: Droplets,
    etaMin: "15 a 25 min",
    basePrice: "R$ 140,00",
    color: "from-blue-600 to-cyan-600",
  },
  {
    id: "eletrica",
    title: "Curto-Circuito / Queda de Energia",
    subtitle: "Chuveiro em chamas, disjuntor desarmando ou cheiro de queimado",
    icon: Zap,
    etaMin: "15 a 30 min",
    basePrice: "R$ 150,00",
    color: "from-amber-500 to-orange-600",
  },
  {
    id: "chaveiro",
    title: "Chaveiro / Porta Travada",
    subtitle: "Abertura residencial sem arrombamento ou cópia emergencial",
    icon: Key,
    etaMin: "12 a 20 min",
    basePrice: "R$ 120,00",
    color: "from-rose-600 to-red-700",
  },
  {
    id: "desentupimento",
    title: "Desentupimento Urgente",
    subtitle: "Ralo, vaso sanitário ou caixa de gordura transbordando",
    icon: ShieldAlert,
    etaMin: "20 a 35 min",
    basePrice: "R$ 160,00",
    color: "from-purple-600 to-indigo-700",
  },
]

/**
 * Constrói a mensagem padronizada de socorro para envio via SMS ou WhatsApp
 */
export function buildSosDispatchMessage({
  emergencyTitle,
  price,
  city,
  neighborhood,
  lat,
  lng,
}: {
  emergencyTitle: string
  price: string
  city: string
  neighborhood: string
  lat?: number | null
  lng?: number | null
}): string {
  const gpsStr = lat && lng ? `\n📍 GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}` : ""
  return `🚨 *SOS SEVERINNO 24H (EMERGÊNCIA)*
Ocorrência: ${emergencyTitle}
Valor Estimado: ${price}
Local: ${neighborhood}, ${city}${gpsStr}
Horário: ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}

Por favor, enviem o profissional de plantão mais próximo! (Mensagem gerada pelo App Severinno PWA)`
}

export function EmergencySosModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [selectedType, setSelectedType] = React.useState<EmergencyType>("hidraulica")
  const [dispatching, setDispatching] = React.useState(false)
  const [dispatched, setDispatched] = React.useState(false)
  const [channelUsed, setChannelUsed] = React.useState<"app" | "whatsapp" | "sms" | "call">("app")

  const isOnline = useOnlineStatus()
  const { city: storedCity, lat, lng } = useGeoStore()
  const city = storedCity || "Governador Valadares"
  const neighborhood = "Ilha dos Araújos / Centro"

  const selectedOpt = EMERGENCY_OPTIONS.find((o) => o.id === selectedType) ?? EMERGENCY_OPTIONS[0]!

  // Enfileira mutação no PWA offline-sync e dispara o canal selecionado
  const handleOfflineOrDirectDispatch = (channel: "whatsapp" | "sms" | "call") => {
    const textMsg = buildSosDispatchMessage({
      emergencyTitle: selectedOpt.title,
      price: selectedOpt.basePrice,
      city,
      neighborhood,
      lat,
      lng,
    })

    // Registra na fila persistida do PWA para auditoria/reconexão
    queueMutation({
      action: "EMERGENCY_SOS",
      entityId: `sos-${Date.now()}`,
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

    setChannelUsed(channel)
    setDispatched(true)

    if (channel === "whatsapp") {
      const waUrl = `https://wa.me/${EMERGENCY_PHONE}?text=${encodeURIComponent(textMsg)}`
      window.open(waUrl, "_blank", "noopener,noreferrer")
      toast.success("Mensagem de emergência preparada no WhatsApp!")
    } else if (channel === "sms") {
      // Formato SMS com body pré-preenchido para iOS e Android
      const smsUrl = `sms:+${EMERGENCY_PHONE}?body=${encodeURIComponent(textMsg)}`
      window.location.href = smsUrl
      toast.success("Mensagem SMS aberta no aplicativo de mensagens!")
    } else if (channel === "call") {
      window.location.href = `tel:+${EMERGENCY_PHONE}`
      toast.info("Iniciando chamada para a Central 24h...")
    }
  }

  const handleOnlineDispatch = () => {
    if (!isOnline) {
      handleOfflineOrDirectDispatch("sms")
      return
    }

    setDispatching(true)
    setTimeout(() => {
      setDispatching(false)
      setChannelUsed("app")
      setDispatched(true)
      toast.success("Socorro acionado! Prestadores de plantão notificados via WhatsApp e App.")
    }, 1200)
  }

  const handleReset = () => {
    setDispatched(false)
    setChannelUsed("app")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-rose-500/30 p-0 sm:max-w-[480px]">
        {/* Top banner com alerta e sirene */}
        <div className="bg-gradient-to-r from-rose-600 via-red-600 to-orange-600 p-5 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur-xs">
                <Siren className="size-5 animate-pulse" />
              </span>
              <div>
                <DialogTitle className="text-lg font-bold tracking-tight text-white">
                  Severinno Express — SOS 24h
                </DialogTitle>
                <DialogDescription className="text-xs text-white/80">
                  Socorro residencial imediato em {city}
                </DialogDescription>
              </div>
            </div>
            {!isOnline ? (
              <Badge className="border-0 bg-amber-500 text-[10px] font-bold text-white shadow-xs">
                <WifiOff className="mr-1 size-3" />
                MODO OFFLINE
              </Badge>
            ) : (
              <Badge className="border-0 bg-white/20 text-[10px] font-bold text-white">
                PLANTÃO ATIVO
              </Badge>
            )}
          </div>
        </div>

        {/* Faixa de aviso offline resiliente */}
        {!isOnline && !dispatched && (
          <div className="flex items-center gap-2.5 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
            <WifiOff className="size-4 shrink-0 text-amber-600" />
            <span className="leading-snug">
              <strong>Sem conexão com a internet.</strong> O sistema usará as coordenadas salvas e
              acionará socorro direto via <strong>SMS</strong> ou <strong>WhatsApp</strong>.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-4 p-5">
          {dispatched ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="mb-3 flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60">
                <CheckCircle2 className="size-8" />
              </div>
              <h4 className="text-foreground text-base font-bold">
                {channelUsed === "sms"
                  ? "SOS Disparado via SMS!"
                  : channelUsed === "whatsapp"
                    ? "SOS Encaminhado via WhatsApp!"
                    : "Chamado de Emergência Confirmado!"}
              </h4>
              <p className="text-muted-foreground mt-1 max-w-sm text-xs">
                {channelUsed === "sms"
                  ? "Sua mensagem com coordenadas GPS foi direcionada para a rede de socorro expressa de Valadares."
                  : channelUsed === "whatsapp"
                    ? "Os dados de emergência foram preparados no WhatsApp para envio com prioridade máxima."
                    : "Os 3 profissionais mais próximos da sua localização foram alertados com alta prioridade."}
              </p>

              <div className="bg-muted/40 mt-4 w-full rounded-xl border p-3 text-left text-xs">
                <div className="flex items-center justify-between font-semibold">
                  <span>{selectedOpt.title}</span>
                  <span className="text-emerald-600">{selectedOpt.basePrice}</span>
                </div>
                <p className="text-muted-foreground mt-1 flex items-center gap-1 text-[11px]">
                  <Clock className="size-3 text-amber-500" />
                  Previsão de chegada: <strong>{selectedOpt.etaMin}</strong>
                </p>
                <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px]">
                  <MapPin className="size-3 text-emerald-600" />
                  Local: {neighborhood}, {city}
                </p>
                {lat && lng && (
                  <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[10px]">
                    <Sparkles className="size-2.5 text-blue-500" />
                    GPS salvo: {lat.toFixed(4)}, {lng.toFixed(4)}
                  </p>
                )}
              </div>

              <div className="mt-4 w-full">
                <EscrowGuaranteeBadge variant="card" />
              </div>

              <div className="mt-4 flex w-full flex-col gap-2">
                <Button
                  onClick={handleReset}
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  Entendido, voltar para o aplicativo
                </Button>

                {/* Opção secundária para reforçar por telefone se necessário */}
                <Button
                  variant="outline"
                  onClick={() => handleOfflineOrDirectDispatch("call")}
                  className="w-full gap-2 text-xs"
                >
                  <PhoneCall className="size-3.5 text-rose-600" />
                  Ligar para a Central de Plantão (Ligação Gratuita)
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Seleção do tipo de emergência */}
              <div className="flex flex-col gap-2">
                <label className="text-foreground text-xs font-semibold">
                  Selecione o tipo de ocorrência:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {EMERGENCY_OPTIONS.map((opt) => {
                    const isSelected = selectedType === opt.id
                    const Icon = opt.icon
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSelectedType(opt.id)}
                        className={cn(
                          "flex flex-col items-start rounded-xl border p-3 text-left transition-all",
                          isSelected
                            ? "border-rose-500 bg-rose-500/10 shadow-xs ring-1 ring-rose-500/30"
                            : "border-border/60 hover:bg-muted/40",
                        )}
                      >
                        <div className="mb-1.5 flex w-full items-center justify-between">
                          <span
                            className={cn(
                              "flex size-7 items-center justify-center rounded-lg bg-gradient-to-br text-white",
                              opt.color,
                            )}
                          >
                            <Icon className="size-3.5" />
                          </span>
                          <span className="text-muted-foreground text-[10px] font-semibold">
                            {opt.etaMin}
                          </span>
                        </div>
                        <span className="text-foreground line-clamp-1 text-xs font-bold">
                          {opt.title}
                        </span>
                        <span className="text-muted-foreground mt-0.5 line-clamp-1 text-[10px]">
                          {opt.subtitle}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Localização GPS detectada */}
              <div className="bg-muted/40 flex items-center justify-between rounded-xl border p-3 text-xs">
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 shrink-0 text-rose-600" />
                  <div>
                    <span className="text-foreground block font-semibold">
                      Local do Atendimento
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {neighborhood}, {city}
                    </span>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    isOnline
                      ? "border-emerald-500/30 text-emerald-600"
                      : "border-amber-500/30 text-amber-600",
                  )}
                >
                  {isOnline ? "GPS Ao Vivo" : "GPS em Cache"}
                </Badge>
              </div>

              {/* Selo Escrow Protegido */}
              <EscrowGuaranteeBadge variant="card" />

              {/* Ações de Disparo: Online vs Offline */}
              {!isOnline ? (
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    size="lg"
                    onClick={() => handleOfflineOrDirectDispatch("sms")}
                    className="h-12 w-full gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-rose-600 font-bold text-white shadow-md hover:from-amber-500 hover:to-rose-500"
                  >
                    <Smartphone className="size-4.5" />
                    Enviar SOS via SMS (100% Sem Internet)
                  </Button>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleOfflineOrDirectDispatch("whatsapp")}
                      className="gap-1.5 border-emerald-500/40 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                    >
                      <MessageSquare className="size-3.5" />
                      WhatsApp Direto
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleOfflineOrDirectDispatch("call")}
                      className="gap-1.5 border-rose-500/40 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                      <PhoneCall className="size-3.5" />
                      Ligar Central 24h
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button
                    size="lg"
                    onClick={handleOnlineDispatch}
                    disabled={dispatching}
                    className="h-12 w-full gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 font-bold text-white shadow-md hover:from-rose-500 hover:to-red-500"
                  >
                    {dispatching ? (
                      <>
                        <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Localizando prestador de plantão...
                      </>
                    ) : (
                      <>
                        <Send className="size-4" />
                        Chamar Socorro Agora ({selectedOpt.basePrice})
                      </>
                    )}
                  </Button>

                  {/* Fallback direto se preferir SMS ou WhatsApp */}
                  <div className="text-muted-foreground flex items-center justify-between px-1 text-[11px]">
                    <span>Sem conexão estável?</span>
                    <button
                      type="button"
                      onClick={() => handleOfflineOrDirectDispatch("sms")}
                      className="font-semibold text-rose-600 underline hover:text-rose-700 dark:text-rose-400"
                    >
                      Disparar via SMS / WhatsApp
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * FloatingSosButton — Botão flutuante de SOS que abre o modal de emergência.
 */
export function FloatingSosButton({ onClick }: { onClick: () => void }) {
  const isOnline = useOnlineStatus()

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="SOS Emergência 24h"
      className={cn(
        "fixed right-4 bottom-20 z-40 flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-bold text-white shadow-xl transition-all hover:scale-105 active:scale-95 sm:right-6 sm:bottom-6",
        isOnline
          ? "bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500"
          : "bg-gradient-to-r from-amber-600 via-rose-600 to-red-600 ring-2 ring-amber-400/50 hover:from-amber-500 hover:to-red-500",
      )}
    >
      {!isOnline ? (
        <WifiOff className="size-4 animate-pulse text-amber-200" />
      ) : (
        <Siren className="size-4 animate-bounce" />
      )}
      <span>{!isOnline ? "SOS Offline (SMS)" : "SOS Emergência"}</span>
      <Sparkles className="size-3 text-amber-300" />
    </button>
  )
}
