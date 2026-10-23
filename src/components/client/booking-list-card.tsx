"use client"

import * as React from "react"
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Eye,
  FileText,
  HelpCircle,
  Loader2,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Navigation,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  XCircle,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SERVICE_UNIT_SHORT,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
  type ServiceUnit,
} from "@/lib/constants"
import { formatBRL, formatDateTime } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"
import {
  StatusBadge,
  bookingIcon,
  bookingTone,
  paymentIcon,
  paymentTone,
} from "@/components/client/client-shared"
import { type Booking, providerInitials } from "@/components/client/client-bookings"

// ---------------------------------------------------------------------------
// BookingCardProps
// ---------------------------------------------------------------------------

export type BookingCardProps = {
  booking: Booking
  onViewDetails: () => void
  onCancel: () => void
  onComplete: () => void
  onReview: () => void
  onMessage: () => void
  onViewProvider: () => void
  onRebook?: () => void
  onTrack?: () => void
  onPay?: () => void
  onViewReceipt?: () => void
  onOpenReport?: () => void
  onCarePlan?: () => void
  onMediate?: () => void
  onDispute?: () => void
  isCompleting: boolean
}

// ---------------------------------------------------------------------------
// BookingCard (List View — Ultra-compact, clean & minimalist)
// ---------------------------------------------------------------------------

