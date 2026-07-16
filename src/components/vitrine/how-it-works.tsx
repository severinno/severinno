"use client"

/**
 * HowItWorks — 3-step explainer + conversion CTA.
 *
 * 1) Busque e compare prestadores próximos
 * 2) Peça orçamento ou agende
 * 3) Avalie após o serviço
 *
 * Minimal, icon-led, emerald accent. Ends with a CTA pair to drive
 * conversion (cadastro grátis · buscar prestadores).
 */

import { Search, CalendarCheck, Star, ArrowRight, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/store"
import { Button } from "@/components/ui/button"

const STEPS = [
  {
    icon: Search,
    title: "Busque e compare",
    description:
      "Encontre prestadores verificados pela sua localização. Compare preços, avaliações e distância.",
  },
  {
    icon: CalendarCheck,
    title: "Peça orçamento ou agende",
    description:
      "Solicite um orçamento sob medida ou agende diretamente pelo calendário do prestador.",
  },
  {
    icon: Star,
    title: "Avalie após o serviço",
    description:
      "Após o serviço, avalie o prestador. Sua opinião ajuda a manter a qualidade da comunidade.",
  },
] as const

export default function HowItWorks({
  className,
  onBrowseProviders,
}: {
  className?: string
  onBrowseProviders?: () => void
}) {
  const openAuth = useUIStore((s) => s.openAuth)

  return (
    <section
      aria-label="Como funciona"
      className={cn(
        "mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8",
        className,
      )}
    >
      <header className="mx-auto mb-6 max-w-2xl text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Como funciona
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Três passos simples para resolver o que você precisa.
        </p>
      </header>

      <ol className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {STEPS.map((step, idx) => {
          const Icon = step.icon
          const isLast = idx === STEPS.length - 1
          return (
            <li
              key={step.title}
              className="relative flex flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center shadow-sm transition-all hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span className="relative flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <Icon className="size-6" />
                  <span className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-background text-xs font-bold text-primary ring-1 ring-primary/30">
                    {idx + 1}
                  </span>
                </span>
              </div>
              <h3 className="text-base font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="text-sm text-muted-foreground">
                {step.description}
              </p>

              {/* Connecting arrow to the next step (desktop only) */}
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute top-1/2 left-full hidden -translate-y-1/2 sm:flex"
                >
                  <ChevronRight className="size-5 text-muted-foreground/40" />
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {/* CTA — drive conversion at the end of the explainer */}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={() => openAuth("register", "CLIENT")}>
          Cadastrar grátis
          <ArrowRight className="size-4" />
        </Button>
        {onBrowseProviders ? (
          <Button
            variant="outline"
            onClick={onBrowseProviders}
            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          >
            <Search className="size-4" />
            Buscar prestadores
          </Button>
        ) : (
          <Button
            variant="outline"
            asChild
            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          >
            <a href="#vitrine-resultados">
              <Search className="size-4" />
              Buscar prestadores
            </a>
          </Button>
        )}
      </div>
    </section>
  )
}
