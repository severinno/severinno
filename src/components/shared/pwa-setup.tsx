"use client"

import * as React from "react"

/**
 * PWA Setup — Client-side setup para PWA.
 *
 * Injeta dinamicamente o <link rel="manifest"> no <head> e detecta
 * se o app está rodando em modo standalone (instalado na tela inicial).
 *
 * Também expõe utilitários para o restante do app saber se está
 * rodando como PWA instalado.
 */

// ── Detect standalone mode ────────────────────────────────────────────────

function getStandaloneMode(): "standalone" | "browser" | "unknown" {
  if (typeof window === "undefined") return "unknown"
  if (window.matchMedia("(display-mode: standalone)").matches) return "standalone"
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true)
    return "standalone"
  return "browser"
}

export function useStandaloneMode() {
  const [mode, setMode] = React.useState<ReturnType<typeof getStandaloneMode>>("unknown")

  React.useEffect(() => {
    setMode(getStandaloneMode())

    const mql = window.matchMedia("(display-mode: standalone)")
    const handler = () => setMode(getStandaloneMode())
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [])

  return mode
}

// ── Detect mobile OS ──────────────────────────────────────────────────────

export type MobileOS = "ios" | "android" | "other" | null

function getMobileOS(): MobileOS {
  if (typeof navigator === "undefined") return null
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return "ios"
  if (/Android/.test(ua)) return "android"
  return "other"
}

export function useMobileOS() {
  const [os] = React.useState<MobileOS>(getMobileOS)
  return os
}

/**
 * Detecta se notificações push via Service Worker são suportadas no
 * dispositivo atual (necessário para saber se podemos usar Web Push
 * ou se devemos fallback para WhatsApp).
 *
 * iOS PWA (16.4+) suporta Web Push, mas iOS Safari (browser) não.
 * Android Chrome suporta Web Push tanto no browser quanto no PWA.
 */
export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false
  if (!("serviceWorker" in navigator)) return false
  if (!("PushManager" in window)) return false
  return true
}

/**
 * PWASetup — componente renderless que detecta se o app está rodando
 * como PWA instalado (standalone) e em qual sistema operacional.
 *
 * As hooks `useStandaloneMode()` e `useMobileOS()` podem ser usadas
 * por qualquer componente para adaptar o comportamento.
 */
export function PWASetup() {
  return null // Renderless — hooks disponíveis via export
}
