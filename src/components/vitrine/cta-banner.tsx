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
    <section className="border-border/40 bg-background border-t py-20 sm:py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="bg-primary text-primary-foreground overflow-hidden rounded-3xl">
          <div className="px-8 py-12 sm:px-12 sm:py-16">
            {/* Tabs */}
            <div className="mb-8 flex items-center justify-center">
              <div className="inline-flex items-center gap-1 rounded-full bg-white/15 p-1 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => setTab("client")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all",
                    tab === "client"
                      ? "text-primary bg-white shadow-xs"
                      : "text-primary-foreground/80 hover:text-primary-foreground",
                  )}
                >
                  <Search className="size-3.5" />
                  Sou cliente
                </button>
                <button
                  type="button"
                  onClick={() => setTab("provider")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all",
                    tab === "provider"
                      ? "text-primary bg-white shadow-xs"
                      : "text-primary-foreground/80 hover:text-primary-foreground",
                  )}
                >
                  <Wrench className="size-3.5" />
                  Sou prestador
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="text-center">
              {tab === "client" ? (
                <>
                  <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                    Encontre o profissional certo
                  </h2>
                  <p className="text-primary-foreground/80 mt-3 text-base">
                    Prestadores verificados, avaliações reais, pagamento protegido.
                  </p>
                  <ul className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
                    {CLIENT_BENEFITS.map((b) => (
                      <li
                        key={b}
                        className="text-primary-foreground/90 flex items-center gap-2 text-sm"
                      >
                        <CheckCircle2 className="size-4 text-white/70" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                    {isLoggedIn ? (
                      <Button
                        size="lg"
                        className="text-primary rounded-full bg-white font-semibold shadow-sm hover:bg-white/90"
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
                          className="text-primary rounded-full bg-white font-semibold shadow-sm hover:bg-white/90"
                          onClick={() => openAuth("register", "CLIENT")}
                        >
                          Criar conta grátis
                          <ArrowRight className="ml-2 size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="lg"
                          className="text-primary-foreground/80 hover:text-primary-foreground rounded-full hover:bg-white/10"
                          onClick={() => openAuth("login", "CLIENT")}
                        >
                          Já tenho conta
                        </Button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                    Expanda sua clientela
                  </h2>
                  <p className="text-primary-foreground/80 mt-3 text-base">
                    Clientes qualificados prontos para contratar seus serviços.
                  </p>
                  <ul className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
                    {PROVIDER_BENEFITS.map((b) => (
                      <li
                        key={b}
                        className="text-primary-foreground/90 flex items-center gap-2 text-sm"
                      >
                        <CheckCircle2 className="size-4 text-white/70" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                    {isLoggedIn ? (
                      <Button
                        size="lg"
                        className="text-primary rounded-full bg-white font-semibold shadow-sm hover:bg-white/90"
                        onClick={() => openAuth("register", "PROVIDER")}
                      >
                        Ir para meu painel
                        <ArrowRight className="ml-2 size-4" />
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="lg"
                          className="text-primary rounded-full bg-white font-semibold shadow-sm hover:bg-white/90"
                          onClick={() => openAuth("register", "PROVIDER")}
                        >
                          Cadastrar como prestador
                          <ArrowRight className="ml-2 size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="lg"
                          className="text-primary-foreground/80 hover:text-primary-foreground rounded-full hover:bg-white/10"
                          onClick={() => openAuth("login", "PROVIDER")}
                        >
                          Já tenho conta
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
