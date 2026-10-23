"use client"

/**
 * CtaBanner — Final conversion CTA.
 * Clean emerald gradient banner with dual CTAs (client / provider).
 */

import * as React from "react"
import { ArrowRight, CheckCircle2, Wrench, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuthStore } from "@/store/auth"
import { useUIStore } from "@/store/ui"
import { cn } from "@/lib/utils"

const CLIENT_BENEFITS = ["Cadastro gratuito", "Orçamento sem compromisso", "Pagamento protegido"]
const PROVIDER_BENEFITS = [
  "Receba clientes qualificados",
  "Agenda integrada",
  "Pagamento garantido",
]

export default function CtaBanner() {
  const { user } = useAuthStore()
  const openAuth = useUIStore((s) => s.openAuth)
  const [tab, setTab] = React.useState<"client" | "provider">("client")

  const isLoggedIn = !!user

  return (
    <section className="border-border/40 bg-background border-t py-12 sm:py-16">
      <div className="mx-auto w-full max-w-[95%] px-2 sm:px-4">
        <div className="bg-primary text-primary-foreground overflow-hidden rounded-3xl shadow-lg">
          <div className="grid grid-cols-1 items-center gap-8 px-6 py-10 sm:px-10 sm:py-12 lg:grid-cols-12">
            {/* Coluna Esquerda: Tabs + Headline + Benefícios */}
            <div className="text-center lg:col-span-8 lg:text-left">
              {/* Tabs */}
              <div className="mb-6 flex items-center justify-center lg:justify-start">
                <div className="inline-flex items-center gap-1 rounded-full bg-white/15 p-1 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => setTab("client")}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all",
                      tab === "client"
                        ? "text-primary bg-white shadow-xs"
                        : "text-primary-foreground/90 hover:text-primary-foreground",
                    )}
                  >
                    <Search className="size-3.5" />
                    Sou cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("provider")}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all",
                      tab === "provider"
                        ? "text-primary bg-white shadow-xs"
                        : "text-primary-foreground/90 hover:text-primary-foreground",
                    )}
                  >
                    <Wrench className="size-3.5" />
                    Sou prestador
                  </button>
                </div>
              </div>

              {tab === "client" ? (
                <>
                  <h2 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
                    Encontre o profissional certo
                  </h2>
                  <p className="text-primary-foreground/90 mt-2.5 text-sm sm:text-base">
                    Prestadores verificados, avaliações reais, pagamento protegido em Governador
                    Valadares.
                  </p>
                  <ul className="mt-5 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                    {CLIENT_BENEFITS.map((b) => (
                      <li
                        key={b}
                        className="text-primary-foreground flex items-center gap-2 text-xs font-medium sm:text-sm"
                      >
                        <CheckCircle2 className="size-4 text-white" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
                    Expanda sua clientela
                  </h2>
                  <p className="text-primary-foreground/90 mt-2.5 text-sm sm:text-base">
                    Clientes qualificados prontos para contratar seus serviços na sua região.
                  </p>
                  <ul className="mt-5 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                    {PROVIDER_BENEFITS.map((b) => (
                      <li
                        key={b}
                        className="text-primary-foreground flex items-center gap-2 text-xs font-medium sm:text-sm"
                      >
                        <CheckCircle2 className="size-4 text-white" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {/* Coluna Direita: Bloco de Ação Rápida */}
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/10 p-6 backdrop-blur-xs lg:col-span-4">
              {tab === "client" ? (
                isLoggedIn ? (
                  <Button
                    size="lg"
                    className="text-primary w-full rounded-full bg-white font-semibold shadow-sm hover:bg-white/90"
                    onClick={() => {
                      const el = document.getElementById("vitrine-resultados")
                      el?.scrollIntoView({ behavior: "smooth" })
                    }}
                  >
                    Ver prestadores
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                ) : (
                  <>
                    <Button
                      size="lg"
                      className="text-primary w-full rounded-full bg-white font-semibold shadow-sm hover:bg-white/90"
                      onClick={() => openAuth("register", "CLIENT")}
                    >
                      Criar conta grátis
                      <ArrowRight className="ml-2 size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="lg"
                      className="text-primary-foreground w-full rounded-full hover:bg-white/15"
                      onClick={() => openAuth("login", "CLIENT")}
                    >
                      Já tenho conta
                    </Button>
                  </>
                )
              ) : isLoggedIn ? (
                <Button
                  size="lg"
                  className="text-primary w-full rounded-full bg-white font-semibold shadow-sm hover:bg-white/90"
                  onClick={() => openAuth("register", "PROVIDER")}
                >
                  Ir para meu painel
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              ) : (
                <>
                  <Button
                    size="lg"
                    className="text-primary w-full rounded-full bg-white font-semibold shadow-sm hover:bg-white/90"
                    onClick={() => openAuth("register", "PROVIDER")}
                  >
                    Cadastrar como prestador
                    <ArrowRight className="ml-2 size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="text-primary-foreground w-full rounded-full hover:bg-white/15"
                    onClick={() => openAuth("login", "PROVIDER")}
                  >
                    Já tenho conta
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
