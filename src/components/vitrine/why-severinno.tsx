"use client"

/**
 * WhySeverinno — Trust pillars and platform stats.
 * Clean 2x3 grid of value propositions with live stats strip.
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { ShieldCheck, Wallet, Clock, Star, MapPin, Headphones } from "lucide-react"

import { apiGet } from "@/lib/api"
import { useCountUp } from "@/hooks/use-animation"

import { Skeleton } from "@/components/ui/skeleton"

type PublicStats = {
  providers: number
  services: number
  reviews: number
  completedBookings: number
  avgRating: number
}

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Prestadores verificados",
    description:
      "Todos os prestadores passam por verificação de identidade, endereço e telefone antes de serem listados.",
  },
  {
    icon: Wallet,
    title: "Pagamento protegido",
    description:
      "Seu dinheiro fica retido em garantia e é liberado apenas após você confirmar que ficou satisfeito.",
  },
  {
    icon: Clock,
    title: "Resposta rápida",
    description:
      "Prestadores comprometidos com tempo de resposta de até 24h. Acompanhe o status em tempo real.",
  },
  {
    icon: Star,
    title: "Avaliações reais",
    description:
      "Apenas clientes que concluíram o serviço podem avaliar. Zero avaliações falsas, sistema anti-fraude.",
  },
  {
    icon: MapPin,
    title: "Próximo de você",
    description:
      "Geolocalização inteligente exibe os melhores prestadores na sua região com filtro de raio configurável.",
  },
  {
    icon: Headphones,
    title: "Suporte humano",
    description:
      "Equipe dedicada para mediar disputas, tirar dúvidas e garantir uma experiência justa para todos.",
  },
]

function StatCounter({
  value,
  suffix = "",
  decimals = 0,
}: {
  value: number
  suffix?: string
  decimals?: number
}) {
  const { ref, value: count } = useCountUp(value, { duration: 1500, decimals })
  return (
    <span ref={ref} className="text-2xl font-bold tracking-tight tabular-nums">
      {decimals > 0 ? count.toFixed(decimals) : count.toLocaleString("pt-BR")}
      {suffix}
    </span>
  )
}

export default function WhySeverinno() {
  const { data: stats, isLoading } = useQuery<PublicStats>({
    queryKey: ["public-stats"],
    queryFn: () => apiGet<PublicStats>("/api/stats"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  return (
    <section className="border-border/40 bg-muted/20 border-t py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <p className="text-primary mb-3 text-xs font-semibold tracking-widest uppercase">
            Por que a Severinno
          </p>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Construído para ser confiável
          </h2>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed">
            Cada funcionalidade existe para proteger clientes e valorizar prestadores.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div
                key={f.title}
                className="group border-border/50 bg-card rounded-2xl border p-6 transition-shadow hover:shadow-sm"
              >
                <div className="bg-primary/8 text-primary ring-primary/15 mb-4 inline-flex size-10 items-center justify-center rounded-xl ring-1">
                  <Icon className="size-5" />
                </div>
                <h3 className="mb-2 text-sm font-semibold">{f.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{f.description}</p>
              </div>
            )
          })}
        </div>

        {/* Stats Strip */}
        {(isLoading || stats) && (
          <div className="border-border/40 bg-border/40 mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border sm:grid-cols-4">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-card flex flex-col items-center gap-1 p-6">
                    <Skeleton className="mb-1 h-7 w-20" />
                    <Skeleton className="h-3.5 w-28" />
                  </div>
                ))
              : stats && (
                  <>
                    <StatCell value={stats.providers} label="Prestadores verificados" />
                    <StatCell value={stats.services} label="Serviços cadastrados" />
                    <StatCell value={stats.completedBookings} label="Serviços concluídos" />
                    <StatCell value={stats.avgRating} decimals={1} suffix="/5" label="Nota média" />
                  </>
                )}
          </div>
        )}
      </div>
    </section>
  )
}

function StatCell({
  value,
  label,
  suffix = "",
  decimals = 0,
}: {
  value: number
  label: string
  suffix?: string
  decimals?: number
}) {
  return (
    <div className="bg-card flex flex-col items-center gap-0.5 px-4 py-6 text-center">
      <StatCounter value={value} suffix={suffix} decimals={decimals} />
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  )
}
