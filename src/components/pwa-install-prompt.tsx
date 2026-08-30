"use client"

/**
 * PwaInstallPrompt — Captures the browser's `beforeinstallprompt` event
 * and renders a friendly install CTA.
 *
 * Features:
 * - Captures `beforeinstallprompt` event (Chrome, Edge, Samsung Internet)
 * - Shows install button with slide-up animation
 * - Dismisses with "Never show again" (localStorage)
 * - Shows only on mobile/tablet (not desktop where install is manual)
 * - Hides after 5s to not be annoying
 * - Detects already-installed PWA (standalone mode)
 */

import { useEffect, useState, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Download, X, Sparkles } from "lucide-react"

const DISMISS_KEY = "severinno-pwa-install-dismissed"
const DISMISS_DAYS = 30 // Re-show after 30 days

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Check if user previously dismissed
  const [isDismissed] = useState(() => {
    try {
      const dismissed = localStorage.getItem(DISMISS_KEY)
      if (dismissed) {
        const dismissedAt = Number(dismissed)
        return Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000
      }
    } catch {
      // localStorage unavailable
    }
    return false
  })

  // Capture beforeinstallprompt
  useEffect(() => {
    if (typeof window === "undefined") return

    // Already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return
    // iOS Safari — no beforeinstallprompt, show manual instructions
    if (navigator.userAgent.includes("iPhone") || navigator.userAgent.includes("iPad")) return
    // Desktop — install is usually manual
    if (window.matchMedia("(min-width: 768px)").matches && !window.matchMedia("(pointer: coarse)").matches) return

    function handler(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)

      // Show prompt after 3s delay (don't be annoying on first visit)
      timerRef.current = setTimeout(() => {
        setShowPrompt(true)
      }, 3000)
    }

    window.addEventListener("beforeinstallprompt", handler)

    return () => {
      window.removeEventListener("beforeinstallprompt", handler)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [isDismissed])

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return
    setIsInstalling(true)

    try {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === "accepted") {
        setShowPrompt(false)
      }
    } catch {
      // User cancelled or error
    } finally {
      setDeferredPrompt(null)
      setIsInstalling(false)
    }
  }, [deferredPrompt])

  const handleDismiss = useCallback(() => {
    setShowPrompt(false)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // localStorage unavailable
    }
  }, [])

  // Don't render if dismissed or no prompt available
  if (isDismissed || !showPrompt) return null

  return (
    <AnimatePresence>
      {showPrompt && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed bottom-4 right-4 left-4 z-50 sm:left-auto sm:w-80"
        >
          <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-2xl shadow-emerald-500/10 dark:border-emerald-800 dark:bg-gray-900">
            {/* Header */}
            <div className="relative bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3">
              <button
                onClick={handleDismiss}
                className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30"
                aria-label="Fechar"
              >
                <X className="size-3.5" />
              </button>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-white" />
                <span className="text-sm font-bold text-white">Instalar Severinno</span>
              </div>
            </div>

            {/* Body */}
            <div className="p-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Instale o Severinno no seu celular para acesso rápido, notificações e uso offline.
              </p>

              {/* Actions */}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleInstall}
                  disabled={isInstalling}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700 active:scale-[0.97] disabled:opacity-50"
                >
                  <Download className="size-4" />
                  {isInstalling ? "Instalando…" : "Instalar agora"}
                </button>
                <button
                  onClick={handleDismiss}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Agora não
                </button>
              </div>

              {/* iOS manual instructions */}
              {typeof navigator !== "undefined" &&
                (navigator.userAgent.includes("iPhone") || navigator.userAgent.includes("iPad")) && (
                  <p className="text-muted-foreground mt-3 text-center text-[10px]">
                    No Safari, toque em{" "}
                    <span className="font-semibold">Compartilhar</span> →{" "}
                    <span className="font-semibold">Adicionar à Tela de Início</span>
                  </p>
                )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
