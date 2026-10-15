"use client"

/**
 * EmergencySosModal — Severinno Express / SOS Emergência 24h em 1 Toque
 *
 * Aplicação das Heurísticas de Nielsen:
 * - H1 Visibilidade do status (localização detectada por GPS, raio de alcance em GV).
 * - H5 Prevenção de erros e pânico (4 opções claras e imediatas).
 * - H7 Flexibilidade e eficiência de uso (contratação em 1 toque sem burocracia).
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
} from "lucide-react"
import { toast } from "sonner"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EscrowGuaranteeBadge } from "./escrow-guarantee-badge"
import { useGeoStore } from "@/store/geo"
import { cn } from "@/lib/utils"

export type EmergencyType = "hidraulica" | "eletrica" | "chaveiro" | "desentupimento"

const EMERGENCY_OPTIONS: Array<{
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

  const city = useGeoStore((s) => s.city) || "Governador Valadares"
  const neighborhood = "Ilha dos Araújos / Centro"

  const selectedOpt = EMERGENCY_OPTIONS.find((o) => o.id === selectedType) ?? EMERGENCY_OPTIONS[0]!

  const handleDispatch = () => {
    setDispatching(true)
    setTimeout(() => {
      setDispatching(false)
      setDispatched(true)
      toast.success("Socorro acionado! Prestadores de plantão notificados via WhatsApp.")
    }, 1200)
  }

  const handleReset = () => {
    setDispatched(false)
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
            <Badge className="border-0 bg-white/20 text-[10px] font-bold text-white">
              PLANTÃO ATIVO
            </Badge>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {dispatched ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="mb-3 flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60">
                <CheckCircle2 className="size-8" />
              </div>
              <h4 className="text-foreground text-base font-bold">
                Chamado de Emergência Confirmado!
              </h4>
              <p className="text-muted-foreground mt-1 max-w-sm text-xs">
                Os 3 profissionais mais próximos da sua localização foram alertados via WhatsApp e
                aplicativo com alta prioridade.
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
              </div>

              <div className="mt-4 w-full">
                <EscrowGuaranteeBadge variant="card" />
              </div>

              <Button
                onClick={handleReset}
                className="mt-4 w-full bg-emerald-600 text-white hover:bg-emerald-500"
              >
                Entendido, acompanhar no mapa
              </Button>
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
                  className="border-emerald-500/30 text-[10px] text-emerald-600"
                >
                  GPS Ativo
                </Badge>
              </div>

              {/* Selo Escrow Protegido */}
              <EscrowGuaranteeBadge variant="card" />

              {/* Botão de Disparo Imediato */}
              <Button
                size="lg"
                onClick={handleDispatch}
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
                    <PhoneCall className="size-4" />
                    Chamar Socorro Agora ({selectedOpt.basePrice})
                  </>
                )}
              </Button>
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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="SOS Emergência 24h"
      className="fixed right-4 bottom-20 z-40 flex items-center gap-2 rounded-full bg-gradient-to-r from-rose-600 to-red-600 px-4 py-2.5 text-xs font-bold text-white shadow-xl transition-all hover:scale-105 hover:from-rose-500 hover:to-red-500 active:scale-95 sm:right-6 sm:bottom-6"
    >
      <Siren className="size-4 animate-bounce" />
      <span>SOS Emergência</span>
      <Sparkles className="size-3 text-amber-300" />
    </button>
  )
}
