"use client"

/**
 * WhySeverinno — value proposition / "Why choose us" section.
 *
 * Redesigned with Jakob Nielsen's 10 Usability Heuristics:
 *   H1 – Visibility: animated stats strip at top showing platform metrics
 *   H2 – Match real world: concrete scenarios, "Você" language
 *   H3 – User control: expandable cards with "Saiba mais"
 *   H4 – Consistency: same card style, gradient icons, emerald palette
 *   H5 – Error prevention: explicit guarantees shown
 *   H6 – Recognition: large gradient icons, visual metaphors, checkmarks
 *   H7 – Flexibility: "Pular para FAQ" link, shortcuts
 *   H8 – Minimalism: 3x2 grid, short descriptions, expandable details
 *   H9 – Error recovery: reassurance badges
 *   H10 – Help: info tooltips per feature, FAQ link
 */

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ShieldCheck,
  Wallet,
  Clock,
  Star,
  MapPin,
  Headphones,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  ArrowRight,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react"

import { useScrollReveal, useCountUp } from "@/hooks/use-animation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"

// ---------------------------------------------------------------------------
// Feature data
// ---------------------------------------------------------------------------

type Feature = {
  icon: LucideIcon
  title: string
  description: string
  bullets: string[]
  accent: string // tailwind gradient classes
  tooltip: string
}

const FEATURES: Feature[] = [
  {
    icon: ShieldCheck,
    title: "Prestadores verificados",
    description:
      "João verificou 3 documentos antes de aprovar o prestador. Você só vê profissionais validados.",
    bullets: [
      "Documento de identidade confirmado",
      "Comprovante de endereço validado",
      "Telefone e WhatsApp verificados",
    ],
    accent: "from-emerald-500 to-teal-600",
    tooltip:
      "Todos os prestadores passam por verificação de documento, endereço e telefone antes de aparecerem na plataforma.",
  },
  {
    icon: Wallet,
    title: "Pagamento protegido",
    description:
      "O valor só é liberado ao prestador após você confirmar que ficou satisfeito com o serviço.",
    bullets: [
      "Pagamento via cartão, PIX ou boleto",
      "Retenção até confirmação do cliente",
      "Disputa mediada em caso de problema",
    ],
    accent: "from-emerald-600 to-green-700",
    tooltip:
      "Seu dinheiro fica retido até você aprovar o serviço. Se algo der errado, mediaremos a disputa.",
  },
  {
    icon: Clock,
    title: "Resposta rápida",
    description:
      "Prestadores comprometidos a responder em até 24h. Acompanhe o status em tempo real.",
    bullets: [
      "Prazo de resposta visível no perfil",
      "Notificações em tempo real",
      "Chat direto com o prestador",
    ],
    accent: "from-teal-500 to-emerald-600",
    tooltip:
      "O prazo médio de resposta é exibido no perfil do prestador para que você saiba o que esperar.",
  },
  {
    icon: Star,
    title: "Avaliações reais",
    description:
      "Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações.",
    bullets: [
      "Avaliação pós-conclusão apenas",
      "Sistema anti-fraude integrado",
      "Histórico público de avaliações",
    ],
    accent: "from-amber-500 to-emerald-600",
    tooltip:
      "Avaliações são coletadas automaticamente após a conclusão do serviço. Não aceitamos avaliações de terceiros.",
  },
  {
    icon: MapPin,
    title: "Próximo de você",
    description:
      "Geolocalização inteligente mostra os melhores prestadores na sua região.",
    bullets: [
      "Busca por CEP ou GPS",
      "Filtro de raio (1–50 km)",
      "Mapa interativo com prestadores",
    ],
    accent: "from-emerald-500 to-cyan-600",
    tooltip:
      "Use sua localização ou digite o CEP para encontrar prestadores no seu raio de atendimento.",
  },
  {
    icon: Headphones,
    title: "Suporte humano",
    description:
      "Equipe disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.",
    bullets: [
      "Suporte por chat e e-mail",
      "Mediação de disputas",
      "Base de conhecimento completa",
    ],
    accent: "from-green-500 to-emerald-700",
    tooltip:
      "Nossa equipe de suporte está disponível para ajudar com qualquer dúvida ou problema.",
  },
]

// ---------------------------------------------------------------------------
// Stat strip data (animated counters)
// ---------------------------------------------------------------------------

type Stat = {
  value: number
  suffix?: string
  label: string
}

