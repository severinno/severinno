"use client";

/**
 * Hero — Interactive, dynamic live-activity engine for the Severinno Marketplace.
 *
 * Redesigned to feel like the visitor is already inside the app:
 *   - Live activity feed showing real bookings, reviews, signups, quotes
 *   - Animated notification toasts cycling through recent activities
 *   - "X pessoas buscando agora" dynamic counter
 *   - Floating activity cards with staggered animations
 *   - Interactive search with live indicators
 *
 * Heuristic mapping:
 *   H1  Visibilidade do status  → live activity feed + browsing counter + loading
 *   H2  Mundo real              → "encanador, eletricista, pintor" / "orçamento grátis"
 *   H3  Controle e liberdade    → browse sem login · "ver como funciona" · sem caminho forçado
 *   H4  Consistência e padrões  → emerald · mesmas alturas de botão · mesma iconografia
 *   H5  Prevenção de erros      → máscara de CEP · busca não vazia · estados disabled
 *   H6  Reconhecimento > memo   → chips de serviços populares · live activity cards
 *   H7  Flexibilidade/eficiência→ GPS 1 clique · Enter · chips de acesso rápido
 *   H8  Estética minimalista    → foco em 1 ação · respiro · sem poluição
 *   H9  Recuperar erros         → mensagens humanas e acionáveis
 *   H10 Ajuda e documentação    → "como funciona" · tooltips nos selos
 */

import * as React from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  LocateFixed,
  Loader2,
  BadgeCheck,
  Star,
  ShieldCheck,
  MapPin,
  ArrowRight,
  Users,
  Wrench,
  CheckCircle2,
  Eye,
  Zap,
  TrendingUp,
  CalendarCheck,
  UserPlus,
  FileText,
} from "lucide-react";

import { useGeoStore, useUIStore } from "@/store";
import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCountUp } from "@/hooks/use-animation";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublicStats = {
  providers: number;
  services: number;
  reviews: number;
  completedBookings: number;
  avgRating: number;
  totalUsers?: number;
  recentSignups24h?: number;
};

type ActivityItem = {
  type: "booking" | "review" | "signup" | "quote";
  userName: string;
  userAvatar?: string | null;
  action: string;
  target: string;
  service?: string | null;
  rating?: number | null;
  timeAgo: string;
  emoji: string;
};

type ActivityResponse = {
  activities: ActivityItem[];
  browsingNow: number;
  quotesToday: number;
};

export type HeroProps = {
  query: string;
  onQueryChange: (q: string) => void;
  onSearchSubmit?: () => void;
  resultsAnchorId?: string;
};

// Popular services — recognition over recall (H6).
const POPULAR_SERVICES = [
  { label: "Encanador", emoji: "🔧" },
  { label: "Eletricista", emoji: "💡" },
  { label: "Pintor", emoji: "🎨" },
  { label: "Diarista", emoji: "🧹" },
  { label: "Pedreiro", emoji: "🧱" },
  { label: "Jardineiro", emoji: "🌿" },
];

