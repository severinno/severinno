"use client"

import * as React from "react"
import { MapPin, Star, ShieldCheck, Clock, ArrowRight, Camera, Award } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRegionalContext } from "@/hooks/use-regional-context"

interface NeighborhoodFeedShowcaseProps {
  onQuoteService?: (serviceName: string, neighborhood: string) => void
  className?: string
}

interface CompletedJobItem {
  id: string
  title: string
  category: string
  neighborhood: string
  completionTimeAgo: string
  rating: number
  reviewExcerpt: string
  clientName: string
  providerName: string
  providerRole: string
  providerAvatarBg: string
  pricePaid: string
  warrantyDays: number
  imageUrl: string
}

const SAMPLE_COMPLETED_JOBS: Omit<CompletedJobItem, "neighborhood">[] = [
  {
    id: "job-1",
    title: "Instalação de Ar-Condicionado Split Inverter",
    category: "Refrigeração",
    completionTimeAgo: "Concluído há 1 dia",
    rating: 5.0,
    reviewExcerpt:
      "Serviço impecável! Deixou tudo limpinho, furou na vácuo e testou o dreno. Pagamento na custódia deu total tranquilidade.",
    clientName: "Patrícia M.",
    providerName: "Roberto F.",
    providerRole: "Técnico Certificado em Ar e Refrigeração",
    providerAvatarBg: "from-blue-600 to-indigo-600",
    pricePaid: "R$ 380,00",
    warrantyDays: 90,
    imageUrl:
      "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "job-2",
    title: "Reforma Completa de Quadro de Disjuntores & DPS",
    category: "Elétrica",
    completionTimeAgo: "Concluído há 2 dias",
    rating: 5.0,
    reviewExcerpt:
      "O disjuntor desarmava direto com o chuveiro ligado. O eletricista reorganizou as fases e instalou proteção contra raios. Nota 10!",
    clientName: "Carlos Eduardo S.",
    providerName: "Alexandre G.",
    providerRole: "Eletricista Industrial e Predial",
    providerAvatarBg: "from-amber-600 to-orange-600",
    pricePaid: "R$ 320,00",
    warrantyDays: 90,
    imageUrl:
      "https://images.unsplash.com/photo-1544725176-7c40e5a71c5e?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "job-3",
    title: "Conserto de Vazamento Oculto e Troca de Registro",
    category: "Hidráulica",
    completionTimeAgo: "Concluído há 3 dias",
    rating: 4.9,
    reviewExcerpt:
      "Achou o cano trincado na parede sem quebrar azulejo à toa com o aparelho geofone. Muito profissional e pontual.",
    clientName: "Renata A.",
    providerName: "Cláudio H.",
    providerRole: "Encanador Especialista em Caça-Vazamentos",
    providerAvatarBg: "from-cyan-600 to-blue-600",
    pricePaid: "R$ 250,00",
    warrantyDays: 90,
    imageUrl:
      "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "job-4",
    title: "Higienização Profunda e Impermeabilização de Sofá",
    category: "Limpeza",
    completionTimeAgo: "Concluído há 2 dias",
    rating: 5.0,
    reviewExcerpt:
      "Tirou todas as manchas do estofado e o cheiro ficou maravilhoso. Secou rápido e o atendimento foi nota mil.",
    clientName: "Juliana V.",
    providerName: "Tatiane M.",
    providerRole: "Especialista em Estofados e Carpetes",
    providerAvatarBg: "from-emerald-600 to-teal-600",
    pricePaid: "R$ 190,00",
    warrantyDays: 60,
    imageUrl:
      "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=600&q=80",
  },
]

