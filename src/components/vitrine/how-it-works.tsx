"use client"

/**
 * HowItWorks — redesigned with Jakob Nielsen's 10 Usability Heuristics.
 *
 * Heuristics applied:
 *   H1 – Animated progress line fills on scroll; step check-mark animation; "3 passos simples"
 *   H2 – Concrete examples ("Busque 'encanador'") instead of abstract; mini UI mock elements
 *   H3 – Accordion on mobile; "Pular para resultados" quick link; back-to-top
 *   H4 – Consistent emerald gradient, card radius, button styles
 *   H5 – Clear flow with "Sem surpresas" tagline
 *   H6 – Large gradient icons; mini illustrations; real service examples
 *   H7 – Clickable steps; "Começar agora" CTA per step
 *   H8 – Clean timeline on mobile; horizontal cards on desktop; visual metaphors; one sentence
 *   H9 – "Sem compromisso" reassurance badge
 *  H10 – Expandable details per step; tooltips on trust badges
 */

import * as React from "react"
import {
  Search,
  CalendarCheck,
  Star,
  ArrowRight,
  MapPin,
  ShieldCheck,
  Clock,
  CheckCircle2,
  GitCompare,
  ChevronDown,
  ChevronRight,
  Handshake,
  MessageSquareQuote,
  Filter,
  ArrowUp,
  type LucideIcon,
} from "lucide-react"
import { motion, useScroll, useTransform } from "framer-motion"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/store"
import { useScrollReveal, useCountUp } from "@/hooks/use-animation"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"

// ---------------------------------------------------------------------------
// Step definitions — concrete, real-world examples (H2 + H6)
// ---------------------------------------------------------------------------

interface StepDef {
  icon: LucideIcon
  emoji: string
  title: string
  oneLiner: string
  example: string
  details: string
  miniIllustration: React.ReactNode
  ctaLabel: string
}

const STEPS: StepDef[] = [
  {
    icon: Search,
    emoji: "🔍",
    title: "Busque o serviço",
    oneLiner: "Encontre prestadores verificados perto de você.",
    example: "Ex: Busque 'encanador em São Paulo'",
    details:
      "Use filtros por categoria, distância e avaliação para encontrar exatamente o que precisa. Compare perfis lado a lado no mapa interativo.",
    ctaLabel: "Buscar prestadores",
    miniIllustration: (
      <div className="flex items-center gap-1.5">
        <div className="flex h-7 w-20 items-center gap-1 rounded-md border bg-white px-1.5 dark:bg-slate-800">
          <Search className="size-3 text-emerald-500" />
          <div className="h-2 w-10 rounded-sm bg-emerald-100 dark:bg-emerald-900/40" />
        </div>
        <Filter className="size-3 text-muted-foreground/50" />
      </div>
    ),
  },
  {
    icon: CalendarCheck,
    emoji: "📅",
    title: "Agende ou peça orçamento",
    oneLiner: "Solicite um orçamento ou agende diretamente.",
    example: "Ex: Peça orçamento para troca de torneira",
    details:
      "Receba orçamentos sem compromisso de vários prestadores ou agende diretamente pelo calendário disponível. Confirmação instantânea.",
    ctaLabel: "Pedir orçamento",
    miniIllustration: (
      <div className="flex items-center gap-1.5">
        <div className="flex h-7 w-16 items-center justify-center rounded-md border bg-white dark:bg-slate-800">
          <CalendarCheck className="size-3.5 text-emerald-500" />
        </div>
        <ArrowRight className="size-3 text-emerald-400" />
        <div className="flex h-7 w-12 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40">
          <CheckCircle2 className="size-3 text-emerald-500" />
        </div>
      </div>
    ),
  },
  {
    icon: Star,
    emoji: "⭐",
    title: "Avalie o resultado",
    oneLiner: "Sua opinião mantém a qualidade da comunidade.",
    example: "Ex: Avalie de 1 a 5 estrelas com comentário",
    details:
      "Após o serviço, avalie o prestador de 1 a 5 estrelas. Comentários verificados ajudam outros usuários. Pagamento seguro garantido.",
    ctaLabel: "Cadastrar grátis",
    miniIllustration: (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={cn(
              "size-3",
              i <= 4
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/30",
            )}
          />
        ))}
      </div>
    ),
  },
]

