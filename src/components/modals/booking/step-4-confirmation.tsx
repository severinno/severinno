"use client"

import {
  Check,
  CheckCircle2,
  CalendarDays,
  Clock,
  CreditCard,
  MapPin,
  QrCode,
  ShieldCheck,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { formatBRL, formatDate, formatHHmm } from "@/lib/format"
import { StepHeader, InfoCard } from "../step-wizard"
import { ReviewSection } from "./review-section"
import type { Step4Props } from "./types"

export function Step4Confirmation({ state, provider, selectedService, goToStep }: Step4Props) {
  const amount = (selectedService?.basePrice ?? 0) * (state.quantity || 1)
  const scheduledAt =
    state.date && state.time
      ? (() => {
          const d = new Date(state.date)
          const [h, m] = state.time.split(":").map(Number)
          d.setHours(h ?? 0, m ?? 0, 0, 0)
          return d
        })()
      : null

  return (
    <div className="grid gap-4">
      <StepHeader
        icon={Check}
        title="Confirme o agendamento"
        description="Revise os detalhes antes de confirmar."
      />

      <ReviewSection label="Prestador" onEdit={() => goToStep(1)}>
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8 rounded-md">
            {provider?.avatarUrl ? (
              <AvatarImage src={provider.avatarUrl} alt={provider.name} />
            ) : null}
            <AvatarFallback className="rounded-md bg-emerald-100 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {provider?.name?.[0]?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{provider?.name}</p>
            <p className="text-muted-foreground truncate text-xs">{selectedService?.title}</p>
          </div>
        </div>
      </ReviewSection>

      <ReviewSection label="Data e horário" onEdit={() => goToStep(1)}>
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-emerald-600" />
          <span className="text-sm">
            {scheduledAt ? formatDate(scheduledAt) : "—"} às{" "}
            {state.time ? formatHHmm(state.time) : "—"}
          </span>
        </div>
      </ReviewSection>

      <ReviewSection label="Endereço" onEdit={() => goToStep(2)}>
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <span className="text-muted-foreground">
            {state.address.street
              ? `${state.address.street}, ${state.address.number}${
                  state.address.complement ? ` - ${state.address.complement}` : ""
                }${state.address.district ? ` · ${state.address.district}` : ""}`
              : "—"}
            {state.address.city ? ` · ${state.address.city}/${state.address.state}` : ""}
          </span>
        </div>
      </ReviewSection>

      <ReviewSection label="Pagamento" onEdit={() => goToStep(3)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            {state.paymentMethod === "PIX" ? (
              <QrCode className="size-4 text-emerald-600" />
            ) : (
              <CreditCard className="size-4 text-emerald-600" />
            )}
            <span>{state.paymentMethod === "PIX" ? "PIX" : "Cartão de crédito"}</span>
          </div>
          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
            {formatBRL(amount)}
          </span>
        </div>
        {state.notes && (
          <p className="text-muted-foreground mt-1.5 line-clamp-2 text-xs">📝 {state.notes}</p>
        )}
      </ReviewSection>

      <InfoCard variant="emerald" className="mt-1">
        <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
          <Clock className="size-3.5" />O que acontece agora?
        </h4>
        <div className="grid gap-2.5">
          {[
            { icon: CalendarDays, label: "Agendado", desc: "Seu pedido é registrado" },
            { icon: CheckCircle2, label: "Prestador confirma", desc: "Aceita ou ajusta o horário" },
            { icon: Clock, label: "Em andamento", desc: "Serviço sendo realizado" },
            { icon: Check, label: "Concluído", desc: "Você avalia o serviço" },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                  {item.label}
                </p>
                <p className="text-muted-foreground text-[11px]">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </InfoCard>

      <div className="text-muted-foreground flex items-center justify-center gap-1.5 text-[11px]">
        <ShieldCheck className="size-3.5 text-emerald-600" />
        Ambiente de demonstração — nenhum pagamento será efetivado
      </div>
    </div>
  )
}
