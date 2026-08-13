"use client"

/**
 * GistDegradationPanel — GiST Index Degradation Alert + REINDEX Action
 *
 * Exibe um alerta colapsável quando o índice GiST do PostGIS está degradado
 * (P95 real ultrapassa todas as curvas teóricas do modelo). Inclui:
 *   - Diagnóstico detalhado do impacto
 *   - Recomendações de ação (REINDEX, VACUUM ANALYZE, particionamento)
 *   - Botão "Executar REINDEX" via GistReindexButton (componente extraído)
 *
 * Props são os valores computados pelo GiSTSelectivitySection no parent.
 */

import * as React from "react"
import { Database } from "lucide-react"

import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { GistReindexButton } from "@/components/admin/gist-reindex-button"
import { POSTGIS_FIXED_US, POSTGIS_PER_ROW_US, PROVIDER_COUNTS } from "@/lib/geo-benchmark-model"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GistDegradationPanelProps {
  /** Whether the GiST index is currently flagged as degraded. */
  gistDegraded: boolean
  /** Mean P95 latency (ms) from real geo-metrics history. */
  p95Mean: number
  /** Current search radius in km (used in the diagnosis message). */
  radiusKm: number
  /** Selectivity percentage snapped to 5% (0–100). */
  snapPct: number
  /** Maximum model-predicted latency (ms) at the current selectivity. */
  maxModelAtSelectivity: number
  /** How many provider scales exceed the model (0 to PROVIDER_COUNTS.length). */
  exceedingCount: number
  /**
   * Called when REINDEX completes successfully.
   * The parent can use this to refetch metrics and update the UI
   * immediately instead of waiting for the next 30s poll interval.
   */
  onReindexSuccess?: () => void
  /** Whether the parent dashboard is currently refetching metrics after REINDEX. */
  isRefetching?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GistDegradationPanel({
  gistDegraded,
  p95Mean,
  radiusKm,
  snapPct,
  maxModelAtSelectivity,
  exceedingCount,
  onReindexSuccess,
  isRefetching,
}: GistDegradationPanelProps) {
  const [showIndexDetails, setShowIndexDetails] = React.useState(false)

  if (!gistDegraded) return null

  return (
    <Collapsible
      open={showIndexDetails}
      onOpenChange={setShowIndexDetails}
      className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/40 dark:bg-red-950/20"
    >
      <div role="alert" className="flex items-start gap-3 px-5 py-4">
        <Database className="mt-0.5 size-5 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            🛑 Índice GiST degradado
          </p>
          <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
            P95 real ({Math.round(p95Mean)}ms) ultrapassou <strong>todas</strong> as curvas teóricas
            do modelo PostGIS em <strong>{radiusKm} km</strong> (seletividade {snapPct}
            %). A curva mais alta do modelo prevê {maxModelAtSelectivity.toFixed(1)}ms. O índice
            GiST pode estar com performance degradada —{" "}
            {exceedingCount >= PROVIDER_COUNTS.length
              ? "todas as escalas de provedores estão acima do esperado."
              : `${exceedingCount} de ${PROVIDER_COUNTS.length} escalas de provedores estão acima do esperado.`}
          </p>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white/80 px-3 py-1.5 text-[11px] font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 dark:border-red-700/40 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Database className="size-3.5" />
              {showIndexDetails ? "Ocultar detalhes" : "Ver detalhes do índice"}
              <span
                className={cn(
                  "inline-block transition-transform",
                  showIndexDetails && "rotate-180",
                )}
              >
                ▼
              </span>
            </button>
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent>
        <div className="border-t border-red-200 px-5 py-4 dark:border-red-800/30">
          <div className="space-y-3">
            {/* Diagnóstico */}
            <div>
              <p className="text-xs font-semibold text-red-800 dark:text-red-300">🔍 Diagnóstico</p>
              <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">
                O P95 real do PostGIS ({Math.round(p95Mean)}ms) excede a previsão do modelo teórico
                em {Math.round(p95Mean - maxModelAtSelectivity)}ms em{" "}
                <strong>{exceedingCount}</strong> de <strong>{PROVIDER_COUNTS.length}</strong>{" "}
                escalas de provedores. As escalas mais afetadas são as de maior volume (acima de{" "}
                {exceedingCount >= PROVIDER_COUNTS.length
                  ? "1k"
                  : `${PROVIDER_COUNTS[PROVIDER_COUNTS.length - exceedingCount]?.toLocaleString("pt-BR") ?? "—"}`}{" "}
                providers), onde o custo linear do full scan domina.
              </p>
            </div>

            {/* Recomendação */}
            <div>
              <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                🛠️ Recomendação
              </p>
              <ul className="mt-1 space-y-1 text-[11px] text-red-700 dark:text-red-400">
                <li className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">1.</span>
                  <span>
                    <code className="rounded bg-red-100/80 px-1 py-0.5 font-mono text-[10px] dark:bg-red-900/30">
                      REINDEX INDEX CONCURRENTLY idx_user_location_gist;
                    </code>
                    {" — "}Reconstrói o índice GiST de localização de usuários.
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">2.</span>
                  <span>
                    <code className="rounded bg-red-100/80 px-1 py-0.5 font-mono text-[10px] dark:bg-red-900/30">
                      VACUUM ANALYZE "User";
                    </code>
                    {" — "}Atualiza estatísticas do planner para o índice.
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">3.</span>
                  <span>
                    Se o problema persistir, avalie particionar a tabela por região geográfica ou
                    aumentar o{" "}
                    <code className="rounded bg-red-100/80 px-1 py-0.5 font-mono text-[10px] dark:bg-red-900/30">
                      work_mem
                    </code>{" "}
                    do PostgreSQL.
                  </span>
                </li>
              </ul>

              {/* ── Executar REINDEX Button (extracted component) ──── */}
              <div className="mt-3 flex items-center gap-3 border-t border-red-200 pt-3 dark:border-red-800/30">
                <GistReindexButton
                  onReindexSuccess={onReindexSuccess}
                  isRefetching={isRefetching}
                />
              </div>
            </div>

            {/* Impacto no modelo */}
            <div>
              <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                📊 Impacto no Modelo
              </p>
              <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">
                T(N, s) = {POSTGIS_FIXED_US / 1000}ms + {(POSTGIS_PER_ROW_US / 1000).toFixed(3)}
                ms × N × s
                <br />
                P95 real ({Math.round(p95Mean)}ms) vs modelo máximo em {radiusKm}km (
                {maxModelAtSelectivity.toFixed(1)}ms) — razão de{" "}
                <strong className="text-red-600">
                  {(p95Mean / maxModelAtSelectivity).toFixed(1)}×
                </strong>
              </p>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