// Trust badges with tooltip descriptions (H10)
const TRUST_ITEMS = [
  {
    icon: ShieldCheck,
    label: "Prestadores verificados",
    tooltip: "Todos os prestadores passam por verificação de identidade e documentos",
  },
  {
    icon: Clock,
    label: "Resposta rápida",
    tooltip: "Prestadores respondem em até 2 horas em média",
  },
  {
    icon: CheckCircle2,
    label: "Satisfação garantida",
    tooltip: "Se não ficar satisfeito, ajudamos a resolver ou devolvemos seu dinheiro",
  },
  {
    icon: GitCompare,
    label: "Compare antes de contratar",
    tooltip: "Compare até 4 prestadores lado a lado antes de decidir",
  },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export default function HowItWorks({
  className,
  onBrowseProviders,
}: {
  className?: string
  onBrowseProviders?: () => void
}) {
  const openAuth = useUIStore((s) => s.openAuth)
  const { ref, visible } = useScrollReveal<HTMLDivElement>()
  const sectionRef = React.useRef<HTMLDivElement>(null)

  // Scroll progress for animated connector line (H1)
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  })
  const lineProgress = useTransform(scrollYProgress, [0.1, 0.6], [0, 100])

  const { ref: countRef, value: countValue } = useCountUp(3, {
    duration: 800,
  })

  return (
    <section
      ref={sectionRef}
      aria-label="Como funciona"
      className={cn(
        "relative overflow-hidden",
        "mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8",
        className,
      )}
    >
      {/* Subtle topographic pattern overlay */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.5) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      <div ref={ref} className="relative">
        {/* ── Header ────────────────────────────────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="relative mx-auto mb-12 max-w-2xl text-center"
        >
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={visible ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50"
          >
            <MapPin className="size-3.5" />
            Simples e rápido
          </motion.span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Como funciona
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            <span ref={countRef} className="font-semibold text-emerald-600 dark:text-emerald-400">
              {countValue}
            </span>{" "}
            passos para resolver o que você precisa
          </p>
          {/* "Sem compromisso" reassurance badge (H9) */}
          <span className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Handshake className="size-3 text-emerald-500" />
            Sem compromisso
          </span>
        </motion.header>

        {/* ── Desktop: 3 connected cards ──────────────────────────── */}
        <div className="hidden sm:block">
          <div className="relative grid grid-cols-3 gap-6">
            {/* Animated SVG connector line between cards (H1) */}
            <svg
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-0 z-0 h-2 w-full -translate-y-1/2"
              viewBox="0 0 1000 8"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="conn-gradient" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="rgb(16,185,129)" />
                  <stop offset="100%" stopColor="rgb(13,148,136)" />
                </linearGradient>
              </defs>
              {/* Background dashed line */}
              <line
                x1="180"
                y1="4"
                x2="820"
                y2="4"
                stroke="currentColor"
                className="text-muted-foreground/15"
                strokeWidth="2"
                strokeDasharray="8 6"
              />
              {/* Animated progress line */}
              <motion.line
                x1="180"
                y1="4"
                x2="820"
                y2="4"
                stroke="url(#conn-gradient)"
                strokeWidth="2.5"
                strokeDasharray="8 6"
                pathLength={1}
                style={{ pathLength: lineProgress }}
              />
            </svg>

            {STEPS.map((step, idx) => (
              <StepCardDesktop
                key={step.title}
                step={step}
                index={idx}
                visible={visible}
                onCtaClick={() => {
                  if (idx === 0 && onBrowseProviders) {
                    onBrowseProviders()
                  } else if (idx === 2) {
                    openAuth("register", "CLIENT")
                  } else {
                    const el = document.getElementById("vitrine-resultados")
                    if (el) el.scrollIntoView({ behavior: "smooth" })
                  }
                }}
              />
            ))}
          </div>
        </div>

        {/* ── Mobile: vertical timeline with accordion (H3) ──────── */}
        <div className="sm:hidden">
          {/* Animated progress line */}
          <div className="relative">
            <div
              aria-hidden
              className="absolute top-0 bottom-0 left-6 w-0.5 bg-muted-foreground/10"
            />
            <motion.div
              aria-hidden
              className="absolute top-0 left-6 w-0.5 bg-gradient-to-b from-emerald-500 to-teal-600"
              initial={{ height: 0 }}
              animate={visible ? { height: "100%" } : {}}
              transition={{ duration: 1.5, ease: "easeOut" }}
            />
          </div>

          <Accordion type="single" collapsible defaultValue="step-0" className="space-y-0">
            {STEPS.map((step, idx) => (
              <AccordionItem
                key={step.title}
                value={`step-${idx}`}
                className="border-b-0"
              >
                <motion.div
                  initial={{ opacity: 0, x: -16 }}
                  animate={visible ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.5, delay: idx * 0.15 }}
                  className="relative flex items-start gap-4 pb-6"
                >
                  {/* Timeline dot */}
                  <div className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
                    <step.icon className="size-5 text-white" />
                  </div>
                  {/* Step number badge */}
                  <span className="absolute left-8 top-0 z-20 flex size-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-emerald-600 shadow-sm ring-2 ring-emerald-200 dark:bg-slate-900 dark:text-emerald-400 dark:ring-emerald-800">
                    {idx + 1}
                  </span>

                  <div className="min-w-0 flex-1 pt-0">
                    <AccordionTrigger className="py-0 text-left text-sm font-semibold hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span>{step.emoji}</span>
                        <span>{step.title}</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-0 pt-2">
                      <p className="text-xs text-muted-foreground">
                        {step.oneLiner}
                      </p>
                      <p className="mt-1 text-[10px] italic text-muted-foreground/70">
                        {step.example}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {step.details}
                      </p>
                      {/* Mini illustration */}
                      <div className="mt-3 flex items-center justify-center rounded-lg border bg-muted/30 px-3 py-2">
                        {step.miniIllustration}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 h-7 gap-1.5 rounded-lg border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                        onClick={() => {
                          if (idx === 0 && onBrowseProviders) onBrowseProviders()
                          else openAuth("register", "CLIENT")
                        }}
                      >
                        {step.ctaLabel}
                        <ChevronRight className="size-3" />
                      </Button>
                    </AccordionContent>
                  </div>
                </motion.div>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* ── Trust badges row (H10 tooltips) ─────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={visible ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
        >
          {TRUST_ITEMS.map((item) => {
            const TIcon = item.icon
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <div className="flex cursor-default items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-emerald-600 dark:hover:text-emerald-400">
                    <TIcon className="size-4 text-emerald-500" />
                    <span>{item.label}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-[220px] text-center text-xs"
                >
                  {item.tooltip}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </motion.div>

        {/* ── CTA — drive conversion ───────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
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

          {/* "Pular para resultados" quick link (H3) */}
          <a
            href="#vitrine-resultados"
            className="mt-2 flex w-full items-center justify-center gap-1 text-xs text-muted-foreground transition-colors hover:text-emerald-600 dark:hover:text-emerald-400 sm:mt-0 sm:w-auto"
          >
            <MessageSquareQuote className="size-3" />
            Pular para resultados
          </a>
        </motion.div>

        {/* Back to top button (H3) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={visible ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="mt-6 flex justify-center"
        >
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 rounded-full text-xs text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="Voltar ao topo"
          >
            <ArrowUp className="size-3" />
            Voltar ao topo
          </Button>
        </motion.div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Desktop step card
// ---------------------------------------------------------------------------

function StepCardDesktop({
  step,
  index,
  visible,
  onCtaClick,
}: {
  step: StepDef
  index: number
  visible: boolean
  onCtaClick: () => void
}) {
  const Icon = step.icon

  return (
    <motion.li
      initial={{ opacity: 0, y: 30 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.15 }}
      className="group relative z-10 flex list-none flex-col items-center gap-4 rounded-2xl border bg-card p-6 text-center shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-emerald-300 hover:shadow-lg dark:hover:border-emerald-800/50"
    >
      {/* Icon with gradient background + step number badge */}
      <div className="relative">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20 transition-transform duration-200 group-hover:scale-110">
          <Icon className="size-7" />
        </span>
        {/* Step number floating badge */}
        <span className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-white text-xs font-bold text-emerald-600 shadow-md ring-2 ring-emerald-200 dark:bg-slate-900 dark:text-emerald-400 dark:ring-emerald-800">
          {index + 1}
        </span>
        {/* Check mark animation (H1) */}
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={visible ? { scale: 1, opacity: 1 } : {}}
          transition={{ duration: 0.3, delay: 0.5 + index * 0.2 }}
          className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-emerald-500"
          aria-hidden
        >
          <CheckCircle2 className="size-3 text-white" />
        </motion.span>
      </div>

      {/* Title */}
      <h3 className="text-lg font-semibold tracking-tight">
        <span className="mr-1">{step.emoji}</span>
        {step.title}
      </h3>

      {/* One-liner description (H8) */}
      <p className="text-sm text-muted-foreground">{step.oneLiner}</p>

      {/* Mini illustration area (H6) */}
      <div className="flex h-12 w-full items-center justify-center rounded-xl border bg-muted/30 transition-colors group-hover:border-emerald-200 group-hover:bg-emerald-50/30 dark:group-hover:border-emerald-800/50 dark:group-hover:bg-emerald-950/20">
        {step.miniIllustration}
      </div>

      {/* Example helper text (H2) */}
      <p className="text-[10px] italic text-muted-foreground/70">
        {step.example}
      </p>

      {/* Per-step CTA (H7) */}
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 rounded-lg border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
        onClick={onCtaClick}
      >
        {step.ctaLabel}
        <ChevronRight className="size-3" />
      </Button>
    </motion.li>
  )
}
