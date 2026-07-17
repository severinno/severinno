"use client"

/**
 * CtaBanner — conversion-focused call-to-action section.
 *
 * Redesigned with Jakob Nielsen's 10 Usability Heuristics:
 *   H1 – Visibility: Dynamic stats from API, "X novos cadastros nas últimas 24h"
 *   H2 – Match real world: "Comece em 30 segundos", Uber-like analogy
 *   H3 – User control: Tab toggle (cliente / prestador), "Já tenho conta" link
 *   H4 – Consistency: Same emerald gradient, badge and button components
 *   H5 – Error prevention: Trust badges, no surprise costs
 *   H6 – Recognition: Avatar stack with initials, trust badges, star rating
 *   H7 – Flexibility: One-click CTA, multiple entry points
 *   H8 – Minimalism: Single focused CTA per persona, clean layout
 *   H9 – Error recovery: "Sem compromisso, cancele quando quiser"
 *   H10 – Help: "O que vem depois?" mini-steps, FAQ link
 */

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowRight,
  Wrench,
  Search,
  Sparkles,
  CheckCircle2,
  UserPlus,
  SearchCheck,
  CalendarCheck,
  ShieldCheck,
  LogIn,
  Star,
  Timer,
  Clock,
  Shield,
  CreditCard,
  XCircle,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useScrollReveal, useCountUp } from "@/hooks/use-animation"
import { useAuthStore, useUIStore } from "@/store"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublicStats = {
  providers: number
  services: number
  reviews: number
  completedBookings: number
  avgRating: number
  totalUsers: number
  recentSignups24h: number
}

type VisitorTab = "client" | "provider"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLIENT_BENEFITS = [
  "Cadastro gratuito",
  "Sem taxa de serviço",
  "Orçamento sem compromisso",
]

const PROVIDER_BENEFITS = [
  "Receba orçamentos qualificados",
  "Gestão de agenda integrada",
  "Pagamento garantido",
]

const SIGNUP_STEPS = [
  {
    icon: UserPlus,
    label: "Cadastre-se grátis",
    time: "30s",
  },
  {
    icon: SearchCheck,
    label: "Busque e compare",
    time: "2 min",
  },
  {
    icon: CalendarCheck,
    label: "Agende com confiança",
    time: "5 min",
  },
] as const

const TRUST_SIGNS = [
  { icon: XCircle, label: "Sem compromisso" },
  { icon: Clock, label: "Cancele quando quiser" },
  { icon: CreditCard, label: "Pagamento protegido" },
] as const

const FLOATING_ICONS = [
  { Icon: Wrench, x: "8%", y: "12%", size: 22, delay: 0, duration: 6 },
  { Icon: Star, x: "88%", y: "8%", size: 18, delay: 1.2, duration: 7 },
  { Icon: ShieldCheck, x: "75%", y: "75%", size: 20, delay: 0.8, duration: 5.5 },
  { Icon: Search, x: "15%", y: "80%", size: 16, delay: 2, duration: 6.5 },
  { Icon: Sparkles, x: "55%", y: "5%", size: 14, delay: 1.5, duration: 8 },
  { Icon: Users, x: "40%", y: "85%", size: 17, delay: 0.3, duration: 7.5 },
] as const

// ---------------------------------------------------------------------------
// Avatar stack for social proof
// ---------------------------------------------------------------------------

const AVATAR_DATA = [
  { initials: "AL", color: "bg-emerald-500" },
  { initials: "RM", color: "bg-teal-500" },
  { initials: "JS", color: "bg-amber-500" },
  { initials: "PF", color: "bg-rose-500" },
  { initials: "CM", color: "bg-cyan-500" },
]

