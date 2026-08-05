"use client"

import * as React from "react"
import { Bell, BellOff, Loader2, BellRing } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuthStore } from "@/store/auth"
import { toast } from "sonner"
import { useMobileOS, useStandaloneMode } from "@/components/shared/pwa-setup"
import { cn } from "@/lib/utils"

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(b64)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export function PushToggle() {
  const user = useAuthStore((s) => s.user)
  const [supported, setSupported] = React.useState(false)
  const [subscribed, setSubscribed] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const os = useMobileOS()
  const standalone = useStandaloneMode()

  const isMobile = os === "ios" || os === "android"
  const isStandalone = standalone === "standalone"

  // VAPID key must be configured in production for push to work.
  // Without it, the component gracefully hides.
  const vapidConfigured = VAPID_PUBLIC_KEY.length > 0

  React.useEffect(() => {
    if (!vapidConfigured) return
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return
    setSupported(true)
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub)),
    )
  }, [vapidConfigured])

  const toggle = async () => {
    if (loading || !user) return
    setLoading(true)
    try {
      if (subscribed) {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await sub.unsubscribe()
          await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
        }
        setSubscribed(false)
        toast.success("Notificações desativadas.")
      } else {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        })
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: sub.endpoint,
            p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))),
            auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))),
            userAgent: navigator.userAgent,
          }),
        })
        setSubscribed(true)
        toast.success(
          isMobile
            ? "Notificações push ativadas! ✅ As notificações chegam mesmo com o app fechado."
            : "Notificações push ativadas!",
        )
      }
    } catch {
      toast.error("Erro ao configurar notificações push.")
    } finally {
      setLoading(false)
    }
  }

  // Don't render anything if push isn't available or VAPID isn't configured
  if (!supported || !user) return null
  if (!vapidConfigured) return null

  // iOS without PWA installed: show a disclaimer that push needs the app installed
  const needsIOSInstall = os === "ios" && !isStandalone

  return (
    <div className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        disabled={loading}
        onClick={toggle}
        title={
          subscribed
            ? "Desativar notificações"
            : needsIOSInstall
              ? "Instale o app para ativar notificações"
              : "Ativar notificações"
        }
        className={cn(needsIOSInstall && "cursor-not-allowed opacity-50")}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : subscribed ? (
          isMobile ? (
            <BellRing className="size-4" />
          ) : (
            <Bell className="size-4" />
          )
        ) : (
          <BellOff className="size-4" />
        )}
      </Button>

      {/* Mobile status label */}
      {isMobile && (
        <span className="text-muted-foreground hidden text-xs sm:inline">
          {subscribed
            ? isStandalone
              ? "Push ativo (PWA)"
              : "Push ativo"
            : needsIOSInstall
              ? "Instale o app"
              : "Push inativo"}
        </span>
      )}
    </div>
  )
}
