import { SUPPORT_WHATSAPP } from "@/lib/constants"
;("use client")

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Flame,
  Star,
  CheckCircle2,
  Clock,
  ArrowRight,
  MessageCircle,
  ShieldCheck,
  TrendingUp,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"
import type {
  VitrineHighlightsResponse,
  VitrineTrendingService,
} from "@/app/api/vitrine/highlights/route"

export type TrendingServicesProps = {
  onQuote: (serviceId: string, providerId: string) => void
  onBook: (providerId: string, serviceId?: string) => void
  onViewProvider: (providerId: string) => void
  className?: string
}

export function TrendingServices({
  onQuote: _onQuote,
  onBook,
  onViewProvider,
  className,
}: TrendingServicesProps) {
  const { data, isLoading } = useQuery<VitrineHighlightsResponse>({
    queryKey: ["vitrine-highlights"],
    queryFn: () => apiGet<VitrineHighlightsResponse>("/api/vitrine/highlights"),
    staleTime: 60 * 1000,
  })

  const services = data?.trendingServices ?? []

  const handleWhatsAppInstant = (service: VitrineTrendingService) => {
    const text = `Olá! Vi na Severinno o serviço *${service.title}* em Governador Valadares e gostaria de pedir um orçamento rápido com garantia de custódia.`
    const url = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  if (isLoading) {
    return (
      <section className={cn("bg-background py-12", className)}>
        <div className="mx-auto w-full max-w-[95%] px-2 sm:px-4">
          <Skeleton className="mb-3 h-8 w-64" />
          <Skeleton className="mb-8 h-4 w-96" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-72 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (services.length === 0) {
    return null
  }

  return (
    <section className={cn("bg-background border-border/40 border-b py-12", className)}>
      <div className="mx-auto w-full max-w-[95%] px-2 sm:px-4">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-400">
              <Flame className="size-3.5 fill-amber-500" />
              <span>Mais Procurados da Semana em Governador Valadares</span>
            </div>
            <h2 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
              Serviços Mais Contratados da Cidade
            </h2>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Preços médios transparentes, atendimento rápido e 100% de proteção com a Garantia de
              Custódia Severinno.
            </p>
          </div>

          <div className="text-muted-foreground hidden items-center gap-2 text-xs sm:flex">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Sem adiantamento arriscado
            </span>
            <span className="mx-1">•</span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="text-primary size-4" />
              Dinheiro seguro no Escrow
            </span>
          </div>
        </div>

        {/* Grid de Serviços */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {services.map((service) => {
            return (
              <div
                key={service.id}
                className="group border-border/60 bg-card hover:border-primary/40 relative flex flex-col justify-between rounded-2xl border p-5 shadow-xs transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
              >
                <div>
                  {/* Badge & Category */}
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                      <TrendingUp className="size-3" />
                      {service.badge}
                    </span>
                    <span className="text-muted-foreground max-w-[120px] truncate text-[11px] font-medium">
                      {service.categoryName}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-foreground group-hover:text-primary text-base leading-snug font-bold transition-colors">
                    {service.title}
                  </h3>

                  {/* Price Banner */}
                  <div className="bg-muted/40 border-border/40 mt-3 flex items-baseline gap-1.5 rounded-xl border p-2.5">
                    <span className="text-muted-foreground text-xs">A partir de</span>
                    <span className="text-foreground text-lg font-extrabold tracking-tight">
                      R$ {service.basePrice}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      /{service.unit || "serviço"}
                    </span>
                  </div>

                  {/* Provider Info */}
                  <div
                    onClick={() => onViewProvider(service.providerId)}
                    className="mt-4 flex cursor-pointer items-center justify-between text-xs transition-opacity hover:opacity-80"
                  >
                    <div className="flex items-center gap-2">
                      <div className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-full text-xs font-bold">
                        {service.providerName.charAt(0)}
                      </div>
                      <div className="max-w-[130px] truncate">
                        <p className="text-foreground truncate font-semibold">
                          {service.providerName}
                        </p>
                        <p className="text-muted-foreground text-[10px]">
                          {service.providerDistrict || "GV"}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 text-xs font-bold text-amber-500">
                      <Star className="size-3.5 fill-amber-500" />
                      <span>{service.providerRating.toFixed(1)}</span>
                      <span className="text-muted-foreground text-[10px]">
                        ({service.providerReviews})
                      </span>
                    </div>
                  </div>

                  <div className="text-muted-foreground mt-2.5 flex items-center gap-1 text-[11px]">
                    <Clock className="size-3 text-emerald-600" />
                    <span>Tempo médio de resposta: ~{service.estimatedMinutes} min</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="border-border/40 mt-5 flex flex-col gap-2 border-t pt-3">
                  <Button
                    size="sm"
                    onClick={() => onBook(service.providerId, service.id)}
                    className="flex w-full items-center justify-center gap-1.5 font-bold shadow-xs"
                  >
                    <span>Contratar Serviço</span>
                    <ArrowRight className="size-3.5" />
                  </Button>

                  <button
                    type="button"
                    onClick={() => handleWhatsAppInstant(service)}
                    className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    <MessageCircle className="size-3.5 text-emerald-600" />
                    <span>Orçar pelo WhatsApp</span>
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
export default TrendingServices
