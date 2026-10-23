"use client"

import * as React from "react"
import { SUPPORT_WHATSAPP } from "@/lib/constants"
import {
  MapPin,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Send,
  ShieldCheck,
  Zap,
  Wrench,
  Droplets,
  Hammer,
  Wind,
  Paintbrush,
  Home,
  MessageCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"

export type InstantQuoteStepWizardProps = {
  onFilterResults?: (serviceQuery: string) => void
  className?: string
}

type ServiceCategory = {
  id: string
  name: string
  icon: React.ElementType
  commonScopes: string[]
  baseRange: { min: number; max: number }
  avgTime: string
}

const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    id: "eletrica",
    name: "Eletricista",
    icon: Zap,
    commonScopes: [
      "Instalação de Chuveiro / Tomadas",
      "Troca de Fiação ou Curto-Circuito",
      "Instalação de Luminárias / Spots",
      "Troca de Quadro de Disjuntores",
    ],
    baseRange: { min: 90, max: 250 },
    avgTime: "25 a 45 min",
  },
  {
    id: "hidraulica",
    name: "Encanador",
    icon: Droplets,
    commonScopes: [
      "Vazamento em Pia / Torneira",
      "Desentupimento de Ralo ou Vaso",
      "Troca de Válvula Hydra / Caixa Acoplada",
      "Instalação de Registro ou Bomba d'água",
    ],
    baseRange: { min: 100, max: 280 },
    avgTime: "30 a 60 min",
  },
  {
    id: "climatizacao",
    name: "Ar-Condicionado",
    icon: Wind,
    commonScopes: [
      "Limpeza e Higienização Completa",
      "Instalação de Ar Split Inverter",
      "Carga de Gás e Verificação de Vazamento",
      "Manutenção Preventiva Geral",
    ],
    baseRange: { min: 150, max: 450 },
    avgTime: "1h a 2h",
  },
  {
    id: "pintura",
    name: "Pintor",
    icon: Paintbrush,
    commonScopes: [
      "Pintura de Cômodo Único",
      "Pintura de Apartamento Completo",
      "Correção de Infiltração / Massa Corrida",
      "Portas, Portões ou Grades",
    ],
    baseRange: { min: 250, max: 1200 },
    avgTime: "1 a 3 dias",
  },
  {
    id: "montador",
    name: "Montador de Móveis",
    icon: Hammer,
    commonScopes: [
      "Montagem de Guarda-Roupa / Casal",
      "Montagem de Armário de Cozinha",
      "Fixação de Painel de TV / Prateleiras",
      "Desmontagem e Remontagem para Mudança",
    ],
    baseRange: { min: 80, max: 220 },
    avgTime: "40 a 90 min",
  },
  {
    id: "reformas",
    name: "Pedreiro / Reparos",
    icon: Wrench,
    commonScopes: [
      "Troca de Piso / Revestimento Solto",
      "Reboco e Pequenos Reparos de Alvenaria",
      "Chumbamento de Portas e Janelas",
      "Impermeabilização de Laje / Parede",
    ],
    baseRange: { min: 120, max: 500 },
    avgTime: "1 a 2 dias",
  },
]

const GV_NEIGHBORHOODS = [
  "Centro",
  "Ilha dos Araújos",
  "Grã-Duquesa",
  "Vila Isa",
  "São Pedro",
  "Morada do Vale",
  "Lourdes",
  "Esplanada",
  "Vila Bretas",
  "Santa Rita",
]

const PROPERTY_TYPES = ["Casa", "Apartamento", "Comércio / Escritório"]
const URGENCIES = [
  { label: "Hoje (Urgente)", multiplier: 1.25, badge: "Plantão" },
  { label: "Nesta semana", multiplier: 1.0, badge: "Normal" },
  { label: "Apenas pesquisando", multiplier: 0.95, badge: "Planejado" },
]

