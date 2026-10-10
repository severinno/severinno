"use client"

import * as React from "react"
import { Bell, X, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePushSubscription } from "@/hooks/use-service-worker"
import { useAuthStore } from "@/store/auth"
import { triggerHaptic } from "@/lib/haptics"
import { toast } from "sonner"

const DISMISSED_KEY = "push-prompt-dismissed-at"
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function isDismissed(): boolean {
  if (typeof window === "undefined") return true
  try {
    const val = localStorage.getItem(DISMISSED_KEY)
    if (!val) return false
    const time = Number.parseInt(val, 10)
    if (Number.isNaN(time)) return false
    return Date.now() - time < DISMISS_DURATION_MS
  } catch {
    return true
  }
}

function persistDismiss(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
  } catch {
    // Ignore storage errors
  }
}

const emptySubscribe = () => () => {}

export function PushPromptBanner() {
  const { user } = useAuthStore()
  const { isSubscribed, isSupported, permission, loading, subscribe } = usePushSubscription()
  const [manuallyDismissed, setManuallyDismissed] = React.useState(false)

  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  const isStoredDismissed = React.useSyncExternalStore(
    emptySubscribe,
    () => isDismissed(),
    () => true,
  )

  const isHidden =
    !mounted ||
    !user ||
    !isSupported ||
    isSubscribed ||
    permission !== "default" ||
    manuallyDismissed ||
    isStoredDismissed

  if (isHidden) {
    return null
  }

  const handleEnable = async () => {
    triggerHaptic("selection")
    const ok = await subscribe()
    if (ok) {
      triggerHaptic("success")
      toast.success("Notificações push ativadas com sucesso!")
      setManuallyDismissed(true)
    } else {
      triggerHaptic("error")
      setManuallyDismissed(true)
      persistDismiss()
    }
  }

  const handleDismiss = () => {
    triggerHaptic("light")
    setManuallyDismissed(true)
    persistDismiss()
  }

  return (
    <aside
      aria-label="Ativar notificações do aplicativo"
      className="animate-in fade-in slide-in-from-bottom-5 fixed right-4 bottom-4 left-4 z-50 mx-auto max-w-lg duration-300 sm:right-6 sm:bottom-6 sm:left-auto"
    >
      <div className="bg-background/95 dark:bg-card/95 flex items-start gap-3 rounded-2xl border border-emerald-500/30 p-4 shadow-xl backdrop-blur-md">
        <div className="mt-0.5 shrink-0 rounded-xl bg-emerald-500/10 p-2.5 text-emerald-600 dark:text-emerald-400">
          <Bell className="size-5 animate-pulse" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <h4 className="text-foreground text-sm font-semibold tracking-tight">
              Ativar Alertas no Celular
            </h4>
            <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              Recomendado
            </span>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Receba novos pedidos de orçamento, confirmações de agendamento e mensagens direto na sua
            tela.
          </p>

          <div className="flex items-center gap-2 pt-2">
            <Button
              type="button"
              size="sm"
              onClick={handleEnable}
              disabled={loading}
              className="h-8 gap-1.5 bg-emerald-600 text-xs text-white shadow-sm hover:bg-emerald-700"
            >
              <Zap className="size-3.5 fill-current" />
              {loading ? "Ativando..." : "Ativar Notificações"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground h-8 text-xs"
            >
              Mais tarde
            </Button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 rounded-lg p-1 transition"
          aria-label="Fechar aviso"
        >
          <X className="size-4" />
        </button>
      </div>
    </aside>
  )
}

export default PushPromptBanner
