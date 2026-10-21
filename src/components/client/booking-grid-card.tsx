"use client"

import * as React from "react"
import {
  CalendarDays,
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
  QrCode,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  XCircle,
} from "lucide-react"

import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SERVICE_UNIT_SHORT,
  type BookingStatus,
  type PaymentStatus,
  type ServiceUnit,
} from "@/lib/constants"
import { formatBRL, formatDateTime } from "@/lib/format"
import { triggerHaptic } from "@/lib/haptics"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  StatusBadge,
  bookingIcon,
  bookingTone,
  paymentIcon,
  paymentTone,
} from "@/components/client/client-shared"
import type { Booking, BookingCardProps } from "@/components/client/client-bookings"

function providerInitials(name?: string | null): string {
  if (!name) return "PR"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

/**
 * BookingGridCard (Grid View — Modern Bento micro-card)
 * Displays a single booking in responsive grid layouts with fast action controls.
 */
export function BookingGridCard({
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
  const canPay = (status === "PENDING" || status === "CONFIRMED") && !!onPay
  const hasReview = (booking.reviews?.length ?? 0) > 0
  const canReview = status === "COMPLETED" && !hasReview

  const unitLabel =
    booking.service.unit && SERVICE_UNIT_SHORT[booking.service.unit as ServiceUnit]
      ? SERVICE_UNIT_SHORT[booking.service.unit as ServiceUnit]
      : null

  return (
    <Card className="border-border/60 bg-card hover:border-primary/40 flex flex-col justify-between rounded-xl shadow-2xs transition-all duration-150 hover:shadow-xs">
      <CardContent className="flex h-full flex-col justify-between p-3.5">
        <div className="space-y-2.5">
          {/* Top header: Avatar + Provider info + Price */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  onViewProvider()
                }}
                className="shrink-0 rounded-full transition-transform outline-none hover:scale-105"
                aria-label={`Ver perfil de ${provider.name}`}
              >
                <Avatar className="border-border/40 size-10 rounded-full border shadow-2xs">
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

              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection")
                    onViewProvider()
                  }}
                  className="text-foreground hover:text-primary block truncate text-left text-sm font-bold tracking-tight"
                >
                  {provider.name}
                </button>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <StatusBadge tone={bookingTone(status)} icon={bookingIcon(status)}>
                    {BOOKING_STATUS_LABELS[status]}
                  </StatusBadge>
                  {hasReview && (
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300">
                      <Star className="size-3 fill-amber-400 text-amber-400" />
                      Avaliado
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-foreground text-sm font-bold tabular-nums sm:text-base">
                {formatBRL(booking.amount)}
              </p>
              <StatusBadge
                tone={paymentTone(booking.paymentStatus as PaymentStatus)}
                icon={paymentIcon(booking.paymentStatus as PaymentStatus)}
                className="text-xs font-medium sm:text-[9px]"
              >
                {PAYMENT_STATUS_LABELS[booking.paymentStatus as PaymentStatus]}
              </StatusBadge>
            </div>
          </div>

          {/* Service Title */}
          <div className="border-border/40 border-t pt-2">
            <div className="text-foreground/90 flex items-center gap-1.5 text-xs font-medium">
              <span className="truncate">{booking.service.title}</span>
              {unitLabel && (
                <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase sm:text-[10px]">
                  {unitLabel}
                </span>
              )}
            </div>

            {/* Date and Address */}
            <div className="text-muted-foreground mt-1.5 space-y-1 text-xs">
              <div className="text-foreground/80 inline-flex items-center gap-1.5 font-medium tabular-nums">
                <CalendarDays className="text-primary size-3 shrink-0" />
                <span>{formatDateTime(booking.scheduledAt)}</span>
              </div>
              <div className="text-muted-foreground flex items-center gap-1.5">
                <MapPin className="text-primary/70 size-3 shrink-0" />
                <span className="truncate">{booking.address}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-border/40 mt-3 flex items-center justify-between gap-1.5 border-t pt-2.5">
          <div className="flex flex-1 items-center gap-1.5">
            {status === "COMPLETED" && canReview ? (
              <Button
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onReview()
                }}
                className="h-10 flex-1 gap-1.5 rounded-xl bg-amber-500 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-amber-600 active:scale-95 sm:h-8"
              >
                <Star className="size-3.5 fill-white text-white" />
                Avaliar
              </Button>
            ) : canComplete ? (
              <Button
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onComplete()
                }}
                disabled={isCompleting}
                className="h-10 flex-1 gap-1.5 rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-8"
              >
                {isCompleting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="size-3.5" />
                )}
                {booking.paymentStatus === "HELD" ? "Liberar Custódia" : "Liberar"}
              </Button>
            ) : canTrack ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  triggerHaptic("selection")
                  onTrack?.()
                }}
                className="h-10 flex-1 gap-1.5 rounded-xl border-sky-300 text-xs font-semibold text-sky-700 transition-all hover:bg-sky-50 active:scale-95 sm:h-8 dark:border-sky-800 dark:text-sky-300"
              >
                <Navigation className="size-3.5" />
                Rastrear
              </Button>
            ) : canPay ? (
              <Button
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onPay?.()
                }}
                className="h-10 flex-1 gap-1.5 rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-emerald-700 active:scale-95 sm:h-8"
              >
                <CreditCard className="size-3.5" />
                Pagar PIX
              </Button>
            ) : status === "CANCELLED" && onRebook ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onRebook()
                }}
                className="border-primary/50 text-primary hover:bg-primary/10 h-10 flex-1 gap-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95 sm:h-8"
              >
                <Sparkles className="size-3.5" />
                Contratar Novamente
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  onViewDetails()
                }}
                className="h-10 flex-1 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95 sm:h-8"
              >
                <Eye className="size-3.5" />
                Detalhes
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                triggerHaptic("selection")
                onMessage()
              }}
              className="text-muted-foreground hover:text-foreground size-10 shrink-0 rounded-xl transition-all active:scale-95 sm:size-8"
              title="Enviar mensagem na plataforma"
              aria-label="Enviar mensagem na plataforma"
            >
              <MessageSquare className="size-3.5" />
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-9 shrink-0 rounded-xl transition-all active:scale-95 sm:size-8"
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
              {onMediate &&
                (status === "CONFIRMED" || status === "IN_PROGRESS" || status === "PENDING") && (
                  <DropdownMenuItem onSelect={onMediate}>
                    <HelpCircle className="mr-2 size-3.5 text-amber-500" />
                    Imprevisto / Atraso
                  </DropdownMenuItem>
                )}
              {onDispute && booking.paymentStatus === "HELD" && (
                <DropdownMenuItem onSelect={onDispute}>
                  <ShieldAlert className="mr-2 size-3.5 text-red-500" />
                  Contestar Escrow (Fotos)
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {canTrack && (
                <DropdownMenuItem onSelect={onTrack}>
                  <Navigation className="mr-2 size-3.5 text-sky-600" />
                  Rastrear ao vivo
                </DropdownMenuItem>
              )}
              {canPay && (
                <DropdownMenuItem onSelect={onPay}>
                  <QrCode className="mr-2 size-3.5 text-emerald-600" />
                  Pagar PIX
                </DropdownMenuItem>
              )}
              {canComplete && (
                <DropdownMenuItem onSelect={onComplete} disabled={isCompleting}>
                  <ShieldCheck className="mr-2 size-3.5 text-emerald-600" />
                  Liberar custódia
                </DropdownMenuItem>
              )}
              {canReview && (
                <DropdownMenuItem onSelect={onReview}>
                  <Star className="mr-2 size-3.5 text-amber-500" />
                  Avaliar serviço
                </DropdownMenuItem>
              )}
              {onOpenReport && (
                <DropdownMenuItem onSelect={onOpenReport}>
                  <ClipboardCheck className="mr-2 size-3.5 text-emerald-600" />
                  Laudo & Checklist
                </DropdownMenuItem>
              )}
              {onCarePlan && (
                <DropdownMenuItem onSelect={onCarePlan}>
                  <Sparkles className="mr-2 size-3.5 text-emerald-600" />
                  Plano Recorrente (-15%)
                </DropdownMenuItem>
              )}
              {(status === "COMPLETED" || booking.paymentStatus === "PAID") && onViewReceipt && (
                <DropdownMenuItem onSelect={onViewReceipt}>
                  <FileText className="mr-2 size-3.5 text-blue-600" />
                  Ver recibo
                </DropdownMenuItem>
              )}
              {status === "CANCELLED" && onRebook && (
                <DropdownMenuItem onSelect={onRebook}>
                  <Sparkles className="text-primary mr-2 size-3.5" />
                  Contratar novamente
                </DropdownMenuItem>
              )}
              {canCancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onCancel}>
                    <XCircle className="mr-2 size-3.5" />
                    Cancelar agendamento
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  )
}
