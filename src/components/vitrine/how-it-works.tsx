"use client"

/**
 * HowItWorks — Clean 3-step process explanation.
 * Minimal, direct, no over-engineering.
 */

import * as React from "react"
import { Search, CalendarCheck, ShieldCheck, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/store/ui"
import { Button } from "@/components/ui/button"

const STEPS = [
  {
    number: "01",
    icon: Search,
    title: "Busque e filtre",
    description:
      "Encontre prestadores verificados perto de você. Filtre por categoria, distância, avaliação e disponibilidade.",
  },
  {
    number: "02",
    icon: CalendarCheck,
    title: "Agende com confiança",
    description:
      "Solicite um orçamento sem compromisso ou agende diretamente pelo calendário. Confirmação instantânea.",
  },
  {
    number: "03",
    icon: ShieldCheck,
    title: "Pague com segurança",
    description:
      "O pagamento fica retido em garantia e é liberado apenas após a conclusão do serviço. Sem risco.",
  },
]

export default function HowItWorks() {
  const openAuth = useUIStore((s) => s.openAuth)

  return (
    <section className="border-border/40 border-t bg-background py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <p className="text-primary mb-3 text-xs font-semibold uppercase tracking-widest">
            Como funciona
          </p>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Simples como deveria ser
          </h2>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed">
            Do serviço ao pagamento em 3 passos. Sem burocracia, sem surpresas.
          </p>
        </div>

        {/* Steps */}
        <div className="relative grid gap-8 sm:grid-cols-3">
          {/* Connector line */}
          <div className="absolute top-8 right-1/6 left-1/6 hidden h-px sm:block">
            <div className="border-border/50 h-full border-t border-dashed" />
          </div>

          {STEPS.map((step, i) => {
            const Icon = step.icon
            return (
              <div
                key={step.number}
                className={cn(
                  "relative flex flex-col items-center text-center",
                  i < STEPS.length - 1 && "sm:after:hidden",
                )}
              >
                {/* Icon Circle */}
                <div className="relative mb-5 flex size-16 items-center justify-center rounded-full border border-primary/20 bg-primary/8 ring-4 ring-background">
                  <Icon className="text-primary size-7" />
                  <span className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground tabular-nums">
                    {i + 1}
                  </span>
                </div>

                <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {step.description}
                </p>
              </div>
            )
          })}
        </div>

        {/* CTA */}
        <div className="mt-12 flex justify-center">
          <Button
            size="lg"
            className="rounded-full bg-primary px-8 font-semibold text-primary-foreground hover:bg-primary/90"
            onClick={() => openAuth("register", "CLIENT")}
          >
            Começar agora
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </div>
      </div>
    </section>
  )
}
