/**
 * realtime-orphan-alert.ts
 *
 * Job de alerta operacional de sockets órfãos PERSISTIDOS — o complemento do
 * alerta in-process do mini-service (mini-services/realtime/ops-alert.ts):
 *
 *   - O realtime grava em Redis a flag `realtime:telemetry:multi:flag`
 *     (STRING "1", TTL curto) sempre que usersWithMultipleSockets > 0, e
 *     buckets por minuto `realtime:telemetry:multi:{minuteBucket}` (JSON com
 *     total/byRole/usersWithMultipleSockets/maxSocketsPerUser, TTL 24h).
 *   - Este job (cron externo, ex.: cron-job.org a cada 5 min) lê a flag E os
 *     N últimos buckets: o alerta só dispara quando a flag está ativa AGORA E
 *     os N buckets consecutivos confirmam a condição — "sockets órfãos
 *     persistirem por N minutos seguidos". Evita falso-positivo de um único
 *     pico transitório.
 *   - Canais: GlitchTip/Sentry (captureMessage — o SDK do app roteia para
 *     GLITCHTIP_DSN/SENTRY_DSN) + email para ADMIN_EMAIL (se configurado).
 *
 * Segurança/limites (espelha revoke-inactive-scan.ts):
 *   - Cooldown Redis (ORPHAN_ALERT_COOLDOWN_MS, default 60min) marcado SOMENTE
 *     quando um alerta REAL dispara (dry-run e runs limpos NÃO marcam — o
 *     monitor precisa re-checar a cada intervalo para pegar um NOVO episódio
 *     dentro da janela; a supressão anti-storm é por alerta, não por run).
 *   - Dry-run (?dryRun=1): reporta o que seria alertado sem notificar nada.
 *   - Fail-open em 3 pontos: Redis fora (client null), leitura falha e
 *     notificação falha — o job nunca quebra nem 500a; sem dados não há
 *     alerta (fail-closed na evidência: buckets ausentes/corrompidos contam
 *     como não-confirmados).
 *
 * Env:
 *   ORPHAN_ALERT_MINUTES     — N minutos consecutivos para disparar (default 5)
 *   ORPHAN_ALERT_COOLDOWN_MS — cooldown entre alertas reais (default 60min)
 *   ADMIN_EMAIL              — destinatário do email (sem env → só Sentry)
 */

import { getClient } from "@/lib/redis"
import { isCooldownElapsed, markCompleted } from "@/lib/cron-cooldown"
import { captureMessage } from "@/lib/sentry"
import { sendMail } from "@/lib/mail"
import logger from "@/lib/logger"

// ---------------------------------------------------------------------------
// Chaves (contrato compartilhado com mini-services/realtime/redis-telemetry.ts
// e src/app/api/admin/realtime/telemetry/route.ts — mantê-los em sincronia).
// ---------------------------------------------------------------------------

/** Sinal de alerta: "há sockets órfãos AGORA" (STRING "1", TTL curto). */
export const MULTI_FLAG_KEY = "realtime:telemetry:multi:flag"

const BUCKET_MS = 60_000

/** Nome do job (chave de cooldown cron:cooldown:realtime-orphan-alert). */
export const JOB_NAME = "realtime-orphan-alert"

// ---------------------------------------------------------------------------
// Env parsing (puro — guard pattern do repo)
// ---------------------------------------------------------------------------

export const DEFAULT_ORPHAN_MINUTES = 5
export const DEFAULT_ALERT_COOLDOWN_MS = 60 * 60 * 1000
const MAX_ORPHAN_MINUTES = 1440 // 24h — o TTL dos buckets

/** Minutos consecutivos para alertar. Missing/empty/NaN → fallback; clamp 1..1440. */
export function parseOrphanAlertMinutes(
  raw: string | undefined,
  fallback = DEFAULT_ORPHAN_MINUTES,
): number {
  // Number("") é 0 (não NaN) — um env vazio viraria clamp a 1 em vez do
  // fallback. Trata vazio/espaços como ausente ANTES do parse numérico.
  if (raw === undefined || raw.trim() === "") return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_ORPHAN_MINUTES, Math.max(1, Math.floor(n)))
}

