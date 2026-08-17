"use client"

/**
 * OnlineUsersKpiCard — KPI card "Usuários online" com breakdown por role.
 *
 * Usado por AdminUsers e AdminProviders (GET /api/admin/realtime/sessions).
 * O contador mostra quem está ONLINE agora (sockets com sessão verificada E
 * join na sala user:{id}); o tooltip detalha o total por role (clientes /
 * prestadores / admins) — o mesmo campo `role` que a rota retorna por socket.
 *
 * O total "online por role" é contado por USUÁRIO distinto (não por socket),
 * para casar com `onlineUsers` do card (presença única): um usuário com 2
 * sockets simultâneos (conflito/órfão) conta 1 em cada métrica.
 *
 * O botão "Revogar sockets órfãos" chama POST /api/admin/realtime/sessions/
 * revoke-orphans — desconecta sockets cuja sessão expirou por TTL ou cujo
 * usuário não existe (mais) no banco (o realtime proxyia a varredura e a
 * rota audita no revoke-run-audit). ConfirmDialog antes de agir + toast do
 * resultado + invalidação da query de sessões (o indicador re-renderiza).
 *
 * Realtime fora do ar (ok: false) → tooltip não renderiza o breakdown e o
 * subtítulo avisa "Realtime indisponível" (degradação graciosa, nunca quebra
 * o painel).
 *
 * Nielsen heuristics (design system em _shared):
 *   H1 — visibilidade do status: quem está online agora e o breakdown por
 *        perfil, antes de o admin desativar/revogar alguém.
 *   H5 — ação destrutiva (revogar sockets) exige confirmação antes de aplicar.
 *   H10— tooltip no card com o detalhe por role.
 */

import * as React from "react"
import { CircleUser, HardHat, RefreshCcw, ShieldCheck, Wifi } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import { type UserRole } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { KpiCard } from "./admin-metric-card"

/** Mesma forma do GET /api/admin/realtime/sessions (definida IDÊNTICA nos
 *  dois admins — o componente só consome os campos de que precisa). */
export type OnlineUsersSessionsResponse = {
  ok: boolean
  sessions: Record<
    string,
    Array<{
      userId: string
      role: string
      socketId: string
      connectedAt: string
      joinedAt: string | null
    }>
  >
  totalSockets: number
  onlineUsers: number
}

/** Resposta do POST /api/admin/realtime/sessions/revoke-orphans. */
export type RevokeOrphansResponse = {
  ok: boolean
  revoked: number
  expired: number
  missingUser: number
  checkedUsers: number
  error?: string
}

/** Ordem de exibição do breakdown no tooltip. */
const ROLE_ORDER: UserRole[] = ["CLIENT", "PROVIDER", "ADMIN"]

const ROLE_META: Record<UserRole, { label: string; icon: React.ElementType; className: string }> = {
  CLIENT: {
    label: "Clientes",
    icon: CircleUser,
    className: "text-sky-500",
  },
  PROVIDER: {
    label: "Prestadores",
    icon: HardHat,
    className: "text-amber-500",
  },
  ADMIN: {
    label: "Administradores",
    icon: ShieldCheck,
    className: "text-emerald-500",
  },
}

