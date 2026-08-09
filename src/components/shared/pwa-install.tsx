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
  const [deferredPrompt, setDeferredPrompt] =
    React.useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = React.useState(isDismissed)
  const [isInstallable, setIsInstallable] = React.useState(false)

  React.useEffect(() => {
    // Listen for the beforeinstallprompt event (Chrome Android)
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setIsInstallable(true)
    }

    window.addEventListener("beforeinstallprompt", handler)

    // Check if already installed (display-mode: standalone) — deferred out of
    // the synchronous effect body (react-hooks/set-state-in-effect gate).
    const t = window.setTimeout(() => {
      if (window.matchMedia("(display-mode: standalone)").matches) {
        setIsInstallable(false)
      }
    }, 0)

    return () => {
      window.removeEventListener("beforeinstallprompt", handler)
      window.clearTimeout(t)
    }
  }, [])

  // Also check on window focus (user might have installed via another method)
  React.useEffect(() => {
    const onFocus = () => {
      if (
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true
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
      console.log("[PWA] User installed the app")
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
        "fixed bottom-0 left-0 right-0 z-50",
        "bg-background border-t shadow-lg",
        "p-4 pb-6 animate-in slide-in-from-bottom",
      )}
    >
      <div className="mx-auto flex max-w-md items-start gap-3">
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold">Instale o Severinno</p>
          <p className="text-xs text-muted-foreground">
            Adicione à tela inicial para acesso rápido e notificações no seu
            celular.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleInstall}>
            <Download className="mr-1.5 size-3.5" />
            Instalar
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={handleDismiss}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * iOS PWA Install Guide — mostra instruções específicas para iOS Safari,
 * já que o iOS não dispara o evento beforeinstallprompt.
 *
 * Exibe um card com o passo a passo: Compartilhar → Adicionar à Tela de Início.
 */
export function IOSInstallGuide() {
  const [showGuide, setShowGuide] = React.useState(false)
  const [isIOS, setIsIOS] = React.useState(false)
  const [isStandalone, setIsStandalone] = React.useState(false)

  React.useEffect(() => {
    // Deferred so the setStates aren't synchronous in the effect body
    // (react-hooks/set-state-in-effect gate).
    const t = window.setTimeout(() => {
      const ua = navigator.userAgent
      const iOS = /iPad|iPhone|iPod/.test(ua)
      setIsIOS(iOS)

      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true
      setIsStandalone(standalone)
    }, 0)
    return () => window.clearTimeout(t)
  }, [])

  if (!isIOS || isStandalone) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(!showGuide)}
        className="text-xs text-emerald-600 hover:text-emerald-700 underline underline-offset-2"
      >
        {showGuide ? "Fechar" : "Como instalar no iPhone/iPad?"}
      </button>

      {showGuide && (
        <div className="mt-2 rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          <p>📱 Para instalar no iPhone/iPad:</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Abra o Safari</li>
            <li>Toque no ícone <strong>Compartilhar</strong> (📤)</li>
            <li>Role para baixo e toque em <strong>Adicionar à Tela de Início</strong></li>
            <li>Toque em <strong>Adicionar</strong> (canto superior direito)</li>
          </ol>
          <p className="pt-1">
            Após instalar, você pode ativar as notificações push no app.
          </p>
        </div>
      )}
    </>
  )
}
