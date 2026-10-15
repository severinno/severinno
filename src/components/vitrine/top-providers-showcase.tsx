"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Trophy,
  BadgeCheck,
  Star,
  MapPin,
  ShieldCheck,
  CheckCircle2,
  CalendarCheck,
  ArrowRight,
  FileBadge,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { VitrineHighlightsResponse } from "@/app/api/vitrine/highlights/route"

export type TopProvidersShowcaseProps = {
  onViewProvider: (providerId: string) => void
  onQuote: (providerId: string) => void
  className?: string
}

export function TopProvidersShowcase({
  onViewProvider,
  onQuote,
  className,
}: TopProvidersShowcaseProps) {
  const { data, isLoading } = useQuery<VitrineHighlightsResponse>({
    queryKey: ["vitrine-highlights"],
    queryFn: () => apiGet<VitrineHighlightsResponse>("/api/vitrine/highlights"),
    staleTime: 60 * 1000,
  })

  const providers = data?.featuredProviders ?? []

  if (isLoading) {
    return (
      <section className={cn("bg-muted/10 py-12", className)}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Skeleton className="mb-3 h-8 w-64" />
          <Skeleton className="mb-8 h-4 w-96" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-80 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (providers.length === 0) {
    return null
  }

  return (
    <section className={cn("bg-muted/15 border-border/40 border-b py-12", className)}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <Trophy className="size-3.5 text-amber-500" />
              <span>Destaques de Confiança em Governador Valadares</span>
            </div>
            <h2 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
              Prestadores Mais Requisitados da Cidade
            </h2>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Profissionais com antecedentes checados, histórico de excelência e centenas de
              atendimentos sem reclamações.
            </p>
          </div>

          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span className="text-foreground inline-flex items-center gap-1 font-semibold">
              <FileBadge className="size-4 text-emerald-600" />
              100% Antecedentes Checados
            </span>
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {providers.map((provider) => {
            return (
              <div
                key={provider.id}
                className="group border-border/60 bg-card hover:border-primary/50 relative flex flex-col justify-between rounded-2xl border p-5 shadow-xs transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
              >
                <div>
                  {/* Avatar & Badges */}
                  <div className="mb-4 flex items-start justify-between gap-2">
                    <div className="relative">
                      <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-xl font-extrabold text-white shadow-md">
                        {provider.name.charAt(0)}
                      </div>
                      <div
                        title="Identidade & Documentos Verificados"
                        className="ring-card absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs ring-2"
                      >
                        <BadgeCheck className="size-3.5" />
                      </div>
                    </div>

                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                      <Star className="size-3 fill-amber-500" />
                      <span>{provider.avgRating.toFixed(1)}</span>
                      <span className="text-muted-foreground">({provider.reviewCount})</span>
                    </span>
                  </div>

                  {/* Name & Location */}
                  <h3 className="text-foreground group-hover:text-primary line-clamp-1 text-base font-bold transition-colors">
                    {provider.name}
                  </h3>

                  <div className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                    <MapPin className="text-primary size-3 shrink-0" />
                    <span className="truncate">
                      {provider.district ? `${provider.district}, GV` : "Governador Valadares"}
                    </span>
                  </div>

                  {/* Trust pills */}
                  <div className="mt-3 flex flex-wrap gap-1">
                    <span className="flex items-center gap-1 rounded-md border border-emerald-200/60 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <ShieldCheck className="size-3" />
                      Antecedentes OK
                    </span>
                    <span className="bg-muted/60 text-muted-foreground border-border/40 flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium">
                      <CalendarCheck className="size-3" />
                      {provider.completedBookingsCount}+ serviços
                    </span>
                  </div>

                  {/* Main Service */}
                  {provider.topServiceTitle && (
                    <div className="bg-muted/30 border-border/30 mt-3.5 rounded-xl border p-2 text-xs">
                      <p className="text-muted-foreground text-[10px] font-medium">
                        Especialidade em destaque:
                      </p>
                      <p className="text-foreground mt-0.5 truncate font-semibold">
                        {provider.topServiceTitle}
                      </p>
                      <p className="text-primary mt-0.5 text-[11px] font-extrabold">
                        A partir de R$ {provider.topServicePrice}
                      </p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="border-border/40 mt-5 flex flex-col gap-2 border-t pt-3">
                  <Button
                    size="sm"
                    onClick={() => onViewProvider(provider.id)}
                    className="flex w-full items-center justify-center gap-1.5 font-bold shadow-xs"
                  >
                    <span>Ver Perfil & Avaliações</span>
                    <ArrowRight className="size-3.5" />
                  </Button>

                  <button
                    type="button"
                    onClick={() => onQuote(provider.id)}
                    className="text-foreground/80 hover:text-foreground bg-muted/60 hover:bg-muted flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                  >
                    <CheckCircle2 className="text-primary size-3.5" />
                    <span>Pedir Orçamento Grátis</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
export default TopProvidersShowcase
