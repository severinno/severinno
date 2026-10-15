"use client"

import * as React from "react"
import { CheckCircle2, Clock, ArrowRight, ShieldCheck, Percent } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

interface ServiceCombosSectionProps {
  onSelectCombo?: (comboTitle: string) => void
  className?: string
}

interface ServiceCombo {
  id: string
  title: string
  badge: string
  badgeColor: string
  originalPrice: string
  discountedPrice: string
  savingsAmount: string
  items: string[]
  durationEst: string
  highlight: string
}

const RESIDENTIAL_COMBOS: ServiceCombo[] = [
  {
    id: "combo-ar-verao",
    title: "Combo Verão Refrescante & Ar Gelando",
    badge: "🔥 Mais Solicitado",
    badgeColor: "bg-rose-500/10 text-rose-600 border-rose-500/30",
    originalPrice: "R$ 480,00",
    discountedPrice: "R$ 389,00",
    savingsAmount: "Economize R$ 91",
    items: [
      "Higienização profunda com bactericida de 2 Ares Split",
      "Limpeza e desobstrução das bandejas de dreno",
      "Instalação ou revisão de 1 ventilador de teto",
    ],
    durationEst: "2h30 a 3h30",
    highlight: "Garante ar puro, zero cheiro de mofo e economia de até 25% na conta de luz.",
  },
  {
    id: "combo-eletrica-segura",
    title: "Combo Elétrica Blindada & Casa Segura",
    badge: "⚡ Prevenção de Incêndio",
    badgeColor: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    originalPrice: "R$ 420,00",
    discountedPrice: "R$ 339,00",
    savingsAmount: "Economize R$ 81",
    items: [
      "Revisão e reaperto térmico do quadro de disjuntores",
      "Instalação de DPS (Dispositivo Protetor contra Raios)",
      "Troca e reforço de tomada de alta potência do chuveiro",
    ],
    durationEst: "2h a 3h",
    highlight: "Evita queima de eletrodomésticos caros e elimina disjuntores desarmando no banho.",
  },
  {
    id: "combo-mudanca",
    title: "Combo Mudança Sem Estresse / Reparo Total",
    badge: "📦 Prático & Rápido",
    badgeColor: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    originalPrice: "R$ 360,00",
    discountedPrice: "R$ 289,00",
    savingsAmount: "Economize R$ 71",
    items: [
      "Fixação de suporte de TV na parede com nível laser",
      "Instalação alinhada de 2 varões de cortina",
      "Troca, vedação com veda-rosca e teste de 2 torneiras",
    ],
    durationEst: "2h a 2h30",
    highlight: "Deixa sua casa nova pronta para morar no mesmo dia sem furadeira e sem poeira.",
  },
  {
    id: "combo-higienizacao",
    title: "Combo Higienização & Ar Puro",
    badge: "✨ Saúde & Bem-Estar",
    badgeColor: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    originalPrice: "R$ 450,00",
    discountedPrice: "R$ 359,00",
    savingsAmount: "Economize R$ 91",
    items: [
      "Higienização por extração profunda de sofá retrátil",
      "Eliminação de 99,9% de ácaros, fungos e bactérias",
      "Limpeza profunda e desodorização de colchão Queen",
    ],
    durationEst: "2h a 3h",
    highlight:
      "Restaura as cores originais do tecido e protege sua família contra alergias respiratórias.",
  },
]

export function ServiceCombosSection({ onSelectCombo, className }: ServiceCombosSectionProps) {
  const regional = useRegionalContext()
  const context = regional?.context
  const city = context?.city || "Governador Valadares"

  return (
    <section
      aria-label="Combos e Pacotes Residenciais com Desconto"
      className={cn("mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8", className)}
    >
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <div className="border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold">
            <Percent className="size-3.5" />
            <span>Multi-Serviços na Mesma Visita com até 20% OFF</span>
          </div>
          <h2 className="text-foreground text-2xl font-black tracking-tight sm:text-3xl">
            Combos Residenciais Mais Pedidos em {city}
          </h2>
          <p className="text-muted-foreground text-xs sm:text-sm">
            Resolva várias pendências da casa com o mesmo profissional experiente, economizando
            tempo e até R$ 91 no orçamento final.
          </p>
        </div>
      </div>

      {/* Grid of Combos */}
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {RESIDENTIAL_COMBOS.map((combo) => (
          <div
            key={combo.id}
            className="border-border/80 bg-card hover:border-primary/50 flex flex-col justify-between rounded-2xl border p-5 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
          >
            <div className="space-y-3.5">
              {/* Badge + Savings */}
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold",
                    combo.badgeColor,
                  )}
                >
                  {combo.badge}
                </span>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-black text-emerald-600 dark:text-emerald-400">
                  {combo.savingsAmount}
                </span>
              </div>

              {/* Title */}
              <h3 className="text-foreground text-base font-black tracking-tight">{combo.title}</h3>

              {/* Price Block */}
              <div className="border-border/60 bg-muted/30 rounded-xl border p-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground text-xs line-through">
                    {combo.originalPrice}
                  </span>
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                    {combo.discountedPrice}
                  </span>
                </div>
                <span className="text-muted-foreground block text-[11px] font-semibold">
                  ou até 6x sem juros no cartão
                </span>
              </div>

              {/* Items List */}
              <ul className="space-y-2 text-xs">
                {combo.items.map((item, idx) => (
                  <li key={idx} className="text-muted-foreground flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <p className="text-muted-foreground border-t pt-2.5 text-[11px] italic">
                {combo.highlight}
              </p>
            </div>

            {/* Bottom Actions */}
            <div className="mt-5 space-y-2.5 border-t pt-3">
              <div className="text-muted-foreground flex items-center justify-between text-[11px] font-semibold">
                <span className="flex items-center gap-1">
                  <Clock className="text-primary size-3" />
                  Duração: ~{combo.durationEst}
                </span>
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="size-3" />
                  Garantia 90 dias
                </span>
              </div>

              <button
                type="button"
                onClick={() => onSelectCombo?.(combo.title)}
                className="bg-primary text-primary-foreground hover:bg-primary/95 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black shadow-xs transition-all active:scale-95"
              >
                <span>Contratar Pacote Completo</span>
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
