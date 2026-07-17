"use client"

/**
 * ProviderSpotlight — Featured provider spotlight section.
 *
 * Heuristic mapping:
 *   H1  Visibility of system status  → "Destaque da semana" status badge, loading skeleton
 *   H2  Match real world             → Real provider info from API
 *   H3  User control and freedom     → "Ver perfil" and "Pedir orçamento" CTAs
 *   H6  Recognition > recall         → Provider avatar, name, rating, services visible
 *   H8  Aesthetic minimalism         → Clean card design, one provider featured
 *   H10 Help/documentation           → Links to provider profile
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Star,
  BadgeCheck,
  MapPin,
  Calendar,
  ArrowRight,
  User,
  MessageSquareQuote,
  Sparkles,
} from "lucide-react"
import { motion } from "framer-motion"

import { fetchProviders, type ProviderCard } from "@/lib/api"
import { useScrollReveal } from "@/hooks/use-animation"
import { useUIStore } from "@/store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
    <section className="relative overflow-hidden bg-gradient-to-b from-muted/30 to-background py-16 sm:py-20">
      {/* Decorative mesh blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 -right-20 size-80 rounded-full bg-emerald-100/40 blur-3xl dark:bg-emerald-900/20" />
        <div className="absolute -bottom-20 -left-20 size-72 rounded-full bg-teal-100/40 blur-3xl dark:bg-teal-900/20" />
      </div>

      <div ref={ref} className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={visible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-8 text-center"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/50">
            <Sparkles className="size-3.5" />
            Destaque da semana
          </span>
          <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
            Profissional em{" "}
            <span className="text-emerald-600 dark:text-emerald-400">destaque</span>
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Conheça um dos nossos prestadores mais bem avaliados.
          </p>
        </motion.div>

        {/* Featured card */}
        {providerQuery.isLoading ? (
          <SpotlightSkeleton />
        ) : provider ? (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={visible ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mx-auto max-w-2xl"
          >
            <div className="relative overflow-hidden rounded-2xl border bg-card shadow-lg transition-shadow hover:shadow-xl">
              {/* Accent bar */}
              <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />

              <div className="p-6 sm:p-8">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className="flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-600 sm:size-24 dark:from-emerald-950/40 dark:to-teal-950/40 dark:text-emerald-400">
                      {provider.avatarUrl ? (
                        <img
                          src={provider.avatarUrl}
                          alt={provider.name}
                          className="size-full rounded-2xl object-cover"
                        />
                      ) : (
                        <User className="size-10" />
                      )}
                    </div>
                    {/* Verified badge */}
                    {provider.verified && (
                      <div className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-white shadow-sm ring-2 ring-emerald-400 dark:bg-slate-900 dark:ring-emerald-500">
                        <BadgeCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 space-y-3">
                    <div>
                      <h3 className="text-xl font-bold">{provider.name}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        {provider.city && (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3.5" />
                            {provider.city}
                          </span>
                        )}
                        {provider.distanceKm != null && (
                          <span className="text-xs">
                            {provider.distanceKm < 1
                              ? "< 1 km"
                              : `${Math.round(provider.distanceKm)} km`}
                          </span>
                        )}
                        {provider.memberSince && (
                          <span className="flex items-center gap-1 text-xs">
                            <Calendar className="size-3" />
                            Membro desde {new Date(provider.memberSince).getFullYear()}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Rating */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Star className="size-4 fill-amber-400 text-amber-400" />
                        <span className="text-sm font-semibold tabular-nums">
                          {provider.rating.toFixed(1)}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        ({provider.reviewCount}{" "}
                        {provider.reviewCount === 1 ? "avaliação" : "avaliações"})
                      </span>
                      {provider.completedBookings != null && provider.completedBookings > 0 && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          {provider.completedBookings} serviços concluídos
                        </Badge>
                      )}
                    </div>

                    {/* Services list */}
                    {provider.services.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Serviços
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {provider.services.slice(0, 3).map((svc) => (
                            <Badge
                              key={svc.id}
                              variant="outline"
                              className="gap-1 text-xs"
                            >
                              {svc.title}
                            </Badge>
                          ))}
                          {provider.services.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{provider.services.length - 3}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Bio snippet */}
                    {provider.bio && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {provider.bio}
                      </p>
                    )}
                  </div>
                </div>

                {/* CTA buttons — H3 */}
                <div className="mt-6 flex flex-col gap-2 border-t pt-5 sm:flex-row">
                  <Button
                    className="gap-1.5"
                    onClick={() => openQuote({ providerId: provider.id })}
                  >
                    <MessageSquareQuote className="size-4" />
                    Pedir orçamento
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => openProvider(provider.id)}
                  >
                    Ver perfil
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          /* Fallback — no provider found */
          <motion.div
            initial={{ opacity: 0 }}
            animate={visible ? { opacity: 1 } : {}}
            className="mx-auto max-w-md rounded-2xl border border-dashed bg-muted/20 p-8 text-center"
          >
            <User className="mx-auto size-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum prestador em destaque no momento.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cadastre-se como prestador e apareça aqui!
            </p>
          </motion.div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Skeleton — loading state (H1: visibility of system status)
// ---------------------------------------------------------------------------

function SpotlightSkeleton() {
  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border bg-card shadow-lg">
      <Skeleton className="h-1.5 w-full" />
      <div className="p-6 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <Skeleton className="size-20 shrink-0 rounded-2xl sm:size-24" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="mt-6 flex gap-2 border-t pt-5">
          <Skeleton className="h-9 w-40 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>
    </div>
  )
}