const STATS: Stat[] = [
  { value: 100, suffix: "%", label: "Prestadores verificados" },
  { value: 24, suffix: "h", label: "Prazo médio de resposta" },
  { value: 7, suffix: " dias", label: "Janela para abrir disputa" },
  { value: 0, suffix: "", label: "Taxa para clientes" },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WhySeverinno() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()

  return (
    <section
      id="por-que"
      className="relative scroll-mt-20 bg-background py-16 sm:py-20"
    >
      {/* Subtle gradient to slate-50 at bottom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-muted/30"
      />

      <div
        ref={ref}
        className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
      >
        {/* Stats strip at TOP (H1) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-6 text-white shadow-lg sm:p-8"
        >
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-4">
            {STATS.map((stat) => (
              <StatCounter key={stat.label} stat={stat} />
            ))}
          </div>
        </motion.div>

        {/* Heading */}
        <div className="mx-auto mt-12 max-w-2xl text-center">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={visible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50"
          >
            <ShieldCheck className="size-3.5" />
            Por que Severinno?
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            animate={visible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-4 text-balance text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Confiança em cada{" "}
            <span className="text-emerald-600 dark:text-emerald-400">
              agendamento
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={visible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-4 text-pretty text-muted-foreground"
          >
            Mais que um diretório de serviços — um ecossistema pensado para
            proteger você e o prestador. Da verificação ao pagamento, cada
            etapa foi desenhada para a sua tranquilidade.
          </motion.p>

          {/* Quick link to FAQ (H7) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={visible ? { opacity: 1 } : {}}
            transition={{ duration: 0.3, delay: 0.3 }}
            className="mt-3"
          >
            <a
              href="#faq"
              className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
            >
              <HelpCircle className="size-3" />
              Pular para FAQ
            </a>
          </motion.div>
        </div>

        {/* Feature grid */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, idx) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
              index={idx}
              visible={visible}
            />
          ))}
        </div>

        {/* Trust reassurance strip (H5, H9) */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center shadow-sm"
        >
          <ShieldAlert className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm font-medium text-foreground">
            Garantia Severinno:{" "}
            <span className="text-muted-foreground font-normal">
              seu dinheiro de volta se o serviço não for bem-feito.
            </span>
          </p>
        </motion.div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Feature card with collapsible details
// ---------------------------------------------------------------------------

function FeatureCard({
  feature,
  index,
  visible,
}: {
  feature: Feature
  index: number
  visible: boolean
}) {
  const Icon = feature.icon
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.45, delay: 0.15 + index * 0.06 }}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div
          className={cn(
            "group relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm transition-all duration-300",
            "hover:-translate-y-1 hover:border-emerald-300 hover:shadow-lg",
            "dark:hover:border-emerald-800/60",
          )}
        >
          {/* Gradient icon + info tooltip */}
          <div className="flex items-start justify-between">
            <div
              className={cn(
                "flex size-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition-transform duration-300 group-hover:scale-110",
                feature.accent,
              )}
            >
              <Icon className="size-6" />
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="mt-1 rounded-full p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    aria-label={`Saiba mais sobre ${feature.title}`}
                  >
                    <HelpCircle className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px]">
                  {feature.tooltip}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <h3 className="mt-4 text-lg font-semibold leading-tight">
            {feature.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-2">
            {feature.description}
          </p>

          {/* Expandable "Saiba mais" */}
          <CollapsibleTrigger asChild>
            <button
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
              aria-expanded={isOpen}
            >
              {isOpen ? "Menos detalhes" : "Saiba mais"}
              <ChevronDown
                className={cn(
                  "size-3 transition-transform duration-200",
                  isOpen && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <AnimatePresence>
              {isOpen && (
                <motion.ul
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="mt-3 space-y-1.5 overflow-hidden"
                >
                  {feature.bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="flex items-start gap-2 text-xs text-muted-foreground"
                    >
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </CollapsibleContent>

          {/* Subtle corner accent on hover */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-gradient-to-br opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-20",
              feature.accent,
            )}
          />
        </div>
      </Collapsible>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Animated stat counter
// ---------------------------------------------------------------------------

function StatCounter({ stat }: { stat: Stat }) {
  const { ref, value } = useCountUp(stat.value, { duration: 1800 })
  return (
    <div className="text-center">
      <p className="text-3xl font-bold tracking-tight sm:text-4xl">
        <span ref={ref}>{value.toLocaleString("pt-BR")}</span>
        {stat.suffix && (
          <span className="text-lg font-normal text-emerald-200">
            {stat.suffix}
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-emerald-100/80 sm:text-sm">
        {stat.label}
      </p>
    </div>
  )
}
