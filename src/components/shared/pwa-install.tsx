"use client"

import * as React from "react"
import { Download, Share2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useMobileOS, useStandaloneMode } from "@/components/shared/pwa-setup"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * PWA Install Banner — orienta prestadores e clientes a instalar o app.
 *
 * Suporta:
 * 1. Chromium Mobile (Android Chrome, Samsung Internet): aciona o prompt nativo via beforeinstallprompt.
 * 2. iOS Safari: orienta passo a passo ("Compartilhar" → "Adicionar à Tela de Início").
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
  const [isChromiumInstallable, setIsChromiumInstallable] = React.useState(false)

  const mobileOS = useMobileOS()
  const standaloneMode = useStandaloneMode()

  // Listen for the beforeinstallprompt event (Chromium Android)
  React.useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setIsChromiumInstallable(true)
    }

    window.addEventListener("beforeinstallprompt", handler)
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  // Re-check standalone mode on focus
  React.useEffect(() => {
    const onFocus = () => {
      if (
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true
      ) {
        setIsChromiumInstallable(false)
        setDeferredPrompt(null)
      }
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  const handleInstallChromium = async () => {
    if (!deferredPrompt) return

    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setIsChromiumInstallable(false)
  }

  const handleDismiss = () => {
    setDismissed(true)
    persistDismiss()
  }

  // Já instalado em modo standalone ou usuário descartou recentemente
  if (standaloneMode === "standalone" || dismissed) return null

  // Caso 1: Navegador Chromium com prompt de instalação disponível
  if (isChromiumInstallable) {
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
              Adicione à tela inicial para acesso rápido, orçamentos e notificações no seu celular.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleInstallChromium}>
              <Download className="mr-1.5 size-3.5" />
              Instalar
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={handleDismiss}
              aria-label="Fechar banner"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Caso 2: iOS Safari no mobile (sem suporte a beforeinstallprompt)
  if (mobileOS === "ios") {
    return (
      <div
        className={cn(
          "fixed right-0 bottom-0 left-0 z-50",
          "bg-background border-t shadow-lg",
          "animate-in slide-in-from-bottom p-4 pb-6",
        )}
      >
        <div className="mx-auto flex max-w-md items-start gap-3">
          <div className="flex-1 space-y-1.5">
            <p className="text-sm font-semibold">Instale o Severinno no iPhone</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Toque no ícone Compartilhar{" "}
              <Share2 className="mx-0.5 inline size-3 text-emerald-600 dark:text-emerald-400" /> e
              selecione{" "}
              <strong className="text-foreground font-medium">Adicionar à Tela de Início</strong>{" "}
              para notificações e acesso instantâneo.
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={handleDismiss}
            aria-label="Fechar banner"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    )
  }

  return null
}