/** Cooldown entre alertas reais (ms). Missing/empty/NaN/0 → fallback; clamp >= 60s. */
export function parseOrphanAlertCooldownMs(
  raw: string | undefined,
  fallback = DEFAULT_ALERT_COOLDOWN_MS,
): number {
  if (raw === undefined || raw.trim() === "") return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n === 0) return fallback
  return Math.max(60_000, Math.floor(n))
}

// ---------------------------------------------------------------------------
// Persistência (puro — unit-testável)
// ---------------------------------------------------------------------------

/** Bucket de minuto (mesmo cálculo do mini-service). */
export function buildMultiBucketKey(bucket: number): string {
  return `realtime:telemetry:multi:${bucket}`
}

/** Snapshot de sessões de um bucket (subset do JSON gravado pelo realtime). */
export interface OrphanBucketSnapshot {
  usersWithMultipleSockets: number
  total: number
  byRole: Record<string, number>
}

export interface OrphanPersistence {
  /** Buckets checados (mais recente primeiro). */
  buckets: number[]
  /** Quantos buckets presentes CONFIRMAM órfãos (> 0). */
  confirmed: number
  /** true quando TODOS os N buckets confirmam — persistência comprovada. */
  persisted: boolean
  /** Snapshot mais recente confirmado (null se nenhum). */
  latest: OrphanBucketSnapshot | null
}

/**
 * Lê os N buckets de minuto (do atual para trás) e verifica persistência:
 * `persisted` = TODOS os N buckets presentes E com usersWithMultipleSockets>0.
 * Buckets ausentes ou JSON corrompido contam como NÃO confirmados
 * (fail-closed na evidência — não se alerta com dados incompletos).
 */
export async function readOrphanPersistence(
  client: { get(key: string): Promise<string | null> },
  minutes: number,
  nowMs: number,
): Promise<OrphanPersistence> {
  const now = Math.floor(nowMs / BUCKET_MS)
  const buckets = Array.from({ length: minutes }, (_, i) => now - i)
  const confirmedSnapshots: OrphanBucketSnapshot[] = []

  for (const b of buckets) {
    const raw = await client.get(buildMultiBucketKey(b))
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as {
        usersWithMultipleSockets?: number
        total?: number
        byRole?: Record<string, number>
      }
      const snap: OrphanBucketSnapshot = {
        usersWithMultipleSockets: parsed.usersWithMultipleSockets ?? 0,
        total: parsed.total ?? 0,
        byRole: parsed.byRole ?? {},
      }
      if (snap.usersWithMultipleSockets > 0) confirmedSnapshots.push(snap)
    } catch {
      // Bucket corrompido → trata como ausente (fail-closed)
    }
  }

  return {
    buckets,
    confirmed: confirmedSnapshots.length,
    persisted: confirmedSnapshots.length >= minutes,
    latest: confirmedSnapshots[0] ?? null, // mais recente confirmado
  }
}

// ---------------------------------------------------------------------------
// Notificação (injetável para testes)
// ---------------------------------------------------------------------------

export interface OrphanAlertNotifyPayload {
  minutes: number
  latest: OrphanBucketSnapshot
}

export type OrphanAlertNotifyFn = (payload: OrphanAlertNotifyPayload) => Promise<void>

/** Escapa entidades HTML (as chaves de byRole vêm do Redis — não confiar). */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

