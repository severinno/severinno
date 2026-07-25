"use client";

/**
 * CtaBanner — conversion-focused call-to-action section.
 *
 * Enhanced with Jakob Nielsen's 10 Usability Heuristics:
 *   H1 – Visibility: Dynamic stats from API, "X novos cadastros nas últimas 24h", live counter
 *   H2 – Match real world: "Comece em 30 segundos", Uber-like analogy
 *   H3 – User control: Tab toggle (cliente / prestador) with sliding indicator, "Já tenho conta" link
 *   H4 – Consistency: Same emerald gradient, badge and button components
 *   H5 – Error prevention: Trust badges, guarantee badges row, no surprise costs
 *   H6 – Recognition: Avatar stack, trust badges, star rating, handshake illustration
 *   H7 – Flexibility: One-click CTA, multiple entry points
 *   H8 – Minimalism: Single focused CTA per persona, clean split-screen layout
 *   H9 – Error recovery: "Sem compromisso, cancele quando quiser"
 *  H10 – Help: "O que vem depois?" mini-steps with animated connector, FAQ link
 */

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Wrench,
  Search,
  Sparkles,
  CheckCircle2,
  UserPlus,
  SearchCheck,
  CalendarCheck,
  ShieldCheck,
  LogIn,
  Star,
  Timer,
  Clock,
  CreditCard,
  XCircle,
  Quote,
  Headset,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useScrollReveal, useCountUp } from "@/hooks/use-animation";
import { useAuthStore, useUIStore } from "@/store";
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
  totalUsers: number;
  recentSignups24h: number;
};

type VisitorTab = "client" | "provider";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLIENT_BENEFITS = ["Cadastro gratuito", "Sem taxa de serviço", "Orçamento sem compromisso"];

const PROVIDER_BENEFITS = [
  "Receba orçamentos qualificados",
  "Gestão de agenda integrada",
  "Pagamento garantido",
];

const SIGNUP_STEPS = [
  {
    icon: UserPlus,
    label: "Cadastre-se grátis",
    time: "30s",
  },
  {
    icon: SearchCheck,
    label: "Busque e compare",
    time: "2 min",
  },
  {
    icon: CalendarCheck,
    label: "Agende com confiança",
    time: "5 min",
  },
] as const;

const GUARANTEE_BADGES = [
  { icon: XCircle, label: "Sem compromisso" },
  { icon: Clock, label: "Cancele quando quiser" },
  { icon: Headset, label: "Suporte 24h" },
] as const;

const TRUST_SIGNS = [
  { icon: XCircle, label: "Sem compromisso" },
  { icon: Clock, label: "Cancele quando quiser" },
  { icon: CreditCard, label: "Pagamento protegido" },
] as const;

const TESTIMONIAL = {
  quote:
    "Encontrei um encanador em 10 minutos, paguei menos do que esperava e ainda pude avaliar o serviço. Recomendo demais!",
  author: "Ana P.",
  role: "Cliente, São Paulo",
};

const FLOATING_MICRO = [
  { type: "star" as const, x: "5%", y: "8%", size: 12, delay: 0, duration: 5 },
  { type: "check" as const, x: "90%", y: "15%", size: 10, delay: 1.5, duration: 6 },
  { type: "dot" as const, x: "80%", y: "70%", size: 8, delay: 0.8, duration: 4.5 },
  { type: "star" as const, x: "12%", y: "82%", size: 10, delay: 2, duration: 5.5 },
  { type: "dot" as const, x: "70%", y: "25%", size: 6, delay: 0.5, duration: 7 },
  { type: "check" as const, x: "25%", y: "55%", size: 8, delay: 1.2, duration: 6 },
  { type: "dot" as const, x: "55%", y: "90%", size: 10, delay: 1.8, duration: 5 },
  { type: "star" as const, x: "45%", y: "5%", size: 8, delay: 0.3, duration: 6.5 },
] as const;

// ---------------------------------------------------------------------------
// Avatar stack for social proof
// ---------------------------------------------------------------------------

const AVATAR_DATA = [
  { initials: "AL", color: "bg-emerald-500" },
  { initials: "RM", color: "bg-teal-500" },
  { initials: "JS", color: "bg-amber-500" },
  { initials: "PF", color: "bg-rose-500" },
  { initials: "CM", color: "bg-cyan-500" },
];