function AvatarStack() {
  return (
    <div className="flex items-center">
      {AVATAR_DATA.map((avatar, i) => (
        <div
          key={i}
          className={cn(
            "flex size-8 items-center justify-center rounded-full ring-2 ring-white/20 text-[10px] font-bold text-white select-none",
            avatar.color,
            i > 0 && "-ml-2",
          )}
          aria-hidden
        >
          {avatar.initials}
        </div>
      ))}
      <div
        className="flex size-8 items-center justify-center rounded-full ring-2 ring-white/20 bg-white/20 text-[10px] font-bold text-white -ml-2 select-none"
        aria-hidden
      >
        +5
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Animated floating icon
// ---------------------------------------------------------------------------

function FloatingIcon({
  Icon,
  x,
  y,
  size,
  delay,
  duration,
}: {
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  x: string
  y: string
  size: number
  delay: number
  duration: number
}) {
  return (
    <motion.div
      aria-hidden
      className="absolute pointer-events-none text-white/[0.08]"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{
        opacity: [0, 0.12, 0.06, 0.12],
        scale: [0.8, 1.1, 0.9, 1.05],
        y: [0, -12, 4, -8],
        x: [0, 6, -4, 3],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        repeatType: "reverse",
        ease: [0.42, 0, 0.58, 1],
      }}
    >
      <Icon style={{ width: size, height: size }} />
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Animated mesh blobs
// ---------------------------------------------------------------------------

function MeshBlobs() {
  return (
    <>
      {/* Primary blob — top right */}
      <motion.div
        aria-hidden
        className="absolute -top-20 -right-10 size-72 rounded-full bg-emerald-400/30 blur-3xl"
        animate={{
          scale: [1, 1.15, 0.95, 1.1],
          x: [0, 15, -10, 5],
          y: [0, -10, 8, -5],
        }}
        transition={{ duration: 8, repeat: Infinity, repeatType: "reverse", ease: [0.42, 0, 0.58, 1] }}
      />
      {/* Secondary blob — bottom left */}
      <motion.div
        aria-hidden
        className="absolute -bottom-24 -left-10 size-80 rounded-full bg-teal-300/20 blur-3xl"
        animate={{
          scale: [1, 0.9, 1.1, 0.95],
          x: [0, -12, 8, -5],
          y: [0, 10, -8, 5],
        }}
        transition={{ duration: 10, repeat: Infinity, repeatType: "reverse", ease: [0.42, 0, 0.58, 1], delay: 1 }}
      />
      {/* Tertiary blob — center accent */}
      <motion.div
        aria-hidden
        className="absolute top-1/3 left-1/2 size-60 rounded-full bg-emerald-300/10 blur-3xl"
        animate={{
          scale: [1, 1.2, 0.85, 1.1],
          x: [0, -20, 10, -8],
          y: [0, 8, -12, 6],
        }}
        transition={{ duration: 12, repeat: Infinity, repeatType: "reverse", ease: [0.42, 0, 0.58, 1], delay: 2 }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Pulsing glow wrapper for CTA button
// ---------------------------------------------------------------------------

function PulsingGlow({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative inline-flex">
      {/* Glow ring */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-lg bg-white/40 blur-md"
        animate={{
          opacity: [0, 0.5, 0],
          scale: [1, 1.08, 1],
        }}
        transition={{
          duration: 2.5,
          repeat: Infinity,
          ease: [0.42, 0, 0.58, 1],
        }}
      />
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Live counter badge
// ---------------------------------------------------------------------------

function LiveCounter({ count }: { count: number }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-100 ring-1 ring-white/20"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
      </span>
      Últimas 24h: {count} novos cadastros
    </motion.span>
  )
}

// ---------------------------------------------------------------------------
// Hook: fetch public stats
// ---------------------------------------------------------------------------

function usePublicStats() {
  const [stats, setStats] = React.useState<PublicStats | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/stats/public")
        if (!res.ok) return
        const data: PublicStats = await res.json()
        if (!cancelled) setStats(data)
      } catch {
        // silently ignore — fallback values used
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return stats
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CtaBanner() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()
  const { status, user } = useAuthStore()
  const openAuth = useUIStore((s) => s.openAuth)
  const stats = usePublicStats()

  const isClient = status === "authenticated" && user?.role === "CLIENT"
  const isProvider = status === "authenticated" && user?.role === "PROVIDER"
  const isVisitor = status !== "authenticated"

  // Visitor tab state
  const [visitorTab, setVisitorTab] = React.useState<VisitorTab>("client")

  // Animated count for totalUsers
  const totalUsersValue = stats?.totalUsers ?? 527
  const { ref: countRef, value: displayedUsers } = useCountUp(totalUsersValue, {
    duration: 2000,
    startOnView: true,
  })

  // Derive benefits and CTAs based on active tab (for visitors) or auth role
  const activeBenefits = isVisitor
    ? visitorTab === "client"
      ? CLIENT_BENEFITS
      : PROVIDER_BENEFITS
    : isProvider
      ? PROVIDER_BENEFITS
      : CLIENT_BENEFITS

  return (
    <section className="relative isolate overflow-hidden bg-background py-16 sm:py-20">
      <div ref={ref} className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.98 }}
          animate={visible ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-6 py-12 text-white shadow-2xl sm:px-12 sm:py-16"
        >
          {/* Animated mesh blobs */}
          <MeshBlobs />

          {/* Grid pattern */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />

          {/* Floating icons with parallax-like movement */}
          {FLOATING_ICONS.map((item, i) => (
            <FloatingIcon key={i} {...item} />
          ))}

          <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
            {/* Left: copy + CTA */}
            <div>
              {/* Top badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur ring-1 ring-white/20">
                  <Sparkles className="size-3.5" />
                  Comece agora mesmo
                </span>
                {stats && stats.recentSignups24h > 0 && (
                  <LiveCounter count={stats.recentSignups24h} />
                )}
              </div>

              <h2 className="mt-4 text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                {isVisitor &&
                  (visitorTab === "client"
                    ? "Pronto para encontrar o prestador ideal?"
                    : "Pronto para grow no seu negócio?")}
                {isClient && "Encontre o serviço que você precisa"}
                {isProvider && "Comece a receber orçamentos hoje"}
                {!isVisitor && !isClient && !isProvider &&
                  "Pronto para começar?"}
              </h2>

              <p className="mt-3 max-w-xl text-pretty text-emerald-50/90">
                {isVisitor &&
                  (visitorTab === "client"
                    ? "Comece em 30 segundos — é como pedir um Uber, mas para serviços. Cadastre-se gratuitamente e tenha acesso a prestadores verificados."
                    : "Cadastre seus serviços, defina sua área de atendimento e comece a receber solicitações de clientes na sua região. Sem taxa de adesão.")}
                {isClient &&
                  "Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar."}
                {isProvider &&
                  "Cadastre seus serviços, defina sua área de atendimento e comece a receber solicitações de clientes na sua região."}
              </p>

              {/* Visitor tab toggle */}
              {isVisitor && (
                <div className="mt-5 inline-flex rounded-lg bg-white/10 p-1 ring-1 ring-white/15 backdrop-blur">
                  <button
                    onClick={() => setVisitorTab("client")}
                    className={cn(
                      "relative rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                      visitorTab === "client"
                        ? "text-emerald-900"
                        : "text-white/70 hover:text-white",
                    )}
                  >
                    {visitorTab === "client" && (
                      <motion.div
                        layoutId="visitor-tab"
                        className="absolute inset-0 rounded-md bg-white shadow-sm"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                      />
                    )}
                    <span className="relative z-10">Para clientes</span>
                  </button>
                  <button
                    onClick={() => setVisitorTab("provider")}
                    className={cn(
                      "relative rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                      visitorTab === "provider"
                        ? "text-emerald-900"
                        : "text-white/70 hover:text-white",
                    )}
                  >
                    {visitorTab === "provider" && (
                      <motion.div
                        layoutId="visitor-tab"
                        className="absolute inset-0 rounded-md bg-white shadow-sm"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                      />
                    )}
                    <span className="relative z-10">Para prestadores</span>
                  </button>
                </div>
              )}

              {/* Benefits list */}
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={isVisitor ? visitorTab : (isProvider ? "provider" : "client")}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.25 }}
                    className="flex flex-wrap gap-x-5 gap-y-2"
                  >
                    {activeBenefits.map((benefit) => (
                      <li
                        key={benefit}
                        className="flex items-center gap-1.5 text-sm text-emerald-50"
                      >
                        <CheckCircle2 className="size-4 text-emerald-300" />
                        {benefit}
                      </li>
                    ))}
                  </motion.div>
                </AnimatePresence>
              </ul>

              {/* CTAs */}
              <div className="mt-7 flex flex-wrap items-center gap-3">
                {isVisitor && (
                  <>
                    <PulsingGlow>
                      <motion.div
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 400, damping: 17 }}
                      >
                        <Button
                          size="lg"
                          onClick={() =>
                            openAuth(
                              "register",
                              visitorTab === "provider" ? "PROVIDER" : "CLIENT",
                            )
                          }
                          className="h-12 gap-2 bg-white px-7 text-base font-semibold text-emerald-700 shadow-lg hover:bg-emerald-50 hover:shadow-xl"
                        >
                          {visitorTab === "client"
                            ? "Cadastrar grátis"
                            : "Cadastrar como prestador"}
                          <motion.span
                            animate={{ x: [0, 4, 0] }}
                            transition={{ duration: 1.5, repeat: Infinity, repeatType: "reverse", ease: [0.42, 0, 0.58, 1] }}
                          >
                            <ArrowRight className="size-4" />
                          </motion.span>
                        </Button>
                      </motion.div>
                    </PulsingGlow>
                    {visitorTab === "client" && (
                      <motion.div
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 400, damping: 17 }}
                      >
                        <Button
                          size="lg"
                          variant="outline"
                          onClick={() => openAuth("register", "PROVIDER")}
                          className="h-12 gap-2 border-white/30 bg-white/10 px-6 text-base font-medium text-white backdrop-blur hover:bg-white/20 hover:text-white"
                        >
                          <Wrench className="size-4" />
                          Sou prestador
                        </Button>
                      </motion.div>
                    )}
                    {visitorTab === "provider" && (
                      <motion.div
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 400, damping: 17 }}
                      >
                        <Button
                          size="lg"
                          variant="outline"
                          onClick={() => openAuth("register", "CLIENT")}
                          className="h-12 gap-2 border-white/30 bg-white/10 px-6 text-base font-medium text-white backdrop-blur hover:bg-white/20 hover:text-white"
                        >
                          <Search className="size-4" />
                          Sou cliente
                        </Button>
                      </motion.div>
                    )}
                  </>
                )}
                {isClient && (
                  <PulsingGlow>
                    <motion.div
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Button
                        size="lg"
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            document
                              .getElementById("vitrine-resultados")
                              ?.scrollIntoView({ behavior: "smooth" })
                          }
                        }}
                        className="h-12 gap-2 bg-white px-7 text-base font-semibold text-emerald-700 shadow-lg hover:bg-emerald-50 hover:shadow-xl"
                      >
                        <Search className="size-4" />
                        Buscar prestadores
                        <motion.span
                          animate={{ x: [0, 4, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity, repeatType: "reverse", ease: [0.42, 0, 0.58, 1] }}
                        >
                          <ArrowRight className="size-4" />
                        </motion.span>
                      </Button>
                    </motion.div>
                  </PulsingGlow>
                )}
                {isProvider && (
                  <PulsingGlow>
                    <motion.div
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Button
                        size="lg"
                        onClick={() => openAuth("login")}
                        className="h-12 gap-2 bg-white px-7 text-base font-semibold text-emerald-700 shadow-lg hover:bg-emerald-50 hover:shadow-xl"
                      >
                        Ir para meu painel
                        <motion.span
                          animate={{ x: [0, 4, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity, repeatType: "reverse", ease: [0.42, 0, 0.58, 1] }}
                        >
                          <ArrowRight className="size-4" />
                        </motion.span>
                      </Button>
                    </motion.div>
                  </PulsingGlow>
                )}
              </div>

              {/* Urgency element */}
              {isVisitor && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={visible ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.6, duration: 0.4 }}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/30 px-3 py-1 text-xs font-medium text-emerald-100 ring-1 ring-emerald-400/20"
                >
                  <Timer className="size-3.5" />
                  Comece em 30 segundos
                </motion.div>
              )}

              {/* "Já tenho conta" link — more prominent */}
              {isVisitor && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={visible ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.7, duration: 0.4 }}
                >
                  <button
                    onClick={() => openAuth("login")}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur-sm transition-all hover:bg-white/20 hover:ring-white/30"
                  >
                    <LogIn className="size-4" />
                    Já tenho conta · Entrar
                  </button>
                </motion.div>
              )}

              {/* Avatar stack social proof — dynamic stats */}
              {isVisitor && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={visible ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.5, duration: 0.4 }}
                  className="mt-5 flex items-center gap-3"
                >
                  <AvatarStack />
                  <div>
                    <p className="text-sm font-medium text-white">
                      <span ref={countRef}>{displayedUsers}</span>+ cadastrados
                    </p>
                    <p className="text-[11px] text-emerald-100/70">
                      na plataforma
                    </p>
                  </div>
                  {stats && stats.avgRating > 0 && (
                    <div className="ml-2 flex items-center gap-1 text-xs text-emerald-200">
                      <Star className="size-3.5 fill-amber-400 text-amber-400" />
                      {stats.avgRating}
                    </div>
                  )}
                </motion.div>
              )}
            </div>

            {/* Right: "O que vem depois?" steps — glassmorphism */}
            <div className="relative hidden lg:block">
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={visible ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl bg-white/[0.08] p-6 backdrop-blur-xl ring-1 ring-white/[0.12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
              >
                <h3 className="text-sm font-semibold text-emerald-100">
                  O que vem depois?
                </h3>
                <p className="mt-1 text-xs text-emerald-100/60">
                  Três passos simples e você estará agendando
                </p>

                <div className="mt-5 relative">
                  {/* Vertical dotted connector */}
                  <div
                    aria-hidden
                    className="absolute left-5 top-6 h-[calc(100%-2rem)] w-px border-l-2 border-dashed border-white/20"
                  />

                  <div className="space-y-5">
                    {SIGNUP_STEPS.map((step, i) => {
                      const StepIcon = step.icon
                      return (
                        <motion.div
                          key={step.label}
                          initial={{ opacity: 0, x: 12 }}
                          animate={visible ? { opacity: 1, x: 0 } : {}}
                          transition={{
                            duration: 0.4,
                            delay: 0.4 + i * 0.12,
                          }}
                          className="flex items-start gap-3"
                        >
                          {/* Step number circle */}
                          <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]">
                            <StepIcon className="size-4 text-white" />
                          </div>
                          <div className="pt-1">
                            <p className="text-sm font-medium text-white">
                              {step.label}
                            </p>
                            <p className="mt-0.5 text-xs text-emerald-100/60">
                              ~{step.time}
                            </p>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>
                </div>

                {/* Learn more link */}
                <a
                  href="#faq"
                  className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-emerald-200 hover:text-white transition-colors"
                >
                  <ShieldCheck className="size-3" />
                  Saiba mais sobre pagamento protegido
                </a>
              </motion.div>
            </div>
          </div>

          {/* Bottom trust strip — improved with icons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={visible ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.8, duration: 0.5 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-4 border-t border-white/10 pt-6 sm:gap-6"
          >
            {TRUST_SIGNS.map((sign) => {
              const SignIcon = sign.icon
              return (
                <span
                  key={sign.label}
                  className="inline-flex items-center gap-1.5 text-xs text-emerald-100/70"
                >
                  <SignIcon className="size-3.5 text-emerald-300" />
                  {sign.label}
                </span>
              )
            })}
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
