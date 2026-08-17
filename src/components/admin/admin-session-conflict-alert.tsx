"use client"

/**
 * SessionConflictAlert — banner global de conflito de sessão (admin).
 *
 * Exibido no topo do AdminDashboard quando QUALQUER usuário tem >1 socket
 * simultâneo no realtime (usersWithMultipleSockets > 0) — o sintoma do
 * socket órfão (HMR leak / sessão stale / multi-tab) que o admin precisa
 * enxergar ANTES de revogar ou desativar contas. CTA "Ver usuários" navega
 * para a view admin.users (onde o OnlineSessionsCell detalha cada conflito
 * com contador + motivo do último kick).
 *
 * Fonte: GET /api/admin/realtime/sessions (mesma query key compartilhada do
 * painel — cache reutilizado quando o admin navegou pelas tabelas antes).
 * Degradação graciosa: sem dados (fetch ainda não resolveu), realtime fora
 * do ar (ok: false) ou sem conflitos → renderiza NADA (banner ausente).
 *
 * Nielsen (design system em _shared):
 *   H1 — visibilidade do status: o conflito vira alerta GLOBAL, não só o
 *        tooltip da linha (o admin vê o problema na primeira tela).
 *   H9 — degração graciosa: realtime fora não quebra o dashboard.
 */

import * as React from "react"
import { AlertTriangle, ArrowRight, Users } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/** Shape mínima da resposta GET /api/admin/realtime/sessions (espelho do
 *  OnlineUsersSessionsResponse — só os campos que o banner consome). */
export type SessionConflictAlertData = {
  ok: boolean
  usersWithMultipleSockets: number
  conflicts?: Array<{
    userId: string
    role: string
    socketCount: number
    oldestAgeMs: number
  }>
  /** Config atual de limites por role (default + perRole) — o dashboard
   *  repassa ao SessionLimitsCard (card de status). Espelho do
   *  RealtimeLimitsConfig da rota. */
  limits?: { default: number; perRole: Record<string, number> }
}

export function SessionConflictAlert({
  sessionsData,
  onNavigate,
}: {
  sessionsData: SessionConflictAlertData | undefined
  onNavigate?: (view: string) => void
}) {
  // Degradação graciosa: sem dados, realtime fora (ok: false), ou sem
  // conflitos → banner ausente (o dashboard nunca quebra por sessões).
  if (!sessionsData || sessionsData.ok === false) return null
  const conflicts = sessionsData.usersWithMultipleSockets ?? 0
  if (conflicts === 0) return null

  const totalSockets = (sessionsData.conflicts ?? []).reduce((n, c) => n + c.socketCount, 0)

  return (
    <Alert className="border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="size-4" />
      <AlertTitle className="flex items-center gap-2">
        {conflicts} {conflicts === 1 ? "usuário com" : "usuários com"} múltiplas sessões simultâneas
        no realtime
      </AlertTitle>
      <AlertDescription className="text-amber-800/90 dark:text-amber-200/80">
        {totalSockets > 0 ? `${totalSockets} sockets ativos no total · ` : ""}O realtime derruba o
        socket mais antigo a cada novo join — identifique quem está com conflito (órfão de HMR,
        sessão stale ou multi-tab) antes de revogar ou desativar contas.
      </AlertDescription>
      {onNavigate ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onNavigate("admin.users")}
          className="bg-background/50 mt-2 h-8 gap-1.5 border-amber-400/50"
        >
          <Users className="size-3.5" />
          Ver usuários
          <ArrowRight className="size-3.5" />
        </Button>
      ) : null}
    </Alert>
  )
}

export default SessionConflictAlert
