"use client"

import * as React from "react"
import { BellRing, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { usePushSubscription } from "@/hooks/use-service-worker"
import { triggerHaptic } from "@/lib/haptics"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * PushNotificationButton — Native Web Push toggle & test
 * Renders in the dashboard topbar to manage device-level push notification subscription.
 */
export function PushNotificationButton() {
  const {
    isSubscribed,
    isSupported,
    permission,
    loading,
    testing,
    subscribe,
    unsubscribe,
    sendTestNotification,
  } = usePushSubscription()

  if (!isSupported) return null

  const handleSubscribe = async () => {
    if (loading || testing) return
    triggerHaptic("medium")
    const ok = await subscribe()
    if (ok) {
      toast.success("Notificações Push ativadas!", {
        description: "Você receberá alertas em tempo real no seu dispositivo.",
      })
    } else if (permission === "denied") {
      toast.error("Notificações bloqueadas", {
        description:
          "Permita as notificações nas configurações do seu navegador para receber avisos.",
      })
    }
  }

  if (isSubscribed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative size-9 text-emerald-600 transition-all hover:text-emerald-700 active:scale-95 dark:text-emerald-400"
            aria-label="Notificações Push no dispositivo ativas"
            title="Notificações Push no dispositivo ativas"
          >
            <BellRing className="size-[18px]" />
            <span className="absolute top-2 right-2 size-2 animate-pulse rounded-full bg-emerald-500" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-xs font-semibold">
            Notificações no Dispositivo
          </DropdownMenuLabel>
          <div className="text-muted-foreground px-2 py-1 text-xs">
            Alertas em tempo real ativados para mensagens, reservas e propostas.
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={testing}
            onClick={async () => {
              triggerHaptic("selection")
              const res = await sendTestNotification()
              if (res.ok) {
                toast.success("Notificação de teste enviada com sucesso!")
              } else {
                toast.error(res.message || "Erro ao testar envio de notificação push")
              }
            }}
            className="cursor-pointer text-xs"
          >
            {testing ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}
            Testar Notificação Push
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={loading}
            onClick={async () => {
              triggerHaptic("selection")
              const ok = await unsubscribe()
              if (ok) {
                toast.info("Notificações push desativadas neste aparelho.")
              }
            }}
            className="cursor-pointer text-xs text-rose-600 focus:text-rose-600 dark:text-rose-400"
          >
            Desativar neste aparelho
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground hover:text-foreground size-9 transition-all active:scale-95"
      onClick={handleSubscribe}
      disabled={loading}
      aria-label="Ativar Notificações Push no dispositivo"
      title={
        permission === "denied"
          ? "Notificações bloqueadas no navegador"
          : "Ativar notificações em tempo real no dispositivo"
      }
    >
      {loading ? (
        <Loader2 className="size-[18px] animate-spin" />
      ) : (
        <BellRing className="size-[18px] opacity-70" />
      )}
    </Button>
  )
}
