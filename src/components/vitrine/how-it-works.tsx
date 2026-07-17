"use client"

/**
 * HowItWorks — enhanced 3-step explainer with animated connectors,
 * gradient step cards, and conversion CTA.
 *
 * Improvements over previous version:
 *   - Animated dashed connector lines between steps (desktop)
 *   - Gradient step number badges
 *   - Hover lift effect on cards
 *   - Feature bullets per step for scannability
 *   - Mobile-optimized stacked layout with number badges
 *   - Emerald accent theme throughout
 */

import {
  Search,
  CalendarCheck,
  Star,
  ArrowRight,
  ChevronRight,
  MapPin,
  ShieldCheck,
  Clock,
  CheckCircle2,
  GitCompare,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/store"
import { Button } from "@/components/ui/button"

const STEPS = [
  {
    icon: Search,
    title: "Busque e compare",
    description:
      "Encontre prestadores verificados pela sua localização. Compare preços, avaliações e distância.",
    features: ["Filtro por categoria e raio", "Comparação lado a lado", "Mapa interativo"],
  },
  {
    icon: CalendarCheck,
    title: "Peça orçamento ou agende",
    description:
      "Solicite um orçamento sob medida ou agende diretamente pelo calendário do prestador.",
    features: ["Orçamento sem compromisso", "Agendamento online", "Confirmação instantânea"],
  },
  {
    icon: Star,
    title: "Avalie após o serviço",
    description:
      "Após o serviço, avalie o prestador. Sua opinião ajuda a manter a qualidade da comunidade.",
    features: ["Avaliação de 1 a 5 estrelas", "Comentários verificados", "Pagamento seguro"],
  },
] as const

// Small trust badges shown below the steps
const TRUST_ITEMS = [
  { icon: ShieldCheck, label: "Prestadores verificados" },
  { icon: Clock, label: "Resposta rápida" },
  { icon: CheckCircle2, label: "Satisfação garantida" },
  { icon: GitCompare, label: "Compare antes de contratar" },
]

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
        "relative overflow-hidden",
        "mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8",
        className,
      )}
    >
      {/* Subtle background pattern */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.5) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      <header className="relative mx-auto mb-10 max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50">
          <MapPin className="size-3.5" />
          Simples e rápido
        </span>
        <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          Como funciona
        </h2>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Três passos simples para resolver o que você precisa.
        </p>
      </header>

      {/* Steps grid */}
      <ol className="relative grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-6">
        {STEPS.map((step, idx) => {
          const Icon = step.icon
          const isLast = idx === STEPS.length - 1
          return (
            <li
              key={step.title}
              className="group relative flex flex-col items-center gap-4 rounded-2xl border bg-card p-6 text-center shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg dark:hover:border-emerald-800/50"
            >
              {/* Step number + icon badge */}
              <div className="relative">
                <span className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
                  <Icon className="size-7" />
                </span>
                <span className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-white text-xs font-bold text-emerald-600 shadow-md ring-2 ring-emerald-200 dark:bg-slate-900 dark:text-emerald-400 dark:ring-emerald-800">
                  {idx + 1}
                </span>
              </div>

              <h3 className="text-lg font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>

              {/* Feature bullets — scannable highlights */}
              <ul className="mt-1 space-y-1.5 text-left">
                {step.features.map((feat) => (
                  <li
                    key={feat}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              {/* Connector arrow — desktop only */}
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute top-1/2 left-full hidden -translate-y-1/2 sm:flex"
                >
                  <div className="relative flex items-center">
                    <div className="h-px w-8 bg-gradient-to-r from-emerald-300 to-emerald-400 dark:from-emerald-700 dark:to-emerald-600" />
                    <ChevronRight className="size-4 text-emerald-400 dark:text-emerald-600" />
                  </div>
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {/* Trust badges row */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        {TRUST_ITEMS.map((item) => {
          const TIcon = item.icon
          return (
            <div
              key={item.label}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <TIcon className="size-4 text-emerald-500" />
              <span>{item.label}</span>
            </div>
          )
        })}
      </div>

      {/* CTA — drive conversion */}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button
          size="lg"
          onClick={() => openAuth("register", "CLIENT")}
          className="h-11 gap-2 rounded-xl px-6"
        >
          Cadastrar grátis
          <ArrowRight className="size-4" />
        </Button>
        {onBrowseProviders ? (
          <Button
            variant="outline"
            size="lg"
            onClick={onBrowseProviders}
            className="h-11 gap-2 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
          >
            <Search className="size-4" />
            Buscar prestadores
          </Button>
        ) : (
          <Button
            variant="outline"
            size="lg"
            asChild
            className="h-11 gap-2 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
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
