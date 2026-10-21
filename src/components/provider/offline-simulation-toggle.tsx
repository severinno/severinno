"use client"

/**
 * offline-simulation-toggle.tsx — Widget de Simulação Offline & Teste de Campo no PWA
 *
 * Permite que prestadores de serviço e avaliadores simulem perda de conectividade (4G/Wi-Fi)
 * diretamente no painel do prestador em Governador Valadares. Permite registrar ações em modo
 * offline (check-in presencial, fotos, conclusão de serviço) e demonstrar o reprocessamento
 * automático via Background Sync do Service Worker ao reconectar.
 */

import * as React from "react"
import { Wifi, WifiOff, RefreshCw, CheckCircle2, MapPin, Send, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  enqueueOfflineMutation,
  getPendingMutations,
  processSyncQueue,
  loadOfflineQueue,
  type QueuedMutation,
} from "@/lib/offline-sync"
import { cn } from "@/lib/utils"

export interface OfflineSimulationToggleProps {
  className?: string
  onSyncComplete?: (result: { succeeded: number; failed: number }) => void
}

export function OfflineSimulationToggle({
  className,
  onSyncComplete,
}: OfflineSimulationToggleProps) {
  const [isSimulatingOffline, setIsSimulatingOffline] = React.useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("severinno_offline_simulation_active") === "true"
    }
    return false
  })
  const [pendingCount, setPendingCount] = React.useState<number>(() => {
    if (typeof window !== "undefined") {
      loadOfflineQueue()
      return getPendingMutations().length
    }
    return 0
  })
  const [isSyncing, setIsSyncing] = React.useState<boolean>(false)
  const [showPanel, setShowPanel] = React.useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("severinno_offline_simulation_active") === "true"
    }
    return false
  })

  // Atualiza contagem de pendências
  const refreshPendingCount = React.useCallback(() => {
    setPendingCount(getPendingMutations().length)
  }, [])

  // Executa sincronização manual da fila
  const handleManualSync = React.useCallback(async () => {
    setIsSyncing(true)
    try {
      const res = await processSyncQueue(async (_mutation: QueuedMutation) => {
        // Simulação realista de despacho para a API com delay de rede
        await new Promise((resolve) => setTimeout(resolve, 350))
        return true
      })

      refreshPendingCount()

      if (res.processed > 0) {
        toast.success("Sincronização PWA Concluída!", {
          description: `${res.succeeded} ação(ões) sincronizada(s) com sucesso via Background Sync.`,
        })
      } else {
        toast.info("Fila Vazia", {
          description: "Nenhuma ação pendente para sincronizar.",
        })
      }

      onSyncComplete?.({ succeeded: res.succeeded, failed: res.failed })
    } catch {
      toast.error("Falha ao sincronizar ações offline")
    } finally {
      setIsSyncing(false)
    }
  }, [onSyncComplete, refreshPendingCount])

  // Escuta evento customizado de trigger de sincronização
  React.useEffect(() => {
    if (typeof window === "undefined") return

    const handleTriggerSync = () => {
      void handleManualSync()
    }

    window.addEventListener("severinno:trigger-offline-sync", handleTriggerSync)
    return () => {
      window.removeEventListener("severinno:trigger-offline-sync", handleTriggerSync)
    }
  }, [handleManualSync])

  // Alterna modo de simulação offline
  const toggleSimulation = () => {
    const nextState = !isSimulatingOffline
    setIsSimulatingOffline(nextState)
    setShowPanel(nextState)

    if (typeof window !== "undefined") {
      sessionStorage.setItem("severinno_offline_simulation_active", String(nextState))
    }

    if (nextState) {
      toast.warning("Modo Simulação Offline Ativado", {
        description:
          "Rede desconectada. Suas ações agora serão guardadas na fila local e enviadas via Background Sync.",
      })
    } else {
      toast.info("Modo Online Restabelecido", {
        description: "Reconectando... Despachando fila de sincronização.",
      })
      void handleManualSync()
    }
  }

  // Simula ação de campo (Check-in, Conclusão de Serviço ou Foto)
  const simulateFieldAction = (type: "CHECKIN" | "COMPLETE_JOB" | "STATUS_UPDATE") => {
    const actionNames: Record<string, string> = {
      CHECKIN: "Check-in Presencial",
      COMPLETE_JOB: "Conclusão de Serviço",
      STATUS_UPDATE: "Atualização de Status",
    }

    enqueueOfflineMutation({
      action: type,
      entityId: `sim-book-${Date.now()}`,
      payload: {
        timestamp: Date.now(),
        location: "Governador Valadares, MG",
        coords: { lat: -18.8548, lng: -41.9482 },
        note: "Ação de campo simulada via widget PWA",
      },
    })

    refreshPendingCount()

    toast.success(`Ação Enfileirada: ${actionNames[type]}`, {
      description: "Salvo no IndexedDB local. Será enviado automaticamente ao reconectar.",
    })
  }

  return (
    <div className={cn("relative inline-block", className)}>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={isSimulatingOffline ? "destructive" : "outline"}
          onClick={toggleSimulation}
          className={cn(
            "h-7 gap-1.5 px-2.5 text-xs font-medium transition-all",
            isSimulatingOffline
              ? "border-amber-500 bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-700"
              : "border-slate-300 hover:border-slate-400 dark:border-slate-700",
          )}
          title="Alternar simulação de modo offline para testes de campo"
        >
          {isSimulatingOffline ? (
            <>
              <WifiOff className="size-3.5 animate-pulse text-amber-100" />
              <span>Offline (Simulado)</span>
            </>
          ) : (
            <>
              <Wifi className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Simular Offline</span>
            </>
          )}
        </Button>

        {pendingCount > 0 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void handleManualSync()}
            disabled={isSyncing}
            className="h-7 gap-1 px-2 text-xs font-semibold"
            title="Sincronizar fila agora"
          >
            <RefreshCw className={cn("size-3", isSyncing && "text-primary animate-spin")} />
            <Badge
              variant="default"
              className="ml-0.5 h-4 min-w-4 px-1 text-[10px] leading-none font-bold"
            >
              {pendingCount}
            </Badge>
          </Button>
        )}
      </div>

      {/* Painel expansível de controle de campo quando em modo offline */}
      {isSimulatingOffline && showPanel && (
        <div
          role="region"
          aria-label="Painel de Simulação Offline"
          className="bg-popover text-popover-foreground animate-in fade-in-50 zoom-in-95 absolute top-9 right-0 z-50 w-72 rounded-xl border p-3.5 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
              <Zap className="size-3.5" />
              <span>Teste de Campo PWA</span>
            </div>
            <Badge variant="outline" className="text-[10px] font-semibold">
              Fila: {pendingCount}
            </Badge>
          </div>

          <p className="text-muted-foreground mb-3 text-[11px] leading-relaxed">
            Simule operações em locais sem sinal em GV (garagens, subsolos ou rodovia). As ações vão
            para o Background Sync local.
          </p>

          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => simulateFieldAction("CHECKIN")}
              className="h-7 justify-start gap-1.5 text-xs"
            >
              <MapPin className="size-3 text-emerald-600" />
              <span>Simular Check-in GPS (50m)</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => simulateFieldAction("COMPLETE_JOB")}
              className="h-7 justify-start gap-1.5 text-xs"
            >
              <CheckCircle2 className="size-3 text-blue-600" />
              <span>Simular Conclusão de Serviço</span>
            </Button>

            <div className="mt-1.5 flex items-center gap-1.5 border-t pt-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void handleManualSync()}
                disabled={isSyncing || pendingCount === 0}
                className="h-7 flex-1 gap-1 text-xs"
              >
                <Send className="size-3" />
                <span>Sincronizar Fila ({pendingCount})</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowPanel(false)}
                className="h-7 px-2 text-xs"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
