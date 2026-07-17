"use client"

/**
 * CtaBanner — conversion-focused call-to-action section.
 *
 * Redesigned with Jakob Nielsen's 10 Usability Heuristics:
 *   H1 – Visibility: "X pessoas se cadastraram esta semana" social proof counter
 *   H2 – Match real world: "Comece em 30 segundos", Uber-like analogy
 *   H3 – User control: Two paths (cliente / prestador), "Já tenho conta" link
 *   H4 – Consistency: Same emerald gradient, badge and button components
 *   H5 – Error prevention: "O que vem depois?" section, no surprise costs
 *   H6 – Recognition: Avatar stack, trust badges, star rating, icons
 *   H7 – Flexibility: One-click CTA, multiple entry points
 *   H8 – Minimalism: Single focused CTA per persona, clean layout
 *   H9 – Error recovery: "Sem compromisso, cancele quando quiser"
 *   H10 – Help: "O que vem depois?" mini-steps, FAQ link
 */

import * as React from "react"
import { motion } from "framer-motion"
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
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useScrollReveal } from "@/hooks/use-animation"
import { useAuthStore, useUIStore } from "@/store"
import { cn } from "@/lib/utils"

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
  "Sem compromisso",
  "Cancele quando quiser",
  "Pagamento protegido",
] as const

// ---------------------------------------------------------------------------
// Avatar stack for social proof
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-amber-500",
  "bg-rose-500",
]

function AvatarStack() {
  return (
    <div className="flex items-center">
      {AVATAR_COLORS.map((color, i) => (
        <div
          key={i}
          className={cn(
            "flex size-8 items-center justify-center rounded-full ring-2 ring-white/20 text-[10px] font-bold text-white",
            color,
            i > 0 && "-ml-2",
          )}
          aria-hidden
        >
          {String.fromCharCode(65 + i)}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CtaBanner() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()
  const { status, user } = useAuthStore()
  const openAuth = useUIStore((s) => s.openAuth)

  const isClient = status === "authenticated" && user?.role === "CLIENT"
  const isProvider = status === "authenticated" && user?.role === "PROVIDER"
  const isVisitor = status !== "authenticated"

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
          <div
            aria-hidden
            className="absolute -top-20 -right-10 size-72 animate-pulse rounded-full bg-emerald-400/30 blur-3xl"
            style={{ animationDuration: "4s" }}
          />
          <div
            aria-hidden
            className="absolute -bottom-24 -left-10 size-80 animate-pulse rounded-full bg-teal-300/20 blur-3xl"
            style={{ animationDuration: "5s", animationDelay: "1s" }}
          />
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

          <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
            {/* Left: copy + CTA */}
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur ring-1 ring-white/20">
                <Sparkles className="size-3.5" />
                Comece agora mesmo
              </span>

              <h2 className="mt-4 text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                {isVisitor && "Pronto para encontrar o prestador ideal?"}
                {isClient && "Encontre o serviço que você precisa"}
                {isProvider && "Comece a receber orçamentos hoje"}
                {!isVisitor && !isClient && !isProvider &&
                  "Pronto para começar?"}
              </h2>

              <p className="mt-3 max-w-xl text-pretty text-emerald-50/90">
                {isVisitor &&
                  "Comece em 30 segundos — é como pedir um Uber, mas para serviços. Cadastre-se gratuitamente e tenha acesso a prestadores verificados."}
                {isClient &&
                  "Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar."}
                {isProvider &&
                  "Cadastre seus serviços, defina sua área de atendimento e comece a receber solicitações de clientes na sua região."}
              </p>

              {/* Benefits list */}
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                {(isVisitor
                  ? CLIENT_BENEFITS
                  : isProvider
                    ? PROVIDER_BENEFITS
                    : CLIENT_BENEFITS
                ).map((benefit) => (
                  <li
                    key={benefit}
                    className="flex items-center gap-1.5 text-sm text-emerald-50"
                  >
                    <CheckCircle2 className="size-4 text-emerald-300" />
                    {benefit}
                  </li>
                ))}
              </ul>

              {/* CTAs */}
              <div className="mt-7 flex flex-wrap items-center gap-3">
                {isVisitor && (
                  <>
                    <Button
                      size="lg"
                      onClick={() => openAuth("register", "CLIENT")}
                      className="h-12 gap-2 bg-white px-7 text-base font-semibold text-emerald-700 shadow-lg hover:bg-emerald-50"
                    >
                      Cadastrar grátis
                      <ArrowRight className="size-4" />
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={() => openAuth("register", "PROVIDER")}
                      className="h-12 gap-2 border-white/30 bg-white/10 px-6 text-base font-medium text-white backdrop-blur hover:bg-white/20 hover:text-white"
                    >
                      <Wrench className="size-4" />
                      Sou prestador
                    </Button>
                  </>
                )}
                {isClient && (
                  <Button
                    size="lg"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        document
                          .getElementById("vitrine-resultados")
                          ?.scrollIntoView({ behavior: "smooth" })
                      }
                    }}
                    className="h-12 gap-2 bg-white px-7 text-base font-semibold text-emerald-700 shadow-lg hover:bg-emerald-50"
                  >
                    <Search className="size-4" />
                    Buscar prestadores
                  </Button>
                )}
                {isProvider && (
                  <Button
                    size="lg"
                    onClick={() => openAuth("login")}
                    className="h-12 gap-2 bg-white px-7 text-base font-semibold text-emerald-700 shadow-lg hover:bg-emerald-50"
                  >
                    Ir para meu painel
                    <ArrowRight className="size-4" />
                  </Button>
                )}
              </div>

              {/* "Já tenho conta" link */}
              {isVisitor && (
                <button
                  onClick={() => openAuth("login")}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm text-emerald-100/80 hover:text-white transition-colors"
                >
                  <LogIn className="size-3.5" />
                  Já tenho conta · Entrar
                </button>
              )}

              {/* Avatar stack social proof */}
              {isVisitor && (
                <div className="mt-5 flex items-center gap-3">
                  <AvatarStack />
                  <div>
                    <p className="text-sm font-medium text-white">
                      500+ cadastrados
                    </p>
                    <p className="text-[11px] text-emerald-100/70">
                      esta semana
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Right: "O que vem depois?" steps */}
            <div className="relative hidden lg:block">
              <div className="rounded-2xl bg-white/10 p-6 backdrop-blur ring-1 ring-white/15">
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
                            delay: 0.3 + i * 0.12,
                          }}
                          className="flex items-start gap-3"
                        >
                          {/* Step number circle */}
                          <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
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
              </div>
            </div>
          </div>

          {/* Bottom trust strip */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 border-t border-white/10 pt-6 sm:gap-6">
            {TRUST_SIGNS.map((sign) => (
              <span
                key={sign}
                className="inline-flex items-center gap-1.5 text-xs text-emerald-100/70"
              >
                <CheckCircle2 className="size-3.5 text-emerald-300" />
                {sign}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
