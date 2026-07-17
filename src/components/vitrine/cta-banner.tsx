"use client"

/**
 * CtaBanner — conversion-focused call-to-action section.
 *
 * Placed between testimonials and FAQ to capture visitors who are
 * warming up but haven't yet registered.
 *
 * Two variants:
 *   - For visitors (not logged in): "Cadastrar grátis" + "Sou prestador"
 *   - For logged-in clients: "Buscar prestadores" + "Ver favoritos"
 *
 * Visual:
 *   - Emerald gradient background with animated mesh blobs
 *   - Decorative grid pattern overlay
 *   - Floating shapes for depth
 *   - Scroll-reveal animation
 */

import * as React from "react"
import { motion } from "framer-motion"
import {
  ArrowRight,
  Wrench,
  Search,
  Heart,
  Sparkles,
  CheckCircle2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useScrollReveal } from "@/hooks/use-animation"
import { useAuthStore, useUIStore } from "@/store"

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
          animate={
            visible ? { opacity: 1, y: 0, scale: 1 } : {}
          }
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

          <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
            {/* Left: copy + CTA */}
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur ring-1 ring-white/20">
                <Sparkles className="size-3.5" />
                Comece agora mesmo
              </span>

              <h2 className="mt-4 text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                {isVisitor &&
                  "Pronto para encontrar o prestador ideal?"}
                {isClient && "Encontre o serviço que você precisa"}
                {isProvider && "Comece a receber orçamentos hoje"}
                {!isVisitor && !isClient && !isProvider &&
                  "Pronto para começar?"}
              </h2>

              <p className="mt-3 max-w-xl text-pretty text-emerald-50/90">
                {isVisitor &&
                  "Cadastre-se gratuitamente e tenha acesso a prestadores verificados, avaliações reais e pagamento protegido. Sem compromisso."}
                {isClient &&
                  "Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar."}
                {isProvider &&
                  "Cadastre seus serviços, defina sua área de atendimento e comece a receber solicitações de clientes na sua região."}
              </p>

              {/* Benefits list */}
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                {(isVisitor ? CLIENT_BENEFITS : isProvider ? PROVIDER_BENEFITS : CLIENT_BENEFITS).map(
                  (benefit) => (
                    <li
                      key={benefit}
                      className="flex items-center gap-1.5 text-sm text-emerald-50"
                    >
                      <CheckCircle2 className="size-4 text-emerald-300" />
                      {benefit}
                    </li>
                  ),
                )}
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
            </div>

            {/* Right: decorative stat / social proof card */}
            <div className="relative hidden lg:block">
              <div className="absolute -right-4 -top-4 size-32 rounded-2xl bg-white/10 backdrop-blur" />
              <div className="absolute -bottom-6 -left-6 size-24 rounded-full bg-emerald-400/30 backdrop-blur" />
              <div className="relative rounded-2xl bg-white/95 p-6 text-slate-900 shadow-xl">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">
                    Selo de confiança
                  </p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="size-3" />
                    Verificado
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-lg font-bold text-white">
                    S
                  </div>
                  <div>
                    <p className="font-semibold leading-tight">
                      Severinno
                    </p>
                    <p className="text-xs text-slate-500">
                      Marketplace de serviços
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-emerald-700">
                      100%
                    </p>
                    <p className="text-xs text-slate-500">
                      Verificados
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-emerald-700">
                      24h
                    </p>
                    <p className="text-xs text-slate-500">
                      Resposta
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-center text-xs text-slate-400">
                  Pagamento protegido · Avaliações reais
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
