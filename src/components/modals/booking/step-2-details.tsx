"use client"

import * as React from "react"
import { MapPin } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { formatBRL, formatHHmm, formatDate } from "@/lib/format"
import { SERVICE_UNIT_SHORT } from "@/lib/constants"
import { StepHeader, InfoCard } from "../step-wizard"
import { GeoAddressForm } from "@/components/forms/geo-address-form"
import type { Step2Props } from "./types"

export function Step2Details({ state, set, provider, selectedService }: Step2Props) {
  const scheduledAt =
    state.date && state.time
      ? (() => {
          const d = new Date(state.date)
          const [h, m] = state.time.split(":").map(Number)
          d.setHours(h ?? 0, m ?? 0, 0, 0)
          return d
        })()
      : null

  const estimatedTotal = (selectedService?.basePrice ?? 0) * (state.quantity || 1)

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={MapPin}
        title="Detalhes do agendamento"
        description="Informe a quantidade, endereço e observações."
      />

      <InfoCard variant="emerald">
        <div className="flex items-center gap-3">
          <Avatar className="size-8 rounded-md">
            {provider?.avatarUrl ? (
              <AvatarImage src={provider.avatarUrl} alt={provider.name} />
            ) : null}
            <AvatarFallback className="rounded-md bg-emerald-100 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {provider?.name?.[0]?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{provider?.name}</p>
            <p className="text-muted-foreground truncate text-[11px]">{selectedService?.title}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-muted-foreground text-[11px]">
              {scheduledAt ? formatDate(scheduledAt) : "—"}
            </p>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              {scheduledAt ? formatHHmm(state.time!) : "—"}
            </p>
          </div>
        </div>
      </InfoCard>

      {selectedService && (
        <div className="flex items-end gap-3">
          <div className="grid flex-1 gap-1">
            <Label htmlFor="qty" className="text-xs">
              Quantidade ({SERVICE_UNIT_SHORT[selectedService.unit]})
            </Label>
            <Input
              id="qty"
              type="number"
              min={1}
              step={1}
              value={state.quantity}
              onChange={(e) => set("quantity", Number(e.target.value) || 1)}
              className="h-9 text-sm"
            />
          </div>
          <div className="pb-0.5">
            <p className="text-muted-foreground text-[11px]">Total estimado</p>
            <p className="text-base font-bold text-emerald-700 dark:text-emerald-400">
              {formatBRL(estimatedTotal)}
            </p>
          </div>
        </div>
      )}

      <Separator />

      <div>
        <p className="text-muted-foreground mb-1.5 flex items-center gap-1 text-xs font-medium">
          <MapPin className="size-3.5 text-emerald-600" />
          Endereço do serviço
        </p>
        <GeoAddressForm value={state.address} onChange={(v) => set("address", v)} />
      </div>

      <Separator />

      <div className="grid gap-1">
        <Label htmlFor="notes" className="text-xs">
          Observações (opcional)
        </Label>
        <Textarea
          id="notes"
          placeholder="Detalhes para o prestador: portão, vaga, problemas específicos..."
          rows={2}
          value={state.notes}
          onChange={(e) => set("notes", e.target.value)}
          className="resize-none text-sm"
        />
      </div>
    </div>
  )
}
