"use client"

import * as React from "react"

/**
 * useOnlineStatus — Hook reativo e seguro para detectar conectividade de rede
 *
 * Aplicação das Heurísticas de Nielsen:
 * - H1 Visibilidade do estado do sistema: Notifica componentes sobre status de conexão em tempo real.
 * - H9 Recuperação de erros: Permite acionar fallbacks imediatos como SMS e WhatsApp offline.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = React.useState<boolean>(() => {
    if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
      return navigator.onLine
    }
    return true
  })

  React.useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  return online
}
