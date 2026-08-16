"use client"

/**
 * AdminRevokeInactive — Audit trail + disparo manual do cron de revogação
 * de sessões inativas.
 *
 * Data source: GET  /api/admin/cron/revoke-inactive/runs   (últimos runs)
 *              POST /api/admin/cron/revoke-inactive/run?dryRun=1|0
 *
 * Nielsen heuristics (design system em admin-shared.tsx):
 *   H1 — StatusBadge inline por run + SavingPill durante a execução
 *   H4 — Badges de origem/status/modo com cores consistentes
 *   H5 — Execução REAL (dryRun=0) exige ConfirmDialog destrutivo; a dry-run
 *        (padrão) roda direto
 *   H9 — ErrorState com retry + toast.error específico
 *   H10— Tooltips/aria-label nos botões de ícone
 *
 * DRY-RUN POR PADRÃO: o select inicia em "Dry-run" — o admin só revoga de
 * verdade ao trocar para "Revogar de verdade" (com confirmação), porque a
 * revogação desconecta sockets de contas inativas.
 */

import * as React from "react"
import { CheckCircle2, Clock, Eye, Loader2, RefreshCcw, ShieldAlert, XCircle } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { ConfirmDialog, ErrorState, errMsg, PageSectionHeader } from "./_shared"

// ── Types (espelham revoke-run-audit.ts / revoke-inactive-scan.ts) ──────────

type RevokeRunEntry = {
  id: string
  ranAt: string
  source: "cron" | "admin"
  status: "completed" | "skipped" | "error"
  dryRun: boolean
  scanned: number
  revoked: number
  failed: number
  elapsedMs: number
  threshold: {
    inactiveSince: string
    deletedSince: string
    passwordChangedSince: string
  } | null
  reason?: string
  error?: string
}

type RunsResponse = { ok: boolean; runs: RevokeRunEntry[] }

type RunResult = {
  ok: boolean
  status?: "completed" | "skipped"
  dryRun?: boolean
  scanned?: number
  revoked?: number
  failed?: number
  elapsedMs?: number
  reason?: string
}

type RunMode = "dry" | "real"

