"use client"

import * as React from "react"
import { WifiOff, RefreshCw, CheckCircle2 } from "lucide-react"
import { isOnline, getPendingMutations, processSyncQueue } from "@/lib/offline-sync"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"

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
      triggerHaptic("warning")
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
      className={cn(
        "fixed top-3 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-2.5 rounded-full border px-4 py-2 text-xs font-semibold shadow-lg backdrop-blur-md transition-all duration-300 sm:max-w-md",
        online
          ? "border-emerald-300/80 bg-emerald-600/95 text-white dark:border-emerald-700/80 dark:bg-emerald-950/95 dark:text-emerald-100"
          : "border-amber-300/80 bg-amber-500/95 text-amber-950 dark:border-amber-700/80 dark:bg-amber-950/95 dark:text-amber-100",
      )}
    >
      {online ? (
        <>
          <CheckCircle2 className="size-4 shrink-0 text-white dark:text-emerald-300" />
          <span className="truncate">Conexão restabelecida</span>
          {syncing && <RefreshCw className="size-3.5 shrink-0 animate-spin" />}
        </>
      ) : (
        <>
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-900 opacity-75 dark:bg-amber-200" />
            <span className="relative inline-flex size-2 rounded-full bg-amber-900 dark:bg-amber-200" />
          </span>
          <WifiOff className="size-4 shrink-0" />
          <span className="truncate">Modo Offline &middot; Ações serão sincronizadas</span>
          {pendingCount > 0 && (
            <span className="shrink-0 rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-bold dark:bg-white/20">
              {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
            </span>
          )}
        </>
      )}
    </div>
  )
}
