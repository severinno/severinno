"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { apiGet } from "@/lib/api"
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SERVICE_UNIT_SHORT,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/constants"
import { formatBRL, formatDateTime } from "@/lib/format"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { BookingTimeline } from "@/components/shared/flow-timeline"
import {
  StatusBadge,
  bookingIcon,
  bookingTone,
  paymentIcon,
  paymentTone,
} from "@/components/client/client-shared"
import type { Booking } from "@/components/client/client-bookings"

export interface BookingDetailsDialogProps {
  bookingId: string | null
  onOpenChange: (open: boolean) => void
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 border-b pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="col-span-2 text-sm break-words">{value}</span>
    </div>
  )
}

/**
 * BookingDetailsDialog — modal displaying comprehensive booking inspection
 * including address, payment status, value and progress timeline.
 */
export function BookingDetailsDialog({ bookingId, onOpenChange }: BookingDetailsDialogProps) {
  const query = useQuery<{
    booking: Booking & { notes?: string | null }
  }>({
    queryKey: ["booking", bookingId],
    queryFn: () => apiGet(`/api/bookings/${bookingId}`),
    enabled: !!bookingId,
  })

  const b = query.data?.booking

  return (
    <Dialog open={!!bookingId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Detalhes do agendamento</DialogTitle>
          <DialogDescription>Informações completas sobre este serviço.</DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Carregando…
          </div>
        ) : !b ? (
          <p className="text-muted-foreground text-sm">Agendamento não encontrado.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <Row label="Prestador" value={b.provider.name} />
            <Row label="Serviço" value={b.service.title} />
            <Row
              label="Agendado para"
              value={<span className="tabular-nums">{formatDateTime(b.scheduledAt)}</span>}
            />
            <Row label="Endereço" value={b.address} />
            <Row label="CEP" value={<span className="tabular-nums">{b.cep}</span>} />
            <Row
              label="Status"
              value={
                <StatusBadge
                  tone={bookingTone(b.status as BookingStatus)}
                  icon={bookingIcon(b.status as BookingStatus)}
                >
                  {BOOKING_STATUS_LABELS[b.status as BookingStatus]}
                </StatusBadge>
              }
            />
            <Row
              label="Pagamento"
              value={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span>{PAYMENT_METHOD_LABELS[b.paymentMethod as PaymentMethod]}</span>
                  <span className="text-muted-foreground">·</span>
                  <StatusBadge
                    tone={paymentTone(b.paymentStatus as PaymentStatus)}
                    icon={paymentIcon(b.paymentStatus as PaymentStatus)}
                    className="text-[10px]"
                  >
                    {PAYMENT_STATUS_LABELS[b.paymentStatus as PaymentStatus]}
                  </StatusBadge>
                </span>
              }
            />
            <Row
              label="Valor"
              value={<span className="font-semibold tabular-nums">{formatBRL(b.amount)}</span>}
            />
            {b.quantity > 1 ? (
              <Row
                label="Quantidade"
                value={`${b.quantity} × ${SERVICE_UNIT_SHORT[b.unit] ?? b.unit}`}
              />
            ) : null}
            {b.notes ? <Row label="Observações" value={b.notes} /> : null}

            {/* Flow transparency — "what happens now" timeline */}
            <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <BookingTimeline status={b.status} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
