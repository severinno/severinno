"use client"

import * as React from "react"
import { Download, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * PWA Install Banner — aparece no Android Chrome quando o app pode ser
 * instalado na tela inicial (beforeinstallprompt event).
 *
 * Funciona apenas em navegadores Chromium mobile (Android Chrome, Samsung
 * Internet, etc.). iOS Safari não dispara this evento — usuários iOS devem
 * usar o botão "Compartilhar" → "Adicionar à Tela de Início".
 */
const DISMISSED_KEY = "pwa-install-dismissed-at"
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function isDismissed(): boolean {
  try {
    const stored = localStorage.getItem(DISMISSED_KEY)
    if (!stored) return false
    const dismissedAt = Number.parseInt(stored, 10)
    if (Number.isNaN(dismissedAt)) return false
    return Date.now() - dismissedAt < DISMISS_DURATION_MS
  } catch {
    return false
  }
}

function persistDismiss(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
  } catch {
    // localStorage not available — ignore
  }
}

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = React.useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = React.useState(isDismissed)
  const [isInstallable, setIsInstallable] = React.useState(false)

  // Standalone (already installed) is derived from the beforeinstallprompt
  // event never firing plus the focus re-check below; the initial value
  // stays false and the mount-time matchMedia check was redundant.

  React.useEffect(() => {
    // Listen for the beforeinstallprompt event (Chrome Android)
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setIsInstallable(true)
    }

    window.addEventListener("beforeinstallprompt", handler)

    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  // Also check on window focus (user might have installed via another method)
  React.useEffect(() => {
    const onFocus = () => {
      if (
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true
      ) {
        setIsInstallable(false)
        setDeferredPrompt(null)
      }
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return

    deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setIsInstallable(false)

    if (choice.outcome === "accepted") {
      // PWA install accepted — analytics-only event, intentionally not logged
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    persistDismiss()
  }

  if (!isInstallable || dismissed) return null

  return (
    <div
      className={cn(
        "fixed right-0 bottom-0 left-0 z-50",
        "bg-background border-t shadow-lg",
        "animate-in slide-in-from-bottom p-4 pb-6",
      )}
    >
      <div className="mx-auto flex max-w-md items-start gap-3">
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold">Instale o Severinno</p>
          <p className="text-muted-foreground text-xs">
            Adicione à tela inicial para acesso rápido e notificações no seu celular.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleInstall}>
            <Download className="mr-1.5 size-3.5" />
            Instalar
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={handleDismiss}>
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
