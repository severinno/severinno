"use client"

import * as React from "react"
import { CalendarDays, ChevronRight, FileText, Loader2, MapPin, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { EmptyState, SectionTitle } from "@/components/shared/shell"
import {
  StatusBadge,
  bookingIcon,
  bookingTone,
  quoteIcon,
  quoteTone,
} from "@/components/client/client-shared"
import {
  BOOKING_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  type BookingStatus,
  type QuoteStatus,
} from "@/lib/constants"
import { formatBRL, formatDateTime, formatRelative } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"

export type DashboardBookingItem = {
  id: string
  status: BookingStatus
  scheduledAt: string
  amount: number
  service: { title: string }
  provider: { name: string; avatarUrl?: string | null }
}

export type DashboardQuoteItem = {
  id: string
  status: QuoteStatus
  createdAt: string
  provider: { name: string; avatarUrl?: string | null }
  items: Array<{ service: { title: string } }>
}

export type DashboardActivityItem = {
  type: "booking" | "quote"
  id: string
  at: string
  title: string
  status: BookingStatus | QuoteStatus
  provider: { name: string; avatarUrl?: string | null }
  amount: number
}

export interface ClientDashboardActivityProps {
  upcomingBookings: DashboardBookingItem[]
  activeQuotes: DashboardQuoteItem[]
  recentActivity: DashboardActivityItem[]
  isLoading: boolean
  onNavigate: (view: any) => void
  onOpenQuote: () => void
}

export function ClientDashboardActivity({
  upcomingBookings,
  activeQuotes,
  recentActivity,
  isLoading,
  onNavigate,
  onOpenQuote,
}: ClientDashboardActivityProps) {
  return (
    <div className="space-y-6">
      {/* 1. Upcoming bookings + Active quotes side-by-side */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Upcoming bookings */}
        <div className="space-y-3">
          <SectionTitle
            title="Próximos agendamentos"
            description="Serviços agendados para os próximos dias."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onNavigate("client.bookings")
                }}
                className="text-primary hover:text-primary h-8 gap-1 text-xs font-semibold"
              >
                Ver tudo
                <ChevronRight className="size-3.5" />
              </Button>
            }
          />
          {isLoading ? (
            <div className="border-border/50 bg-card text-muted-foreground flex items-center justify-center gap-2 rounded-2xl border p-8 text-sm shadow-2xs">
              <Loader2 className="text-primary size-5 animate-spin" />
              Carregando agendamentos…
            </div>
          ) : upcomingBookings.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nenhum agendamento próximo"
              description="Que tal agendar seu primeiro serviço? Explore prestadores verificados perto de você."
              action={
                <Button
                  onClick={() => {
                    triggerHaptic("selection")
                    onNavigate("client.providers")
                  }}
                  className="mt-2 gap-2 rounded-xl text-xs font-semibold shadow-2xs"
                >
                  <MapPin className="size-4" />
                  Buscar prestadores
                </Button>
              }
            />
          ) : (
            <div className="space-y-2.5">
              {upcomingBookings.slice(0, 3).map((b) => {
                const initials = (b.provider.name ?? "")
                  .split(" ")
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection")
                      onNavigate("client.bookings")
                    }}
                    className="group border-border/60 bg-card hover:border-primary/40 focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border p-4 text-left transition-all outline-none hover:shadow-xs focus-visible:ring-2"
                  >
                    <Avatar className="border-border/60 size-11 shrink-0 border shadow-2xs">
                      {b.provider.avatarUrl ? (
                        <AvatarImage
                          src={b.provider.avatarUrl}
                          alt={b.provider.name}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground group-hover:text-primary truncate text-sm font-bold transition-colors">
                        {b.service.title}
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs tabular-nums">
                        {formatDateTime(b.scheduledAt)} · {b.provider.name}
                      </p>
                    </div>
                    {b.amount > 0 && (
                      <span className="text-foreground hidden text-xs font-bold tabular-nums sm:inline-block">
                        {formatBRL(b.amount)}
                      </span>
                    )}
                    <StatusBadge
                      tone={bookingTone(b.status as BookingStatus)}
                      icon={bookingIcon(b.status as BookingStatus)}
                    >
                      {BOOKING_STATUS_LABELS[b.status as BookingStatus]}
                    </StatusBadge>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Active quotes */}
        <div className="space-y-3">
          <SectionTitle
            title="Orçamentos ativos"
            description="Aguardando resposta do prestador ou sua ação."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onNavigate("client.quotes")
                }}
                className="text-primary hover:text-primary h-8 gap-1 text-xs font-semibold"
              >
                Ver tudo
                <ChevronRight className="size-3.5" />
              </Button>
            }
          />
          {isLoading ? (
            <div className="border-border/50 bg-card text-muted-foreground flex items-center justify-center gap-2 rounded-2xl border p-8 text-sm shadow-2xs">
              <Loader2 className="text-primary size-5 animate-spin" />
              Carregando orçamentos…
            </div>
          ) : activeQuotes.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhum orçamento ativo"
              description="Solicite um orçamento sob medida e receba propostas detalhadas de profissionais."
              action={
                <Button
                  onClick={() => {
                    triggerHaptic("selection")
                    onOpenQuote()
                  }}
                  className="mt-2 gap-2 rounded-xl text-xs font-semibold shadow-2xs"
                >
                  <Plus className="size-4" />
                  Pedir orçamento
                </Button>
              }
            />
          ) : (
            <div className="space-y-2.5">
              {activeQuotes.slice(0, 3).map((q) => {
                const initials = (q.provider.name ?? "")
                  .split(" ")
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection")
                      onNavigate("client.quotes")
                    }}
                    className="group border-border/60 bg-card focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border p-4 text-left transition-all outline-none hover:border-amber-500/40 hover:shadow-xs focus-visible:ring-2"
                  >
                    <Avatar className="border-border/60 size-11 shrink-0 border shadow-2xs">
                      {q.provider.avatarUrl ? (
                        <AvatarImage
                          src={q.provider.avatarUrl}
                          alt={q.provider.name}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-amber-500/10 text-xs font-bold text-amber-700 dark:text-amber-300">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-bold transition-colors group-hover:text-amber-600 dark:group-hover:text-amber-400">
                        {q.items[0]?.service?.title ?? "Orçamento sob medida"}
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs tabular-nums">
                        {q.provider.name} · {formatRelative(q.createdAt)}
                      </p>
                    </div>
                    <StatusBadge
                      tone={quoteTone(q.status as QuoteStatus)}
                      icon={quoteIcon(q.status as QuoteStatus)}
                    >
                      {QUOTE_STATUS_LABELS[q.status as QuoteStatus]}
                    </StatusBadge>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 2. Recent activity timeline */}
      <div className="space-y-3">
        <SectionTitle
          title="Atividade recente"
          description="Seus últimos agendamentos e orçamentos."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onNavigate("client.bookings")
              }}
              className="text-primary hover:text-primary h-8 gap-1 text-xs font-semibold"
            >
              Ver tudo
              <ChevronRight className="size-3.5" />
            </Button>
          }
        />

        {isLoading ? (
          <div className="border-border/50 bg-card text-muted-foreground flex items-center justify-center gap-2 rounded-2xl border p-8 text-sm shadow-2xs">
            <Loader2 className="text-primary size-5 animate-spin" />
            Carregando atividade…
          </div>
        ) : recentActivity.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nenhuma atividade ainda"
            description="Quando você começar a agendar ou solicitar orçamentos, suas atividades recentes aparecerão aqui."
            action={
              <Button
                onClick={() => {
                  triggerHaptic("selection")
                  onNavigate("client.providers")
                }}
                className="mt-2 gap-2 rounded-xl text-xs font-semibold shadow-2xs"
              >
                <MapPin className="size-4" />
                Buscar prestadores
              </Button>
            }
          />
        ) : (
          <Card className="border-border/60 bg-card overflow-hidden rounded-2xl border shadow-2xs">
            <CardContent className="divide-border/40 divide-y p-0">
              {recentActivity.map((a) => {
                const provider = a.provider
                const initials = (provider.name ?? "")
                  .split(" ")
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
                const isBooking = a.type === "booking"
                const status = a.status as BookingStatus | QuoteStatus
                const tone = isBooking
                  ? bookingTone(status as BookingStatus)
                  : quoteTone(status as QuoteStatus)
                const Icon = isBooking
                  ? bookingIcon(status as BookingStatus)
                  : quoteIcon(status as QuoteStatus)
                const label = isBooking
                  ? BOOKING_STATUS_LABELS[status as BookingStatus]
                  : QUOTE_STATUS_LABELS[status as QuoteStatus]
                return (
                  <button
                    key={`${a.type}-${a.id}`}
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection")
                      onNavigate(isBooking ? "client.bookings" : "client.quotes")
                    }}
                    className="hover:bg-muted/40 focus-visible:bg-muted/40 group flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left transition-colors outline-none"
                  >
                    <Avatar className="border-border/50 size-10 shrink-0 border shadow-2xs">
                      {provider.avatarUrl ? (
                        <AvatarImage
                          src={provider.avatarUrl}
                          alt={provider.name}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="bg-muted text-foreground text-xs font-bold">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground group-hover:text-primary truncate text-sm font-semibold transition-colors">
                        {a.title}
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs tabular-nums">
                        <span className="text-foreground/75 font-medium">
                          {isBooking ? "Agendamento" : "Orçamento"}
                        </span>{" "}
                        · {provider.name} · {formatRelative(a.at)}
                      </p>
                    </div>
                    {isBooking && a.type === "booking" && a.amount > 0 ? (
                      <span className="text-foreground hidden text-sm font-bold tabular-nums sm:block">
                        {formatBRL(a.amount)}
                      </span>
                    ) : null}
                    <StatusBadge tone={tone} icon={Icon}>
                      {label}
                    </StatusBadge>
                  </button>
                )
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
