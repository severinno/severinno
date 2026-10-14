"use client"

import * as React from "react"
import { WifiOff, RefreshCw, CheckCircle2 } from "lucide-react"
import { isOnline, getPendingMutations, processSyncQueue } from "@/lib/offline-sync"
import { toast } from "sonner"

export function OfflineIndicator() {
  const [online, setOnline] = React.useState<boolean>(() => isOnline())
  const [justReconnected, setJustReconnected] = React.useState<boolean>(false)
  const [syncing, setSyncing] = React.useState<boolean>(false)
  const [pendingCount, setPendingCount] = React.useState<number>(() => getPendingMutations().length)

  const updatePendingCount = React.useCallback(() => {
    setPendingCount(getPendingMutations().length)
  }, [])

  React.useEffect(() => {
    const handleOnline = async () => {
      setOnline(true)
      setJustReconnected(true)
      const count = getPendingMutations().length

      if (count > 0) {
        setSyncing(true)
        toast.info(`Reconectado! Sincronizando ${count} ações salvas localmente...`)
        try {
          await processSyncQueue(async () => true)
          toast.success("Todas as ações foram sincronizadas com sucesso!")
        } catch {
          toast.error("Algumas ações pendentes falharam na sincronização.")
        } finally {
          setSyncing(false)
          updatePendingCount()
        }
      }

      const timer = setTimeout(() => {
        setJustReconnected(false)
      }, 4000)
      return () => clearTimeout(timer)
    }

    const handleOffline = () => {
      setOnline(false)
      setJustReconnected(false)
      updatePendingCount()
      toast.warning("Você está offline. Visualizando dados salvos em cache.", {
        duration: 5000,
      })
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [updatePendingCount])

  if (online && !justReconnected) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md transition-all duration-300 md:bottom-6 md:left-6"
      style={{
        backgroundColor: online ? "rgba(16, 185, 129, 0.95)" : "rgba(245, 158, 11, 0.95)",
        borderColor: online ? "rgb(5, 150, 105)" : "rgb(217, 119, 6)",
        color: "#ffffff",
      }}
    >
      {online ? (
        <>
          <CheckCircle2 className="size-3.5" />
          <span>Conexão restabelecida</span>
          {syncing && <RefreshCw className="size-3.5 animate-spin" />}
        </>
      ) : (
        <>
          <WifiOff className="size-3.5" />
          <span>Modo Offline</span>
          {pendingCount > 0 && (
            <span className="py-0.2 rounded-full bg-black/30 px-1.5 text-[10px]">
              {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
            </span>
          )}
        </>
      )}
    </div>
  )
}
