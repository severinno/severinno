"use client"

/**
 * ProviderOnboardingLanding — Attraction landing page & interactive earnings calculator for new providers.
 */

import * as React from "react"
import {
  Banknote,
  Calculator,
  CheckCircle2,
  ChevronRight,
  Clock,
  Compass,
  MapPin,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react"

import { formatBRL } from "@/lib/format"
import { useViewStore } from "@/store/view"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"

const VALUE_PROPS = [
  {
    icon: Banknote,
    title: "Pagamento Garantido via PIX",
    description: "O cliente paga na contratação e o valor fica seguro em custódia até você concluir o serviço.",
  },
  {
    icon: Zap,
    title: "Zero Mensalidade Fixa",
    description: "Você não paga nada para se cadastrar ou receber orçamentos. Apenas 10% quando o serviço for concluído com sucesso.",
  },
  {
    icon: Sparkles,
    title: "IA Orçamentadora Gratuita",
    description: "Nossa IA qualifica as necessidades do cliente e estima a faixa de preço ideal antes mesmo do contato.",
  },
  {
    icon: Compass,
    title: "Roteirizador de Rotas Inteligente",
    description: "Organize as visitas do dia na melhor sequência para economizar tempo no trânsito e combustível.",
  },
]

export function ProviderOnboardingLanding() {
  const { navigate } = useViewStore()
  const [jobsPerWeek, setJobsPerWeek] = React.useState(6)
  const [avgTicket, setAvgTicket] = React.useState(180)

  // Monthly earnings calculation (4.2 weeks per month)
  const monthlyGross = Math.round(jobsPerWeek * avgTicket * 4.2)
  const monthlyNet = Math.round(monthlyGross * 0.90) // after 10% platform fee

  return (
    <div className="py-12 space-y-12">
      {/* Header / Hero */}
      <div className="text-center max-w-2xl mx-auto space-y-3 px-4">
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 inline-flex items-center gap-1.5 shadow-sm">
          <Sparkles className="size-3.5" />
          Programa Severinno Pro para Prestadores
        </span>
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
          Aumente sua renda prestando serviços na sua região
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Receba solicitações qualificadas de clientes perto de você, com pagamento 100% garantido e total flexibilidade de horários.
        </p>
      </div>

      {/* Interactive Income Calculator */}
      <div className="max-w-3xl mx-auto px-4">
        <Card className="rounded-3xl border-2 border-emerald-300 dark:border-emerald-800 shadow-xl overflow-hidden bg-gradient-to-br from-background via-emerald-50/20 to-background dark:via-emerald-950/20">
          <CardContent className="p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-2 border-b pb-4">
              <Calculator className="size-5 text-emerald-600" />
              <h3 className="text-base font-bold text-foreground">
                Simule seu Potencial de Faturamento Mensal
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              {/* Sliders Control */}
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>Atendimentos por semana:</span>
                    <span className="text-emerald-600 font-bold tabular-nums text-sm">
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
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>1 serviço (renda extra)</span>
                    <span>20 serviços (tempo integral)</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>Valor médio por serviço:</span>
                    <span className="text-emerald-600 font-bold tabular-nums text-sm">
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
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>R$ 60 (reparo simples)</span>
                    <span>R$ 600 (instalação/reforma)</span>
                  </div>
                </div>
              </div>

              {/* Result Display Box */}
              <div className="rounded-2xl bg-emerald-600 text-white p-6 text-center space-y-3 shadow-lg">
                <div className="text-xs uppercase tracking-wider text-emerald-200 font-semibold">
                  Seu Ganho Líquido Estimado
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight">
                  {formatBRL(monthlyNet)}
                  <span className="text-xs font-normal text-emerald-200"> / mês</span>
                </div>
                <p className="text-[11px] text-emerald-100/90 leading-relaxed">
                  Faturamento bruto de {formatBRL(monthlyGross)} direto na sua chave PIX, sem mensalidades.
                </p>
                <Button
                  onClick={() => navigate("provider.services")}
                  size="sm"
                  className="w-full bg-white text-emerald-900 hover:bg-emerald-50 font-bold text-xs h-10 shadow-md transition-all hover:scale-105 mt-2"
                >
                  Começar a Atender Agora
                  <ChevronRight className="size-4 ml-1" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4 Key Pillars */}
      <div className="max-w-4xl mx-auto px-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {VALUE_PROPS.map((prop, i) => {
          const Icon = prop.icon
          return (
            <Card key={i} className="rounded-2xl border shadow-sm hover:border-emerald-300 transition-all">
              <CardContent className="p-5 flex items-start gap-3.5">
                <div className="size-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600 shrink-0">
                  <Icon className="size-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground">{prop.title}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{prop.description}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
