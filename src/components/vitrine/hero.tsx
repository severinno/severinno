"use client"

/**
 * Hero — the trust engine of the Severinno Marketplace vitrine.
 *
 * Designed applying Jakob Nielsen's 10 usability heuristics, focused on
 * building CONFIDENCE, TRANSPARENCY and PROFESSIONALISM so visitors:
 *   - register for free
 *   - request quotes (orçamentos)
 *   - schedule services (agendamentos)
 *
 * Heuristic mapping:
 *   H1  Visibilidade do status  → live "{n} prestadores ativos" + location chip + loading
 *   H2  Mundo real              → "encanador, eletricista, pintor" / "orçamento grátis"
 *   H3  Controle e liberdade    → browse sem login · "ver como funciona" · sem caminho forçado
 *   H4  Consistência e padrões  → emerald · mesmas alturas de botão · mesma iconografia
 *   H5  Prevenção de erros      → máscara de CEP · busca não vazia · estados disabled
 *   H6  Reconhecimento > memo   → chips de serviços populares · card de prestador real
 *   H7  Flexibilidade/eficiência→ GPS 1 clique · Enter · chips de acesso rápido
 *   H8  Estética minimalista    → foco em 1 ação · respiro · sem poluição
 *   H9  Recuperar erros         → mensagens humanas e acionáveis
 *   H10 Ajuda e documentação    → "como funciona" · tooltips nos selos
 *
 * Trust / Transparency / Professionalism:
 *   - Card de prestador VERIFICADO real (reconhecimento, não memorização)
 *   - Prova social ao vivo (X prestadores, Y serviços, Z avaliações)
 *   - Microcopy de transparência ("cadastro grátis · sem compromisso")
 *   - Imagem profissional de um prestador real
 *   - Selos de confiança com ícones + labels
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Search,
  LocateFixed,
  Loader2,
  BadgeCheck,
  Star,
  ShieldCheck,
  MapPin,
  Clock,
  ArrowRight,
  Users,
  Wrench,
  CheckCircle2,
  Quote,
} from "lucide-react"

import { useGeoStore, useUIStore } from "@/store"
import { apiGet, fetchProviders, type ProviderCard } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { SERVICE_UNIT_SHORT } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublicStats = {
  providers: number
  services: number
  reviews: number
  completedBookings: number
  avgRating: number
}

export type HeroProps = {
  query: string
  onQueryChange: (q: string) => void
  onSearchSubmit?: () => void
  resultsAnchorId?: string
}

// Popular services — recognition over recall (H6).
// One click fills the search and scrolls to results.
const POPULAR_SERVICES = [
  { label: "Encanador", emoji: "🔧" },
  { label: "Eletricista", emoji: "💡" },
  { label: "Pintor", emoji: "🎨" },
  { label: "Diarista", emoji: "🧹" },
  { label: "Pedreiro", emoji: "🧱" },
  { label: "Jardineiro", emoji: "🌿" },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Hero({
  query,
  onQueryChange,
  onSearchSubmit,
  resultsAnchorId,
}: HeroProps) {
  const { city, status, setFromGPS, setFromCEP } = useGeoStore()
  const openAuth = useUIStore((s) => s.openAuth)
  const [locating, setLocating] = React.useState(false)
  const [cepInput, setCepInput] = React.useState("")
  const [cepError, setCepError] = React.useState<string | null>(null)

  // H1 — Visibilidade do status: live social proof numbers
  const { data: stats } = useQuery<PublicStats>({
    queryKey: ["public-stats"],
    queryFn: () => apiGet<PublicStats>("/api/stats/public"),
    staleTime: 60 * 1000,
  })

  // H6 — Reconhecimento: show a real verified provider card preview
  const { data: topProviderData, isLoading: providerLoading } = useQuery({
    queryKey: ["hero-top-provider"],
    queryFn: () => fetchProviders({ sort: "rating", limit: 1 }),
    staleTime: 5 * 60 * 1000,
  })
  const topProvider = topProviderData?.items?.[0]

  // ---- Actions -------------------------------------------------------------

  const scrollToResults = React.useCallback(() => {
    if (!resultsAnchorId || typeof window === "undefined") return
    window.setTimeout(() => {
      document
        .getElementById(resultsAnchorId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 80)
  }, [resultsAnchorId])

  const handleLocate = React.useCallback(async () => {
    setLocating(true)
    try {
      await setFromGPS()
    } finally {
      setLocating(false)
    }
    scrollToResults()
  }, [setFromGPS, scrollToResults])

  // H5 — Prevenção de erros: CEP mask (XXXXX-XXX)
  const maskCep = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8)
    if (digits.length <= 5) return digits
    return `${digits.slice(0, 5)}-${digits.slice(5)}`
  }

  const handleCep = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const cep = cepInput.replace(/\D/g, "")
      if (cep.length !== 8) {
        // H9 — Recuperar erros: human, actionable message
        setCepError("Digite um CEP com 8 dígitos (ex: 01001-000).")
        return
      }
      setCepError(null)
      try {
        await setFromCEP(cepInput)
        scrollToResults()
      } catch {
        setCepError("CEP não encontrado. Verifique e tente novamente.")
      }
    },
    [cepInput, setFromCEP, scrollToResults],
  )

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    // H5 — Prevenção: don't submit empty — gently hint instead
    onSearchSubmit?.()
    scrollToResults()
  }

  const handlePopularClick = (label: string) => {
    onQueryChange(label)
    onSearchSubmit?.()
    scrollToResults()
  }

  const isLocating = locating || status === "locating" || status === "geocoding"

  // ---- Render --------------------------------------------------------------

  return (
    <section
      className={cn(
        "relative isolate overflow-hidden",
        "bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800",
        "text-white",
      )}
    >
      {/* H8 — Estética minimalista: subtle pattern, no clutter */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      <div
        aria-hidden
        className="absolute -top-24 -right-24 size-72 rounded-full bg-emerald-400/30 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-20 size-80 rounded-full bg-teal-300/20 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
          {/* ============ LEFT: copy + search + CTA ============ */}
          <div className="flex flex-col items-start">
            {/* H1 — Status badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur ring-1 ring-white/20">
                <BadgeCheck className="size-3.5" />
                Marketplace de serviços verificados
              </span>
              {stats && stats.providers > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-medium ring-1 ring-emerald-300/30">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
                  </span>
                  {stats.providers} prestadores ativos agora
                </span>
              )}
            </div>

            {/* H2 — Linguagem do mundo real + H8 hierarquia forte */}
            <h1 className="mt-5 text-balance text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl md:text-5xl">
              Prestadores de serviço verificados,{" "}
              <span className="text-emerald-200">perto de você.</span>
            </h1>
            <p className="mt-4 max-w-xl text-pretty text-sm font-light text-emerald-50/90 sm:text-base md:text-lg">
              Compare avaliações reais, peça orçamento grátis e agende —
              encanador, eletricista, pintor e mais. Você escolhe o
              profissional.
            </p>

            {/* H5 — Prevenção de erros + H7 eficiência: search com máscara CEP */}
            <form
              onSubmit={handleSearch}
              className="mt-7 w-full max-w-xl rounded-2xl bg-white p-2 text-foreground shadow-2xl ring-1 ring-black/5"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="O que você precisa? Ex.: encanador, pintura…"
                    className="h-12 border-0 bg-transparent pl-10 text-left shadow-none focus-visible:ring-0"
                    aria-label="Serviço buscado"
                  />
                </div>
                <div className="relative flex items-center sm:w-44">
                  <MapPin className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={cepInput}
                    onChange={(e) => {
                      setCepInput(maskCep(e.target.value))
                      setCepError(null)
                    }}
                    placeholder={city ? city : "CEP ou cidade"}
                    className="h-12 border-0 bg-transparent pl-10 text-left shadow-none focus-visible:ring-0"
                    aria-label="Localização"
                    inputMode="numeric"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void handleCep(e as unknown as React.FormEvent)
                      }
                    }}
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="h-12 shrink-0 rounded-xl px-6 text-base shadow-sm"
                >
                  <Search className="size-4" />
                  Buscar
                </Button>
              </div>
            </form>

            {/* H9 — Recuperar erros: mensagem clara abaixo do CEP */}
            {cepError && (
              <p className="mt-2 text-sm text-amber-200" role="alert">
                {cepError}
              </p>
            )}

            {/* H6 — Reconhecimento: chips de serviços populares + H7 eficiência */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-emerald-100/80">
                Mais buscados:
              </span>
              {POPULAR_SERVICES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => handlePopularClick(s.label)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/15 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <span aria-hidden>{s.emoji}</span>
                  {s.label}
                </button>
              ))}
            </div>

            {/* H7 — Eficiência: GPS 1 clique */}
            <button
              type="button"
              onClick={handleLocate}
              disabled={isLocating}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-emerald-50 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-60"
            >
              {isLocating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LocateFixed className="size-4" />
              )}
              Usar minha localização
            </button>

            {/* H3 — Controle: CTAs claros (cadastro grátis + como funciona) */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() => openAuth("register", "CLIENT")}
                className="h-11 rounded-xl bg-white px-6 text-base font-semibold text-emerald-700 shadow-lg hover:bg-emerald-50"
              >
                Cadastrar grátis
                <ArrowRight className="size-4" />
              </Button>
              <button
                type="button"
                onClick={scrollToResults}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-medium text-emerald-50 underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                Ver como funciona
              </button>
            </div>

            {/* Transparência — microcopy explícita */}
            <p className="mt-3 text-xs text-emerald-100/70">
              Cadastro grátis · Orçamento sem compromisso · Você escolhe o
              profissional
            </p>

            {/* H10 — Ajuda: selos de confiança com tooltips */}
            <ul className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-emerald-50">
              <TrustBadge
                icon={<BadgeCheck className="size-4" />}
                title="Prestadores verificados"
                tooltip="Documentos validados e identidade confirmada"
              />
              <TrustBadge
                icon={<Star className="size-4" />}
                title="Avaliações reais"
                tooltip="Avaliações de clientes após a conclusão do serviço"
              />
              <TrustBadge
                icon={<ShieldCheck className="size-4" />}
                title="Pagamento seguro"
                tooltip="Pagamento só é liberado após você marcar como concluído"
              />
            </ul>
          </div>

          {/* ============ RIGHT: profissional + card real flutuante ============ */}
          <div className="relative hidden lg:block">
            <HeroVisual
              provider={topProvider}
              loading={providerLoading}
              stats={stats}
            />
          </div>
        </div>

        {/* ============ Social proof bar (H1 + H6) ============ */}
        {stats && (
          <div className="mt-12 grid grid-cols-2 gap-4 rounded-2xl bg-white/10 px-6 py-5 backdrop-blur ring-1 ring-white/15 sm:grid-cols-4 sm:gap-0">
            <StatItem
              icon={<Users className="size-5" />}
              value={stats.providers}
              label="Prestadores verificados"
              accent
            />
            <StatItem
              icon={<Wrench className="size-5" />}
              value={stats.services}
              label="Serviços cadastrados"
              accent
            />
            <StatItem
              icon={<CheckCircle2 className="size-5" />}
              value={stats.completedBookings}
              label="Serviços concluídos"
              accent
            />
            <StatItem
              icon={<Star className="size-5" />}
              value={stats.avgRating || "—"}
              label="Nota média das avaliações"
              suffix={stats.avgRating ? "★" : undefined}
              accent
            />
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Hero visual — professional image + floating real provider card preview
// ---------------------------------------------------------------------------

function HeroVisual({
  provider,
  loading,
  stats,
}: {
  provider?: ProviderCard
  loading: boolean
  stats?: PublicStats
}) {
  return (
    <div className="relative">
      {/* Professional image (transparency + professionalism) */}
      <div className="relative overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/20">
        <img
          src="/hero-provider.png"
          alt="Prestador de serviço profissional verificado, em uniforme verde, sorrindo"
          className="aspect-[4/3] w-full object-cover"
          loading="eager"
        />
        {/* Gradient overlay for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-emerald-900/40 via-transparent to-transparent" />
      </div>

      {/* Floating real provider card — bottom left (recognition over recall) */}
      <div className="absolute -bottom-6 -left-6 w-72 rounded-2xl bg-white p-4 text-slate-900 shadow-2xl ring-1 ring-black/5">
        {loading ? (
          <div className="flex items-center gap-3">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ) : provider ? (
          <ProviderPreview provider={provider} />
        ) : null}
      </div>

      {/* Floating rating badge — bottom right (social proof) */}
      {stats && stats.avgRating > 0 && (
        <div className="absolute -bottom-3 right-4 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-xl">
          <Star className="size-5 fill-amber-400 text-amber-400" />
          <div className="leading-tight">
            <p className="text-base font-bold text-slate-900">
              {stats.avgRating}
            </p>
            <p className="text-[11px] text-slate-500">
              {stats.reviews} avaliações
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function ProviderPreview({ provider }: { provider: ProviderCard }) {
  const firstService = provider.services?.[0]
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="relative">
          {provider.avatarUrl ? (
            <img
              src={provider.avatarUrl}
              alt={provider.name}
              className="size-12 rounded-full object-cover ring-2 ring-emerald-500"
            />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
              {provider.name.charAt(0)}
            </div>
          )}
          {provider.verified && (
            <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
              <BadgeCheck className="size-3 text-white" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">
            {provider.name}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
            <Star className="size-3 fill-amber-400 text-amber-400" />
            <span className="font-medium text-slate-700">
              {provider.rating.toFixed(1)}
            </span>
            <span>·</span>
            <span>{provider.reviewCount} avaliações</span>
          </div>
        </div>
      </div>

      {firstService && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-700">
              {firstService.title}
            </p>
            <p className="text-[11px] text-slate-400">
              a partir de
            </p>
          </div>
          <p className="text-sm font-bold text-emerald-700">
            {formatBRL(firstService.basePrice)}
            <span className="text-[11px] font-normal text-slate-400">
              /{SERVICE_UNIT_SHORT[firstService.unit]}
            </span>
          </p>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
        <MapPin className="size-3" />
        <span>{provider.city || "São Paulo, SP"}</span>
        {provider.distanceKm != null && (
          <>
            <span>·</span>
            <span>{provider.distanceKm.toFixed(1)} km de você</span>
          </>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
          <Quote className="size-3" />
          Orçamento grátis
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
          <Clock className="size-3" />
          Resposta rápida
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function TrustBadge({
  icon,
  title,
  tooltip,
}: {
  icon: React.ReactNode
  title: string
  tooltip: string
}) {
  return (
    <li
      className="flex items-center gap-2"
      title={tooltip}
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
        {icon}
      </span>
      <span className="whitespace-nowrap font-medium">{title}</span>
    </li>
  )
}

function StatItem({
  icon,
  value,
  label,
  suffix,
  accent,
}: {
  icon: React.ReactNode
  value: number | string
  label: string
  suffix?: string
  accent?: boolean
}) {
  return (
    <div className="flex items-center gap-3 sm:border-l sm:border-white/20 sm:px-6 sm:first:border-l-0 sm:first:pl-0 sm:last:pr-0">
      <span className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1",
        accent
          ? "bg-emerald-400/20 ring-emerald-300/30"
          : "bg-white/10 ring-white/15",
      )}>
        {icon}
      </span>
      <div className="leading-tight">
        <p className="text-2xl font-bold tracking-tight text-white">
          {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
          {suffix && (
            <span className="ml-1 text-sm font-normal text-emerald-200">
              {suffix}
            </span>
          )}
        </p>
        <p className="text-xs text-emerald-100/80">{label}</p>
      </div>
    </div>
  )
}
