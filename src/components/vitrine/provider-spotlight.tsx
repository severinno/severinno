"use client"

/**
 * ProviderSpotlight — Featured provider spotlight section.
 *
 * Heuristic mapping:
 *   H1  Visibility of system status  → "Destaque da semana" badge, loading skeleton
 *   H2  Match real world             → Real provider info from API, WhatsApp CTA
 *   H3  User control and freedom     → "Pedir orçamento", "Ver perfil completo", "Enviar mensagem" CTAs
 *   H6  Recognition > recall         → Provider avatar with ring, rating, services, social proof
 *   H8  Aesthetic minimalism         → Clean card design, one provider featured, no clutter
 *   H10 Help/documentation           → Links to provider profile, expandable bio
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import Image from "next/image"
import {
  Star,
  BadgeCheck,
  MapPin,
  Calendar,
  ArrowRight,
  User,
  MessageSquareQuote,
  Sparkles,
  Clock,
  Trophy,
  ChevronDown,
  ChevronUp,
  MessageCircle,
} from "lucide-react"
import { motion } from "framer-motion"

import { fetchProviders, type ProviderCard, type ProviderService } from "@/lib/api"
import { useScrollReveal } from "@/hooks/use-animation"
import { useUIStore } from "@/store/ui"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Staggered children animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: "easeOut" as const },
  },
}

// ---------------------------------------------------------------------------
// Helper: response time estimate (simulated based on rating)
// ---------------------------------------------------------------------------

function getResponseTime(rating: number): string {
  if (rating >= 4.8) return "~30min"
  if (rating >= 4.5) return "~1h"
  if (rating >= 4.0) return "~2h"
  return "~3h"
}

export default function ProviderSpotlight() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()
  const openQuote = useUIStore((s) => s.openQuote)
  const openProvider = useUIStore((s) => s.openProvider)

  // Fetch top-rated provider
  const providerQuery = useQuery({
    queryKey: ["providers", "spotlight"],
    queryFn: () =>
      fetchProviders({
        sort: "rating",
        limit: 1,
        verified: true,
      }),
    staleTime: 5 * 60 * 1000,
  })

  const provider: ProviderCard | undefined = providerQuery.data?.items?.[0]

  return (
    <section className="relative overflow-hidden py-10 sm:py-14">
      <div ref={ref} className="relative mx-auto w-full max-w-[95%] px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.45 }}
          className="mb-6 flex flex-col justify-between gap-2 sm:flex-row sm:items-end"
        >
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <Trophy className="size-3.5 text-amber-500" />
              Destaque da semana
            </span>
            <h2 className="mt-2.5 text-xl font-bold tracking-tight sm:text-2xl">
              Profissional em{" "}
              <span className="text-emerald-600 dark:text-emerald-400">destaque</span>
            </h2>
          </div>
          <p className="text-muted-foreground text-xs sm:text-sm">
            Selecionado pela excelência no atendimento e índice máximo de satisfação em Governador
            Valadares.
          </p>
        </motion.div>

        {/* Featured card */}
        {providerQuery.isLoading ? (
          <SpotlightSkeleton />
        ) : provider ? (
          <SpotlightCard
            provider={provider}
            visible={visible}
            openQuote={openQuote}
            openProvider={openProvider}
          />
        ) : (
          /* Fallback — no provider found */
          <motion.div
            initial={{ opacity: 0 }}
            animate={visible ? { opacity: 1 } : {}}
            className="bg-muted/20 mx-auto max-w-md rounded-2xl border border-dashed p-8 text-center"
          >
            <User className="text-muted-foreground/50 mx-auto size-10" />
            <p className="text-muted-foreground mt-3 text-sm">
              Nenhum prestador em destaque no momento.
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Cadastre-se como prestador e apareça aqui!
            </p>
          </motion.div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// SpotlightCard — Clean Widescreen 2-Column Split Layout
// ---------------------------------------------------------------------------

function SpotlightCard({
  provider,
  visible,
  openQuote,
  openProvider,
}: {
  provider: ProviderCard
  visible: boolean
  openQuote: (opts?: { providerId?: string }) => void
  openProvider: (id: string) => void
}) {
  const [bioExpanded, setBioExpanded] = React.useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.45, delay: 0.1 }}
      data-provider-id={provider.id}
      data-compare-name={provider.name}
      data-compare-avatar={provider.avatarUrl ?? ""}
      className="group bg-card relative overflow-hidden rounded-2xl border border-slate-200/90 shadow-xs transition-all duration-200 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:hover:border-slate-700"
    >
      <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-12 lg:items-center lg:gap-8">
        {/* Left column (7 cols): Identity, Bio, Trust & Metrics */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate={visible ? "visible" : "hidden"}
          className="flex flex-col gap-5 sm:flex-row sm:items-start lg:col-span-7"
        >
          {/* Circular Avatar */}
          <motion.div variants={itemVariants} className="relative shrink-0 self-start">
            <div className="relative flex size-20 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200 sm:size-24 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
              {provider.avatarUrl ? (
                <Image
                  src={provider.avatarUrl}
                  alt={provider.name}
                  width={96}
                  height={96}
                  className="size-full rounded-full object-cover"
                />
              ) : (
                <User className="size-10" />
              )}
            </div>
            {provider.verified && (
              <div className="absolute -right-0.5 -bottom-0.5 flex size-7 items-center justify-center rounded-full bg-white shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                <BadgeCheck className="size-4.5 fill-emerald-500 text-white" />
              </div>
            )}
          </motion.div>

          {/* Identity + Bio + Badges */}
          <motion.div variants={containerVariants} className="min-w-0 flex-1 space-y-3">
            <motion.div variants={itemVariants}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {provider.name}
                </h3>
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800 ring-1 ring-amber-200/70 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800/50">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" />
                  {provider.rating.toFixed(1)}
                  <span className="font-normal text-amber-700/80 dark:text-amber-300/80">
                    ({provider.reviewCount})
                  </span>
                </span>
              </div>

              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {provider.city || "Governador Valadares, MG"}
                </span>
                {provider.distanceKm != null && (
                  <span>
                    · {provider.distanceKm < 1 ? "< 1 km" : `${provider.distanceKm.toFixed(1)} km`}
                  </span>
                )}
                {provider.memberSince && (
                  <span className="flex items-center gap-1">
                    · <Calendar className="size-3" />
                    Membro desde {new Date(provider.memberSince).getFullYear()}
                  </span>
                )}
              </div>
            </motion.div>

            {/* Bio */}
            {provider.bio && (
              <motion.div variants={itemVariants}>
                <p
                  className={cn(
                    "text-muted-foreground text-sm leading-relaxed",
                    !bioExpanded && "line-clamp-2",
                  )}
                >
                  {provider.bio}
                </p>
                {provider.bio.length > 140 && (
                  <button
                    type="button"
                    onClick={() => setBioExpanded((v) => !v)}
                    className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                  >
                    {bioExpanded ? (
                      <>
                        Ver menos <ChevronUp className="size-3" />
                      </>
                    ) : (
                      <>
                        Ver mais <ChevronDown className="size-3" />
                      </>
                    )}
                  </button>
                )}
              </motion.div>
            )}

            {/* Minimalist Metrics & Real Guarantees */}
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-center gap-2 pt-0.5"
            >
              {provider.completedBookings != null && provider.completedBookings > 0 && (
                <Badge
                  variant="secondary"
                  className="gap-1 rounded-md border-0 bg-slate-100 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <Sparkles className="size-3 text-emerald-600" />
                  {provider.completedBookings} serviços concluídos
                </Badge>
              )}
              <Badge
                variant="outline"
                className="gap-1 rounded-md border-slate-200 text-xs font-normal text-slate-600 dark:border-slate-800 dark:text-slate-400"
              >
                <Clock className="size-3" />
                Responde em {getResponseTime(provider.rating)}
              </Badge>
              <Badge
                variant="outline"
                className="gap-1 rounded-md border-emerald-200/70 bg-emerald-50/50 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
              >
                <BadgeCheck className="size-3" />
                Custódia PIX & Garantia 90 dias
              </Badge>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Right column (5 cols): Services Table + Direct Actions */}
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:p-5 lg:col-span-5 dark:border-slate-800/80 dark:bg-slate-900/50">
          {provider.services.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                Principais serviços e valores base
              </p>
              <div className="divide-y divide-slate-200/60 dark:divide-slate-800">
                {provider.services.slice(0, 3).map((svc) => (
                  <ServicePriceRow key={svc.id} service={svc} />
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              className="h-9 flex-1 gap-1.5 rounded-lg bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
              onClick={() => openQuote({ providerId: provider.id })}
            >
              <MessageSquareQuote className="size-3.5" />
              Pedir orçamento
            </Button>
            <Button
              variant="outline"
              className="h-9 flex-1 gap-1.5 rounded-lg border-slate-200 text-xs font-semibold dark:border-slate-700"
              onClick={() => openProvider(provider.id)}
            >
              Ver perfil completo
              <ArrowRight className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 text-xs text-slate-600 hover:text-emerald-700 dark:text-slate-400 dark:hover:text-emerald-300"
              onClick={() => {
                const msg = encodeURIComponent(
                  `Olá! Vi seu perfil no Severinno e gostaria de saber mais sobre seus serviços.`,
                )
                const whatsappUrl = `https://wa.me/?text=${msg}`
                window.open(whatsappUrl, "_blank", "noopener")
              }}
            >
              <MessageCircle className="size-3.5" />
              WhatsApp
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// ServicePriceRow — displays a service with its price in a clean format
// ---------------------------------------------------------------------------

function ServicePriceRow({ service }: { service: ProviderService }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">
        {service.title}
      </span>
      <span className="shrink-0 text-xs font-bold text-slate-900 dark:text-slate-100">
        {formatBRL(service.basePrice)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton — loading state (H1: visibility of system status)
// ---------------------------------------------------------------------------

function SpotlightSkeleton() {
  return (
    <div className="bg-card overflow-hidden rounded-2xl border border-slate-200/80 p-6 shadow-xs sm:p-8 dark:border-slate-800">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex gap-5 lg:col-span-7">
          <Skeleton className="size-20 shrink-0 rounded-full sm:size-24" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-28 rounded-md" />
              <Skeleton className="h-6 w-24 rounded-md" />
            </div>
          </div>
        </div>
        <div className="space-y-3 lg:col-span-5">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="flex gap-2">
            <Skeleton className="h-9 flex-1 rounded-lg" />
            <Skeleton className="h-9 flex-1 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
