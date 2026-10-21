"use client"

import * as React from "react"
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  HelpCircle,
  Info,
  Loader2,
  MapPin,
  MessageSquare,
  MoreVertical,
  Navigation,
  Play,
  Radio,
  X,
} from "lucide-react"

import { PAYMENT_STATUS_LABELS } from "@/lib/constants"
import { formatBRL, formatDate, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"
import { useLocationBroadcaster } from "@/hooks/use-location-broadcaster"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { BookingStatusBadge } from "@/components/admin/admin-shared"
import { PAY_BADGE_STYLES, initials } from "@/components/provider/provider-booking-details-dialog"
import type { Booking } from "@/components/provider/provider-bookings"

// ---------------------------------------------------------------------------
// Location broadcast button
// ---------------------------------------------------------------------------

export function LocationBroadcastButton({ bookingId }: { bookingId: string }) {
  const { isBroadcasting, toggle } = useLocationBroadcaster({ bookingId })
  return (
    <Button
      size="sm"
      variant={isBroadcasting ? "default" : "outline"}
      onClick={() => {
        triggerHaptic("medium")
        toggle()
      }}
      className={cn(
        "h-8 gap-1.5 px-2.5 text-xs font-medium transition-colors",
        isBroadcasting && "animate-pulse bg-emerald-600 text-white hover:bg-emerald-700",
      )}
    >
      <Radio className="size-3.5" />
      {isBroadcasting ? "GPS Ativo" : "Transmitir GPS"}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Booking actions dropdown / buttons
// ---------------------------------------------------------------------------

export function BookingActions({
  booking,
  actioning,
  onDetail,
  onMessage,
  onConfirm,
  onStart,
  onCancel,
  onReport,
  onTransitHud,
  onMediate,
}: {
  booking: Booking
  actioning: boolean
  onDetail: () => void
  onMessage: () => void
  onConfirm: () => void
  onStart: () => void
  onCancel: () => void
  onReport?: () => void
  onTransitHud?: () => void
  onMediate?: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      {actioning && <Loader2 className="text-muted-foreground size-4 animate-spin" />}

      {booking.status === "PENDING" && (
        <Button
          size="sm"
          onClick={() => {
            triggerHaptic("success")
            onConfirm()
          }}
          disabled={actioning}
          className="h-8 gap-1.5 px-3 text-xs font-semibold shadow-xs"
        >
          <CheckCircle2 className="size-3.5" /> Confirmar
        </Button>
      )}

      {booking.status === "CONFIRMED" && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              triggerHaptic("light")
              onStart()
            }}
            disabled={actioning}
            className="border-primary/30 text-primary hover:bg-primary/5 h-8 gap-1.5 px-3 text-xs font-semibold shadow-xs"
          >
            <Play className="fill-primary/20 size-3.5" /> Iniciar
          </Button>
          {onTransitHud && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                triggerHaptic("medium")

                onTransitHud?.()
              }}
              className="h-8 gap-1.5 border-sky-500/40 px-2.5 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/30"
              title="Abrir Modo Trânsito HUD com GPS e Waze"
            >
              <Navigation className="size-3.5 text-sky-500" /> Trânsito HUD
            </Button>
          )}
        </>
      )}

      {booking.status === "IN_PROGRESS" && (
        <>
          <LocationBroadcastButton bookingId={booking.id} />
          {onTransitHud && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                triggerHaptic("medium")

                onTransitHud?.()
              }}
              className="h-8 gap-1.5 border-sky-500/40 px-2.5 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/30"
            >
              <Navigation className="size-3.5 text-sky-500" /> Trânsito HUD
            </Button>
          )}
        </>
      )}

      {onReport &&
        (booking.status === "IN_PROGRESS" ||
          booking.status === "CONFIRMED" ||
          booking.status === "COMPLETED") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              triggerHaptic("light")

              onReport?.()
            }}
            className="h-8 gap-1.5 border-emerald-500/40 px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
          >
            <ClipboardCheck className="size-3.5" /> Laudo
          </Button>
        )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 rounded-lg" aria-label="Mais ações">
            <MoreVertical className="text-muted-foreground size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 rounded-xl">
          <DropdownMenuItem onClick={onDetail}>
            <Info className="text-muted-foreground mr-2 size-4" /> Ver detalhes
          </DropdownMenuItem>
          {onMediate &&
            (booking.status === "PENDING" ||
              booking.status === "CONFIRMED" ||
              booking.status === "IN_PROGRESS") && (
              <DropdownMenuItem onClick={onMediate}>
                <HelpCircle className="mr-2 size-4 text-amber-500" /> Imprevisto / Atraso
              </DropdownMenuItem>
            )}
          {booking.status === "IN_PROGRESS" && onTransitHud && (
            <DropdownMenuItem
              onClick={() => {
                triggerHaptic("medium")
                onTransitHud?.()
              }}
            >
              <Navigation className="mr-2 size-4 text-sky-500" /> Modo Trânsito (HUD)
            </DropdownMenuItem>
          )}
          {onReport && (
            <DropdownMenuItem
              onClick={() => {
                triggerHaptic("light")
                onReport?.()
              }}
            >
              <ClipboardCheck className="mr-2 size-4 text-emerald-600" /> Laudo & Checklist
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onMessage}>
            <MessageSquare className="mr-2 size-4 text-blue-500" /> Enviar mensagem
          </DropdownMenuItem>
          {booking.status === "PENDING" && (
            <DropdownMenuItem onClick={onConfirm}>
              <CheckCircle2 className="mr-2 size-4 text-emerald-600" /> Confirmar
            </DropdownMenuItem>
          )}
          {booking.status === "CONFIRMED" && (
            <DropdownMenuItem onClick={onStart}>
              <Play className="text-primary mr-2 size-4" /> Iniciar atendimento
            </DropdownMenuItem>
          )}
          {(booking.status === "PENDING" ||
            booking.status === "CONFIRMED" ||
            booking.status === "IN_PROGRESS") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onCancel}
                className="text-destructive focus:text-destructive"
              >
                <X className="mr-2 size-4" /> Cancelar agendamento
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mobile booking card
// ---------------------------------------------------------------------------

export function BookingCard({
  booking,
  actioning,
  onDetail,
  onMessage,
  onConfirm,
  onStart,
  onCancel,
  onReport,
  onTransitHud,
  onMediate,
}: {
  booking: Booking
  actioning: boolean
  onDetail: () => void
  onMessage: () => void
  onConfirm: () => void
  onStart: () => void
  onCancel: () => void
  onReport?: () => void
  onTransitHud?: () => void
  onMediate?: () => void
}) {
  return (
    <div className="bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-xs">
      <div className="flex items-center gap-3">
        <Avatar className="size-10 border shadow-xs">
          {booking.client.avatarUrl ? (
            <AvatarImage src={booking.client.avatarUrl} alt={booking.client.name} />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
            {initials(booking.client.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm leading-tight font-semibold">
            {booking.client.name}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{booking.service.title}</p>
        </div>
        <BookingStatusBadge status={booking.status} />
      </div>

      <div className="text-muted-foreground my-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-y py-2 text-xs">
        <span className="text-foreground flex items-center gap-1 font-medium tabular-nums">
          <Clock className="text-muted-foreground size-3" />
          {formatDate(booking.scheduledAt)} às {formatTime(booking.scheduledAt)}
        </span>
        <span className="flex max-w-[240px] items-center gap-1 truncate">
          <MapPin className="text-muted-foreground size-3" />
          <span className="truncate">{booking.address}</span>
        </span>
      </div>

      {/* Row 1: Valor + Status do Pagamento + Menu de Ações Secundárias */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-primary text-sm font-bold tabular-nums sm:text-base">
            {formatBRL(booking.amount)}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
              PAY_BADGE_STYLES[booking.paymentStatus],
            )}
          >
            {PAYMENT_STATUS_LABELS[booking.paymentStatus]}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDetail}
            className="text-muted-foreground hover:text-foreground h-9 px-2.5 text-xs"
          >
            <Info className="mr-1 size-3.5" /> Detalhes
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 rounded-lg"
                aria-label="Mais opções"
              >
                <MoreVertical className="text-muted-foreground size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl">
              <DropdownMenuItem onClick={onMessage}>
                <MessageSquare className="mr-2 size-4 text-blue-500" /> Conversar com cliente
              </DropdownMenuItem>
              {onMediate &&
                (booking.status === "PENDING" ||
                  booking.status === "CONFIRMED" ||
                  booking.status === "IN_PROGRESS") && (
                  <DropdownMenuItem onClick={onMediate}>
                    <HelpCircle className="mr-2 size-4 text-amber-500" /> Imprevisto / Atraso
                  </DropdownMenuItem>
                )}
              {booking.status === "PENDING" && (
                <DropdownMenuItem onClick={onConfirm}>
                  <CheckCircle2 className="mr-2 size-4 text-emerald-600" /> Confirmar
                </DropdownMenuItem>
              )}
              {booking.status === "CONFIRMED" && (
                <DropdownMenuItem onClick={onStart}>
                  <Play className="text-primary mr-2 size-4" /> Iniciar atendimento
                </DropdownMenuItem>
              )}
              {booking.status === "IN_PROGRESS" && onTransitHud && (
                <DropdownMenuItem
                  onClick={() => {
                    triggerHaptic("medium")
                    onTransitHud?.()
                  }}
                >
                  <Navigation className="mr-2 size-4 text-sky-500" /> Modo Trânsito (HUD)
                </DropdownMenuItem>
              )}
              {onReport && (
                <DropdownMenuItem
                  onClick={() => {
                    triggerHaptic("light")
                    onReport?.()
                  }}
                >
                  <ClipboardCheck className="mr-2 size-4 text-emerald-600" /> Laudo & Checklist
                </DropdownMenuItem>
              )}
              {(booking.status === "PENDING" ||
                booking.status === "CONFIRMED" ||
                booking.status === "IN_PROGRESS") && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onCancel}
                    className="text-destructive focus:text-destructive"
                  >
                    <X className="mr-2 size-4" /> Cancelar agendamento
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Row 2: Botões de Ação Primária em Grade Ergonômica Mobile */}
      <div className="border-border/40 mt-1 flex flex-wrap items-center gap-2 border-t pt-2.5">
        {actioning && <Loader2 className="text-muted-foreground size-4 animate-spin" />}

        {booking.status === "PENDING" && (
          <Button
            size="sm"
            onClick={() => {
              triggerHaptic("success")
              onConfirm()
            }}
            disabled={actioning}
            className="h-11 w-full gap-2 rounded-xl text-xs font-semibold shadow-xs sm:h-9.5"
          >
            <CheckCircle2 className="size-4" /> Confirmar Atendimento
          </Button>
        )}

        {booking.status === "CONFIRMED" && (
          <>
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic("light")
                onStart()
              }}
              disabled={actioning}
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-11 flex-1 gap-1.5 rounded-xl text-xs font-semibold shadow-xs sm:h-9.5"
            >
              <Play className="fill-primary-foreground/20 size-3.5" /> Iniciar
            </Button>
            {onTransitHud && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  triggerHaptic("medium")

                  onTransitHud?.()
                }}
                className="h-11 flex-1 gap-1.5 rounded-xl border-sky-500/40 text-xs font-medium text-sky-700 hover:bg-sky-50 sm:h-9.5 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/30"
              >
                <Navigation className="size-3.5 text-sky-500" /> Trânsito HUD
              </Button>
            )}
            {onReport && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  triggerHaptic("light")

                  onReport?.()
                }}
                className="h-11 gap-1.5 rounded-xl border-emerald-500/40 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50 sm:h-9.5 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                <ClipboardCheck className="size-3.5" /> Laudo
              </Button>
            )}
          </>
        )}

        {booking.status === "IN_PROGRESS" && (
          <>
            <div className="flex-1">
              <LocationBroadcastButton bookingId={booking.id} />
            </div>
            {onTransitHud && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  triggerHaptic("medium")

                  onTransitHud?.()
                }}
                className="h-11 flex-1 gap-1.5 rounded-xl border-sky-500/40 text-xs font-medium text-sky-700 hover:bg-sky-50 sm:h-9.5 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/30"
              >
                <Navigation className="size-3.5 text-sky-500" /> Trânsito HUD
              </Button>
            )}
            {onReport && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  triggerHaptic("light")

                  onReport?.()
                }}
                className="h-11 gap-1.5 rounded-xl border-emerald-500/40 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50 sm:h-9.5 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                <ClipboardCheck className="size-3.5" /> Laudo
              </Button>
            )}
          </>
        )}

        {booking.status === "COMPLETED" && (
          <>
            {onReport && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  triggerHaptic("light")

                  onReport?.()
                }}
                className="h-9.5 flex-1 gap-1.5 rounded-xl border-emerald-500/40 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                <ClipboardCheck className="size-3.5" /> Ver Laudo & Fotos
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onMessage()}
              className="h-9.5 flex-1 gap-1.5 rounded-xl text-xs font-medium"
            >
              <MessageSquare className="size-3.5 text-blue-500" /> Mensagem
            </Button>
          </>
        )}

        {booking.status === "CANCELLED" && (
          <Button
            size="sm"
            variant="outline"
            onClick={onDetail}
            className="text-muted-foreground h-9.5 w-full rounded-xl text-xs"
          >
            Ver Detalhes do Cancelamento
          </Button>
        )}
      </div>
    </div>
  )
}
