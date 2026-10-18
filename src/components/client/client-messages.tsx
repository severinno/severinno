"use client"

/**
 * ClientMessages — client messaging panel with anti-fraud shield & escrow protection.
 *
 * Polish & Service Design:
 *  - Modern Hero Banner with subtle emerald/card gradient & Trust Shield Badge.
 *  - Quick access actions: "Buscar prestadores" & "Meus agendamentos".
 *  - Anti-Fraud & Escrow Safety Advisory Banner (reinforcing 100% in-platform communication,
 *    zero external WhatsApp leaks, 90-day CDC warranty protection).
 *  - Smart peer ID resolution supporting params.with, params.peerId, or params.providerId.
 *  - High-performance, realtime chat wrapper with MessagesView.
 */

import * as React from "react"
import { Calendar, MapPin, ShieldAlert, ShieldCheck } from "lucide-react"

import { MessagesView } from "@/components/shared/messages-view"
import { useViewStore } from "@/store/view"
import { Button } from "@/components/ui/button"

export function ClientMessages() {
  const navigate = useViewStore((s) => s.navigate)
  const params = useViewStore((s) => s.params) as
    { with?: string; peerId?: string; providerId?: string } | undefined

  const peerId =
    typeof params?.providerId === "string"
      ? params.providerId
      : typeof params?.peerId === "string"
        ? params.peerId
        : typeof params?.with === "string"
          ? params.with
          : undefined

  return (
    <div className="space-y-4">
      {/* Hero Banner */}
      <div className="border-border/60 from-card via-card/95 to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br p-6 shadow-sm">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
              <ShieldCheck className="text-primary size-3.5" />
              <span>Blindagem & Comunicação Segura</span>
            </div>
            <h1 className="text-foreground mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              Mensagens
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Converse em tempo real com prestadores em Governador Valadares. Mantenha toda a
              negociação dentro da plataforma para garantir a custódia segura do pagamento e a
              garantia legal de 90 dias do CDC.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("client.bookings")}
              className="gap-1.5 text-xs font-medium"
            >
              <Calendar className="size-3.5" />
              Meus agendamentos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("client.providers")}
              className="gap-1.5 text-xs font-medium"
            >
              <MapPin className="size-3.5" />
              Buscar prestadores
            </Button>
          </div>
        </div>
      </div>

      {/* Escrow & Anti-Fraud Security Notice */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-50/50 p-4 text-xs dark:border-amber-500/20 dark:bg-amber-950/20">
        <ShieldAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 space-y-1">
          <p className="font-semibold text-amber-900 dark:text-amber-200">
            Proteção de Custódia & Garantia Legal de 90 Dias
          </p>
          <p className="leading-relaxed text-amber-800/90 dark:text-amber-300/80">
            Nunca realize pagamentos por fora da plataforma nem migre a conversa para WhatsApp ou
            telefone pessoal. O pagamento fica retido em custódia até você confirmar a conclusão do
            serviço. Negociações externas anulam a proteção de estorno e a garantia legal de 90
            dias.
          </p>
        </div>
      </div>

      {/* Embedded Messages View */}
      <MessagesView
        initialPeerId={peerId}
        emptyTitle="Conversas com prestadores"
        emptyDescription="Tire dúvidas, aprove propostas com Custódia Segura PIX e combine detalhes dos seus atendimentos."
        className="h-[calc(100vh-19rem)] min-h-[520px]"
      />
    </div>
  )
}

export default ClientMessages