function AvatarStack() {
  return (
    <div className="flex items-center">
      {AVATAR_DATA.map((avatar, i) => (
        <div
          key={i}
          className={cn(
            "flex size-8 items-center justify-center rounded-full ring-2 ring-white/20 text-[10px] font-bold text-white select-none",
            avatar.color,
            i > 0 && "-ml-2",
          )}
          aria-hidden
        >
          {avatar.initials}
        </div>
      ))}
      <div
        className="flex size-8 items-center justify-center rounded-full ring-2 ring-white/20 bg-white/20 text-[10px] font-bold text-white -ml-2 select-none"
        aria-hidden
      >
        +5
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating micro-elements (stars, checkmarks, dots)
// ---------------------------------------------------------------------------

function FloatingMicro({
  type,
  x,
  y,
  size,
  delay,
  duration,
}: {
  type: "star" | "check" | "dot";
  x: string;
  y: string;
  size: number;
  delay: number;
  duration: number;
}) {
  return (
    <motion.div
      aria-hidden
      className="absolute pointer-events-none"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.3 }}
      animate={{
        opacity: [0, 0.25, 0.1, 0.2],
        scale: [0.6, 1.1, 0.8, 1],
        y: [0, -8, 3, -5],
        x: [0, 4, -3, 2],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        repeatType: "reverse",
        ease: [0.42, 0, 0.58, 1],
      }}
    >
      {type === "star" && (
        <Star
          style={{ width: size, height: size }}
          className="fill-amber-300/30 text-amber-300/40"
        />
      )}
      {type === "check" && (
        <CheckCircle2 style={{ width: size, height: size }} className="text-emerald-300/30" />
      )}
      {type === "dot" && (
        <div style={{ width: size, height: size }} className="rounded-full bg-white/20" />
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Animated mesh blobs
// ---------------------------------------------------------------------------

function MeshBlobs() {
  return (
    <>
      {/* Primary blob — top right */}
      <motion.div
        aria-hidden
        className="absolute -top-20 -right-10 size-72 rounded-full bg-emerald-400/30 blur-3xl"
        animate={{
          scale: [1, 1.15, 0.95, 1.1],
          x: [0, 15, -10, 5],
          y: [0, -10, 8, -5],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          repeatType: "reverse",
          ease: [0.42, 0, 0.58, 1],
        }}
      />
      {/* Secondary blob — bottom left */}
      <motion.div
        aria-hidden
        className="absolute -bottom-24 -left-10 size-80 rounded-full bg-teal-300/20 blur-3xl"
        animate={{
          scale: [1, 0.9, 1.1, 0.95],
          x: [0, -12, 8, -5],
          y: [0, 10, -8, 5],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          repeatType: "reverse",
          ease: [0.42, 0, 0.58, 1],
          delay: 1,
        }}
      />
      {/* Tertiary blob — center accent */}
      <motion.div
        aria-hidden
        className="absolute top-1/3 left-1/2 size-60 rounded-full bg-emerald-300/10 blur-3xl"
        animate={{
          scale: [1, 1.2, 0.85, 1.1],
          x: [0, -20, 10, -8],
          y: [0, 8, -12, 6],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          repeatType: "reverse",
          ease: [0.42, 0, 0.58, 1],
          delay: 2,
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Pulsing glow wrapper for CTA button — emerald glow on hover
// ---------------------------------------------------------------------------

function PulsingGlow({ children }: { children: React.ReactNode }) {
  return (
    <div className="group/glow relative inline-flex">
      {/* Ambient glow ring */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-lg bg-emerald-400/30 blur-lg opacity-0 transition-opacity duration-300 group-hover/glow:opacity-100"
      />
      {/* Pulsing ring */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-lg bg-white/40 blur-md"
        animate={{
          opacity: [0, 0.4, 0],
          scale: [1, 1.06, 1],
        }}
        transition={{
          duration: 2.5,
          repeat: Infinity,
          ease: [0.42, 0, 0.58, 1],
        }}
      />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live counter badge — "X pessoas se cadastraram hoje"
// ---------------------------------------------------------------------------

function LiveCounter({ count }: { count: number }) {
  const { ref, value } = useCountUp(count, { duration: 1500 });
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-100 ring-1 ring-white/20"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
      </span>
      <span ref={ref}>{value}</span> pessoas se cadastraram hoje
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// Right-side abstract illustration — customer + provider handshake
// ---------------------------------------------------------------------------

function HandshakeIllustration() {
  return (
    <div className="relative flex h-full items-center justify-center" aria-hidden>
      {/* Abstract person 1 — customer */}
      <motion.div
        className="absolute left-[15%] top-[25%]"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
      >
        {/* Head */}
        <div className="size-12 rounded-full bg-gradient-to-br from-emerald-300 to-emerald-400 shadow-lg shadow-emerald-400/30" />
        {/* Body */}
        <div className="mx-auto mt-1 h-14 w-10 rounded-t-full bg-gradient-to-b from-emerald-300/80 to-emerald-400/60" />
        {/* Label */}
        <span className="mt-1 block text-center text-[9px] font-semibold text-white/80">
          Cliente
        </span>
      </motion.div>

      {/* Abstract person 2 — provider */}
      <motion.div
        className="absolute right-[15%] top-[25%]"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.6, duration: 0.6 }}
      >
        {/* Head */}
        <div className="size-12 rounded-full bg-gradient-to-br from-teal-300 to-teal-400 shadow-lg shadow-teal-400/30" />
        {/* Body */}
        <div className="mx-auto mt-1 h-14 w-10 rounded-t-full bg-gradient-to-b from-teal-300/80 to-teal-400/60" />
        {/* Wrench badge */}
        <div className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-amber-400 shadow-md">
          <Wrench className="size-3 text-white" />
        </div>
        {/* Label */}
        <span className="mt-1 block text-center text-[9px] font-semibold text-white/80">
          Prestador
        </span>
      </motion.div>

      {/* Handshake in the middle — two overlapping circles */}
      <motion.div
        className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8, duration: 0.5, type: "spring" }}
      >
        <div className="relative flex size-16 items-center justify-center">
          <div className="absolute size-14 rounded-full border-2 border-white/20" />
          <div className="absolute size-10 rounded-full bg-gradient-to-br from-emerald-400/60 to-teal-400/60 backdrop-blur-sm" />
          <Sparkles className="relative size-6 text-white" />
        </div>
      </motion.div>

      {/* Decorative connection lines */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 300 250" fill="none">
        <motion.path
          d="M 80 80 Q 150 60 150 110"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 1, duration: 0.8 }}
        />
        <motion.path
          d="M 220 80 Q 150 60 150 110"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 1.2, duration: 0.8 }}
        />
      </svg>

      {/* Decorative floating elements around illustration */}
      <motion.div
        className="absolute left-[8%] bottom-[20%]"
        animate={{ y: [0, -6, 0], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 3, repeat: Infinity }}
      >
        <Star className="size-4 fill-amber-300/40 text-amber-300/50" />
      </motion.div>
      <motion.div
        className="absolute right-[10%] bottom-[30%]"
        animate={{ y: [0, -5, 0], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, delay: 1 }}
      >
        <CheckCircle2 className="size-4 text-emerald-300/40" />
      </motion.div>
      <motion.div
        className="absolute left-1/2 bottom-[10%] -translate-x-1/2"
        animate={{ y: [0, -4, 0], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 3.5, repeat: Infinity, delay: 0.5 }}
      >
        <ShieldCheck className="size-5 text-white/20" />
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook: fetch public stats
// ---------------------------------------------------------------------------

function usePublicStats() {
  const [stats, setStats] = React.useState<PublicStats | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/stats/public");
        if (!res.ok) return;
        const data: PublicStats = await res.json();
        if (!cancelled) setStats(data);
      } catch {
        // silently ignore — fallback values used
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return stats;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CtaBanner() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  const { status, user } = useAuthStore();
  const openAuth = useUIStore((s) => s.openAuth);
  const stats = usePublicStats();

  const isClient = status === "authenticated" && user?.role === "CLIENT";
  const isProvider = status === "authenticated" && user?.role === "PROVIDER";
  const isVisitor = status !== "authenticated";

  // Visitor tab state
  const [visitorTab, setVisitorTab] = React.useState<VisitorTab>("client");

  // Animated count for totalUsers
  const totalUsersValue = stats?.totalUsers ?? 527;
  const { ref: countRef, value: displayedUsers } = useCountUp(totalUsersValue, {
    duration: 2000,
    startOnView: true,
  });

  // Derive benefits and CTAs based on active tab (for visitors) or auth role
  const activeBenefits = isVisitor
    ? visitorTab === "client"
      ? CLIENT_BENEFITS
      : PROVIDER_BENEFITS
    : isProvider
      ? PROVIDER_BENEFITS
      : CLIENT_BENEFITS;

  return (
    <section className="relative isolate overflow-hidden bg-background py-16 sm:py-20">
      <div ref={ref} className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.98 }}
          animate={visible ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-900 shadow-2xl"
        >
          {/* Animated mesh blobs */}
          <MeshBlobs />

          {/* Grid pattern */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />

          {/* Floating micro-elements (stars, checkmarks, dots) */}
          {FLOATING_MICRO.map((item, i) => (
            <FloatingMicro key={i} {...item} />
          ))}

          {/* ── Split-screen layout ────────────────────────────────── */}
          <div className="relative grid items-center gap-8 px-6 py-12 sm:px-12 sm:py-16 lg:grid-cols-[1.3fr_1fr] lg:gap-12">
            {/* LEFT side: CTA text + buttons */}
            <div>
              {/* Top badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur ring-1 ring-white/20">
                  <Sparkles className="size-3.5" />
                  Comece agora mesmo
                </span>
                {stats && stats.recentSignups24h > 0 && (
                  <LiveCounter count={stats.recentSignups24h} />
                )}
              </div>

              <h2 className="mt-4 text-balance text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
                {isVisitor &&
                  (visitorTab === "client"
                    ? "Pronto para encontrar o prestador ideal?"
                    : "Pronto para grow no seu negócio?")}
                {isClient && "Encontre o serviço que você precisa"}
                {isProvider && "Comece a receber orçamentos hoje"}
                {!isVisitor && !isClient && !isProvider && "Pronto para começar?"}
              </h2>

              <p className="mt-3 max-w-xl text-pretty text-emerald-50/90">
                {isVisitor &&
                  (visitorTab === "client"
                    ? "Comece em 30 segundos — é como pedir um Uber, mas para serviços. Cadastre-se gratuitamente e tenha acesso a prestadores verificados."
                    : "Cadastre seus serviços, defina sua área de atendimento e comece a receber solicitações de clientes na sua região. Sem taxa de adesão.")}
                {isClient &&
                  "Navegue pela vitrine, salve seus favoritos e agende com confiança. Tudo em um só lugar."}
                {isProvider &&
                  "Cadastre seus serviços, defina sua área de atendimento e comece a receber solicitações de clientes na sua região."}
              </p>

              {/* Visitor tab toggle — with sliding indicator */}
              {isVisitor && (
                <div className="mt-5 inline-flex rounded-lg bg-white/10 p-1 ring-1 ring-white/15 backdrop-blur">
                  <button
                    onClick={() => setVisitorTab("client")}
                    className={cn(
                      "relative rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                      visitorTab === "client"
                        ? "text-emerald-900"
                        : "text-white/70 hover:text-white",
                    )}
                  >
                    {visitorTab === "client" && (
                      <motion.div
                        layoutId="visitor-tab-indicator"
                        className="absolute inset-0 rounded-md bg-white shadow-sm"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                      />
                    )}
                    <span className="relative z-10">Para clientes</span>
                  </button>
                  <button
                    onClick={() => setVisitorTab("provider")}
                    className={cn(
                      "relative rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                      visitorTab === "provider"
                        ? "text-emerald-900"
                        : "text-white/70 hover:text-white",
                    )}
                  >
                    {visitorTab === "provider" && (
                      <motion.div
                        layoutId="visitor-tab-indicator"
                        className="absolute inset-0 rounded-md bg-white shadow-sm"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                      />
                    )}
                    <span className="relative z-10">Para prestadores</span>
                  </button>
                </div>
              )}

              {/* Benefits list */}
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={isVisitor ? visitorTab : isProvider ? "provider" : "client"}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.25 }}
                    className="flex flex-wrap gap-x-5 gap-y-2"
                  >
                    {activeBenefits.map((benefit) => (
                      <li
                        key={benefit}
                        className="flex items-center gap-1.5 text-sm text-emerald-50"
                      >
                        <CheckCircle2 className="size-4 text-emerald-300" />
                        {benefit}
                      </li>
                    ))}
                  </motion.div>
                </AnimatePresence>
              </ul>

              {/* CTAs */}
              <div className="mt-7 flex flex-wrap items-center gap-3">
                {isVisitor && (
                  <>
                    <PulsingGlow>
                      <motion.div
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 400, damping: 17 }}
                      >
                        <Button
                          size="lg"
                          onClick={() =>
                            openAuth("register", visitorTab === "provider" ? "PROVIDER" : "CLIENT")
                          }
                          className="h-12 gap-2 bg-white px-7 text-base font-semibold text-emerald-700 shadow-lg transition-shadow hover:bg-emerald-50 hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-emerald-500/30"
                        >
                          {visitorTab === "client"
                            ? "Cadastrar grátis"
                            : "Cadastrar como prestador"}
                          <motion.span
                            animate={{ x: [0, 4, 0] }}
                            transition={{
                              duration: 1.5,
                              repeat: Infinity,
                              repeatType: "reverse",
                              ease: [0.42, 0, 0.58, 1],
                            }}
                          >
                            <ArrowRight className="size-4" />
                          </motion.span>
                        </Button>
                      </motion.div>
                    </PulsingGlow>
                    {visitorTab === "client" && (
                      <motion.div
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 400, damping: 17 }}
                      >
                        <Button
                          size="lg"
                          variant="outline"
                          onClick={() => openAuth("register", "PROVIDER")}
                          className="h-12 gap-2 border-white/30 bg-white/10 px-6 text-base font-medium text-white backdrop-blur hover:bg-white/20 hover:text-white"
                        >
                          <Wrench className="size-4" />
                          Sou prestador
                        </Button>
                      </motion.div>
                    )}
                    {visitorTab === "provider" && (
                      <motion.div
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 400, damping: 17 }}
                      >
                        <Button
                          size="lg"
                          variant="outline"
                          onClick={() => openAuth("register", "CLIENT")}
                          className="h-12 gap-2 border-white/30 bg-white/10 px-6 text-base font-medium text-white backdrop-blur hover:bg-white/20 hover:text-white"
                        >
                          <Search className="size-4" />
                          Sou cliente
                        </Button>
                      </motion.div>
                    )}
                  </>
                )}
                {isClient && (
                  <PulsingGlow>
                    <motion.div
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Button
                        size="lg"
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            document
                              .getElementById("vitrine-resultados")
                              ?.scrollIntoView({ behavior: "smooth" });
                          }
                        }}
                        className="h-12 gap-2 bg-white px-7 text-base font-semibold text-emerald-700 shadow-lg transition-shadow hover:bg-emerald-50 hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-emerald-500/30"
                      >
                        <Search className="size-4" />
                        Buscar prestadores
                        <motion.span
                          animate={{ x: [0, 4, 0] }}
                          transition={{
                            duration: 1.5,
                            repeat: Infinity,
                            repeatType: "reverse",
                            ease: [0.42, 0, 0.58, 1],
                          }}
                        >
                          <ArrowRight className="size-4" />
                        </motion.span>
                      </Button>
                    </motion.div>
                  </PulsingGlow>
                )}
                {isProvider && (
                  <PulsingGlow>
                    <motion.div
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Button
                        size="lg"
                        onClick={() => openAuth("login")}
                        className="h-12 gap-2 bg-white px-7 text-base font-semibold text-emerald-700 shadow-lg transition-shadow hover:bg-emerald-50 hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-emerald-500/30"
                      >
                        Ir para meu painel
                        <motion.span
                          animate={{ x: [0, 4, 0] }}
                          transition={{
                            duration: 1.5,
                            repeat: Infinity,
                            repeatType: "reverse",
                            ease: [0.42, 0, 0.58, 1],
                          }}
                        >
                          <ArrowRight className="size-4" />
                        </motion.span>
                      </Button>
                    </motion.div>
                  </PulsingGlow>
                )}
              </div>

              {/* Urgency element */}
              {isVisitor && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={visible ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.6, duration: 0.4 }}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/30 px-3 py-1 text-xs font-medium text-emerald-100 ring-1 ring-emerald-400/20"
                >
                  <Timer className="size-3.5" />
                  Comece em 30 segundos
                </motion.div>
              )}

              {/* "Já tenho conta" link */}
              {isVisitor && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={visible ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.7, duration: 0.4 }}
                >
                  <button
                    onClick={() => openAuth("login")}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur-sm transition-all hover:bg-white/20 hover:ring-white/30"
                  >
                    <LogIn className="size-4" />
                    Já tenho conta · Entrar
                  </button>
                </motion.div>
              )}

              {/* Avatar stack social proof */}
              {isVisitor && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={visible ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.5, duration: 0.4 }}
                  className="mt-5 flex items-center gap-3"
                >
                  <AvatarStack />
                  <div>
                    <p className="text-sm font-medium text-white">
                      <span ref={countRef}>{displayedUsers}</span>+ cadastrados
                    </p>
                    <p className="text-[11px] text-emerald-100/70">na plataforma</p>
                  </div>
                  {stats && stats.avgRating > 0 && (
                    <div className="ml-2 flex items-center gap-1 text-xs text-emerald-200">
                      <Star className="size-3.5 fill-amber-400 text-amber-400" />
                      {stats.avgRating}
                    </div>
                  )}
                </motion.div>
              )}
            </div>

            {/* RIGHT side: "O que vem depois?" steps + handshake illustration */}
            <div className="relative hidden lg:block">
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={visible ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl bg-white/[0.08] p-6 backdrop-blur-xl ring-1 ring-white/[0.12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
              >
                <h3 className="text-sm font-semibold text-emerald-100">O que vem depois?</h3>
                <p className="mt-1 text-xs text-emerald-100/60">
                  Três passos simples e você estará agendando
                </p>

                <div className="mt-5 relative">
                  {/* Connected dots/steps with animated line */}
                  <svg
                    aria-hidden
                    className="absolute left-5 top-6 h-[calc(100%-2rem)] w-8"
                    viewBox="0 0 40 200"
                    preserveAspectRatio="none"
                  >
                    <motion.line
                      x1="20"
                      y1="20"
                      x2="20"
                      y2="180"
                      stroke="rgba(255,255,255,0.15)"
                      strokeWidth="2"
                      strokeDasharray="4 3"
                    />
                    <motion.line
                      x1="20"
                      y1="20"
                      x2="20"
                      y2="180"
                      stroke="rgba(16,185,129,0.6)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      initial={{ pathLength: 0 }}
                      animate={visible ? { pathLength: 1 } : {}}
                      transition={{ duration: 1.5, delay: 0.5, ease: "easeOut" }}
                    />
                  </svg>

                  <div className="space-y-5">
                    {SIGNUP_STEPS.map((step, i) => {
                      return (
                        <motion.div
                          key={step.label}
                          initial={{ opacity: 0, x: 12 }}
                          animate={visible ? { opacity: 1, x: 0 } : {}}
                          transition={{
                            duration: 0.4,
                            delay: 0.4 + i * 0.15,
                          }}
                          className="flex items-start gap-3"
                        >
                          {/* Step number circle with number */}
                          <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]">
                            <span className="text-xs font-bold text-white">{i + 1}</span>
                          </div>
                          <div className="pt-1">
                            <p className="text-sm font-medium text-white">{step.label}</p>
                            <p className="mt-0.5 text-xs text-emerald-100/60">~{step.time}</p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>

                {/* Guarantee badges row (H5) */}
                <div className="mt-5 flex items-center justify-center gap-3 border-t border-white/10 pt-4">
                  {GUARANTEE_BADGES.map((badge) => {
                    const BadgeIcon = badge.icon;
                    return (
                      <span
                        key={badge.label}
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-100/70"
                      >
                        <BadgeIcon className="size-3 text-emerald-300" />
                        {badge.label}
                      </span>
                    );
                  })}
                </div>

                {/* Learn more link */}
                <a
                  href="#faq"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-200 hover:text-white transition-colors"
                >
                  <ShieldCheck className="size-3" />
                  Saiba mais sobre pagamento protegido
                </a>
              </motion.div>

              {/* Handshake illustration below the steps card */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={visible ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.5 }}
                className="mt-4 h-48 rounded-2xl bg-white/[0.04] ring-1 ring-white/[0.08] backdrop-blur-sm overflow-hidden"
              >
                <HandshakeIllustration />
              </motion.div>
            </div>
          </div>

          {/* ── Testimonial quote at the bottom ─────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={visible ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.9, duration: 0.5 }}
            className="border-t border-white/10 px-6 py-5 sm:px-12"
          >
            <div className="mx-auto flex max-w-2xl items-start gap-3">
              <Quote className="mt-0.5 size-5 shrink-0 text-emerald-300/50" />
              <div>
                <p className="text-sm italic leading-relaxed text-emerald-100/80">
                  &ldquo;{TESTIMONIAL.quote}&rdquo;
                </p>
                <p className="mt-1.5 text-xs font-medium text-emerald-200/60">
                  — {TESTIMONIAL.author}, {TESTIMONIAL.role}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Bottom trust strip */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={visible ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 1, duration: 0.5 }}
            className="flex flex-wrap items-center justify-center gap-4 border-t border-white/10 px-6 py-4 sm:gap-6 sm:px-12"
          >
            {TRUST_SIGNS.map((sign) => {
              const SignIcon = sign.icon;
              return (
                <span
                  key={sign.label}
                  className="inline-flex items-center gap-1.5 text-xs text-emerald-100/70"
                >
                  <SignIcon className="size-3.5 text-emerald-300" />
                  {sign.label}
                </span>
              );
            })}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