export function BookingCard({
  booking,
  onViewDetails,
  onCancel,
  onComplete,
  onReview,
  onMessage,
  onViewProvider,
  onRebook,
  onTrack,
  onPay,
  onViewReceipt,
  onOpenReport,
  onCarePlan,
  onMediate,
  onDispute,
  isCompleting,
}: BookingCardProps) {
  const provider = booking.provider
  const initials = providerInitials(provider.name)

  const status = booking.status as BookingStatus
  const canCancel = status === "PENDING" || status === "CONFIRMED" || status === "IN_PROGRESS"
  const canComplete =
    status === "CONFIRMED" || status === "IN_PROGRESS" || booking.paymentStatus === "HELD"
  const canTrack = status === "IN_PROGRESS"
  // Never allow paying for cancelled or completed bookings
  const canPay = (status === "PENDING" || status === "CONFIRMED") && !!onPay
  const hasReview = (booking.reviews?.length ?? 0) > 0
  const canReview = status === "COMPLETED" && !hasReview

  // Avoid empty parentheses bug: only resolve if unit is defined and recognized
  const unitLabel =
    booking.service.unit && SERVICE_UNIT_SHORT[booking.service.unit as ServiceUnit]
      ? SERVICE_UNIT_SHORT[booking.service.unit as ServiceUnit]
      : null

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 relative overflow-hidden rounded-xl shadow-2xs transition-all duration-150 hover:shadow-xs">
      <CardContent className="p-3 sm:p-3.5">
        {/* Main Card Header: Avatar, Provider, Status, Price */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {/* Round Avatar with click to provider modal */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onViewProvider()
              }}
              className="ring-background shrink-0 rounded-full ring-1 transition-transform outline-none hover:scale-105 focus-visible:ring-2"
              aria-label={`Ver perfil de ${provider.name}`}
            >
              <Avatar className="border-border/40 size-10 rounded-full border shadow-2xs sm:size-11">
                {provider.avatarUrl ? (
                  <AvatarImage
                    src={provider.avatarUrl}
                    alt={provider.name}
                    className="rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary rounded-full text-xs font-bold">
                  {initials || "PR"}
                </AvatarFallback>
              </Avatar>
            </button>

            {/* Provider Info & Service Details */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary truncate text-sm font-bold tracking-tight transition-colors hover:underline"
                >
                  {provider.name}
                </button>

                <StatusBadge tone={bookingTone(status)} icon={bookingIcon(status)}>
                  {BOOKING_STATUS_LABELS[status]}
                </StatusBadge>

                {hasReview && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300">
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    Avaliado
                  </span>
                )}
              </div>

              {/* Service Title — cleanly rendered without empty () */}
              <div className="text-foreground/90 mt-0.5 flex items-center gap-1.5 text-xs">
                <span className="truncate font-medium">{booking.service.title}</span>
                {unitLabel && (
                  <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase sm:text-[10px]">
                    {unitLabel}
                  </span>
                )}
              </div>

              {/* Date & Address */}
              <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                <span className="text-foreground/85 inline-flex items-center gap-1 font-medium tabular-nums">
                  <CalendarDays className="text-primary size-3" />
                  {formatDateTime(booking.scheduledAt)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="text-primary/70 size-3" />
                  <span className="max-w-[14rem] truncate sm:max-w-[18rem]">{booking.address}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Right: Financial & Payment Info + Menu */}
          <div className="border-border/40 flex items-center justify-between border-t pt-2 sm:flex-col sm:items-end sm:justify-center sm:border-0 sm:pt-0">
            <div className="flex items-baseline gap-1.5 sm:flex-col sm:items-end sm:gap-0.5">
              <span className="text-foreground text-sm font-bold tracking-tight tabular-nums sm:text-base">
                {formatBRL(booking.amount)}
              </span>
              {booking.quantity > 1 && (
                <span className="text-muted-foreground text-xs tabular-nums sm:text-[10px]">
                  {booking.quantity} × {unitLabel ?? booking.unit}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <StatusBadge
                tone={paymentTone(booking.paymentStatus as PaymentStatus)}
                icon={paymentIcon(booking.paymentStatus as PaymentStatus)}
                className="text-xs font-medium sm:text-[10px]"
              >
                {PAYMENT_METHOD_LABELS[booking.paymentMethod as PaymentMethod]} ·{" "}
                {PAYMENT_STATUS_LABELS[booking.paymentStatus as PaymentStatus]}
              </StatusBadge>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground size-7 shrink-0 rounded-lg sm:hidden"
                    aria-label="Mais opções"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={onViewDetails}>
                    <Eye className="mr-2 size-3.5" />
                    Ver detalhes
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onViewProvider}>
                    <MapPin className="mr-2 size-3.5" />
                    Perfil do prestador
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onMessage}>
                    <MessageSquare className="mr-2 size-3.5" />
                    Mensagem
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Contextual Escrow / Service Design Reassurance Banner (Ultra-compact) */}
        {status === "COMPLETED" ? (
          <div className="mt-2 flex items-center justify-between gap-1.5 rounded-lg border border-emerald-200/50 bg-emerald-50/40 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-300">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>Serviço finalizado e inspecionado · Garantia 90D ativa</span>
            </div>
            <span className="hidden text-[10px] font-semibold text-emerald-700 sm:inline dark:text-emerald-300">
              Pagamento Liberado
            </span>
          </div>
        ) : status === "IN_PROGRESS" ? (
          <div className="mt-2 flex items-center justify-between gap-1.5 rounded-lg border border-sky-200/50 bg-sky-50/40 px-2.5 py-1 text-[11px] font-medium text-sky-900 dark:border-sky-900/30 dark:bg-sky-950/20 dark:text-sky-200">
            <div className="flex items-center gap-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-sky-500"></span>
              </span>
              <span>Prestador a caminho ou executando o serviço · Pagamento protegido</span>
            </div>
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              🛡️ Escrow Seguro
            </span>
          </div>
        ) : status === "CONFIRMED" ? (
          <div className="mt-2 flex items-center justify-between gap-1.5 rounded-lg border border-emerald-200/40 bg-emerald-50/30 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:border-emerald-900/20 dark:bg-emerald-950/15 dark:text-emerald-300">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>Horário confirmado · {formatBRL(booking.amount)} protegido em custódia</span>
            </div>
            {booking.paymentStatus === "HELD" && (
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                Custódia Ativa
              </span>
            )}
          </div>
        ) : status === "CANCELLED" ? (
          <div className="border-border/40 bg-muted/20 text-muted-foreground mt-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium">
            <XCircle className="size-3.5 shrink-0 text-rose-500" />
            <span>Agendamento cancelado · Nenhuma cobrança pendente</span>
          </div>
        ) : null}

        {/* Quick Action Buttons Strip */}
        <div className="border-border/40 mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
          {/* Primary Action Button based on status */}
          {status === "COMPLETED" && canReview && (
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onReview()
              }}
              className="h-9 gap-1.5 rounded-xl bg-amber-500 px-3 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-amber-600 active:scale-95 sm:h-8"
            >
              <Star className="size-3.5 fill-white text-white" />
              Avaliar
            </Button>
          )}

          {canComplete && (
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onComplete()
              }}
              disabled={isCompleting}
              className="h-9 gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-8"
            >
              {isCompleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="size-3.5" />
              )}
              {booking.paymentStatus === "HELD" ? "Liberar Custódia" : "Liberar Pagamento"}
            </Button>
          )}

          {canTrack && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                triggerHaptic("selection")
                onTrack?.()
              }}
              className="h-9 gap-1.5 rounded-xl border-sky-300 px-3 text-xs font-semibold text-sky-700 transition-all hover:bg-sky-50 active:scale-95 sm:h-8 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/30"
            >
              <Navigation className="size-3.5" />
              Rastrear
            </Button>
          )}

          {canPay && (
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onPay?.()
              }}
              className="h-9 gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-8"
            >
              <CreditCard className="size-3.5" />
              Pagar PIX
            </Button>
          )}

          {/* Standard Tools */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onViewDetails()
            }}
            className="border-border/60 hover:bg-muted/60 h-9 gap-1.5 rounded-xl px-3 text-xs font-medium transition-all active:scale-95 sm:h-8"
          >
            <Eye className="size-3.5" />
            Detalhes
          </Button>

          {/* Rebook option on Cancelled */}
          {status === "CANCELLED" && onRebook && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onRebook()
              }}
              className="border-primary/50 text-primary hover:bg-primary/10 h-9 gap-1.5 rounded-xl px-3 text-xs font-semibold transition-all active:scale-95 sm:h-8"
            >
              <Sparkles className="size-3.5" />
              Contratar Novamente
            </Button>
          )}

          {/* Report on In-Progress / Completed / Confirmed */}
          {onOpenReport &&
            (status === "CONFIRMED" || status === "IN_PROGRESS" || status === "COMPLETED") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onOpenReport()
                }}
                className="border-border/60 hover:bg-muted/60 h-9 gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-all active:scale-95 sm:h-8"
              >
                <ClipboardCheck className="size-3" />
                Laudo / Fotos
              </Button>
            )}

          {/* Receipt on Completed or Paid */}
          {(status === "COMPLETED" || booking.paymentStatus === "PAID") && onViewReceipt && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onViewReceipt()
              }}
              className="border-border/60 hover:bg-muted/60 h-9 gap-1.5 rounded-xl px-2.5 text-xs font-medium text-blue-700 transition-all active:scale-95 sm:h-8 dark:text-blue-400"
            >
              <FileText className="size-3" />
              Recibo
            </Button>
          )}

          {/* Care Plan recommendation on Completed */}
          {status === "COMPLETED" && onCarePlan && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onCarePlan()
              }}
              className="h-9 gap-1.5 rounded-xl border-emerald-300 px-2.5 text-xs font-medium text-emerald-700 transition-all hover:bg-emerald-50 active:scale-95 sm:h-8 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
            >
              <Sparkles className="size-3" />
              Plano Recorrente
            </Button>
          )}

          {/* In-app Message button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              onMessage()
            }}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/60 size-9 shrink-0 rounded-xl p-0 transition-colors active:scale-95 sm:size-8"
            title="Enviar mensagem na plataforma"
            aria-label="Enviar mensagem na plataforma"
          >
            <MessageSquare className="size-3.5" />
          </Button>

          {/* Imprevisto / Mediação rápida */}
          {onMediate &&
            (status === "CONFIRMED" || status === "IN_PROGRESS" || status === "PENDING") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onMediate()
                }}
                className="h-9 gap-1 rounded-xl border-amber-500/30 px-2 text-xs font-medium text-amber-700 transition-all hover:bg-amber-50 active:scale-95 sm:h-8 dark:border-amber-700/40 dark:text-amber-400 dark:hover:bg-amber-950/20"
                title="Ajuste de horário ou reagendamento amigável"
              >
                <HelpCircle className="size-3 text-amber-500" />
                Imprevisto
              </Button>
            )}

          {/* Contestar / Disputar Escrow */}
          {onDispute && booking.paymentStatus === "HELD" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onDispute()
              }}
              className="h-9 gap-1 rounded-xl border-red-500/30 px-2 text-xs font-medium text-red-700 transition-all hover:bg-red-50 active:scale-95 sm:h-8 dark:border-red-700/40 dark:text-red-400 dark:hover:bg-red-950/20"
              title="Contestar serviço e congelar custódia com evidências"
            >
              <ShieldAlert className="size-3 text-red-500" />
              Contestar
            </Button>
          )}

          {/* Cancel button if applicable */}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                onCancel()
              }}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto h-9 gap-1.5 rounded-xl px-2 text-xs font-medium transition-all active:scale-95 sm:h-8"
            >
              <XCircle className="size-3" />
              Cancelar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