function OnlineUsersKpiCard({
  sessionsData,
  sessionsByUser,
}: {
  sessionsData: OnlineUsersSessionsResponse | undefined
  /** userId → sockets ativos (para conflitos/órfãos no subtítulo). */
  sessionsByUser: Map<string, Array<{ role?: string }>>
}) {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const revokeOrphans = useMutation({
    mutationFn: () => apiPost<RevokeOrphansResponse>("/api/admin/realtime/sessions/revoke-orphans"),
  })

  const handleConfirmRevoke = () => {
    revokeOrphans.mutate(undefined, {
      onSuccess: (res) => {
        setConfirmOpen(false)
        if (res.ok) {
          toast.success(
            res.revoked > 0
              ? `${res.revoked} socket(s) órfão(s) revogado(s) (${res.expired} expirados · ${res.missingUser} usuário inexistente).`
              : "Nenhum socket órfão encontrado — varredura limpa.",
          )
        } else {
          toast.error(res.error ?? "Não foi possível revogar os sockets órfãos.")
        }
        // Re-renderiza o indicador: o realtime já fechou os sockets.
        queryClient.invalidateQueries({ queryKey: ["admin", "realtime", "sessions"] })
      },
      onError: (e: unknown) => {
        setConfirmOpen(false)
        toast.error(e instanceof Error ? e.message : "Não foi possível revogar os sockets órfãos.")
      },
    })
  }

  const conflicts = React.useMemo(
    () => [...sessionsByUser.values()].filter((s) => s.length > 1).length,
    [sessionsByUser],
  )

  const subtitle = (() => {
    if (sessionsData?.ok === false) return "Realtime indisponível"
    const base = `${sessionsData?.totalSockets ?? 0} sockets ativos`
    return conflicts > 0 ? `${base} · ${conflicts} conflito(s)` : base
  })()

  // Usuários online distintos POR ROLE — o campo `role` que a rota retorna
  // por socket. Um usuário com N sockets conta 1 (presença única, casa com
  // onlineUsers). Roles desconhecidas entram como "outros".
  const breakdown = React.useMemo(() => {
    const counts: Record<string, number> = {}
    for (const sockets of sessionsByUser.values()) {
      const role = sockets[0]?.role ?? "unknown"
      counts[role] = (counts[role] ?? 0) + 1
    }
    return counts
  }, [sessionsByUser])

  const hasLiveData = sessionsData?.ok !== false

  return (
    <div className="max-w-xs">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">
            <KpiCard
              icon={Wifi}
              label="Usuários online"
              value={String(sessionsData?.onlineUsers ?? 0)}
              subtitle={subtitle}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="min-w-52 space-y-1.5">
          {hasLiveData ? (
            <>
              <p className="text-foreground text-xs font-semibold">Online por perfil</p>
              <div className="space-y-1">
                {ROLE_ORDER.map((role) => {
                  const meta = ROLE_META[role]
                  const count = breakdown[role] ?? 0
                  return (
                    <div key={role} className="flex items-center justify-between gap-4 text-xs">
                      <span className="text-muted-foreground inline-flex items-center gap-1.5">
                        <meta.icon className={cn("size-3.5", meta.className)} />
                        {meta.label}
                      </span>
                      <span className="font-semibold tabular-nums">{count}</span>
                    </div>
                  )
                })}
                <div className="text-muted-foreground flex items-center justify-between gap-4 text-xs">
                  <span className="inline-flex items-center gap-1.5">Outros</span>
                  <span className="font-semibold tabular-nums">{breakdown.unknown ?? 0}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-xs">Realtime indisponível no momento.</p>
          )}
        </TooltipContent>
      </Tooltip>

      {/* Revogar sockets órfãos — limpeza manual de sessões TTL-expiradas e
          usuários inexistentes (o realtime proxyia a varredura; a rota audita
          no revoke-run-audit). ConfirmDialog antes de agir (H5). */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 h-8 w-full gap-1.5"
        onClick={() => setConfirmOpen(true)}
        disabled={revokeOrphans.isPending}
        aria-label="Revogar sockets órfãos (sessões expiradas ou usuários inexistentes)"
      >
        {revokeOrphans.isPending ? (
          <RefreshCcw className="size-3.5 animate-spin" />
        ) : (
          <RefreshCcw className="size-3.5" />
        )}
        Revogar sockets órfãos
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Revogar sockets órfãos?</DialogTitle>
            <DialogDescription>
              Desconecta sockets do realtime cuja sessão expirou por TTL ou cujo usuário não existe
              mais no banco (contas removidas/soft-deletadas com sessão stale). Usuários ativos não
              são afetados — a ação é segura e auditada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={revokeOrphans.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmRevoke}
              disabled={revokeOrphans.isPending}
            >
              {revokeOrphans.isPending ? "Revogando…" : "Revogar agora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default OnlineUsersKpiCard
