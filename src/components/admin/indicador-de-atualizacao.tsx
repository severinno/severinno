"use client"

/**
 * IndicadorDeAtualizacao — Indicador reutilizável de loading/refetch/reindex
 *
 * Exibe um spinner com texto animado para estados de carregamento, ou
 * resultado (success/error) com ícone e cor apropriados.
 *
 * Estados:
 *   null        → oculto (sempre no DOM, sem layout shift)
 *   'refetching' → spinner + "Atualizando…"
 *   'reindexing' → spinner + "Reindexando índices…"
 *   'success'    → check + mensagem (verde)
 *   'error'      → alerta + mensagem (vermelho)
 *
 * Uso típico:
 *   <IndicadorDeAtualizacao status={isFetching ? 'refetching' : null} />
 *   <IndicadorDeAtualizacao status="success" message="3/3 índices OK" />
 */

import * as React from "react"
import { CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IndicadorStatus = "refetching" | "reindexing" | "success" | "error" | null

export interface IndicadorDeAtualizacaoProps {
  /** Estado atual do indicador. null = oculto. */
  status: IndicadorStatus
  /** Mensagem customizada para estados success/error. Se omitido, usa texto padrão. */
  message?: string
  /** Classes CSS extras. */
  className?: string
}

// ---------------------------------------------------------------------------
// Labels padrão
// ---------------------------------------------------------------------------

export const DEFAULT_LABELS: Record<NonNullable<IndicadorStatus>, string> = {
  refetching: "Atualizando…",
  reindexing: "Reindexando índices…",
  success: "Operação concluída com sucesso",
  error: "Erro na operação",
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IndicadorDeAtualizacao({
  status,
  message,
  className,
}: IndicadorDeAtualizacaoProps) {
  if (status == null) {
    return (
      <span
        className={cn(
          "pointer-events-none inline-flex items-center gap-1.5 text-xs opacity-0 transition-opacity duration-300",
          className,
        )}
        aria-hidden="true"
      >
        {/* Spacer invisível para manter altura/largura mínima */}
        <RefreshCw className="size-3" />
        <span>—</span>
      </span>
    )
  }

  const isRefetchOrReindex = status === "refetching" || status === "reindexing"
  const isSuccess = status === "success"
  const isError = status === "error"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs opacity-100 transition-opacity duration-300",
        isSuccess && "text-emerald-600 dark:text-emerald-400",
        isError && "text-red-600 dark:text-red-400",
        isRefetchOrReindex && "text-muted-foreground",
        className,
      )}
      aria-live={isSuccess || isError ? "assertive" : "polite"}
    >
      {isRefetchOrReindex && <RefreshCw className="size-3 animate-spin" aria-hidden="true" />}
      {isSuccess && <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />}
      {isError && <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />}
      <span>{message ?? DEFAULT_LABELS[status]}</span>
    </span>
  )
}
