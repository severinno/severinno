"use client"

import * as React from "react"
import {
  Calculator,
  Check,
  Coins,
  Copy,
  Fuel,
  Info,
  MapPin,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { formatBRL } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"
import { playCoinSound } from "@/lib/sounds"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

export type ProviderPriceEstimatorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialHourlyRate?: number
  onApplyPrice?: (
    suggestedTotal: number,
    breakdown: { labor: number; travel: number; materials: number },
  ) => void
}

const HOUR_PRESETS = [1, 2, 3, 4, 6, 8]
const TRAVEL_PRESETS = [
  { label: "Sem deslocamento", value: 0 },
  { label: "Centro / Ilha (+R$ 15)", value: 15 },
  { label: "Vila Isa / Sta Rita (+R$ 25)", value: 25 },
  { label: "Distante / Rural (+R$ 40)", value: 40 },
]
const BUFFER_PRESETS = [
  { label: "0%", value: 0 },
  { label: "10% (Recomendado)", value: 0.1 },
  { label: "15%", value: 0.15 },
]

export function ProviderPriceEstimatorDialog({
  open,
  onOpenChange,
  initialHourlyRate = 65,
  onApplyPrice,
}: ProviderPriceEstimatorDialogProps) {
  const [hours, setHours] = React.useState<number>(2)
  const [hourlyRate, setHourlyRate] = React.useState<number>(initialHourlyRate)
  const [materials, setMaterials] = React.useState<number>(0)
  const [travelFee, setTravelFee] = React.useState<number>(15)
  const [contingencyBuffer, setContingencyBuffer] = React.useState<number>(0.1)
  const [copied, setCopied] = React.useState(false)

  // Calculations
  const rawLabor = Math.max(0, hours * hourlyRate)
  const baseSubtotal = rawLabor + travelFee + Math.max(0, materials)
  const contingencyAmount = baseSubtotal * contingencyBuffer
  const finalPrice = Math.round((baseSubtotal + contingencyAmount) * 100) / 100

  // Platform Escrow calculations (12% platform fee)
  const platformFee = Math.round(finalPrice * 0.12 * 100) / 100
  const netEarnings = Math.round((finalPrice - platformFee) * 100) / 100

  const handleApply = () => {
    triggerHaptic("success")
    playCoinSound()
    if (onApplyPrice) {
      onApplyPrice(finalPrice, {
        labor: rawLabor,
        travel: travelFee,
        materials,
      })
      toast.success(`Preço sugerido de ${formatBRL(finalPrice)} aplicado!`)
      onOpenChange(false)
    }
  }

  const handleCopySummary = async () => {
    triggerHaptic("selection")
    const summary = [
      `📐 *Estimativa de Orçamento Técnico — Severinno*`,
      `⏱️ Tempo estimado: ${hours}h (taxa base: ${formatBRL(hourlyRate)}/h) = ${formatBRL(rawLabor)}`,
      travelFee > 0 ? `🚗 Deslocamento: ${formatBRL(travelFee)}` : null,
      materials > 0 ? `📦 Insumos/Peças: ${formatBRL(materials)}` : null,
      contingencyBuffer > 0
        ? `🛡️ Margem de imprevistos (${contingencyBuffer * 100}%): ${formatBRL(contingencyAmount)}`
        : null,
      `-----------------------------`,
      `💰 *Valor Total do Serviço: ${formatBRL(finalPrice)}*`,
      `🔒 Pagamento retido no Escrow com liberação após conclusão.`,
    ]
      .filter(Boolean)
      .join("\n")

    try {
      await navigator.clipboard.writeText(summary)
      playCoinSound()
      setCopied(true)
      toast.success("Detalhamento do orçamento copiado para a área de transferência!")
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast.error("Não foi possível copiar o orçamento.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg gap-5 rounded-2xl p-5 sm:p-6"
        data-testid="estimator-dialog"
      >
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Calculator className="size-4" />
            </span>
            <DialogTitle className="text-base font-bold sm:text-lg">
              Calculadora Expressa de Precificação
            </DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground text-xs">
            Calcule o valor justo da sua mão de obra com transparência, considerando deslocamento em
            GV e margem de imprevistos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Hours Section */}
          <div className="space-y-1.5">
            <label className="text-foreground text-xs font-semibold">
              Tempo estimado de execução (horas)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {HOUR_PRESETS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    setHours(h)
                  }}
                  className={cn(
                    "h-8 rounded-xl px-3 text-xs font-semibold transition-all active:scale-95",
                    hours === h
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "border-border/70 bg-card hover:bg-muted/60 text-muted-foreground border",
                  )}
                >
                  {h}h
                </button>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0.5}
                  max={24}
                  step={0.5}
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value) || 1)}
                  className="h-8 w-18 rounded-xl text-xs font-semibold tabular-nums"
                  aria-label="Horas customizadas"
                />
                <span className="text-muted-foreground text-xs font-medium">h</span>
              </div>
            </div>
          </div>

          {/* Hourly Rate & Materials Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-foreground text-xs font-semibold">Valor por hora (R$/h)</label>
              <div className="relative">
                <Input
                  type="number"
                  min={10}
                  max={500}
                  step={5}
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(Number(e.target.value) || 0)}
                  className="h-9 rounded-xl pl-7 text-xs font-semibold tabular-nums"
                />
                <span className="text-muted-foreground absolute top-2.5 left-2.5 text-xs font-bold">
                  R$
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-foreground text-xs font-semibold">Insumos / Peças (R$)</label>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={5000}
                  step={10}
                  value={materials}
                  onChange={(e) => setMaterials(Number(e.target.value) || 0)}
                  placeholder="0,00"
                  className="h-9 rounded-xl pl-7 text-xs font-semibold tabular-nums"
                />
                <span className="text-muted-foreground absolute top-2.5 left-2.5 text-xs font-bold">
                  R$
                </span>
              </div>
            </div>
          </div>

          {/* Travel Fee Section */}
          <div className="space-y-1.5">
            <label className="text-foreground text-xs font-semibold">
              Deslocamento em Governador Valadares
            </label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {TRAVEL_PRESETS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    setTravelFee(t.value)
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded-xl p-2 text-center transition-all active:scale-95",
                    travelFee === t.value
                      ? "border border-blue-500/40 bg-blue-500/10 font-bold text-blue-700 dark:text-blue-300"
                      : "border-border/70 bg-card text-muted-foreground hover:bg-muted/50 border text-[11px]",
                  )}
                >
                  <Fuel className="mb-0.5 size-3.5 text-blue-500" />
                  <span className="text-[11px] leading-tight font-medium">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Contingency Buffer Section */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-foreground text-xs font-semibold">
                Margem para pequenos imprevistos
              </label>
              <span className="text-muted-foreground text-[11px] font-medium">
                Protege contra horas extras
              </span>
            </div>
            <div className="flex gap-2">
              {BUFFER_PRESETS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    setContingencyBuffer(b.value)
                  }}
                  className={cn(
                    "h-7 flex-1 rounded-xl text-xs font-semibold transition-all active:scale-95",
                    contingencyBuffer === b.value
                      ? "border border-amber-500/30 bg-amber-500/20 text-amber-800 dark:text-amber-300"
                      : "border-border/60 bg-card text-muted-foreground hover:bg-muted/50 border",
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* Results Bento Summary Card */}
          <div className="border-primary/20 from-primary/5 via-card to-card space-y-3 rounded-2xl border bg-gradient-to-br p-4">
            <div className="border-border/50 flex items-center justify-between border-b pb-2.5">
              <div>
                <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                  Preço Sugerido ao Cliente
                </p>
                <p className="text-foreground text-2xl font-black tracking-tight tabular-nums">
                  {formatBRL(finalPrice)}
                </p>
              </div>

              <div className="text-right">
                <p className="text-[11px] font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                  Líquido do Especialista
                </p>
                <p className="text-xl font-bold tracking-tight text-emerald-700 tabular-nums dark:text-emerald-400">
                  {formatBRL(netEarnings)}
                </p>
              </div>
            </div>

            {/* Breakdown detail rows */}
            <div className="text-muted-foreground grid grid-cols-2 gap-y-1.5 text-[11px]">
              <div>
                • Mão de obra ({hours}h × {formatBRL(hourlyRate)}):
              </div>
              <div className="text-foreground text-right font-medium tabular-nums">
                {formatBRL(rawLabor)}
              </div>

              {travelFee > 0 && (
                <>
                  <div>• Custo de deslocamento:</div>
                  <div className="text-foreground text-right font-medium tabular-nums">
                    +{formatBRL(travelFee)}
                  </div>
                </>
              )}

              {materials > 0 && (
                <>
                  <div>• Insumos / Peças:</div>
                  <div className="text-foreground text-right font-medium tabular-nums">
                    +{formatBRL(materials)}
                  </div>
                </>
              )}

              {contingencyAmount > 0 && (
                <>
                  <div>• Reserva de imprevistos ({contingencyBuffer * 100}%):</div>
                  <div className="text-foreground text-right font-medium tabular-nums">
                    +{formatBRL(contingencyAmount)}
                  </div>
                </>
              )}

              <div className="text-muted-foreground/80">• Taxa Severinno (12%):</div>
              <div className="text-muted-foreground/80 text-right tabular-nums">
                -{formatBRL(platformFee)}
              </div>
            </div>

            {/* Escrow Peace of Mind Tag */}
            <div className="flex items-center gap-1.5 pt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="size-3.5 shrink-0" />
              <span>
                Garantia de custódia: 100% retido no PIX Escrow antes do início do serviço.
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopySummary}
            className="border-border/70 h-9 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-600" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copiar Orçamento
              </>
            )}
          </Button>

          {onApplyPrice && (
            <Button
              type="button"
              onClick={handleApply}
              className="h-9 gap-1.5 rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-95"
            >
              <Sparkles className="size-3.5" />
              Aplicar {formatBRL(finalPrice)}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
