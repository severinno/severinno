"use client"

/**
 * usePWAInstall — Hook to manage Progressive Web App installation lifecycle.
 *
 * Capabilities:
 * - Intercepts and buffers the Chromium `beforeinstallprompt` event.
 * - Detects iOS Safari devices requiring manual "Add to Home Screen" instructions.
 * - Detects whether the app is already running in standalone display mode.
 * - Manages user dismiss state with configurable expiration (default: 7 days) via localStorage.
 * - Exposes an async `promptInstall()` method returning the user's choice outcome.
 */

import { useState, useEffect, useCallback } from "react"

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export interface UsePWAInstallOptions {
  storageKey?: string
  dismissDays?: number
}

export interface PWAInstallState {
  canInstall: boolean
  isInstalled: boolean
  isIOS: boolean
  isDismissed: boolean
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">
  dismiss: () => void
  resetDismiss: () => void
}

const DEFAULT_STORAGE_KEY = "severinno_pwa_banner_dismissed_until"
const DEFAULT_DISMISS_DAYS = 7

function checkStandalone(): boolean {
  if (typeof window === "undefined") return false
  const matchMediaStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches
  const navigatorStandalone =
    (window.navigator as Navigator & { standalone?: boolean })?.standalone === true
  return Boolean(matchMediaStandalone || navigatorStandalone)
}

function checkDismissed(storageKey: string): boolean {
  if (typeof window === "undefined") return false
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (!stored) return false
    const dismissedUntil = Number.parseInt(stored, 10)
    if (Number.isNaN(dismissedUntil)) return false
    return Date.now() < dismissedUntil
  } catch {
    return false
  }
}

function checkIsIOS(): boolean {
  if (typeof window === "undefined") return false
  const ua = window.navigator?.userAgent?.toLowerCase() || ""
  return /iphone|ipad|ipod/.test(ua) && !/crios|fxios/.test(ua)
}

export function usePWAInstall(options: UsePWAInstallOptions = {}): PWAInstallState {
  const { storageKey = DEFAULT_STORAGE_KEY, dismissDays = DEFAULT_DISMISS_DAYS } = options

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkStandalone())
  const [isIOS] = useState<boolean>(() => checkIsIOS())
  const [isDismissed, setIsDismissed] = useState<boolean>(() => checkDismissed(storageKey))

  useEffect(() => {
    if (typeof window === "undefined") return

    // 1. Listen for Chromium beforeinstallprompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    // 2. Update status when app is launched/focused
    const handleFocus = () => {
      if (checkStandalone()) {
        setIsInstalled(true)
        setDeferredPrompt(null)
      }
    }

    // 3. Listen for appinstalled event
    const handleAppInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstall)
    window.addEventListener("appinstalled", handleAppInstalled)
    window.addEventListener("focus", handleFocus)

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall)
      window.removeEventListener("appinstalled", handleAppInstalled)
      window.removeEventListener("focus", handleFocus)
    }
  }, [storageKey])

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferredPrompt) {
      return "unavailable"
    }

    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      setDeferredPrompt(null)
      return choice.outcome
    } catch {
      setDeferredPrompt(null)
      return "unavailable"
    }
  }, [deferredPrompt])

  const dismiss = useCallback(() => {
    setIsDismissed(true)
    if (typeof window === "undefined") return
    try {
      const expiry = Date.now() + dismissDays * 24 * 60 * 60 * 1000
      window.localStorage.setItem(storageKey, String(expiry))
    } catch {
      // localStorage disabled / quota exceeded
    }
  }, [storageKey, dismissDays])

  const resetDismiss = useCallback(() => {
    setIsDismissed(false)
    if (typeof window === "undefined") return
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
  }, [storageKey])

  return {
    canInstall: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    isIOS: isIOS && !isInstalled,
    isDismissed,
    promptInstall,
    dismiss,
    resetDismiss,
  }
}
