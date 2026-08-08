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

import { fetchProviders, type ProviderCard, type ProviderService } from "@/lib/api"
import { useScrollReveal } from "@/hooks/use-animation"
import { useUIStore } from "@/store/ui"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBRL } from "@/lib/format"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Helper: response time estimate (simulated based on rating)
// ---------------------------------------------------------------------------

function getResponseTime(rating: number): string {
  if (rating >= 4.8) return "~30min"
  if (rating >= 4.5) return "~1h"
  if (rating >= 4.0) return "~2h"
  return "~3h"
}

// ---------------------------------------------------------------------------
// Fake avatar stack data for social proof (recent clients)
// ---------------------------------------------------------------------------

const FAKE_CLIENT_AVATARS = [
  { name: "Maria S.", hue: 340 },
  { name: "João P.", hue: 160 },
  { name: "Ana L.", hue: 30 },
]

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
        <div
          className={cn(
            "mb-8 text-center transition-all duration-500 ease-out",
            visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
          )}
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/50">
            <Trophy className="size-3.5" />
            Destaque da semana
          </span>
          <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
            Profissional em{" "}
            <span className="text-emerald-600 dark:text-emerald-400">destaque</span>
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Conheça um dos nossos prestadores mais bem avaliados.
          </p>
        </div>

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
          <div
            className={cn(
              "mx-auto max-w-md rounded-2xl border border-dashed bg-muted/20 p-8 text-center transition-opacity duration-500",
              visible ? "opacity-100" : "opacity-0",
            )}
          >
            <User className="mx-auto size-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum prestador em destaque no momento.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cadastre-se como prestador e apareça aqui!
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// SpotlightCard — the main card with all enhancements
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
    <div
      className={cn(
        "mx-auto max-w-2xl transition-all duration-500 ease-out",
        visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-[0.98] opacity-0",
      )}
      style={{ transitionDelay: visible ? "150ms" : "0ms" }}
    >
      <div className="group relative overflow-hidden rounded-2xl border bg-card shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
        {/* Gradient accent bar — taller & more prominent */}
        <div className="h-2 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600" />

        {/* Subtle pattern overlay inside card */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 top-2 opacity-[0.03] dark:opacity-[0.05]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />

        {/* Decorative gradient glow behind avatar area */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-8 left-1/2 size-64 -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl dark:bg-emerald-500/5"
        />

        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            {/* Avatar — larger with decorative ring */}
            <div
              className="relative shrink-0 self-center transition-all duration-500 ease-out sm:self-start"
              style={{ transitionDelay: visible ? "200ms" : "0ms" }}
            >
              {/* Decorative ring */}
              <div className="absolute -inset-1.5 rounded-full bg-gradient-to-br from-emerald-400 via-teal-400 to-emerald-500 opacity-60 blur-[2px] transition-opacity group-hover:opacity-80" />
              <div className="relative flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-600 sm:size-28 dark:from-emerald-950/40 dark:to-teal-950/40 dark:text-emerald-400 ring-4 ring-background">
                {provider.avatarUrl ? (
                  <Image
                    src={provider.avatarUrl}
                    alt={provider.name}
                    width={112}
                    height={112}
                    className="size-full rounded-full object-cover"
                  />
                ) : (
                  <User className="size-12" />
                )}
              </div>
              {/* Verified badge — overlaid on avatar ring */}
              {provider.verified && (
                <div className="absolute -bottom-0.5 -right-0.5 flex size-8 items-center justify-center rounded-full bg-white shadow-md ring-3 ring-emerald-400 dark:bg-slate-900 dark:ring-emerald-500">
                  <BadgeCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
                </div>
              )}
              {/* Top rated badge overlay */}
              <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 shadow-sm ring-1 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-700/50">
                  <Star className="size-2.5 fill-amber-500 text-amber-500" />
                  Top
                </span>
              </div>
            </div>

            {/* Info section */}
            <div className="flex-1 space-y-3">
              {/* Name & Location */}
              <div
                className="transition-all duration-500 ease-out"
                style={{ transitionDelay: visible ? "250ms" : "0ms" }}
              >
                <h3 className="text-xl font-bold">{provider.name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
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

              {/* Rating — prominent with numeric + stars */}
              <div
                className="flex items-center gap-3 transition-all duration-500 ease-out"
                style={{ transitionDelay: visible ? "300ms" : "0ms" }}
              >
                <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 dark:bg-amber-950/30">
                  <Star className="size-5 fill-amber-400 text-amber-400" />
                  <span className="text-base font-bold tabular-nums text-amber-700 dark:text-amber-300">
                    {provider.rating.toFixed(1)}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  ({provider.reviewCount}{" "}
                  {provider.reviewCount === 1 ? "avaliação" : "avaliações"})
                </span>
              </div>

              {/* Meta row: completed bookings + response time */}
              <div
                className="flex flex-wrap items-center gap-2 transition-all duration-500 ease-out"
                style={{ transitionDelay: visible ? "350ms" : "0ms" }}
              >
                {provider.completedBookings != null && provider.completedBookings > 0 && (
                  <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60 border-0">
                    <Sparkles className="size-3" />
                    {provider.completedBookings} serviços concluídos
                  </Badge>
                )}
                <Badge variant="outline" className="gap-1 text-xs">
                  <Clock className="size-3" />
                  Responde em {getResponseTime(provider.rating)}
                </Badge>
              </div>

              {/* Services with prices */}
              {provider.services.length > 0 && (
                <div
                  className="space-y-1.5 transition-all duration-500 ease-out"
                  style={{ transitionDelay: visible ? "400ms" : "0ms" }}
                >
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Serviços
                  </p>
                  <div className="space-y-1">
                    {provider.services.slice(0, 3).map((svc) => (
                      <ServicePriceRow key={svc.id} service={svc} />
                    ))}
                    {provider.services.length > 3 && (
                      <p className="pl-1 text-xs text-muted-foreground">
                        +{provider.services.length - 3} outros serviços
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Bio with expandable "Ver mais" */}
              {provider.bio && (
                <div
                  className="transition-all duration-500 ease-out"
                  style={{ transitionDelay: visible ? "450ms" : "0ms" }}
                >
                  <p
                    className={cn(
                      "text-sm text-muted-foreground transition-all duration-300",
                      !bioExpanded && "line-clamp-2"
                    )}
                  >
                    {provider.bio}
                  </p>
                  {provider.bio.length > 120 && (
                    <button
                      onClick={() => setBioExpanded((v) => !v)}
                      className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                    >
                      {bioExpanded ? (
                        <>
                          Ver menos
                          <ChevronUp className="size-3" />
                        </>
                      ) : (
                        <>
                          Ver mais
                          <ChevronDown className="size-3" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Social proof: recent client avatar stack */}
              <div
                className="flex items-center gap-2 transition-all duration-500 ease-out"
                style={{ transitionDelay: visible ? "500ms" : "0ms" }}
              >
                <div className="flex -space-x-2">
                  {FAKE_CLIENT_AVATARS.map((client, i) => (
                    <div
                      key={i}
                      className="flex size-7 items-center justify-center rounded-full border-2 border-background text-[10px] font-bold text-white"
                      style={{ backgroundColor: `hsl(${client.hue}, 60%, 45%)` }}
                      title={client.name}
                    >
                      {client.name.charAt(0)}
                    </div>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  Clientes recentes
                </span>
              </div>
            </div>
          </div>

          {/* CTA buttons */}
          <div
            className="mt-6 flex flex-col gap-2 border-t pt-5 transition-all duration-500 ease-out sm:flex-row sm:items-center"
            style={{ transitionDelay: visible ? "550ms" : "0ms" }}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-1">
              {/* Primary CTA — Pedir orçamento */}
              <Button
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                onClick={() => openQuote({ providerId: provider.id })}
              >
                <MessageSquareQuote className="size-4" />
                Pedir orçamento
              </Button>
              {/* Secondary CTA — Ver perfil completo */}
              <Button
                variant="outline"
                className="gap-1.5 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                onClick={() => openProvider(provider.id)}
              >
                Ver perfil completo
                <ArrowRight className="size-4" />
              </Button>
            </div>

            {/* WhatsApp-style CTA */}
            <div>
              <Button
                variant="ghost"
                className="gap-1.5 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300 transition-all duration-200"
                onClick={() => {
                  const msg = encodeURIComponent(
                    `Olá! Vi seu perfil no Severinno e gostaria de saber mais sobre seus serviços.`
                  )
                  const whatsappUrl = `https://wa.me/?text=${msg}`
                  window.open(whatsappUrl, "_blank", "noopener")
                }}
              >
                <MessageCircle className="size-4" />
                Enviar mensagem
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ServicePriceRow — displays a service with its price in a clean format
// ---------------------------------------------------------------------------

function ServicePriceRow({ service }: { service: ProviderService }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
      <span className="text-sm truncate">{service.title}</span>
      <span className="shrink-0 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
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
    <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border bg-card shadow-lg">
      <Skeleton className="h-2 w-full" />
      <div className="relative p-6 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          {/* Avatar skeleton */}
          <div className="relative shrink-0 self-center sm:self-start">
            <Skeleton className="size-24 rounded-full sm:size-28" />
          </div>
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-32 rounded-lg" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-28 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-7 w-full rounded-md" />
              <Skeleton className="h-7 w-3/4 rounded-md" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="size-7 rounded-full" />
              </div>
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>
        <div className="mt-6 flex gap-2 border-t pt-5">
          <Skeleton className="h-9 w-40 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>
    </div>
  )
}