// Map activity types to icons and colors
const ACTIVITY_META: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  booking: { icon: CalendarCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
  review: { icon: Star, color: "text-amber-600", bg: "bg-amber-50" },
  signup: { icon: UserPlus, color: "text-blue-600", bg: "bg-blue-50" },
  quote: { icon: FileText, color: "text-violet-600", bg: "bg-violet-50" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Hero({ query, onQueryChange, onSearchSubmit, resultsAnchorId }: HeroProps) {
  const { city, status, setFromGPS, setFromCEP } = useGeoStore();
  const openAuth = useUIStore((s) => s.openAuth);
  const [locating, setLocating] = React.useState(false);
  const [cepInput, setCepInput] = React.useState("");
  const [cepError, setCepError] = React.useState<string | null>(null);

  // H1 — Live social proof numbers
  const { data: stats } = useQuery<PublicStats>({
    queryKey: ["public-stats"],
    queryFn: () => apiGet<PublicStats>("/api/stats/public"),
    staleTime: 60 * 1000,
  });

  // Live activity feed
  const { data: activityData, isLoading: activityLoading } = useQuery<ActivityResponse>({
    queryKey: ["hero-activity"],
    queryFn: () => apiGet<ActivityResponse>("/api/stats/activity"),
    staleTime: 30 * 1000,
    refetchInterval: 45 * 1000, // Auto-refresh for live feel
  });

  // ---- Actions -------------------------------------------------------------

  const scrollToResults = React.useCallback(() => {
    if (!resultsAnchorId || typeof window === "undefined") return;
    window.setTimeout(() => {
      document
        .getElementById(resultsAnchorId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [resultsAnchorId]);

  const handleLocate = React.useCallback(async () => {
    setLocating(true);
    try {
      await setFromGPS();
    } finally {
      setLocating(false);
    }
    scrollToResults();
  }, [setFromGPS, scrollToResults]);

  // H5 — Prevenção de erros: CEP mask (XXXXX-XXX)
  const maskCep = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  };

  const handleCep = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const cep = cepInput.replace(/\D/g, "");
      if (cep.length !== 8) {
        setCepError("Digite um CEP com 8 dígitos (ex: 01001-000).");
        return;
      }
      setCepError(null);
      try {
        await setFromCEP(cepInput);
        scrollToResults();
      } catch {
        setCepError("CEP não encontrado. Verifique e tente novamente.");
      }
    },
    [cepInput, setFromCEP, scrollToResults],
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchSubmit?.();
    scrollToResults();
  };

  const handlePopularClick = (label: string) => {
    onQueryChange(label);
    onSearchSubmit?.();
    scrollToResults();
  };

  const isLocating = locating || status === "locating" || status === "geocoding";

  // ---- Render --------------------------------------------------------------

  return (
    <section
      className={cn(
        "relative isolate overflow-hidden",
        "bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800",
        "text-white",
      )}
    >
      {/* Subtle pattern */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      {/* Animated mesh blobs */}
      <div
        aria-hidden
        className="absolute -top-24 -right-24 size-72 animate-pulse rounded-full bg-emerald-400/30 blur-3xl"
        style={{ animationDuration: "6s" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-20 size-80 animate-pulse rounded-full bg-teal-300/20 blur-3xl"
        style={{ animationDuration: "7s", animationDelay: "1.5s" }}
      />
      <div
        aria-hidden
        className="absolute top-1/3 right-1/4 size-56 animate-pulse rounded-full bg-emerald-300/15 blur-3xl"
        style={{ animationDuration: "8s", animationDelay: "0.8s" }}
      />

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
          {/* ============ LEFT: copy + search + CTA ============ */}
          <div className="flex flex-col items-start">
            {/* H1 — Status badges */}
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
              {activityData && activityData.browsingNow > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/15">
                  <Eye className="size-3" />
                  {activityData.browsingNow} pessoas buscando
                </span>
              )}
            </div>

            {/* H2 — Linguagem do mundo real */}
            <h1 className="mt-5 text-balance text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl md:text-5xl">
              Prestadores de serviço verificados,{" "}
              <span className="text-emerald-200">perto de você.</span>
            </h1>
            <p className="mt-4 max-w-xl text-pretty text-sm font-light text-emerald-50/90 sm:text-base md:text-lg">
              Compare avaliações reais, peça orçamento grátis e agende — encanador, eletricista,
              pintor e mais. Você escolhe o profissional.
            </p>

            {/* Search bar */}
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
                      setCepInput(maskCep(e.target.value));
                      setCepError(null);
                    }}
                    placeholder={city ? city : "CEP ou cidade"}
                    className="h-12 border-0 bg-transparent pl-10 text-left shadow-none focus-visible:ring-0"
                    aria-label="Localização"
                    inputMode="numeric"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleCep(e as unknown as React.FormEvent);
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

            {cepError && (
              <p className="mt-2 text-sm text-amber-200" role="alert">
                {cepError}
              </p>
            )}

            {/* Popular service chips */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-emerald-100/80">Mais buscados:</span>
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

            {/* GPS + CTAs */}
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

            <p className="mt-3 text-xs text-emerald-100/70">
              Cadastro grátis · Orçamento sem compromisso · Você escolhe o profissional
            </p>

            {/* Trust badges */}
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

          {/* ============ RIGHT: Live Activity Feed ============ */}
          <div className="relative hidden lg:block">
            <LiveActivityPanel
              activities={activityData?.activities ?? []}
              browsingNow={activityData?.browsingNow ?? 0}
              quotesToday={activityData?.quotesToday ?? 0}
              stats={stats}
              isLoading={activityLoading}
            />
          </div>
        </div>

        {/* ============ Social proof bar ============ */}
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
  );
}

// ---------------------------------------------------------------------------
// Live Activity Panel — the interactive right side
// ---------------------------------------------------------------------------

function LiveActivityPanel({
  activities,
  browsingNow,
  quotesToday,
  stats,
  isLoading,
}: {
  activities: ActivityItem[];
  browsingNow: number;
  quotesToday: number;
  stats?: PublicStats;
  isLoading: boolean;
}) {
  // Cycle through toast notifications
  const [toastIndex, setToastIndex] = React.useState(0);
  const [visibleActivities, setVisibleActivities] = React.useState<ActivityItem[]>([]);

  // Stagger-reveal activities
  React.useEffect(() => {
    if (activities.length === 0) return;
    setVisibleActivities([]);
    activities.forEach((_, i) => {
      setTimeout(() => {
        setVisibleActivities((prev) => [...prev, activities[i]]);
      }, i * 300);
    });
  }, [activities]);

  // Cycle toast
  React.useEffect(() => {
    if (activities.length === 0) return;
    const interval = setInterval(() => {
      setToastIndex((prev) => (prev + 1) % activities.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [activities.length]);

  return (
    <div className="relative">
      {/* ── Main activity feed card ── */}
      <div className="rounded-3xl bg-white/10 p-5 backdrop-blur-md ring-1 ring-white/20 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-sm font-semibold text-white">Atividade ao vivo</span>
          </div>
          {browsingNow > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-100 ring-1 ring-white/10">
              <Eye className="size-3" />
              {browsingNow} online
            </span>
          )}
        </div>

        {/* Activity list */}
        <div className="space-y-2.5 max-h-[400px] overflow-y-auto scrollbar-thin pr-1">
          {isLoading ? (
            // Skeleton loading
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
                <Skeleton className="size-10 shrink-0 rounded-full bg-white/10" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/4 rounded bg-white/10" />
                  <Skeleton className="h-3 w-1/2 rounded bg-white/10" />
                </div>
              </div>
            ))
          ) : visibleActivities.length === 0 ? (
            // Empty state
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Zap className="size-8 text-emerald-300/50" />
              <p className="text-sm text-emerald-200/70">Carregando atividades…</p>
            </div>
          ) : (
            visibleActivities.map((activity, i) => (
              <ActivityCard
                key={`${activity.type}-${activity.userName}-${i}`}
                activity={activity}
                index={i}
              />
            ))
          )}
        </div>

        {/* Footer stats */}
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
          {quotesToday > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-200/80">
              <FileText className="size-3" />
              {quotesToday} orçamentos hoje
            </span>
          )}
          {stats && stats.completedBookings > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-200/80">
              <TrendingUp className="size-3" />
              {stats.completedBookings.toLocaleString("pt-BR")} concluídos
            </span>
          )}
        </div>
      </div>

      {/* ── Floating toast notification (CSS fade-in/out) ── */}
      {activities.length > 0 && (
        <div
          key={`toast-${toastIndex}`}
          className="animate-fade-slide-up absolute -bottom-4 -left-4 z-10 flex items-center gap-2.5 rounded-2xl bg-white px-4 py-3 shadow-2xl ring-1 ring-black/5"
        >
            <span className="text-lg" aria-hidden>
              {activities[toastIndex % activities.length].emoji}
            </span>
            <div className="leading-tight">
              <p className="text-xs font-semibold text-slate-900">
                {activities[toastIndex % activities.length].userName}{" "}
                {activities[toastIndex % activities.length].action}
              </p>
              <p className="text-[11px] text-slate-500">
                {activities[toastIndex % activities.length].target}
              </p>
            </div>
            <span className="ml-2 text-[10px] text-slate-400 whitespace-nowrap">
              {activities[toastIndex % activities.length].timeAgo}
            </span>
          </div>
        )}

      {/* ── Floating rating badge ── */}
      {stats && stats.avgRating > 0 && (
        <div className="absolute -top-3 -right-3 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-xl ring-1 ring-black/5">
          <Star className="size-5 fill-amber-400 text-amber-400" />
          <div className="leading-tight">
            <p className="text-base font-bold text-slate-900">{stats.avgRating}</p>
            <p className="text-[11px] text-slate-500">{stats.reviews} avaliações</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity Card — individual activity in the feed
// ---------------------------------------------------------------------------

function ActivityCard({ activity, index }: { activity: ActivityItem; index: number }) {
  const meta = ACTIVITY_META[activity.type] ?? ACTIVITY_META.booking;
  const Icon = meta.icon;

  return (
    <div
      className="group flex items-start gap-3 rounded-xl bg-white/5 p-3 transition-colors hover:bg-white/10 slide-in-right"
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      {/* Avatar or icon */}
      <div className="relative shrink-0">
        {activity.userAvatar ? (
          <Image
            src={activity.userAvatar}
            alt={activity.userName}
            width={40}
            height={40}
            className="rounded-full object-cover ring-2 ring-white/20"
          />
        ) : (
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-full ring-1 ring-white/10",
              meta.bg,
            )}
          >
            <Icon className={cn("size-4", meta.color)} />
          </div>
        )}
        {/* Activity type badge */}
        <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-white/20 text-[10px] ring-1 ring-white/10">
          {activity.emoji}
        </span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug text-white/90">
          <span className="font-semibold">{activity.userName}</span>{" "}
          <span className="text-emerald-200/80">{activity.action}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-emerald-100/60">{activity.target}</p>
        {activity.rating && (
          <div className="mt-1 flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={cn(
                  "size-3",
                  i < (activity.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-white/20",
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Time */}
      <span className="shrink-0 text-[10px] font-medium text-emerald-200/50">
        {activity.timeAgo}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function TrustBadge({
  icon,
  title,
  tooltip,
}: {
  icon: React.ReactNode;
  title: string;
  tooltip: string;
}) {
  return (
    <li className="flex items-center gap-2" title={tooltip}>
      <span className="flex size-6 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
        {icon}
      </span>
      <span className="whitespace-nowrap font-medium">{title}</span>
    </li>
  );
}

function StatItem({
  icon,
  value,
  label,
  suffix,
  accent,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  suffix?: string;
  accent?: boolean;
}) {
  const numericValue = typeof value === "number" ? value : 0;
  const isNumeric = typeof value === "number";
  const { ref, value: animatedValue } = useCountUp(numericValue, {
    duration: 1800,
  });

  return (
    <div className="flex items-center gap-3 sm:border-l sm:border-white/20 sm:px-6 sm:first:border-l-0 sm:first:pl-0 sm:last:pr-0">
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1",
          accent ? "bg-emerald-400/20 ring-emerald-300/30" : "bg-white/10 ring-white/15",
        )}
      >
        {icon}
      </span>
      <div className="leading-tight">
        <p className="text-2xl font-bold tracking-tight text-white">
          {isNumeric ? <span ref={ref}>{animatedValue.toLocaleString("pt-BR")}</span> : value}
          {suffix && <span className="ml-1 text-sm font-normal text-emerald-200">{suffix}</span>}
        </p>
        <p className="text-xs text-emerald-100/80">{label}</p>
      </div>
    </div>
  );
}