/** HTML do email de alerta (branding inline, sem depender de template do app). */
export function buildOrphanAlertHtml(payload: OrphanAlertNotifyPayload): string {
  const { minutes, latest } = payload
  const roleBreakdown = Object.entries(latest.byRole)
    .map(([role, count]) => `<li><strong>${escapeHtml(role)}</strong>: ${count}</li>`)
    .join("")

  return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#dc2626,#991b1b);padding:32px 24px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700">⚠️ Sockets órfãos persistentes</h1>
          <p style="margin:4px 0 0;color:#fecaca;font-size:13px">Realtime — telemetria de conflito de sessão</p>
        </td></tr>
        <tr><td style="padding:32px 24px">
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
            O monitor detectou <strong style="color:#111827">${latest.usersWithMultipleSockets} usuário(s)</strong>
            com múltiplos sockets simultâneos por <strong style="color:#111827">${minutes} minutos consecutivos</strong>.
            Isso indica socket órfão (ex.: leak de HMR em dev) ou conflito de sessão real em produção.
          </p>
          <table style="width:100%;border-collapse:collapse;background:#fef2f2;border:1px solid #fecaca;border-radius:8px">
            <tr><td style="padding:12px;color:#374151;font-size:13px">Usuários multi-socket</td>
                <td style="padding:12px;text-align:right;font-weight:700;color:#dc2626;font-size:15px">${latest.usersWithMultipleSockets}</td></tr>
            <tr><td style="padding:12px;color:#374151;font-size:13px;border-top:1px solid #fee2e2">Sockets ativos (total)</td>
                <td style="padding:12px;text-align:right;font-weight:600;color:#111827;font-size:15px;border-top:1px solid #fee2e2">${latest.total}</td></tr>
          </table>
          ${roleBreakdown ? `<p style="margin:16px 0 0;color:#6b7280;font-size:13px">Breakdown por perfil:</p><ul style="margin:4px 0 0;color:#374151;font-size:13px">${roleBreakdown}</ul>` : ""}
          <p style="margin:16px 0 0;color:#6b7280;font-size:13px;line-height:1.5">
            🔧 <strong>Ações recomendadas:</strong> veja a view de telemetria no painel admin
            (sessões ativas + gráfico de órfãos) e revogue sockets órfãos se confirmado.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Notificação default: GlitchTip/Sentry (sempre) + email para ADMIN_EMAIL. */
async function defaultNotify(payload: OrphanAlertNotifyPayload): Promise<void> {
  const { minutes, latest } = payload
  captureMessage(
    `[Cron] ⚠️ ${latest.usersWithMultipleSockets} usuário(s) com múltiplos sockets há ${minutes} min seguidos (socket órfão persistente)`,
    "error",
    {
      source: "realtime-orphan-alert",
      minutes,
      usersWithMultipleSockets: latest.usersWithMultipleSockets,
      total: latest.total,
      byRole: latest.byRole,
    },
  )

  const adminEmail = process.env.ADMIN_EMAIL ?? ""
  if (!adminEmail) {
    logger.warn({ minutes }, "realtime-orphan-alert: ADMIN_EMAIL not set — skipping email")
    return
  }
  await sendMail({
    to: adminEmail,
    subject: `[Severinno] ⚠️ Sockets órfãos há ${minutes} min — ${latest.usersWithMultipleSockets} usuário(s)`,
    html: buildOrphanAlertHtml(payload),
  })
}

// ---------------------------------------------------------------------------
// Engine (fail-open)
// ---------------------------------------------------------------------------

export type OrphanAlertResult =
  | { ok: true; status: "skipped"; reason: "cooldown" }
  | {
      ok: true
      status: "completed"
      dryRun: boolean
      alerted: boolean
      /** Redis disponível e leitura OK (false nos paths de fail-open). */
      available: boolean
      /** Motivo do desfecho: flag-clear | not-persisted | alerted | redis-unavailable. */
      reason: "flag-clear" | "not-persisted" | "alerted" | "redis-unavailable"
      flag: boolean
      persisted: boolean
      minutes: number
      confirmed: number
      /** usersWithMultipleSockets do snapshot mais recente confirmado (0 se nenhum). */
      latest: number
      elapsedMs: number
    }

export interface RunOrphanAlertOptions {
  dryRun: boolean
  /** Injetável para testes (default: captureMessage + email para ADMIN_EMAIL). */
  notify?: OrphanAlertNotifyFn
  /** Cooldown override (default: env ORPHAN_ALERT_COOLDOWN_MS). */
  cooldownMs?: number
  /** Clock injetável (padrão do createOrphanAlert do mini-service). */
  now?: () => number
}

/**
 * Executa uma checagem do job de alerta de sockets órfãos persistidos.
 * Nunca lança para os caminhos esperados (cooldown/Redis fora/leitura falha) —
 * retorna o desfecho estruturado; erros inesperados sobem para a rota mapear.
 *
 * Regra de disparo: flag ATIVA (agora) E os N buckets consecutivos confirmam
 * órfãos (persistência). Cooldown marcado só em alertas REAIS — dry-run e
 * runs limpos não suprimem o monitor por uma hora inteira.
 */
export async function runRealtimeOrphanAlert(
  opts: RunOrphanAlertOptions,
): Promise<OrphanAlertResult> {
  const nowFn = opts.now ?? (() => Date.now())
  const startedAt = nowFn()
  const { dryRun } = opts
  const minutes = parseOrphanAlertMinutes(process.env.ORPHAN_ALERT_MINUTES)
  const cooldownMs = parseOrphanAlertCooldownMs(
    process.env.ORPHAN_ALERT_COOLDOWN_MS,
    opts.cooldownMs,
  )
  const notify = opts.notify ?? defaultNotify

  // ── Cooldown (anti-storm): sem re-alerta enquanto o cooldown estiver ativo ──
  if (!(await isCooldownElapsed(JOB_NAME, cooldownMs))) {
    return { ok: true, status: "skipped", reason: "cooldown" }
  }

  const client = getClient()
  if (!client) {
    // Redis indisponível → fail-open: sem dados não há alerta (nunca 500).
    logger.warn("realtime-orphan-alert: redis unavailable — skipping check (fail-open)")
    return {
      ok: true,
      status: "completed",
      dryRun,
      alerted: false,
      available: false,
      reason: "redis-unavailable",
      flag: false,
      persisted: false,
      minutes,
      confirmed: 0,
      latest: 0,
      elapsedMs: nowFn() - startedAt,
    }
  }

  let flag = false
  let persistence: OrphanPersistence
  try {
    const flagRaw = await client.get(MULTI_FLAG_KEY)
    flag = flagRaw === "1"
    persistence = await readOrphanPersistence(client, minutes, nowFn())
  } catch (e) {
    logger.error({ err: e }, "realtime-orphan-alert: redis read failed (fail-open)")
    return {
      ok: true,
      status: "completed",
      dryRun,
      alerted: false,
      available: false,
      reason: "redis-unavailable",
      flag: false,
      persisted: false,
      minutes,
      confirmed: 0,
      latest: 0,
      elapsedMs: nowFn() - startedAt,
    }
  }

  const shouldAlert = flag && persistence.persisted && persistence.latest !== null
  const reason: OrphanAlertResult["reason"] = !flag
    ? "flag-clear"
    : !persistence.persisted
      ? "not-persisted"
      : "alerted"

  if (!shouldAlert) {
    logger.info(
      { dryRun, flag, minutes, confirmed: persistence.confirmed },
      "realtime-orphan-alert: condition not met — no alert",
    )
    return {
      ok: true,
      status: "completed",
      dryRun,
      alerted: false,
      available: true,
      reason,
      flag,
      persisted: persistence.persisted,
      minutes,
      confirmed: persistence.confirmed,
      latest: persistence.latest?.usersWithMultipleSockets ?? 0,
      elapsedMs: nowFn() - startedAt,
    }
  }

  const latest = persistence.latest!

  if (dryRun) {
    logger.info(
      { dryRun, minutes, latest: latest.usersWithMultipleSockets },
      "realtime-orphan-alert: dry-run — would alert",
    )
    return {
      ok: true,
      status: "completed",
      dryRun,
      alerted: true,
      available: true,
      reason,
      flag,
      persisted: true,
      minutes,
      confirmed: persistence.confirmed,
      latest: latest.usersWithMultipleSockets,
      elapsedMs: nowFn() - startedAt,
    }
  }

  // ── Alerta real ──────────────────────────────────────────────────────
  try {
    await notify({ minutes, latest })
  } catch (e) {
    // Notificação best-effort — falha do canal não transforma o job em erro.
    logger.error({ err: e }, "realtime-orphan-alert: notify failed (fail-open)")
  }

  // Cooldown SÓ em alertas reais: um dry-run ou run limpo não deve suprimir
  // o monitor por uma hora (o próximo intervalo pode pegar um NOVO episódio).
  await markCompleted(JOB_NAME, cooldownMs)

  logger.info(
    { dryRun, minutes, latest: latest.usersWithMultipleSockets },
    "realtime-orphan-alert: alert sent",
  )
  return {
    ok: true,
    status: "completed",
    dryRun,
    alerted: true,
    available: true,
    reason,
    flag,
    persisted: true,
    minutes,
    confirmed: persistence.confirmed,
    latest: latest.usersWithMultipleSockets,
    elapsedMs: nowFn() - startedAt,
  }
}
