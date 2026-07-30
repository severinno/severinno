"use client"

/**
 * RefreshButton — Botão de atualização com indicador visual de loading
 *
 * Combina o botão de refresh (ícone RefreshCw com animate-spin) com o
 * IndicadorDeAtualizacao ("Atualizando…") em um único componente inline.
 *
 * Uso típico:
 *   <RefreshButton isFetching={isFetching} onRefresh={() => void refetch()} />
 *
 *   // Com label customizada:
 *   <RefreshButton
 *     isFetching={isFetching}
 *     onRefresh={() => void refetch()}
 *     label="Atualizar mapa"
 *   />
 */

import * as React from "react"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { IndicadorDeAtualizacao } from "@/components/admin/indicador-de-atualizacao"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RefreshButtonProps {
  /** Whether the page/query is currently refetching. */
  isFetching: boolean
  /** Callback when the refresh button is clicked. */
  onRefresh: () => void
  /** aria-label for the button (default: "Atualizar"). */
  label?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RefreshButton({ isFetching, onRefresh, label = "Atualizar" }: RefreshButtonProps) {
  return (
    <>
      <button
        type="button"
        onClick={onRefresh}
        disabled={isFetching}
        className="bg-muted/50 text-muted-foreground hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-50"
        aria-label={label}
      >
        <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
      </button>
      <IndicadorDeAtualizacao status={isFetching ? "refetching" : null} />
    </>
  )
}
