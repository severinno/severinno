"use client"

/**
 * WhySeverinno — merged value proposition + live platform stats section.
 *
 * Combines the former StatsCounter component into a single cohesive section:
 *   TOP    → Full-width emerald gradient stats bar (live API metrics)
 *   MIDDLE → Value proposition heading + 2×3 feature grid
 *   BOTTOM → Trust guarantee strip
 *
 * Jakob Nielsen's 10 Usability Heuristics mapping:
 *   H1  Visibility of system status   → Live animated stats, loading skeletons, expandable details
 *   H2  Match real world              → Concrete scenarios ("João verificou 3 documentos"), real API metrics
 *   H3  User control & freedom        → Expandable cards with "Saiba mais", "Pular para FAQ" link
 *   H4  Consistency & standards       → Consistent card styles, gradient icons, emerald palette
 *   H5  Error prevention              → Explicit guarantees shown prominently
 *   H6  Recognition over recall       → Large gradient icons, visual metaphors, checkmarks in bullets
 *   H7  Flexibility & efficiency      → "Pular para FAQ" link, shortcuts for power users
 *   H8  Aesthetic & minimalist design → 3×2 grid, short descriptions, expandable details
 *   H9  Help users recover errors     → Reassurance badges, guarantee strip
 *   H10 Help & documentation          → Info tooltips per feature, FAQ link
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
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
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { apiGet } from "@/lib/api"
import { useScrollReveal, useCountUp } from "@/hooks/use-animation"
import { cn } from "@/lib/utils"

import { Skeleton } from "@/components/ui/skeleton"
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
// Types
// ---------------------------------------------------------------------------

type PublicStats = {
  providers: number
  services: number
  reviews: number
  completedBookings: number
  avgRating: number
}

type Feature = {
  icon: LucideIcon
  title: string
  description: string
  bullets: string[]
  accent: string // tailwind gradient classes
  tooltip: string
}

type StatItem = {
  icon: LucideIcon
  label: string
  getValue: (stats: PublicStats) => number
  decimals?: number
  suffix?: string
}

// ---------------------------------------------------------------------------
// Feature data (H2 — concrete scenarios, H6 — visual metaphors)
// ---------------------------------------------------------------------------

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
// Stat item config (H1 — live platform metrics)
// ---------------------------------------------------------------------------

const STAT_ITEMS: StatItem[] = [
  {
    icon: Users,
    label: "Prestadores verificados",
    getValue: (s) => s.providers,
  },
  {
    icon: Wrench,
    label: "Serviços cadastrados",
    getValue: (s) => s.services,
  },
  {
    icon: CheckCircle2,
    label: "Serviços concluídos",
    getValue: (s) => s.completedBookings,
  },
  {
    icon: Star,
    label: "Nota média",
    getValue: (s) => s.avgRating,
    decimals: 1,
    suffix: "/5",
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WhySeverinno() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()

  // H1 — Fetch live platform stats
  const statsQuery = useQuery({
    queryKey: ["stats", "public"],
    queryFn: () => apiGet<PublicStats>("/api/stats/public"),
    staleTime: 5 * 60 * 1000,
  })

  const stats = statsQuery.data

  return (
    <section
      id="por-que"
      className="relative scroll-mt-20 bg-background"
    >
      {/* ================================================================
          TOP — Full-width emerald gradient stats bar (H1, H6)
          ================================================================ */}
      <div className="relative overflow-hidden bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-800 dark:from-emerald-700 dark:via-emerald-800 dark:to-teal-900">
        {/* Decorative mesh blobs */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-1/4 size-64 rounded-full bg-white/5 blur-3xl" />
          <div className="absolute bottom-0 right-1/4 size-56 rounded-full bg-teal-400/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          <div className="grid grid-cols-2 gap-6 sm:gap-8 lg:grid-cols-4">
            {STAT_ITEMS.map((item, idx) => (
              <LiveStatItem
                key={item.label}
                item={item}
                index={idx}
                visible={visible}
                stats={stats}
                isLoading={statsQuery.isLoading}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ================================================================
          MIDDLE — Value proposition heading + 2×3 feature grid
          ================================================================ */}
      <div className="relative py-16 sm:py-20">
        {/* Subtle gradient to muted at bottom */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-muted/30"
        />

        <div
          ref={ref}
          className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
        >
          {/* Heading */}
          <div className="mx-auto max-w-2xl text-center">
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

            {/* H7 — Quick link to FAQ */}
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

          {/* Feature grid (H8 — 3×2 minimalism) */}
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
        </div>
      </div>

      {/* ================================================================
          BOTTOM — Trust guarantee strip (H5, H9)
          ================================================================ */}
      <div className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-6 sm:pb-20 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center shadow-sm"
        >
          <ShieldAlert className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm font-medium text-foreground">
            Garantia Severinno:{" "}
            <span className="text-muted-foreground font-normal">
              seu dinheiro de volta se o serviço não for bem-feito.
            </span>
          </p>
          <a
            href="#faq"
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
          >
            Saiba mais
            <ArrowRight className="size-3" />
          </a>
        </motion.div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// LiveStatItem — animated counter for the top stats bar (H1, H6, H7)
// ---------------------------------------------------------------------------

function LiveStatItem({
  item,
  index,
  visible,
  stats,
  isLoading,
}: {
  item: StatItem
  index: number
  visible: boolean
  stats?: PublicStats
  isLoading: boolean
}) {
  const Icon = item.icon
  const value = stats ? item.getValue(stats) : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="flex flex-col items-center gap-2 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 sm:size-14">
        <Icon className="size-6 text-white sm:size-7" />
      </div>
      <div className="text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
        {isLoading ? (
          <Skeleton className="inline-block h-8 w-16 rounded bg-white/20" />
        ) : (
          <AnimatedNumber
            target={value}
            decimals={item.decimals}
            suffix={item.suffix}
          />
        )}
      </div>
      <p className="text-xs font-medium text-emerald-100 sm:text-sm">
        {item.label}
      </p>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// AnimatedNumber — scroll-triggered counter (H1, H7)
// ---------------------------------------------------------------------------

function AnimatedNumber({
  target,
  decimals = 0,
  suffix = "",
}: {
  target: number
  decimals?: number
  suffix?: string
}) {
  const { ref, value } = useCountUp(target, { decimals, duration: 2000 })

  return (
    <span ref={ref} className="tabular-nums">
      {decimals > 0 ? value.toFixed(decimals) : value.toLocaleString("pt-BR")}
      {suffix && (
        <span className="ml-1 text-lg font-normal text-emerald-200 sm:text-xl">
          {suffix}
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// FeatureCard — expandable value proposition card (H3, H4, H6, H8, H10)
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
          {/* Gradient icon + H10 info tooltip */}
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

          {/* H3 — Expandable "Saiba mais" */}
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

          {/* H4, H6 — Subtle colored corner accent on hover */}
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
