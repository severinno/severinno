"use client"

/**
 * NotificationPreferences — per-type channel toggle UI.
 *
 * Allows users to opt in/out of push, email, WhatsApp, and sound
 * for each notification type (BOOKING_CONFIRMED, QUOTE_RECEIVED, MESSAGE, etc.).
 *
 * Layout:
 *   - Grid card: one row per notification type
 *   - Each row has 4 toggles: Push, E-mail, WhatsApp, Som
 *   - Saves immediately on toggle via API
 */

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Bell, Volume2, Mail, MessageSquare } from "lucide-react"
import { MobilePushGuide } from "@/components/shared/mobile-push-guide"
import { toast } from "sonner"

import { apiGet, apiPatch } from "@/lib/api"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

// ── Types ───────────────────────────────────────────────────────────────────

type NotificationPreference = {
  type: string
  pushEnabled: boolean
  emailEnabled: boolean
  whatsappEnabled: boolean
  soundEnabled: boolean
}

type ChannelKey = "pushEnabled" | "emailEnabled" | "whatsappEnabled" | "soundEnabled"

const NOTIFICATION_TYPES = [
  { key: "BOOKING_CONFIRMED", label: "Agendamento confirmado" },
  { key: "BOOKING_CANCELLED", label: "Agendamento cancelado" },
  { key: "BOOKING_REMINDER", label: "Lembrete de agendamento" },
  { key: "QUOTE_RECEIVED", label: "Orçamento recebido" },
  { key: "QUOTE_RESPONDED", label: "Orçamento respondido" },
  { key: "MESSAGE", label: "Nova mensagem" },
  { key: "REVIEW_RECEIVED", label: "Avaliação recebida" },
  { key: "PAYMENT_CONFIRMED", label: "Pagamento confirmado" },
  { key: "PAYMENT_REFUNDED", label: "Reembolso" },
  { key: "WITHDRAWAL_COMPLETED", label: "Saque realizado" },
  { key: "PROMOTIONAL", label: "Ofertas e novidades" },
]

const CHANNELS: { key: ChannelKey; label: string; icon: React.ReactNode }[] = [
  { key: "pushEnabled", label: "Push", icon: <Bell className="size-3.5" /> },
  { key: "emailEnabled", label: "E-mail", icon: <Mail className="size-3.5" /> },
  { key: "whatsappEnabled", label: "WhatsApp", icon: <MessageSquare className="size-3.5" /> },
  { key: "soundEnabled", label: "Som", icon: <Volume2 className="size-3.5" /> },
]

// ── Component ───────────────────────────────────────────────────────────────

export function NotificationPreferences() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () =>
      apiGet<{ preferences: NotificationPreference[] }>("/api/notifications/preferences"),
    staleTime: 60_000,
  })

  const preferences = React.useMemo(() => {
    const map = new Map<string, NotificationPreference>()
    for (const p of data?.preferences ?? []) {
      map.set(p.type, p)
    }
    return map
  }, [data])

  const saveMutation = useMutation({
    mutationFn: (payload: Partial<NotificationPreference> & { type: string }) =>
      apiPatch("/api/notifications/preferences", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] })
    },
    onError: () => {
      toast.error("Não foi possível salvar a preferência.")
    },
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="text-primary size-5" />
          Preferências de notificação
        </CardTitle>
        <CardDescription>
          Escolha como você quer ser notificado para cada tipo de evento.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs font-medium">
                <th className="pr-4 pb-2 font-normal">Tipo de notificação</th>
                {CHANNELS.map((ch) => (
                  <th key={ch.key} className="px-3 pb-2 text-center font-normal">
                    <span className="inline-flex items-center gap-1">
                      {ch.icon}
                      {ch.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_TYPES.map((nt) => {
                const pref = preferences.get(nt.key)
                return (
                  <tr
                    key={nt.key}
                    className="hover:bg-muted/30 border-b transition-colors last:border-0"
                  >
                    <td className="py-3 pr-4 text-sm font-medium">{nt.label}</td>
                    {CHANNELS.map((ch) => {
                      const enabled = pref ? pref[ch.key] : true // default: enabled
                      return (
                        <td key={ch.key} className="px-3 py-3 text-center">
                          <Switch
                            checked={enabled}
                            onCheckedChange={(checked) => {
                              saveMutation.mutate({
                                type: nt.key,
                                [ch.key]: checked,
                              })
                            }}
                            disabled={saveMutation.isPending}
                            aria-label={`${ch.label} para ${nt.label}`}
                            className="mx-auto"
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>

      {/* Mobile-specific push guide (hidden on desktop) */}
      <div className="px-6 pb-6">
        <MobilePushGuide />
      </div>
    </Card>
  )
}
