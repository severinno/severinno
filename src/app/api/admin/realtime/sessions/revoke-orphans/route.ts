import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { recordRevokeRun } from "@/lib/revoke-run-audit"

/**
 * POST /api/admin/realtime/sessions/revoke-orphans
 *
 * ADMIN: desconecta os sockets ÓRFÃOS do realtime — sessões cujo TTL já
 * expirou (cookie `expiresAt` no passado) OU cujo userId não existe (mais)
 * no banco (conta soft-deletada/removida com socket stale ainda na sala
 * user:{id}). É o alvo do botão "Revogar sockets órfãos" do card de
 * usuários online.
 *
 * Proxies o POST /revoke-orphans do mini-service (Bearer-protected) e
 * registra a execução no MESMO audit trail das varreduras de revogação
 * (revoke-run-audit.ts, source="admin") — operação rastreável no painel.
 *
 * Degradação graciosa: realtime fora do ar ou sem REALTIME_EMIT_TOKEN →
 * `{ ok: false, revoked: 0, error }` (200, nunca 500) — o painel mostra o
 * erro como toast sem quebrar. O mini-service é fail-open na checagem de
 * existência (sem DB, só os TTL-expirados são revogados) — segurança
 * primeiro: nunca derruba usuário válido por falha de infra.
 */

const REALTIME_URL = process.env.REALTIME_URL ?? "http://localhost:3003"
// Timeout (ms) do fetch para o mini-service (guard do repo: >= 1s).
const REALTIME_ORPHANS_TIMEOUT_MS = Math.max(
  1,
  Number(process.env.REALTIME_ORPHANS_TIMEOUT_MS) || 5_000,
)

export type RevokeOrphansResponse = {
  ok: boolean
  /** Total de sockets desconectados (expirados + usuário inexistente). */
  revoked: number
  /** Sockets com sessão TTL expirada. */
  expired: number
  /** Sockets cujo userId não existe (mais) no banco. */
  missingUser: number
  /** userIds consultados no banco (só os não-expirados). */
  checkedUsers: number
  error?: string
}

export async function POST(): Promise<NextResponse<RevokeOrphansResponse>> {
  try {
    await requireRole("ADMIN")

    const startedAt = Date.now()
    const ranAt = new Date().toISOString()

    const emitToken = process.env.REALTIME_EMIT_TOKEN
    if (!emitToken) {
      // Fail-closed no mini-service: sem token não há como revogar.
      return NextResponse.json({
        ok: false,
        revoked: 0,
        expired: 0,
        missingUser: 0,
        checkedUsers: 0,
        error: "REALTIME_EMIT_TOKEN não configurado",
      })
    }

    const res = await fetch(`${REALTIME_URL}/revoke-orphans`, {
      method: "POST",
      headers: { Authorization: `Bearer ${emitToken}` },
      signal: AbortSignal.timeout(REALTIME_ORPHANS_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body: RevokeOrphansResponse = {
        ok: false,
        revoked: 0,
        expired: 0,
        missingUser: 0,
        checkedUsers: 0,
        error: `realtime respondeu ${res.status}`,
      }
      await recordRevokeRun({
        id: crypto.randomUUID(),
        ranAt,
        source: "admin",
        status: "error",
        dryRun: false,
        scanned: 0,
        revoked: 0,
        failed: 0,
        elapsedMs: Date.now() - startedAt,
        threshold: null,
        error: body.error,
      })
      return NextResponse.json(body)
    }

    const data = (await res.json()) as {
      ok?: boolean
      revoked?: number
      expired?: number
      missingUser?: number
      checkedUsers?: number
    }

    const result: RevokeOrphansResponse = {
      ok: data.ok ?? true,
      revoked: data.revoked ?? 0,
      expired: data.expired ?? 0,
      missingUser: data.missingUser ?? 0,
      checkedUsers: data.checkedUsers ?? 0,
    }

    // Auditoria: execução manual do admin (source="admin"), sem cooldown —
    // ação explícita e pontual. status="completed" mesmo com 0 revogados
    // (varredura rodou, nada a fazer é um resultado válido).
    await recordRevokeRun({
      id: crypto.randomUUID(),
      ranAt,
      source: "admin",
      status: "completed",
      dryRun: false,
      // scanned = userIds consultados no DB (os TTL-expirados não passam
      // pelo check de existência — são contabilizados no `reason` abaixo).
      scanned: result.checkedUsers,
      revoked: result.revoked,
      failed: 0,
      elapsedMs: Date.now() - startedAt,
      threshold: null,
      reason: `revoke-orphans (expired=${result.expired}, missingUser=${result.missingUser})`,
    })

    return NextResponse.json(result)
  } catch (e) {
    // Degradação graciosa por NOME (Bun: DOMException do AbortSignal.timeout
    // não é instanceof Error — o instanceof deixaria cair no handleError 500).
    if (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "TimeoutError") {
      return NextResponse.json({
        ok: false,
        revoked: 0,
        expired: 0,
        missingUser: 0,
        checkedUsers: 0,
        error: "Realtime não respondeu a tempo",
      })
    }
    const err = handleError(e) as NextResponse<unknown>
    return err as NextResponse<RevokeOrphansResponse>
  }
}