export function NeighborhoodFeedShowcase({
  onQuoteService,
  className,
}: NeighborhoodFeedShowcaseProps) {
  const regional = useRegionalContext()
  const context = regional?.context
  const city = context?.city || "Governador Valadares"
  const rawNeighborhoods = context?.neighborhoods
  const availableNeighborhoods: string[] = React.useMemo(() => {
    return (rawNeighborhoods || ["Centro", "Ilha dos Araújos", "Grã-Duquesa"]).slice(0, 5)
  }, [rawNeighborhoods])

  const [activeDistrict, setActiveDistrict] = React.useState<string>("Todos")

  const jobsWithNeighborhoods = React.useMemo(() => {
    return SAMPLE_COMPLETED_JOBS.map((job, idx) => ({
      ...job,
      neighborhood: availableNeighborhoods[idx % availableNeighborhoods.length] || "Centro",
    }))
  }, [availableNeighborhoods])

  const filteredJobs = React.useMemo(() => {
    if (activeDistrict === "Todos") return jobsWithNeighborhoods
    return jobsWithNeighborhoods.filter((j) => j.neighborhood === activeDistrict)
  }, [jobsWithNeighborhoods, activeDistrict])

  return (
    <section
      aria-label="Serviços Concluídos no Seu Bairro"
      className={cn("mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8", className)}
    >
      {/* Section Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <div className="border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold">
            <Camera className="size-3.5" />
            <span>Feed Hiperlocal de Entregas Reais</span>
          </div>
          <h2 className="text-foreground text-2xl font-black tracking-tight sm:text-3xl">
            Serviços Concluídos Recentemente em {city}
          </h2>
          <p className="text-muted-foreground text-xs sm:text-sm">
            Veja o que seus vizinhos andam contratando com laudo fotográfico, pagamento protegido na
            custódia e garantia de 90 dias.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveDistrict("Todos")}
            className={cn(
              "rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
              activeDistrict === "Todos"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border-border/80 bg-background text-muted-foreground hover:bg-muted/60 border",
            )}
          >
            Todos os Bairros
          </button>
          {availableNeighborhoods.map((district) => (
            <button
              key={district}
              type="button"
              onClick={() => setActiveDistrict(district)}
              className={cn(
                "flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                activeDistrict === district
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border-border/80 bg-background text-muted-foreground hover:bg-muted/60 border",
              )}
            >
              <MapPin className="size-3" />
              <span>{district}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Feed Cards */}
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {filteredJobs.map((job) => (
          <div
            key={job.id}
            className="group border-border/80 bg-card hover:border-primary/40 relative flex flex-col overflow-hidden rounded-2xl border shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
          >
            {/* Card Image */}
            <div className="bg-muted relative aspect-4/3 w-full overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={job.imageUrl}
                alt={job.title}
                loading="lazy"
                className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

              {/* Top Badges */}
              <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
                <span className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-md">
                  <MapPin className="text-primary size-3" />
                  <span>{job.neighborhood}</span>
                </span>
              </div>

              <div className="absolute top-2.5 right-2.5">
                <span className="flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-extrabold text-white backdrop-blur-md">
                  <ShieldCheck className="size-3" />
                  <span>Protegido</span>
                </span>
              </div>

              {/* Bottom Image Overlay Info */}
              <div className="absolute right-3 bottom-3 left-3 flex items-center justify-between text-white">
                <span className="flex items-center gap-1 text-[11px] font-semibold text-zinc-300">
                  <Clock className="size-3 text-zinc-400" />
                  {job.completionTimeAgo}
                </span>
                <span className="text-xs font-black text-emerald-400">{job.pricePaid}</span>
              </div>
            </div>

            {/* Card Content */}
            <div className="flex flex-1 flex-col justify-between p-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-primary text-[11px] font-extrabold tracking-wider uppercase">
                    {job.category}
                  </span>
                  <div className="flex items-center gap-1 text-amber-500">
                    <Star className="size-3.5 fill-amber-500" />
                    <span className="text-foreground text-xs font-bold">
                      {job.rating.toFixed(1)}
                    </span>
                  </div>
                </div>

                <h3 className="text-foreground group-hover:text-primary line-clamp-2 text-sm font-bold transition-colors">
                  {job.title}
                </h3>

                <p className="text-muted-foreground line-clamp-2 text-xs italic">
                  &ldquo;{job.reviewExcerpt}&rdquo;
                </p>
              </div>

              {/* Provider Info & Action */}
              <div className="mt-4 space-y-3 border-t pt-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-xs",
                      job.providerAvatarBg,
                    )}
                  >
                    {job.providerName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-foreground truncate text-xs font-bold">
                        {job.providerName}
                      </span>
                      <Award className="text-primary size-3 shrink-0" />
                    </div>
                    <span className="text-muted-foreground block truncate text-[10px]">
                      {job.providerRole}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onQuoteService?.(job.title, job.neighborhood)}
                  className="bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition-all active:scale-95"
                >
                  <span>Pedir Orçamento Igual</span>
                  <ArrowRight className="size-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
