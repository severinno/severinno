"use client"

import * as React from "react"
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  ShieldCheck,
  Wallet,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatBRL, formatDateTime } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"
import type { BookingStatus, ServiceUnit } from "@/lib/constants"

// ---------------------------------------------------------------------------
// Interactive Command KPI Card Component
// ---------------------------------------------------------------------------

export function InteractiveKpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  badgeText,
  onClick,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
  hint: string
  tone: "primary" | "amber" | "sky" | "emerald"
  badgeText?: string
  onClick: () => void
}) {
  const toneConfig = {
    primary: {
      halo: "bg-primary/10 text-primary border-primary/20",
      badge: "bg-primary/10 text-primary border-primary/20",
      hoverBorder: "hover:border-primary/50",
    },
    amber: {
      halo: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
      hoverBorder: "hover:border-amber-500/50",
    },
    sky: {
      halo: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
      badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
      hoverBorder: "hover:border-sky-500/50",
    },
    emerald: {
      halo: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
      hoverBorder: "hover:border-emerald-500/50",
    },
  }[tone]

  return (
    <button
      type="button"
      title={hint}
      onClick={() => {
        triggerHaptic("selection")
        onClick()
      }}
      className={`group border-border/60 bg-card focus-visible:ring-primary relative flex cursor-pointer items-center justify-between overflow-hidden rounded-xl border p-3 text-left shadow-2xs transition-all duration-200 outline-none hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 ${toneConfig.hoverBorder}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg border transition-transform duration-200 group-hover:scale-105 ${toneConfig.halo}`}
        >
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-foreground text-lg font-bold tracking-tight tabular-nums">
              {value}
            </span>
            {badgeText && (
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[9.5px] leading-none font-medium tracking-tight ${toneConfig.badge}`}
              >
                {badgeText}
              </span>
            )}
          </div>
          <p className="text-muted-foreground truncate text-xs font-medium">{label}</p>
        </div>
      </div>
      <ChevronRight className="text-muted-foreground/35 group-hover:text-foreground size-4 shrink-0 transition-all duration-200 group-hover:translate-x-0.5" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Client Dashboard KPIs Section
// ---------------------------------------------------------------------------

export type InProgressBooking = {
  id: string
  status: BookingStatus
  scheduledAt: string
  amount: number
  service: {
    id: string
    title: string
    basePrice: number
    unit: ServiceUnit
  }
  provider: { id: string; name: string; avatarUrl?: string | null }
}

export interface ClientDashboardKpisProps {
  inProgressBooking?: InProgressBooking | null
  upcomingCount: number
  activeQuotesCount: number
  completedCount: number
  totalInvested: number
  onNavigate: (view: string) => void
}

export function ClientDashboardKpis({
  inProgressBooking,
  upcomingCount,
  activeQuotesCount,
  completedCount,
  totalInvested,
  onNavigate,
}: ClientDashboardKpisProps) {
  return (
    <div className="space-y-4 sm:space-y-5">
      {/* 1. In-progress active service alert if any */}
      {inProgressBooking && (
        <div className="border-primary/30 from-primary/10 via-primary/5 to-card relative overflow-hidden rounded-2xl border bg-gradient-to-r p-4.5 shadow-2xs sm:p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3.5 sm:items-center">
              <span className="relative mt-1 flex size-3.5 shrink-0 sm:mt-0">
                <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                <span className="bg-primary relative inline-flex size-3.5 rounded-full" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-primary text-[11px] font-bold tracking-wider uppercase">
                    Serviço em Andamento Agora
                  </span>
                  <span className="text-muted-foreground text-[10px]">·</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatDateTime(inProgressBooking.scheduledAt)}
                  </span>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    {formatBRL(inProgressBooking.amount)} em Custódia
                  </span>
                </div>
                <p className="text-foreground mt-0.5 truncate text-sm font-bold sm:text-base">
                  {inProgressBooking.service.title} com {inProgressBooking.provider.name}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  O valor de {formatBRL(inProgressBooking.amount)} está protegido pelo Escrow e só é
                  liberado após a sua aprovação final.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onNavigate("client.bookings")
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 shrink-0 gap-1 self-start rounded-xl px-4 text-xs font-semibold shadow-2xs sm:self-auto"
            >
              Acompanhar
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* 2. Escrow & Protection Banner — High-trust Institutional Reassurance */}
      <div className="via-card dark:via-card relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-50/70 to-emerald-500/5 p-4.5 shadow-2xs sm:p-5 dark:border-emerald-800/30 dark:from-emerald-950/20 dark:to-emerald-950/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 shadow-2xs ring-1 ring-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400">
              <ShieldCheck className="size-6" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-foreground text-sm font-bold tracking-tight sm:text-base">
                  Garantia Severinno Escrow & Proteção 90 Dias
                </p>
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  Custódia Ativa
                </span>
              </div>
              <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed sm:text-sm">
                Seu pagamento fica seguro na custódia e só é liberado ao profissional após a sua
                aprovação final do serviço. Sem risco de perda financeira ou serviços mal
                executados.
              </p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Custódia 100% via PIX
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Garantia de 90 dias
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Mediação e suporte ao cliente
                </span>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onNavigate("client.bookings")
            }}
            className="bg-background/80 h-9 shrink-0 gap-1.5 self-start rounded-xl border-emerald-600/30 px-4 text-xs font-semibold text-emerald-700 shadow-2xs hover:bg-emerald-500/10 lg:self-center dark:text-emerald-300"
          >
            <span>Gerenciar liberação</span>
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 3. 4 Interactive Command KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InteractiveKpiCard
          icon={CalendarDays}
          label="Próximos agendamentos"
          value={upcomingCount}
          tone="primary"
          badgeText={
            upcomingCount > 0
              ? `${upcomingCount} ativo${upcomingCount > 1 ? "s" : ""}`
              : "0 pendentes"
          }
          hint="Pendentes, confirmados e em andamento"
          onClick={() => onNavigate("client.bookings")}
        />
        <InteractiveKpiCard
          icon={FileText}
          label="Orçamentos ativos"
          value={activeQuotesCount}
          tone="amber"
          badgeText={activeQuotesCount > 0 ? `${activeQuotesCount} em aberto` : "0 pendentes"}
          hint="Aguardando resposta ou ação"
          onClick={() => onNavigate("client.quotes")}
        />
        <InteractiveKpiCard
          icon={CheckCircle2}
          label="Serviços concluídos"
          value={completedCount}
          tone="sky"
          badgeText={completedCount > 0 ? `${completedCount} realizados` : "0 concluídos"}
          hint="Histórico com garantia 90 dias"
          onClick={() => onNavigate("client.bookings")}
        />
        <InteractiveKpiCard
          icon={Wallet}
          label="Total investido"
          value={formatBRL(totalInvested)}
          tone="emerald"
          badgeText="100% Protegido"
          hint="Soma de pagamentos confirmados"
          onClick={() => onNavigate("client.bookings")}
        />
      </div>
    </div>
  )
}
