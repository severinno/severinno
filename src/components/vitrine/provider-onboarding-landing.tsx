"use client"

/**
 * ProviderOnboardingLanding — Attraction landing page & interactive earnings calculator for new providers.
 */

import * as React from "react"
import { Banknote, Calculator, ChevronRight, Compass, Sparkles, Zap } from "lucide-react"

import { formatBRL } from "@/lib/format"
import { useViewStore } from "@/store/view"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"

const VALUE_PROPS = [
  {
    icon: Banknote,
    title: "Pagamento Garantido via PIX",
    description:
      "O cliente paga na contratação e o valor fica seguro em custódia até você concluir o serviço.",
  },
  {
    icon: Zap,
    title: "Zero Mensalidade Fixa",
    description:
      "Você não paga nada para se cadastrar ou receber orçamentos. Apenas 10% quando o serviço for concluído com sucesso.",
  },
  {
    icon: Sparkles,
    title: "IA Orçamentadora Gratuita",
    description:
      "Nossa IA qualifica as necessidades do cliente e estima a faixa de preço ideal antes mesmo do contato.",
  },
  {
    icon: Compass,
    title: "Roteirizador de Rotas Inteligente",
    description:
      "Organize as visitas do dia na melhor sequência para economizar tempo no trânsito e combustível.",
  },
]

export function ProviderOnboardingLanding() {
  const { navigate } = useViewStore()
  const [jobsPerWeek, setJobsPerWeek] = React.useState(6)
  const [avgTicket, setAvgTicket] = React.useState(180)

  // Monthly earnings calculation (4.2 weeks per month)
  const monthlyGross = Math.round(jobsPerWeek * avgTicket * 4.2)
  const monthlyNet = Math.round(monthlyGross * 0.9) // after 10% platform fee

  return (
    <div className="space-y-12 py-12">
      {/* Header / Hero */}
      <div className="mx-auto max-w-2xl space-y-3 px-4 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 shadow-sm dark:bg-emerald-950/40 dark:text-emerald-300">
          <Sparkles className="size-3.5" />
          Programa Severinno Pro para Prestadores
        </span>
        <h2 className="text-foreground text-3xl font-extrabold tracking-tight sm:text-4xl">
          Aumente sua renda prestando serviços na sua região
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Receba solicitações qualificadas de clientes perto de você, com pagamento 100% garantido e
          total flexibilidade de horários.
        </p>
      </div>

      {/* Interactive Income Calculator */}
      <div className="mx-auto max-w-3xl px-4">
        <Card className="from-background to-background overflow-hidden rounded-3xl border-2 border-emerald-300 bg-gradient-to-br via-emerald-50/20 shadow-xl dark:border-emerald-800 dark:via-emerald-950/20">
          <CardContent className="space-y-6 p-6 sm:p-8">
            <div className="flex items-center gap-2 border-b pb-4">
              <Calculator className="size-5 text-emerald-600" />
              <h3 className="text-foreground text-base font-bold">
                Simule seu Potencial de Faturamento Mensal
              </h3>
            </div>

            <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
              {/* Sliders Control */}
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>Atendimentos por semana:</span>
                    <span className="text-sm font-bold text-emerald-600 tabular-nums">
                      {jobsPerWeek} {jobsPerWeek === 1 ? "serviço" : "serviços"} / sem
                    </span>
                  </div>
                  <Slider
                    value={[jobsPerWeek]}
                    onValueChange={(val) => setJobsPerWeek(val[0])}
                    min={1}
                    max={20}
                    step={1}
                    className="py-2"
                  />
                  <div className="text-muted-foreground flex justify-between text-[10px]">
                    <span>1 serviço (renda extra)</span>
                    <span>20 serviços (tempo integral)</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>Valor médio por serviço:</span>
                    <span className="text-sm font-bold text-emerald-600 tabular-nums">
                      {formatBRL(avgTicket)}
                    </span>
                  </div>
                  <Slider
                    value={[avgTicket]}
                    onValueChange={(val) => setAvgTicket(val[0])}
                    min={60}
                    max={600}
                    step={10}
                    className="py-2"
                  />
                  <div className="text-muted-foreground flex justify-between text-[10px]">
                    <span>R$ 60 (reparo simples)</span>
                    <span>R$ 600 (instalação/reforma)</span>
                  </div>
                </div>
              </div>

              {/* Result Display Box */}
              <div className="space-y-3 rounded-2xl bg-emerald-600 p-6 text-center text-white shadow-lg">
                <div className="text-xs font-semibold tracking-wider text-emerald-200 uppercase">
                  Seu Ganho Líquido Estimado
                </div>
                <div className="text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl">
                  {formatBRL(monthlyNet)}
                  <span className="text-xs font-normal text-emerald-200"> / mês</span>
                </div>
                <p className="text-[11px] leading-relaxed text-emerald-100/90">
                  Faturamento bruto de {formatBRL(monthlyGross)} direto na sua chave PIX, sem
                  mensalidades.
                </p>
                <Button
                  onClick={() => navigate("provider.services")}
                  size="sm"
                  className="mt-2 h-10 w-full bg-white text-xs font-bold text-emerald-900 shadow-md transition-all hover:scale-105 hover:bg-emerald-50"
                >
                  Começar a Atender Agora
                  <ChevronRight className="ml-1 size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4 Key Pillars */}
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 px-4 sm:grid-cols-2">
        {VALUE_PROPS.map((prop, i) => {
          const Icon = prop.icon
          return (
            <Card
              key={i}
              className="rounded-2xl border shadow-sm transition-all hover:border-emerald-300"
            >
              <CardContent className="flex items-start gap-3.5 p-5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950">
                  <Icon className="size-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-foreground text-sm font-bold">{prop.title}</h4>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {prop.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
