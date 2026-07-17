"use client"

/**
 * WhySeverinno — value proposition / "Why choose us" section.
 *
 * Showcases the platform's differentiators with iconographic feature cards.
 * Designed to build trust and communicate value before the visitor scrolls
 * to the provider grid.
 *
 * Features:
 *   - 6 feature cards in a responsive grid (1/2/3 columns)
 *   - Each card: gradient icon, title, description, micro-bullet points
 *   - Hover: subtle lift + border accent + icon scale
 *   - Scroll-reveal stagger animation
 *   - Stats strip at the bottom (animated counters)
 *   - Dark mode fully supported
 */

import * as React from "react"
import { motion } from "framer-motion"
import {
  ShieldCheck,
  Wallet,
  Clock,
  Star,
  MapPin,
  Headphones,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react"

import { useScrollReveal, useCountUp } from "@/hooks/use-animation"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Feature data
// ---------------------------------------------------------------------------

type Feature = {
  icon: LucideIcon
  title: string
  description: string
  bullets: string[]
  accent: string // tailwind gradient classes
}

const FEATURES: Feature[] = [
  {
    icon: ShieldCheck,
    title: "Prestadores verificados",
    description:
      "Todos os profissionais passam por validação de documento, endereço e telefone antes de aparecerem na vitrine.",
    bullets: [
      "Documento de identidade confirmado",
      "Comprovante de endereço validado",
      "Telefone e WhatsApp verificados",
    ],
    accent: "from-emerald-500 to-teal-600",
  },
  {
    icon: Wallet,
    title: "Pagamento protegido",
    description:
      "O valor só é liberado ao prestador após você confirmar que o serviço foi concluído com satisfação.",
    bullets: [
      "Pagamento via cartão, PIX ou boleto",
      "Retenção até confirmação do cliente",
      "Disputa mediada em caso de problema",
    ],
    accent: "from-emerald-600 to-green-700",
  },
  {
    icon: Clock,
    title: "Resposta rápida",
    description:
      "Prestadores comprometidos a responder orçamentos em até 24h. Acompanhe o status em tempo real.",
    bullets: [
      "Prazo de resposta visível no perfil",
      "Notificações em tempo real",
      "Chat direto com o prestador",
    ],
    accent: "from-teal-500 to-emerald-600",
  },
  {
    icon: Star,
    title: "Avaliações reais",
    description:
      "Apenas clientes que concluíram o serviço podem avaliar. Sem falsas avaliações, sem manipulação.",
    bullets: [
      "Avaliação pós-conclusão apenas",
      "Sistema anti-fraude integrado",
      "Histórico público de avaliações",
    ],
    accent: "from-amber-500 to-emerald-600",
  },
  {
    icon: MapPin,
    title: "Próximo de você",
    description:
      "Geolocalização inteligente mostra os melhores prestadores na sua região, com raio de atendimento customizável.",
    bullets: [
      "Busca por CEP ou GPS",
      "Filtro de raio (1–50 km)",
      "Mapa interativo com prestadores",
    ],
    accent: "from-emerald-500 to-cyan-600",
  },
  {
    icon: Headphones,
    title: "Suporte humano",
    description:
      "Equipe de suporte disponível para mediar disputas, tirar dúvidas e garantir uma experiência justa.",
    bullets: [
      "Suporte por chat e e-mail",
      "Mediação de disputas",
      "Base de conhecimento completa",
    ],
    accent: "from-green-500 to-emerald-700",
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

// These will be overridden by real data from the API in the parent — for now
// they provide a sensible fallback / preview.
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
      <div
        ref={ref}
        className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
      >
        {/* Heading */}
        <div className="mx-auto max-w-2xl text-center">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={visible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50"
          >
            <ShieldCheck className="size-3.5" />
            Por que Severinno?
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            animate={visible ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.05 }}
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
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-4 text-pretty text-muted-foreground"
          >
            Mais que um diretório de serviços — um ecossistema pensado para
            proteger você e o prestador. Da verificação ao pagamento, cada
            etapa foi desenhada para a sua tranquilidade.
          </motion.p>
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

        {/* Stats strip */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-14 overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-6 text-white shadow-lg sm:p-8"
        >
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-4">
            {STATS.map((stat) => (
              <StatCounter key={stat.label} stat={stat} />
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Feature card with hover lift + gradient icon
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
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.45, delay: index * 0.08 }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm transition-all duration-300",
        "hover:-translate-y-1 hover:border-emerald-300 hover:shadow-lg",
        "dark:hover:border-emerald-800/60",
      )}
    >
      {/* Gradient icon */}
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition-transform duration-300 group-hover:scale-110",
          feature.accent,
        )}
      >
        <Icon className="size-6" />
      </div>

      <h3 className="mt-4 text-lg font-semibold leading-tight">
        {feature.title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {feature.description}
      </p>

      {/* Bullet list */}
      <ul className="mt-4 space-y-1.5">
        {feature.bullets.map((bullet) => (
          <li
            key={bullet}
            className="flex items-start gap-2 text-xs text-muted-foreground"
          >
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      {/* Subtle corner accent on hover */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-gradient-to-br opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-20",
          feature.accent,
        )}
      />
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
        <span ref={ref}>
          {value.toLocaleString("pt-BR")}
        </span>
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