// ── Badge helpers ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RevokeRunEntry["status"] }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/60 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
        <CheckCircle2 className="size-2.5" />
        Concluído
      </span>
    )
  }
  if (status === "skipped") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
        <Clock className="size-2.5" />
        Pulado
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-200/60 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
      <XCircle className="size-2.5" />
      Erro
    </span>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function AdminRevokeInactive() {
  const queryClient = useQueryClient()
  const [mode, setMode] = React.useState<RunMode>("dry")
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  // ── Audit trail (últimos runs) ─────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "cron", "revoke-inactive", "runs"],
    queryFn: () => apiGet<RunsResponse>("/api/admin/cron/revoke-inactive/runs"),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const runMutation = useMutation({
    mutationFn: (dry: boolean) =>
      apiPost<RunResult>(`/api/admin/cron/revoke-inactive/run?dryRun=${dry ? "1" : "0"}`),
    onSuccess: (res) => {
      if (res.status === "skipped") {
        toast.info("Varredura pulada — cooldown ativo ou sem candidatos.")
      } else if (res.dryRun) {
        toast.success(
          `Dry-run concluído: ${res.revoked ?? 0} revogável(is) em ${res.scanned ?? 0} varrido(s). Nada foi desconectado.`,
        )
      } else {
        toast.success(
          `Varredura real: ${res.revoked ?? 0} sessões revogadas (${res.failed ?? 0} falhas) em ${res.scanned ?? 0} varridos.`,
        )
      }
      queryClient.invalidateQueries({ queryKey: ["admin", "cron", "revoke-inactive", "runs"] })
    },
    onError: (e: unknown) => {
      const msg = errMsg(e, "Não foi possível executar a varredura.")
      toast.error(msg)
    },
  })

  const handleRun = () => {
    if (mode === "real") {
      setConfirmOpen(true)
      return
    }
    runMutation.mutate(true) // dry-run (padrão)
  }

  const handleConfirmRealRun = () => {
    setConfirmOpen(false)
    runMutation.mutate(false) // revogação real
  }

  const runs = data?.runs ?? []

  return (
    <div className="flex flex-col gap-4">
      <PageSectionHeader
        title="Revogação de sessões inativas"
        description="Audite as execuções do cron que desconecta sockets de contas desativadas/soft-deleted e execute a varredura manualmente."
      />

      {/* ── Ação: executar agora ─────────────────────────────────────── */}
      <Card className="border-border/50 bg-card rounded-xl border">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
              <ShieldAlert className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Executar varredura agora</p>
              <p className="text-muted-foreground text-xs">
                Varre usuários inativos/deletados e revoga os sockets realtime.{" "}
                <strong className="text-foreground">Dry-run por padrão</strong> — troque o modo para
                revogar de verdade (com confirmação).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Select value={mode} onValueChange={(v) => setMode(v as RunMode)}>
              <SelectTrigger className="h-9 w-auto min-w-[200px]" aria-label="Modo da varredura">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dry">
                  <span className="inline-flex items-center gap-1.5">
                    <Eye className="size-3.5" />
                    Dry-run (não desconecta)
                  </span>
                </SelectItem>
                <SelectItem value="real">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldAlert className="size-3.5" />
                    Revogar de verdade
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleRun} disabled={runMutation.isPending} className="h-9 gap-1.5">
              {runMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              Executar agora
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Audit trail ──────────────────────────────────────────────── */}
      {isError ? (
        <ErrorState
          title="Não foi possível carregar o audit trail"
          description="Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <AuditSkeleton />
      ) : runs.length === 0 ? (
        <Card className="border-border/50 bg-card rounded-xl border">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldAlert className="text-muted-foreground/40 size-10" />
            <p className="text-muted-foreground text-sm">
              Nenhuma execução registrada ainda. O cron e os disparos manuais aparecerão aqui.
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()} className="gap-1.5">
              <RefreshCcw className="size-3.5" />
              Atualizar
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50 bg-card overflow-hidden rounded-xl border">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground h-9 border-b text-[10px] font-medium tracking-wider uppercase">
                    <th className="px-3 font-medium">Quando</th>
                    <th className="px-3 font-medium">Origem</th>
                    <th className="px-3 font-medium">Status</th>
                    <th className="px-3 font-medium">Modo</th>
                    <th className="px-3 text-right font-medium">Varridos</th>
                    <th className="px-3 text-right font-medium">Revogados</th>
                    <th className="px-3 text-right font-medium">Falhas</th>
                    <th className="px-3 text-right font-medium">Duração</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {runs.map((run) => (
                    <tr key={run.id} className="hover:bg-muted/20 h-11 transition-colors">
                      <td className="px-3">
                        <span className="text-foreground/80 text-[10px] tabular-nums">
                          {new Date(run.ranAt).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>
                      <td className="px-3">
                        <Badge variant="outline" className="text-[9px]">
                          {run.source === "cron" ? "Cron" : "Admin"}
                        </Badge>
                      </td>
                      <td className="px-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-3">
                        {run.dryRun ? (
                          <span className="text-muted-foreground text-[10px]">Dry-run</span>
                        ) : (
                          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            Real
                          </span>
                        )}
                      </td>
                      <td className="px-3 text-right tabular-nums">{run.scanned}</td>
                      <td className="px-3 text-right tabular-nums">{run.revoked}</td>
                      <td className="px-3 text-right tabular-nums">
                        {run.failed > 0 ? (
                          <span className="text-red-500">{run.failed}</span>
                        ) : (
                          <span className="text-muted-foreground">{run.failed}</span>
                        )}
                      </td>
                      <td className="px-3 text-right text-[10px] tabular-nums">
                        {run.elapsedMs < 1000
                          ? `${run.elapsedMs}ms`
                          : `${(run.elapsedMs / 1000).toFixed(1)}s`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {runs.some((r) => r.reason || r.error) ? (
              <div className="border-border/50 border-t px-3 py-2">
                {runs
                  .filter((r) => r.reason || r.error)
                  .slice(0, 1)
                  .map((r) => (
                    <p
                      key={r.id}
                      className={cn(
                        "text-[10px]",
                        r.status === "error" ? "text-red-500" : "text-muted-foreground",
                      )}
                    >
                      {r.status === "error" ? `Erro: ${r.error}` : `Pulado: ${r.reason}`}
                    </p>
                  ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Confirmação para a revogação REAL (destrutiva) — H5 */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Revogar sessões de verdade?"
        description={
          <>
            Esta ação desconecta <strong className="text-foreground">agora</strong> os sockets
            realtime de todos os usuários inativos/deletados encontrados. Não é um dry-run. Deseja
            continuar?
          </>
        }
        confirmLabel="Revogar agora"
        variant="destructive"
        onConfirm={handleConfirmRealRun}
      />
    </div>
  )
}

// ── Skeleton ────────────────────────────────────────────────────────────────

function AuditSkeleton() {
  return (
    <Card className="border-border/50 bg-card rounded-xl border">
      <CardContent className="flex flex-col gap-3 p-4">
        <Skeleton className="h-8 w-full rounded-lg" />
        <Skeleton className="h-8 w-full rounded-lg" />
        <Skeleton className="h-8 w-full rounded-lg" />
        <Skeleton className="h-8 w-full rounded-lg" />
        <Skeleton className="h-8 w-full rounded-lg" />
      </CardContent>
    </Card>
  )
}

export default AdminRevokeInactive
