"use client"

import {
  Camera,
  ClipboardCheck,
  ExternalLink,
  MapPin,
  MessageSquare,
  Navigation,
} from "lucide-react"

import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SERVICE_UNIT_SHORT,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/constants"
import { formatBRL, formatDate, formatDateTime, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { BookingStatusBadge } from "@/components/admin/admin-shared"
import type { Booking } from "@/components/provider/provider-bookings"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const PAY_BADGE_STYLES: Record<PaymentStatus, string> = {
  PENDING:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border-amber-200/50",
  AUTHORIZED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border-blue-200/50",
  HELD: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200 border-indigo-200/50",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 border-emerald-200/50",
  REFUNDED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 border-rose-200/50",
  FAILED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 border-rose-200/50",
}

export function initials(name?: string) {
  if (!name) return "?"
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
}

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------

export function BookingDetailsDialog({
  booking,
  open,
  onOpenChange,
  onMessage,
  onReport,
}: {
  booking: Booking | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onMessage: (clientId: string) => void
  onReport?: () => void
}) {
  if (!booking) return null
  const encodedAddress = encodeURIComponent(booking.address)
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`
  const wazeUrl = `https://waze.com/ul?q=${encodedAddress}&navigate=yes`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-base font-semibold">Detalhes do Agendamento</DialogTitle>
            <BookingStatusBadge status={booking.status} />
          </div>
          <DialogDescription className="text-xs tabular-nums">
            {formatDateTime(booking.scheduledAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 text-sm">
          {/* Card do Cliente */}
          <div className="bg-muted/20 flex items-center gap-3.5 rounded-xl border p-3.5">
            <Avatar className="size-11 border shadow-xs">
              {booking.client.avatarUrl ? (
                <AvatarImage src={booking.client.avatarUrl} alt={booking.client.name} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {initials(booking.client.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-foreground font-semibold">{booking.client.name}</p>
              <p className="text-muted-foreground text-xs">Cliente cadastrado no Severinno</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onMessage(booking.clientId)}
              className="h-8 gap-1.5 text-xs"
            >
              <MessageSquare className="size-3.5" /> Mensagem
            </Button>
          </div>

          {/* Dados do Serviço & Pagamento */}
          <div className="bg-card grid gap-2.5 rounded-xl border p-4 text-xs">
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground font-medium">Serviço</span>
              <span className="text-foreground text-right font-semibold">
                {booking.service.title}
              </span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground font-medium">Data e Hora</span>
              <span className="text-foreground font-medium tabular-nums">
                {formatDate(booking.scheduledAt)} às {formatTime(booking.scheduledAt)}
              </span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground font-medium">Forma de Pagamento</span>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={cn(
                    "px-2 py-0.5 text-[10px] font-semibold",
                    PAY_BADGE_STYLES[booking.paymentStatus],
                  )}
                >
                  {PAYMENT_STATUS_LABELS[booking.paymentStatus]}
                </Badge>
                <span className="text-muted-foreground text-xs font-medium">
                  • {PAYMENT_METHOD_LABELS[booking.paymentMethod]}
                </span>
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between border-t pt-2">
              <span className="text-muted-foreground font-medium">Valor Total</span>
              <span className="text-primary text-base font-bold tabular-nums">
                {formatBRL(booking.amount)}
              </span>
            </div>
            {booking.quantity > 1 && (
              <div className="text-muted-foreground flex justify-between">
                <span>Detalhamento</span>
                <span className="tabular-nums">
                  {booking.quantity} ×{" "}
                  {SERVICE_UNIT_SHORT[booking.unit as keyof typeof SERVICE_UNIT_SHORT] ??
                    booking.unit}
                </span>
              </div>
            )}
          </div>

          {/* Endereço & Rotas */}
          <div className="bg-card space-y-2.5 rounded-xl border p-4">
            <div className="flex items-start gap-2.5">
              <MapPin className="text-primary mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground text-xs font-medium">Endereço do Local</p>
                <p className="text-foreground text-xs leading-snug font-semibold">
                  {booking.address}
                </p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">CEP: {booking.cep}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t pt-1">
              <Button variant="outline" size="sm" asChild className="h-7 flex-1 text-xs">
                <a href={googleMapsUrl} target="_blank" rel="noreferrer">
                  <Navigation className="mr-1 size-3 text-blue-500" /> Google Maps
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild className="h-7 flex-1 text-xs">
                <a href={wazeUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 size-3 text-cyan-500" /> Waze
                </a>
              </Button>
            </div>
          </div>

          {booking.notes && (
            <div className="bg-muted/10 space-y-1 rounded-xl border p-3.5">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                Observações do Cliente
              </p>
              <p className="text-foreground text-xs leading-relaxed">{booking.notes}</p>
            </div>
          )}

          {/* Laudo Técnico Digital & Fotos Antes/Depois */}
          <div className="space-y-2.5 rounded-xl border border-emerald-500/20 bg-emerald-50/50 p-3.5 dark:bg-emerald-950/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                <ClipboardCheck className="size-4 text-emerald-600" />
                <span>Laudo Técnico & Fotos Antes/Depois</span>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
                Garantia de 90 Dias
              </span>
            </div>

            <p className="text-muted-foreground text-xs leading-relaxed">
              Registre a comprovação fotográfica do serviço para garantir a liberação dos fundos em
              custódia e proteger seu trabalho contra contestações.
            </p>

            {((booking.beforePhotos && booking.beforePhotos.length > 0) ||
              (booking.afterPhotos && booking.afterPhotos.length > 0)) && (
              <div className="flex items-center gap-3 pt-1 text-xs">
                <span className="font-medium text-emerald-700 dark:text-emerald-300">
                  📷 {booking.beforePhotos?.length ?? 0} fotos antes ·{" "}
                  {booking.afterPhotos?.length ?? 0} fotos depois
                </span>
              </div>
            )}

            {onReport && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onOpenChange(false)
                  onReport()
                }}
                className="mt-1 w-full gap-2 bg-emerald-600 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
              >
                <Camera className="size-3.5" />
                <span>
                  {booking.beforePhotos?.length || booking.afterPhotos?.length
                    ? "Editar Laudo & Fotos"
                    : "Preencher Laudo & Tirar Fotos"}
                </span>
              </Button>
            )}
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2 border-t pt-3">
          {onReport && (
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false)
                onReport()
              }}
              className="gap-1.5 border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            >
              <ClipboardCheck className="size-4" /> Laudo & Checklist
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { BookingDetailsDialog as ProviderBookingDetailsDialog }
