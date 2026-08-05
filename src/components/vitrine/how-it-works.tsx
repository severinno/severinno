"use client"

/**
 * HowItWorks — enhanced with Jakob Nielsen's 10 Usability Heuristics.
 *
 * Heuristics applied:
 *   H1 – Animated progress line fills on scroll; prominent step numbers; completion checkmarks; counter animations
 *   H2 – Concrete examples; realistic mini UI mockups (search bar, comparison, calendar, stars)
 *   H3 – Accordion on mobile with AnimatePresence; "Pular para resultados" quick link; back-to-top
 *   H4 – Consistent emerald gradient, card radius, button styles across all steps
 *   H5 – "Sem surpresas" tagline; "Sem compromisso" badge prevents anxiety
 *   H6 – Large gradient step icons (size-16); mini UI illustrations inside cards; numbered badges
 *   H7 – Clickable steps with CTAs; keyboard navigation; quick-skip link at top-right
 *   H8 – One sentence per step; visual metaphors over text; clean whitespace
 *   H9 – "Sem compromisso" reassurance badges on quote step
 *  H10 – Expandable details per step; tooltips on trust badges
 */

import * as React from "react"
import {
  Search,
  CalendarCheck,
  Star,
  ArrowRight,
  ShieldCheck,
  Clock,
  CheckCircle2,
  GitCompare,
  ChevronRight,
  Handshake,
  MessageSquareQuote,
  Filter,
  ArrowUp,
  Sparkles,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react"
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/store/ui"
import { useScrollReveal, useCountUp } from "@/hooks/use-animation"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

// ---------------------------------------------------------------------------
// Step definitions — concrete, real-world examples (H2 + H6)
// Now with 4 steps: Busca → Compare → Agende → Avalie
// ---------------------------------------------------------------------------

interface StepDef {
  icon: LucideIcon
  title: string
  oneLiner: string
  example: string
  details: string
  miniIllustration: React.ReactNode
  ctaLabel: string
  stat: { value: number; suffix: string; label: string }
}

const STEPS: StepDef[] = [
  {
    icon: Search,
    title: "Busque o serviço",
    oneLiner: "Encontre prestadores verificados perto de você.",
    example: "Busque 'encanador em São Paulo'",
    details:
      "Use filtros por categoria, distância e avaliação para encontrar exatamente o que precisa. Veja resultados no mapa interativo.",
    ctaLabel: "Buscar prestadores",
    stat: { value: 50, suffix: "+", label: "categorias" },
    miniIllustration: (
      <div className="flex w-full flex-col gap-1.5">
        {/* Search bar mockup */}
        <div className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 shadow-sm dark:bg-slate-800">
          <Search className="size-4 text-emerald-500" />
          <span className="text-muted-foreground text-[11px]">encanador em São Paulo</span>
          <span className="ml-auto animate-pulse text-[11px] text-emerald-500">|</span>
        </div>
        {/* Filter pills */}
        <div className="flex gap-1.5">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Verificados
          </span>
          <span className="bg-muted/50 text-muted-foreground rounded-full border px-2 py-0.5 text-[9px] font-medium">
            &lt; 5 km
          </span>
          <span className="bg-muted/50 text-muted-foreground rounded-full border px-2 py-0.5 text-[9px] font-medium">
            <Filter className="mr-0.5 inline size-2.5" />
            Mais filtros
          </span>
        </div>
      </div>
    ),
  },
  {
    icon: GitCompare,
    title: "Compare orçamentos",
    oneLiner: "Receba e compare propostas lado a lado.",
    example: "Compare 3 orçamentos em 24h",
    details:
      "Receba orçamentos sem compromisso de vários prestadores. Compare preços, avaliações e disponibilidade lado a lado antes de decidir.",
    ctaLabel: "Pedir orçamento",
    stat: { value: 3, suffix: "", label: "orçamentos em 24h" },
    miniIllustration: (
      <div className="flex w-full flex-col gap-1.5">
        {/* Comparison cards mockup */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-md border bg-white p-1.5 shadow-sm dark:bg-slate-800">
            <div className="flex items-center gap-1">
              <div className="size-4 rounded-full bg-emerald-100 dark:bg-emerald-900/40" />
              <span className="text-[8px] font-semibold">João S.</span>
            </div>
            <div className="mt-1 flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star
                  key={i}
                  className={cn(
                    "size-2",
                    i <= 4 ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30",
                  )}
                />
              ))}
            </div>
            <span className="mt-0.5 block text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              R$ 180
            </span>
          </div>
          <div className="rounded-md border border-emerald-300 bg-emerald-50/80 p-1.5 shadow-sm ring-1 ring-emerald-200 dark:border-emerald-700 dark:bg-emerald-950/30 dark:ring-emerald-800">
            <div className="flex items-center gap-1">
              <div className="size-4 rounded-full bg-teal-100 dark:bg-teal-900/40" />
              <span className="text-[8px] font-semibold">Maria L.</span>
            </div>
            <div className="mt-1 flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star
                  key={i}
                  className={cn(
                    "size-2",
                    i <= 5 ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30",
                  )}
                />
              ))}
            </div>
            <span className="mt-0.5 block text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              R$ 150
            </span>
            <span className="mt-0.5 block text-[7px] font-semibold text-emerald-600 dark:text-emerald-400">
              Melhor avaliação
            </span>
          </div>
        </div>
        <div className="text-muted-foreground flex items-center justify-center gap-1 text-[8px]">
          <GitCompare className="size-2.5" />
          Compare lado a lado
        </div>
      </div>
    ),
  },
  {
    icon: CalendarCheck,
    title: "Agende com confiança",
    oneLiner: "Solicite um orçamento ou agende diretamente.",
    example: "Agende para amanhã às 14h",
    details:
      "Receba orçamentos sem compromisso de vários prestadores ou agende diretamente pelo calendário disponível. Confirmação instantânea.",
    ctaLabel: "Agendar agora",
    stat: { value: 24, suffix: "h", label: "para confirmar" },
    miniIllustration: (
      <div className="flex w-full flex-col gap-1.5">
        {/* Calendar mockup */}
        <div className="rounded-lg border bg-white p-2 shadow-sm dark:bg-slate-800">
          <div className="text-muted-foreground mb-1 text-center text-[9px] font-bold tracking-wider uppercase">
            Março 2025
          </div>
          <div className="text-muted-foreground grid grid-cols-7 gap-0.5 text-center text-[8px]">
            {["S", "T", "Q", "Q", "S", "S", "D"].map((d, i) => (
              <span key={`${d}-${i}`}>{d}</span>
            ))}
            {Array.from({ length: 15 }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "rounded py-0.5",
                  i === 11 ? "bg-emerald-500 font-bold text-white" : "",
                )}
              >
                {i + 1}
              </span>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 dark:border-emerald-800 dark:bg-emerald-950/30">
            <CheckCircle2 className="size-3 text-emerald-500" />
            <span className="text-[9px] font-medium text-emerald-700 dark:text-emerald-300">
              12 Mar, 14:00 — Confirmado
            </span>
          </div>
        </div>
      </div>
    ),
  },
  {
    icon: Star,
    title: "Avalie o resultado",
    oneLiner: "Sua opinião mantém a qualidade da comunidade.",
    example: "Avalie de 1 a 5 estrelas com comentário",
    details:
      "Após o serviço, avalie o prestador de 1 a 5 estrelas. Comentários verificados ajudam outros usuários. Pagamento seguro garantido.",
    ctaLabel: "Cadastrar grátis",
    stat: { value: 98, suffix: "%", label: "satisfação" },
    miniIllustration: (
      <div className="flex w-full flex-col gap-1.5">
        {/* Rating mockup */}
        <div className="rounded-lg border bg-white p-2 shadow-sm dark:bg-slate-800">
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className={cn(
                  "size-4",
                  i <= 4 ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30",
                )}
              />
            ))}
            <span className="ml-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
              4.0
            </span>
          </div>
          <div className="bg-muted/50 mt-1.5 h-2 w-full rounded-full">
            <div className="h-2 w-4/5 rounded-full bg-gradient-to-r from-amber-400 to-amber-500" />
          </div>
          <p className="text-muted-foreground mt-1 text-[9px] italic">
            "Excelente trabalho, recomendo!"
          </p>
        </div>
        {/* Verified badge */}
        <div className="flex items-center justify-center gap-1 text-[9px] text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="size-3" />
          Avaliação verificada
        </div>
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
    icon: ThumbsUp,
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
// Animation variants
// ---------------------------------------------------------------------------

const staggerContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12 },
  },
}

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
}

// ---------------------------------------------------------------------------
// Parallax blobs — different scroll speeds for layered depth
// ---------------------------------------------------------------------------

function ParallaxBlobs({
  scrollYProgress,
}: {
  scrollYProgress: ReturnType<typeof useScroll>["scrollYProgress"]
}) {
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -60])
  const y2 = useTransform(scrollYProgress, [0, 1], [0, 40])
  const y3 = useTransform(scrollYProgress, [0, 1], [0, -30])

  return (
    <>
      <motion.div
        aria-hidden
        className="absolute -top-32 right-0 size-80 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-800/20"
        style={{ y: y1 }}
      />
      <motion.div
        aria-hidden
        className="absolute -bottom-24 -left-16 size-96 rounded-full bg-teal-200/30 blur-3xl dark:bg-teal-800/15"
        style={{ y: y2 }}
      />
      <motion.div
        aria-hidden
        className="absolute top-1/2 left-1/3 size-64 rounded-full bg-emerald-100/30 blur-3xl dark:bg-emerald-900/10"
        style={{ y: y3 }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Step stat counter — animates the number inside step description
// ---------------------------------------------------------------------------

function StepStat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const { ref, value: displayed } = useCountUp(value, { duration: 1200 })
  return (
    <span className="inline-flex items-baseline gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
      <span ref={ref}>{displayed}</span>
      {suffix}
      <span className="text-muted-foreground ml-0.5 font-normal">{label}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Component
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
  const lineProgress = useTransform(scrollYProgress, [0.1, 0.6], [0, 1])

  const { ref: countRef, value: countValue } = useCountUp(4, {
    duration: 800,
  })

  // Mobile accordion state for AnimatePresence
  const [expandedStep, setExpandedStep] = React.useState<number>(0)

  // Keyboard handler for step cards (H7)
  const handleStepKeyDown = React.useCallback(
    (idx: number, e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        if (idx === 0 && onBrowseProviders) {
          onBrowseProviders()
        } else if (idx === 3) {
          openAuth("register", "CLIENT")
        } else {
          const el = document.getElementById("vitrine-resultados")
          if (el) el.scrollIntoView({ behavior: "smooth" })
        }
      }
    },
    [onBrowseProviders, openAuth],
  )

  return (
    <section
      ref={sectionRef}
      aria-label="Como funciona"
      className={cn(
        "relative overflow-hidden",
        "bg-gradient-to-b from-white via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900",
        className,
      )}
    >
      {/* Dotted pattern background decoration */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(16,185,129,0.6) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Parallax decorative blobs */}
      <ParallaxBlobs scrollYProgress={scrollYProgress} />

      <div
        ref={ref}
        className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24"
      >
        {/* ── Header with quick-skip link (H7) ──────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="relative mx-auto mb-14 max-w-2xl text-center sm:mb-16"
        >
          {/* "Pular para resultados" quick-skip button at top-right (H7) */}
          <a
            href="#vitrine-resultados"
            className="absolute top-0 right-0 hidden items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-[10px] font-medium text-emerald-700 transition-all hover:bg-emerald-100 hover:shadow-sm sm:inline-flex dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
          >
            <MessageSquareQuote className="size-3" />
            Pular para resultados
          </a>

          {/* "4 passos simples" badge (H1) */}
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={visible ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50"
          >
            <Sparkles className="size-3.5" />
            <span ref={countRef}>{countValue}</span> passos simples
          </motion.span>

          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Como funciona
          </h2>

          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Sem surpresas — do início ao fim, você tem o controle.
          </p>

          {/* "Sem compromisso" reassurance badge (H5 + H9) */}
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/60 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300">
            <Handshake className="size-3.5" />
            Sem compromisso
          </span>
        </motion.header>

        {/* ── Desktop: 4 connected cards with animated line ───────── */}
        <div className="hidden sm:block">
          <div className="relative">
            {/* Animated SVG connector line between cards (H1) — progressive fill */}
            <div className="absolute top-20 left-0 z-0 w-full">
              <svg
                aria-hidden
                className="h-2 w-full"
                viewBox="0 0 1000 8"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="conn-gradient" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor="rgb(16,185,129)" />
                    <stop offset="50%" stopColor="rgb(20,184,166)" />
                    <stop offset="100%" stopColor="rgb(13,148,136)" />
                  </linearGradient>
                </defs>
                {/* Background dashed line */}
                <line
                  x1="125"
                  y1="4"
                  x2="875"
                  y2="4"
                  stroke="currentColor"
                  className="text-emerald-200 dark:text-emerald-900/60"
                  strokeWidth="2"
                  strokeDasharray="8 6"
                />
                {/* Animated progress line — fills on scroll */}
                <motion.line
                  x1="125"
                  y1="4"
                  x2="875"
                  y2="4"
                  stroke="url(#conn-gradient)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  pathLength={1}
                  style={{ pathLength: lineProgress }}
                />
              </svg>
            </div>

            {/* Step cards grid — 4 columns */}
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate={visible ? "show" : "hidden"}
              className="relative z-10 grid grid-cols-2 gap-6 lg:grid-cols-4 lg:gap-6"
            >
              {STEPS.map((step, idx) => (
                <StepCardDesktop
                  key={step.title}
                  step={step}
                  index={idx}
                  visible={visible}
                  onKeyDown={(e) => handleStepKeyDown(idx, e)}
                  onCtaClick={() => {
                    if (idx === 0 && onBrowseProviders) {
                      onBrowseProviders()
                    } else if (idx === 3) {
                      openAuth("register", "CLIENT")
                    } else {
                      const el = document.getElementById("vitrine-resultados")
                      if (el) el.scrollIntoView({ behavior: "smooth" })
                    }
                  }}
                />
              ))}
            </motion.div>
          </div>
        </div>

        {/* ── Mobile: vertical timeline with AnimatePresence accordion (H3) ──────── */}
        <div className="sm:hidden">
          <div className="relative">
            {/* Vertical timeline track */}
            <div
              aria-hidden
              className="absolute top-0 bottom-0 left-7 w-0.5 rounded-full bg-emerald-200 dark:bg-emerald-900/60"
            />
            {/* Animated progress fill based on expanded step */}
            <motion.div
              aria-hidden
              className="absolute top-0 left-7 w-0.5 rounded-full bg-gradient-to-b from-emerald-500 to-teal-600"
              initial={{ height: 0 }}
              animate={{ height: `${((expandedStep + 1) / STEPS.length) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>

          <div className="space-y-0">
            {STEPS.map((step, idx) => {
              const Icon = step.icon
              const isExpanded = expandedStep === idx
              return (
                <motion.div
                  key={step.title}
                  variants={fadeUp}
                  initial="hidden"
                  animate={visible ? "show" : "hidden"}
                  className="relative flex items-start gap-4 pb-5"
                >
                  {/* Timeline node — size-16 circle with gradient */}
                  <button
                    onClick={() => setExpandedStep(isExpanded ? -1 : idx)}
                    className="relative z-10 flex size-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25 transition-transform active:scale-95"
                    aria-expanded={isExpanded}
                    aria-label={`Passo ${idx + 1}: ${step.title}`}
                  >
                    <Icon className="size-7 text-white" />
                  </button>
                  {/* Step number badge */}
                  <span className="absolute top-0 left-12 z-20 flex size-6 items-center justify-center rounded-full bg-white text-xs font-bold text-emerald-600 shadow-sm ring-2 ring-emerald-200 dark:bg-slate-900 dark:text-emerald-400 dark:ring-emerald-800">
                    {idx + 1}
                  </span>

                  {/* Step content */}
                  <div className="min-w-0 flex-1 pt-1">
                    <button
                      onClick={() => setExpandedStep(isExpanded ? -1 : idx)}
                      className="flex w-full items-center justify-between text-left text-sm font-semibold"
                    >
                      {step.title}
                      <motion.span
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-muted-foreground ml-2"
                      >
                        <ChevronRight className="size-3.5 -rotate-90" />
                      </motion.span>
                    </button>

                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="pt-2 pb-2">
                            <p className="text-muted-foreground text-xs">{step.oneLiner}</p>
                            <p className="mt-1 text-[10px] text-emerald-600 italic dark:text-emerald-400">
                              Ex: {step.example}
                            </p>
                            {/* Step stat counter (H1) */}
                            <div className="mt-1.5">
                              <StepStat {...step.stat} />
                            </div>
                            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                              {step.details}
                            </p>
                            {/* Mini illustration (H6) */}
                            <div className="bg-muted/20 mt-3 rounded-xl border p-3">
                              {step.miniIllustration}
                            </div>
                            {/* "Sem compromisso" badge on compare step (H9) */}
                            {idx === 1 && (
                              <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                <Handshake className="size-3" />
                                Sem compromisso
                              </span>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-3 h-8 gap-1.5 rounded-lg border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                              onClick={() => {
                                if (idx === 0 && onBrowseProviders) onBrowseProviders()
                                else if (idx === 3) openAuth("register", "CLIENT")
                                else {
                                  const el = document.getElementById("vitrine-resultados")
                                  if (el) el.scrollIntoView({ behavior: "smooth" })
                                }
                              }}
                            >
                              {step.ctaLabel}
                              <ChevronRight className="size-3" />
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>

        {/* ── Guarantee strip with trust badges (H10 tooltips) ────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-14 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50/60 via-white to-teal-50/60 p-5 sm:mt-16 dark:border-emerald-900/50 dark:from-emerald-950/20 dark:via-slate-900 dark:to-teal-950/20"
        >
          <div className="mb-3 flex items-center justify-center gap-2">
            <ShieldCheck className="size-4 text-emerald-500" />
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              Garantia Severinno
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:gap-x-8">
            {TRUST_ITEMS.map((item) => {
              const TIcon = item.icon
              return (
                <Tooltip key={item.label}>
                  <TooltipTrigger asChild>
                    <div className="text-muted-foreground flex cursor-default items-center gap-2 text-sm transition-colors hover:text-emerald-600 dark:hover:text-emerald-400">
                      <TIcon className="size-4 text-emerald-500" />
                      <span className="hidden text-xs sm:inline">{item.label}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px] text-center text-xs">
                    {item.tooltip}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </motion.div>

        {/* ── CTA — drive conversion ───────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
        >
          <Button
            size="lg"
            onClick={() => openAuth("register", "CLIENT")}
            className="h-12 gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-8 text-base font-semibold shadow-lg shadow-emerald-500/20 transition-all hover:shadow-xl hover:shadow-emerald-500/30 hover:brightness-110"
          >
            Começar agora
            <ArrowRight className="size-4" />
          </Button>
          {onBrowseProviders ? (
            <Button
              variant="outline"
              size="lg"
              onClick={onBrowseProviders}
              className="h-12 gap-2 rounded-xl border-emerald-200 px-6 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            >
              <Search className="size-4" />
              Buscar prestadores
            </Button>
          ) : (
            <Button
              variant="outline"
              size="lg"
              asChild
              className="h-12 gap-2 rounded-xl border-emerald-200 px-6 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            >
              <a href="#vitrine-resultados">
                <Search className="size-4" />
                Buscar prestadores
              </a>
            </Button>
          )}
        </motion.div>

        {/* Quick-skip links (H3 + H7) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={visible ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="mt-4 flex items-center justify-center gap-4"
        >
          <a
            href="#vitrine-resultados"
            className="text-muted-foreground flex items-center gap-1 text-xs transition-colors hover:text-emerald-600 sm:hidden dark:hover:text-emerald-400"
          >
            <MessageSquareQuote className="size-3" />
            Pular para resultados
          </a>
          <span className="text-muted-foreground/30 sm:hidden">·</span>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="text-muted-foreground flex items-center gap-1 text-xs transition-colors hover:text-emerald-600 dark:hover:text-emerald-400"
            aria-label="Voltar ao topo"
          >
            <ArrowUp className="size-3" />
            Voltar ao topo
          </button>
        </motion.div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Desktop step card — with size-16 step number, gradient border on hover,
// mini UI mockup, counter stat, hover lift
// ---------------------------------------------------------------------------

function StepCardDesktop({
  step,
  index,
  visible,
  onKeyDown,
  onCtaClick,
}: {
  step: StepDef
  index: number
  visible: boolean
  onKeyDown: (e: React.KeyboardEvent) => void
  onCtaClick: () => void
}) {
  const Icon = step.icon

  return (
    <motion.div
      variants={fadeUp}
      className="group relative z-10 cursor-pointer"
      role="button"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={onCtaClick}
    >
      {/* Gradient border wrapper — visible on hover */}
      <div className="rounded-2xl bg-gradient-to-br from-transparent via-transparent to-transparent p-[1.5px] transition-all duration-300 group-hover:from-emerald-400 group-hover:via-teal-400 group-hover:to-emerald-500 group-hover:shadow-xl group-hover:shadow-emerald-500/10">
        <div className="bg-card flex h-full flex-col items-center rounded-2xl border p-5 text-center shadow-sm transition-colors duration-300 group-hover:border-transparent lg:p-6">
          {/* Large step number badge — size-16 (H6) */}
          <div className="absolute -top-5 left-1/2 z-20 -translate-x-1/2">
            <span className="flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xl font-extrabold text-white shadow-lg ring-4 shadow-emerald-500/30 ring-white dark:ring-slate-900">
              {index + 1}
            </span>
          </div>

          {/* Icon with gradient background + completion checkmark (H1) */}
          <div className="relative mt-6">
            <span className="flex size-18 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20 transition-transform duration-300 group-hover:scale-110">
              <Icon className="size-8" />
            </span>
            {/* Completion checkmark */}
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={visible ? { scale: 1, opacity: 1 } : {}}
              transition={{
                duration: 0.3,
                delay: 0.6 + index * 0.15,
                type: "spring",
                stiffness: 300,
              }}
              className="absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-full bg-emerald-500 shadow-md"
              aria-hidden
            >
              <CheckCircle2 className="size-3.5 text-white" />
            </motion.span>
          </div>

          {/* Title */}
          <h3 className="mt-4 text-sm font-bold tracking-tight lg:text-base">{step.title}</h3>

          {/* One-liner description (H8 — minimalism) */}
          <p className="text-muted-foreground mt-1 text-xs lg:text-sm">{step.oneLiner}</p>

          {/* Step stat counter (H1) */}
          <div className="mt-2">
            <StepStat {...step.stat} />
          </div>

          {/* Mini UI illustration area (H2 + H6) */}
          <div className="bg-muted/20 mt-3 flex w-full items-stretch justify-center rounded-xl border p-3 transition-colors duration-200 group-hover:border-emerald-200 group-hover:bg-emerald-50/40 dark:group-hover:border-emerald-800/50 dark:group-hover:bg-emerald-950/20">
            {step.miniIllustration}
          </div>

          {/* Concrete example (H2) */}
          <p className="mt-2 text-[9px] text-emerald-600 italic dark:text-emerald-400">
            Ex: {step.example}
          </p>

          {/* "Sem compromisso" reassurance on compare step (H5 + H9) */}
          {index === 1 && (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/60 px-2 py-0.5 text-[9px] font-medium text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              <Handshake className="size-2.5" />
              Sem compromisso
            </span>
          )}

          {/* Per-step CTA (H7) */}
          <Button
            size="sm"
            variant="outline"
            className="mt-3 h-7 gap-1.5 rounded-lg border-emerald-200 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            onClick={(e) => {
              e.stopPropagation()
              onCtaClick()
            }}
          >
            {step.ctaLabel}
            <ChevronRight className="size-3" />
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
