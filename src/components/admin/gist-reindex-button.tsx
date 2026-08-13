"use client"

/**
 * GistReindexButton — Executar REINDEX com confirmação AlertDialog
 *
 * Botão auto-contido para executar REINDEX nos índices GiST do PostGIS.
 * Extraído do GistDegradationPanel para reduzir o tamanho do arquivo
 * e permitir reuso independente.
 *
 * Props:
 *   onReindexSuccess — callback chamado após REINDEX bem-sucedido
 *                      (ex: para refetch de métricas no dashboard)
 *
 * Estado interno:
 *   - reindexing: loading durante execução
 *   - reindexResult: string de resultado (exibida após execução)
 *   - showReindexConfirm: controla abertura do AlertDialog
 */

import * as React from "react"
import { Database } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { IndicadorDeAtualizacao } from "@/components/admin/indicador-de-atualizacao"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GistReindexButtonProps {
  /** Called when REINDEX completes successfully. */
  onReindexSuccess?: () => void
  /** Whether the parent is currently refetching metrics after a successful REINDEX. */
  isRefetching?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GistReindexButton({ onReindexSuccess, isRefetching }: GistReindexButtonProps) {
  const [reindexing, setReindexing] = React.useState(false)
  const [reindexResult, setReindexResult] = React.useState<string | null>(null)
  const [showReindexConfirm, setShowReindexConfirm] = React.useState(false)

  // ── REINDEX execution ─────────────────────────────────────────────
  const executeReindex = React.useCallback(async () => {
    setReindexing(true)
    setReindexResult(null)
    setShowReindexConfirm(false)

    try {
      const res = await fetch("/api/admin/geo-reindex", { method: "POST" })
      const data = (await res.json()) as {
        success: boolean
        message: string
        indexes: Array<{ name: string; durationMs: number; ok: boolean }>
        totalDurationMs: number
      }

      if (data.success) {
        const details = data.indexes.map((i) => `${i.name}: ${i.durationMs}ms`).join(" · ")
        setReindexResult(`✅ ${data.message} (${data.totalDurationMs}ms) — ${details}`)
        toast.success("Índices GiST reindexados com sucesso")
        onReindexSuccess?.()
      } else {
        setReindexResult(`❌ Falha ao reindexar: ${data.message ?? "erro desconhecido"}`)
        toast.error("Falha ao reindexar índices GiST")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setReindexResult(`❌ Erro de conexão: ${msg}`)
      toast.error("Erro de conexão ao executar REINDEX")
    } finally {
      setReindexing(false)
    }
  }, [onReindexSuccess])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <AlertDialog open={showReindexConfirm} onOpenChange={setShowReindexConfirm}>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            disabled={reindexing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Database className="size-3.5" />
            {reindexing ? "Reindexando…" : "Executar REINDEX"}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ Executar REINDEX nos índices GiST?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Esta ação irá reconstruir <strong>3 índices</strong> espaciais GiST do PostGIS:
              </p>
              <ul className="list-inside list-disc space-y-1 text-[13px]">
                <li>
                  <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
                    idx_user_location_gist
                  </code>
                  {" — "}localização de usuários
                </li>
                <li>
                  <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
                    idx_booking_location_gist
                  </code>
                  {" — "}localização de bookings
                </li>
                <li>
                  <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
                    idx_quoterequest_location_gist
                  </code>
                  {" — "}localização de quote requests
                </li>
              </ul>
              <p className="text-amber-600 dark:text-amber-400">
                ⏱ A operação usa REINDEX CONCURRENTLY e não bloqueia a tabela durante a execução.
                Pode levar alguns segundos dependendo do volume de dados.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reindexing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={reindexing}
              onClick={(e) => {
                e.preventDefault()
                void executeReindex()
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              {reindexing ? "Executando…" : "Sim, executar REINDEX"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Result / loading indicator (extracted) */}
      {reindexResult != null ? (
        <IndicadorDeAtualizacao
          status={reindexResult.startsWith("✅") ? "success" : "error"}
          message={reindexResult.replace(/^[✅❌]\s*/, "")}
        />
      ) : reindexing ? (
        <IndicadorDeAtualizacao status="reindexing" />
      ) : isRefetching ? (
        <IndicadorDeAtualizacao status="refetching" message="Atualizando métricas…" />
      ) : null}
    </div>
  )
}
