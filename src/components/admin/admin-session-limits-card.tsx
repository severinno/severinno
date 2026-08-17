"use client"

/**
 * SessionLimitsCard — card de status "Limites de sessão (realtime)".
 *
 * Exibido no AdminDashboard (visão geral) refletindo a config ATUAL de
 * limites de sessões simultâneas por role do mini-service realtime:
 * o default global + o max resolvido para CLIENT/PROVIDER/ADMIN
 * (override por role quando presente, senão o fallback global). A mesma
 * resolução que o realtime aplica no join (resolveMaxSessionsPerRole) — o
 * admin vê o limite real por perfil SEM conhecer as envs do serviço.
 *
 * Fonte: GET /api/admin/realtime/sessions → `limits` (default + perRole),
 * exposto pelo realtime no /sessions (SESSION_LIMITS_CONFIG). Degradação
 * graciosa: realtime fora do ar (ok: false) ou limits ausente → o card
 * renderiza NADA (nunca quebra o dashboard).
 *
 * Nielsen (design system em _shared):
 *   H1 — visibilidade do status: o admin enxerga o limite por perfil antes
 *        de interpretar um badge de conflito ("2 sessões" para PROVIDER é
 *        conflito? Não — o limite é 2; o card responde isso na primeira tela).
 */

import * as React from "react"
import { CircleUser, HardHat, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

/** Config de limites por role E por plano (espelho do SESSION_LIMITS_CONFIG
 *  do realtime e do RealtimeLimitsConfig da rota admin). */
export type SessionLimitsInfo = {
  default: number
  perRole: Record<string, number>
  /** Override por plano/tenant (ex.: FREE=1, PREMIUM=5) — vazio quando não
   *  configurado (usuários caem no per-role). */
  perPlan?: Record<string, number>
}

/** Ordem + metadados de exibição por role (mesmo padrão do breakdown do
 *  OnlineUsersKpiCard — só os campos que o card consome). */
const ROLE_ORDER: Array<{
  role: string
  label: string
  icon: React.ElementType
  className: string
}> = [
  { role: "CLIENT", label: "Clientes", icon: CircleUser, className: "text-sky-500" },
  { role: "PROVIDER", label: "Prestadores", icon: HardHat, className: "text-amber-500" },
  { role: "ADMIN", label: "Administradores", icon: ShieldCheck, className: "text-emerald-500" },
]

function SessionLimitsCard({
  limits,
  available,
}: {
  limits: SessionLimitsInfo | undefined
  /** Realtime respondendo (ok: true no /sessions) — false → card oculto. */
  available: boolean
}) {
  // Degradação graciosa: sem dados ou realtime fora do ar → nada renderiza
  // (o dashboard nunca quebra por sessões/limites).
  if (!available || !limits) return null

  const maxFor = (role: string) => limits.perRole[role] ?? limits.default
  // Override por PLANO/tenant (quando configurado) — ex.: FREE=1, PREMIUM=5.
  // Ordenado alfabeticamente para renderização estável (o env JSON não
  // garante ordem).
  const planEntries = Object.entries(limits.perPlan ?? {}).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="border-border/50 bg-card rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-foreground text-sm font-semibold">Limites de sessão (realtime)</p>
        <span className="text-muted-foreground text-[11px] tabular-nums">
          default {limits.default}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {ROLE_ORDER.map(({ role, label, icon: Icon, className }) => (
          <span
            key={role}
            className="border-border/50 bg-muted/40 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
          >
            <Icon className={cn("size-3", className)} />
            {label}
            <span className="text-foreground font-semibold tabular-nums">{maxFor(role)}</span>
          </span>
        ))}
        {planEntries.map(([plan, max]) => (
          <span
            key={plan}
            title={`Override por plano — vence o limite por role quando o usuário tem o plano ${plan}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium"
          >
            <span className="text-violet-500">★</span>
            {plan}
            <span className="text-foreground font-semibold tabular-nums">{max}</span>
          </span>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-[11px]">
        Sockets simultâneos por usuário — o socket mais antigo é derrubado a cada novo join além do
        limite. Config por role + por plano (env do realtime); o plano vence quando configurado,
        senão vale o per-role.
      </p>
    </div>
  )
}

export default SessionLimitsCard
