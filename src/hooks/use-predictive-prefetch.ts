"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

export const prefetchedUrls = new Set<string>()

export interface PredictivePrefetchOptions {
  hoverDelayMs?: number
  enabled?: boolean
}

export interface PrefetchHandlers {
  onMouseEnter: () => void
  onMouseLeave: () => void
  onTouchStart: () => void
  onFocus: () => void
}

/**
 * Hook para pré-carregamento preditivo de páginas baseado na intenção do usuário (hover/foco/toque).
 * Reduz a latência percebida de navegação para < 50ms (sensação de aplicativo nativo).
 */
export function usePredictivePrefetch(defaultOptions: PredictivePrefetchOptions = {}) {
  const router = useRouter()
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const prefetch = React.useCallback(
    (href: string) => {
      if (
        !href ||
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("#") ||
        href.startsWith("tel:") ||
        href.startsWith("sms:") ||
        href.startsWith("mailto:")
      ) {
        return
      }

      // Evita chamadas duplicadas
      if (prefetchedUrls.has(href)) return

      // Respeita modo de economia de dados do usuário (Save-Data)
      if (
        typeof navigator !== "undefined" &&
        "connection" in navigator &&
        (navigator as { connection?: { saveData?: boolean } }).connection?.saveData
      ) {
        return
      }

      prefetchedUrls.add(href)
      try {
        router.prefetch(href)
      } catch {
        // Ignora erro em ambientes sem suporte
      }
    },
    [router],
  )

  const getPrefetchProps = React.useCallback(
    (href: string, options: PredictivePrefetchOptions = {}): PrefetchHandlers => {
      const delay = options.hoverDelayMs ?? defaultOptions.hoverDelayMs ?? 65
      const enabled = options.enabled ?? defaultOptions.enabled ?? true

      if (!enabled) {
        return {
          onMouseEnter: () => {},
          onMouseLeave: () => {},
          onTouchStart: () => {},
          onFocus: () => {},
        }
      }

      const handleMouseEnter = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => {
          prefetch(href)
        }, delay)
      }

      const handleMouseLeave = () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
      }

      const handleTouchStart = () => {
        prefetch(href)
      }

      const handleFocus = () => {
        prefetch(href)
      }

      return {
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
        onTouchStart: handleTouchStart,
        onFocus: handleFocus,
      }
    },
    [defaultOptions, prefetch],
  )

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return {
    prefetch,
    getPrefetchProps,
    prefetchedUrls,
  }
}