export function InstantQuoteStepWizard({
  onFilterResults,
  className,
}: InstantQuoteStepWizardProps) {
  const [step, setStep] = React.useState<1 | 2 | 3>(1)
  const [selectedCategory, setSelectedCategory] = React.useState<ServiceCategory>(
    SERVICE_CATEGORIES[0],
  )
  const [selectedNeighborhood, setSelectedNeighborhood] = React.useState<string>("Centro")
  const [selectedScope, setSelectedScope] = React.useState<string>(
    SERVICE_CATEGORIES[0].commonScopes[0],
  )
  const [selectedProperty, setSelectedProperty] = React.useState<string>("Casa")
  const [selectedUrgency, setSelectedUrgency] = React.useState(URGENCIES[1])

  // Atualiza escopo padrão quando troca categoria
  const handleSelectCategory = (cat: ServiceCategory) => {
    triggerHaptic("selection")
    setSelectedCategory(cat)
    setSelectedScope(cat.commonScopes[0])
  }

  // Wraps option setters with a selection haptic
  const pick =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      triggerHaptic("selection")
      setter(v)
    }

  // Avançar = toque leve; voltar = seleção (mais sutil)
  const goToStep = (next: 1 | 2 | 3) => {
    triggerHaptic(next > step ? "light" : "selection")
    setStep(next)
  }

  // Cálculo da estimativa com base na urgência
  const estimatedMin = Math.round(selectedCategory.baseRange.min * selectedUrgency.multiplier)
  const estimatedMax = Math.round(selectedCategory.baseRange.max * selectedUrgency.multiplier)

  // Gerar mensagem de WhatsApp estruturada
  const whatsappMessage = encodeURIComponent(
    `Olá! Solicitei um orçamento via Orçamentômetro Severinno em Governador Valadares.\n\n` +
      `📌 *Serviço*: ${selectedCategory.name}\n` +
      `📍 *Bairro*: ${selectedNeighborhood} (Governador Valadares - MG)\n` +
      `🛠️ *Detalhe*: ${selectedScope}\n` +
      `🏠 *Imóvel*: ${selectedProperty}\n` +
      `⏱️ *Urgência*: ${selectedUrgency.label}\n` +
      `💰 *Estimativa média*: R$ ${estimatedMin} a R$ ${estimatedMax}\n\n` +
      `Gostaria de verificar a disponibilidade dos prestadores verificados mais próximos!`,
  )

  const whatsappUrl = `https://wa.me/${SUPPORT_WHATSAPP}?text=${whatsappMessage}`

  return (
    <section
      aria-label="Orçamentômetro Instantâneo em 3 Passos"
      className={cn(
        "border-primary/20 from-primary/5 via-background to-background relative mx-auto my-8 w-full max-w-full overflow-hidden rounded-3xl border bg-gradient-to-b p-6 shadow-xl sm:p-8 md:p-10",
        className,
      )}
    >
      {/* Background ambient badge */}
      <div className="bg-primary/10 pointer-events-none absolute -top-12 -right-12 size-64 rounded-full blur-3xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-12 size-64 rounded-full bg-emerald-500/10 blur-3xl" />

      {/* Header */}
      <div className="relative mb-6 text-center sm:mb-8">
        <div className="border-primary/30 bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-bold">
          <Sparkles className="size-3.5" />
          <span>Fechamento Instantâneo • 30 Segundos</span>
        </div>
        <h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl md:text-4xl">
          Orçamentômetro com Disparo Direto no WhatsApp
        </h2>
        <p className="text-muted-foreground mx-auto mt-2 max-w-2xl text-xs sm:text-sm md:text-base">
          Estime o valor justo para Governador Valadares e gere uma cotação completa pronta para
          disparar para até 3 prestadores verificados.
        </p>

        {/* Step indicator */}
        <div className="mx-auto mt-6 flex max-w-md items-center justify-between px-2">
          {[
            { num: 1, label: "Serviço & Local" },
            { num: 2, label: "Escopo & Prazo" },
            { num: 3, label: "Cotação & Disparo" },
          ].map((s) => (
            <div key={s.num} className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-xs font-bold transition-all",
                  step === s.num
                    ? "bg-primary text-primary-foreground ring-primary/20 shadow-md ring-4"
                    : step > s.num
                      ? "bg-emerald-600 text-white"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {step > s.num ? <CheckCircle2 className="size-4" /> : s.num}
              </div>
              <span
                className={cn(
                  "text-[11px] font-semibold",
                  step === s.num ? "text-primary" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Wizard Content */}
      <div className="border-border/60 bg-card/70 relative mx-auto max-w-3xl rounded-2xl border p-5 shadow-sm backdrop-blur-md sm:p-7">
        {/* STEP 1: Serviço e Bairro */}
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
            <div>
              <label className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                1. Selecione a especialidade:
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {SERVICE_CATEGORIES.map((cat) => {
                  const Icon = cat.icon
                  const active = selectedCategory.id === cat.id
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => handleSelectCategory(cat)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border p-3 text-left transition-all active:scale-[0.98]",
                        active
                          ? "border-primary bg-primary/10 ring-primary/30 shadow-xs ring-2"
                          : "border-border/60 bg-background/80 hover:border-primary/40 hover:bg-muted/50",
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="size-4.5" />
                      </div>
                      <span className="text-xs font-bold sm:text-sm">{cat.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                2. Qual o seu bairro em GV?
              </label>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {GV_NEIGHBORHOODS.map((bairro) => (
                  <button
                    key={bairro}
                    type="button"
                    onClick={() => pick(setSelectedNeighborhood)(bairro)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95",
                      selectedNeighborhood === bairro
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "border-border/80 bg-background text-foreground hover:bg-muted border",
                    )}
                  >
                    <MapPin className="size-3" />
                    <span>{bairro}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={() => goToStep(2)}
                className="gap-2 font-bold shadow-md"
              >
                <span>Avançar para Detalhes</span>
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Escopo e Urgência */}
        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                  O que precisa ser feito em {selectedCategory.name}?
                </label>
                <span className="text-primary text-[11px] font-semibold">
                  {selectedNeighborhood}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {selectedCategory.commonScopes.map((scope) => {
                  const active = selectedScope === scope
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => pick(setSelectedScope)(scope)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border p-3 text-left text-xs font-semibold transition-all active:scale-[0.98]",
                        active
                          ? "border-primary bg-primary/10 ring-primary/30 shadow-xs ring-2"
                          : "border-border/60 bg-background/80 hover:border-primary/40 hover:bg-muted/50",
                      )}
                    >
                      <CheckCircle2
                        className={cn(
                          "size-4 shrink-0",
                          active ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span>{scope}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                  Tipo de Imóvel:
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PROPERTY_TYPES.map((prop) => (
                    <button
                      key={prop}
                      type="button"
                      onClick={() => pick(setSelectedProperty)(prop)}
                      className={cn(
                        "rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95",
                        selectedProperty === prop
                          ? "border-primary bg-primary/10 text-primary font-bold"
                          : "border-border/60 bg-background hover:bg-muted",
                      )}
                    >
                      {prop}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                  Urgência de Atendimento:
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {URGENCIES.map((urg) => (
                    <button
                      key={urg.label}
                      type="button"
                      onClick={() => pick(setSelectedUrgency)(urg)}
                      className={cn(
                        "rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95",
                        selectedUrgency.label === urg.label
                          ? "border-emerald-600 bg-emerald-500/10 font-bold text-emerald-700 dark:text-emerald-400"
                          : "border-border/60 bg-background hover:bg-muted",
                      )}
                    >
                      {urg.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => goToStep(1)}
                className="gap-2 text-xs"
              >
                <ArrowLeft className="size-4" />
                <span>Voltar</span>
              </Button>
              <Button
                type="button"
                onClick={() => goToStep(3)}
                className="gap-2 font-bold shadow-md"
              >
                <span>Ver Estimativa & Disparar</span>
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Resultado & Disparo WhatsApp */}
        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
            {/* Price Box */}
            <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent p-5 text-center sm:p-6">
              <span className="text-xs font-bold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                Estimativa Média de Valor em Governador Valadares:
              </span>
              <div className="mt-1 flex items-baseline justify-center gap-1.5">
                <span className="text-3xl font-black text-emerald-600 sm:text-4xl dark:text-emerald-400">
                  R$ {estimatedMin} ~ R$ {estimatedMax}
                </span>
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                Baseado em serviços recentes no bairro <strong>{selectedNeighborhood}</strong> •
                Média de resposta: <strong>{selectedCategory.avgTime}</strong>
              </p>
            </div>

            {/* Resume pills */}
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div className="border-border/70 bg-background/90 rounded-xl border p-2.5 text-center">
                <span className="text-muted-foreground block text-[10px] uppercase">Serviço</span>
                <span className="font-bold">{selectedCategory.name}</span>
              </div>
              <div className="border-border/70 bg-background/90 rounded-xl border p-2.5 text-center">
                <span className="text-muted-foreground block text-[10px] uppercase">Bairro</span>
                <span className="font-bold">{selectedNeighborhood}</span>
              </div>
              <div className="border-border/70 bg-background/90 rounded-xl border p-2.5 text-center">
                <span className="text-muted-foreground block text-[10px] uppercase">Prazo</span>
                <span className="font-bold">{selectedUrgency.label}</span>
              </div>
              <div className="border-border/70 bg-background/90 rounded-xl border p-2.5 text-center">
                <span className="text-muted-foreground block text-[10px] uppercase">Garantia</span>
                <span className="font-bold text-emerald-600">Escrow Blindado</span>
              </div>
            </div>

            {/* CTAs */}
            <div className="space-y-3 pt-2">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => triggerHaptic("success")}
                className="group flex w-full items-center justify-center gap-2.5 rounded-2xl bg-emerald-600 px-6 py-4 text-center font-black text-white shadow-lg shadow-emerald-600/30 transition-all hover:bg-emerald-700 hover:shadow-xl active:scale-[0.99]"
              >
                <MessageCircle className="size-5 transition-transform group-hover:scale-110" />
                <span className="text-sm sm:text-base">
                  Disparar Cotação Pronta no WhatsApp Agora
                </span>
                <Send className="size-4 opacity-75" />
              </a>

              {onFilterResults && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onFilterResults(`${selectedCategory.name} ${selectedNeighborhood}`)
                  }}
                  className="border-border/80 w-full gap-2 font-bold"
                >
                  <Home className="text-primary size-4" />
                  <span>Ver Prestadores de {selectedCategory.name} Disponíveis na Vitrine</span>
                </Button>
              )}
            </div>

            <div className="border-border/60 text-muted-foreground flex items-center justify-between border-t pt-4 text-xs">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => goToStep(2)}
                className="gap-1.5 text-xs"
              >
                <ArrowLeft className="size-3.5" />
                <span>Editar detalhes</span>
              </Button>
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="size-4" />
                <span>Zero compromisso • Sem taxas ocultas</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
export default InstantQuoteStepWizard
