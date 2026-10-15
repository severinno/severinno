"use client"

/**
 * HowItWorks — Formato Horizontal Interativo 95% (Enxuto & Escaneável).
 * Inclui fluxo de Busca -> Agendamento -> Custódia PIX + Garantia de 90 dias.
 */

import * as React from "react"
import { Search, CalendarCheck, ShieldCheck, ArrowRight, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/store/ui"
import { Button } from "@/components/ui/button"

const STEPS = [
  {
    number: "01",
    icon: Search,
    badge: "30 segundos",
    title: "Busque e filtre",
    description:
      "Encontre prestadores verificados perto de você em GV. Filtre por categoria, bairro, nota e disponibilidade.",
    highlight: "100% Antecedentes e CPF/CNPJ Checados",
  },
  {
    number: "02",
    icon: CalendarCheck,
    badge: "Sem compromisso",
    title: "Agende com confiança",
    description:
      "Peça orçamento grátis em 1 clique ou escolha o horário direto na agenda do profissional.",
    highlight: "Resposta média em menos de 15 minutos",
  },
  {
    number: "03",
    icon: ShieldCheck,
    badge: "Risco Zero",
    title: "Pague com segurança",
    description:
      "O valor fica protegido em custódia PIX e só é liberado ao técnico quando você aprovar o serviço.",
    highlight: "Garantia de 90 dias + Recibo Digital",
  },
]

export default function HowItWorks() {
  const openAuth = useUIStore((s) => s.openAuth)
  const [activeStep, setActiveStep] = React.useState<number>(0)

  return (
    <section className="border-border/40 bg-background border-t py-10 sm:py-12">
      <div className="mx-auto w-full max-w-[95%] px-2 sm:px-4">
        <div className="border-border/60 bg-card/60 rounded-3xl border p-5 shadow-xs sm:p-7">
          {/* Header Compacto Horizontal */}
          <div className="mb-6 flex flex-col justify-between gap-4 border-b pb-5 lg:flex-row lg:items-center">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-primary text-xs font-bold tracking-widest uppercase">
                  Como funciona
                </span>
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  Fluxo Blindado em 3 Passos
                </span>
              </div>
              <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                Simples como deveria ser — do chamado à garantia
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="text-muted-foreground hidden items-center gap-2 text-xs sm:flex">
                <CheckCircle2 className="size-4 text-emerald-600" />
                <span>Sem burocracia • Pagamento retido até a conclusão</span>
              </div>
              <Button
                size="default"
                className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-6 font-semibold shadow-xs"
                onClick={() => openAuth("register", "CLIENT")}
              >
                Começar agora
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </div>
          </div>

          {/* 3 Passos Horizontais Interativos */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {STEPS.map((step, i) => {
              const Icon = step.icon
              const isSelected = activeStep === i
              return (
                <div
                  key={step.number}
                  onClick={() => setActiveStep(i)}
                  onMouseEnter={() => setActiveStep(i)}
                  className={cn(
                    "group relative flex cursor-pointer flex-col justify-between rounded-2xl border p-5 transition-all duration-200",
                    isSelected
                      ? "border-primary/50 bg-primary/5 shadow-sm ring-1 ring-emerald-500/20"
                      : "border-border/50 bg-background/70 hover:border-primary/30 hover:bg-muted/30",
                  )}
                >
                  <div>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex size-11 items-center justify-center rounded-xl border transition-colors",
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground shadow-xs"
                              : "border-primary/20 bg-primary/10 text-primary",
                          )}
                        >
                          <Icon className="size-5" />
                        </div>
                        <div>
                          <span className="text-muted-foreground text-[11px] font-bold uppercase">
                            Passo {step.number}
                          </span>
                          <h3 className="text-base font-bold tracking-tight">{step.title}</h3>
                        </div>
                      </div>

                      <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[10px] font-bold">
                        {step.badge}
                      </span>
                    </div>

                    <p className="text-muted-foreground text-xs leading-relaxed sm:text-sm">
                      {step.description}
                    </p>
                  </div>

                  <div className="border-border/40 mt-4 flex items-center gap-1.5 border-t pt-3 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                    <span>{step.highlight}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
