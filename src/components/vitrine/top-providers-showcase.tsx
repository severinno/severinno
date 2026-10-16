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
  GitCompare,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useCompareStore } from "@/store/compare"
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
      <section className={cn("bg-muted/10 py-10", className)}>
        <div className="mx-auto w-full max-w-[95%] px-2 sm:px-4">
          <Skeleton className="mb-3 h-8 w-64" />
          <Skeleton className="mb-8 h-4 w-96" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-64 w-full rounded-2xl" />
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
    <section className={cn("bg-muted/10 border-border/40 border-b py-10", className)}>
      <div className="mx-auto w-full max-w-[95%] px-2 sm:px-4">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-muted-foreground mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold">
              <Trophy className="size-3.5 text-amber-500" />
              <span>Destaques de Confiança em Governador Valadares</span>
            </div>
            <h2 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
              Prestadores Mais Requisitados da Cidade
            </h2>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Profissionais com antecedentes checados, histórico de excelência e atendimentos sem
              reclamações.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground inline-flex items-center gap-1 font-medium">
              <FileBadge className="size-3.5 text-emerald-600" />
              100% Antecedentes Checados
            </span>
            {providers.length >= 2 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const topIds = providers.slice(0, 3).map((p) => p.id)
                  useCompareStore.getState().setIds(topIds)
                  useCompareStore.getState().openCompare()
                }}
                className="border-border/60 hover:bg-muted/60 cursor-pointer gap-1.5 rounded-xl text-xs font-medium"
              >
                <GitCompare className="text-primary size-3.5" />
                Comparar os Melhores Lado a Lado
              </Button>
            )}
          </div>
        </div>

        {/* Cards Minimalistas */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {providers.map((provider) => {
            return (
              <div
                key={provider.id}
                data-provider-id={provider.id}
                data-compare-name={provider.name}
                className="group border-border/50 bg-card hover:border-border relative flex flex-col justify-between rounded-2xl border p-5 shadow-2xs transition-all duration-200 hover:shadow-md"
              >
                <div>
                  {/* Header Minimalista: Avatar + Nome + Meta Unificada */}
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full text-base font-bold">
                        {provider.name.charAt(0)}
                      </div>
                      <div
                        title="Identidade & Documentos Verificados"
                        className="ring-card absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-600 text-white ring-2"
                      >
                        <BadgeCheck className="size-3" />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3
                        onClick={() => onViewProvider(provider.id)}
                        className="text-foreground hover:text-primary cursor-pointer truncate text-[15px] font-semibold tracking-tight transition-colors"
                      >
                        {provider.name}
                      </h3>

                      <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span className="text-foreground inline-flex items-center gap-1 font-medium">
                          <Star className="size-3.5 fill-amber-400 text-amber-400" />
                          <span>{provider.avgRating.toFixed(1)}</span>
                          <span className="text-muted-foreground font-normal">
                            ({provider.reviewCount})
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-0.5 truncate">
                          <MapPin className="text-muted-foreground/70 size-3 shrink-0" />
                          <span className="truncate">
                            {provider.district ? `${provider.district}, GV` : "GV"}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Especialidade & Preço em Linha Limpa */}
                  {provider.topServiceTitle && (
                    <div className="mt-3.5 flex items-center justify-between gap-2">
                      <span className="bg-muted/50 text-foreground/85 truncate rounded-md px-2 py-0.5 text-[11px] font-medium">
                        {provider.topServiceTitle}
                      </span>
                      {provider.topServicePrice != null && (
                        <span className="text-foreground shrink-0 text-xs font-bold">
                          {formatBRL(provider.topServicePrice)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Linha Sutil de Confiança */}
                  <div className="text-muted-foreground mt-3 flex items-center justify-between text-[11px]">
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="size-3.5 text-emerald-600/80" />
                      <span>Antecedentes OK</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarCheck className="size-3" />
                      <span>{provider.completedBookingsCount}+ serviços</span>
                    </span>
                  </div>
                </div>

                {/* Ações Lado a Lado */}
                <div className="border-border/40 mt-4 flex items-center gap-2 border-t pt-3.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onQuote(provider.id)}
                    className="border-border/60 hover:bg-muted/60 h-9 flex-1 rounded-xl text-xs font-medium"
                  >
                    <CheckCircle2 className="text-primary mr-1 size-3.5" />
                    Orçamento
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => onViewProvider(provider.id)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 flex-1 rounded-xl text-xs font-semibold shadow-2xs"
                  >
                    <span>Ver Perfil & Avaliações</span>
                    <ArrowRight className="ml-1 size-3.5" />
                  </Button>
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
