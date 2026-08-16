/**
 * Severinno Marketplace SaaS — Realtime Mini-Service: operational alerting
 *
 * Emits an operational alert (Sentry/GlitchTip webhook — raw envelope, the
 * same protocol the Sentry SDK posts) when the orphan-socket signal
 * `usersWithMultipleSockets` crosses a threshold. This is the HMR-orphan
 * symptom (a dev reload leaves stale sockets behind) — alerting on it in
 * staging catches leaks BEFORE they reach production.
 *
 * Design (mirrors the app-side geo-health-alert pattern):
 *   - Threshold crossing: alert when `usersWithMultipleSockets > threshold`
 *     (env REALTIME_ORPHAN_ALERT_THRESHOLD, default 0 = any orphan).
 *   - Cooldown per direction: at most one alert every `cooldownMs` while the
 *     condition persists (no storm — the telemetry timer runs every ~30s).
 *   - Recovery notice (level "info") when it drops back after having alerted.
 *   - Fail-open: no DSN / network error / malformed DSN → log (deduped) and
 *     resolve — alerting never breaks the realtime.
 *
 * The mini-service is a bare Bun process (no @sentry/nextjs SDK), so it posts
 * the Sentry envelope directly — the exact ingest protocol the SDK uses:
 *   POST {protocol}://{host}/api/{projectId}/envelope/
 *   X-Sentry-Auth: Sentry sentry_version=7, sentry_client=..., sentry_key=...
 *   Content-Type: application/x-sentry-envelope
 */

import { readSecret } from "./security"
import type { TelemetrySessionsSnapshot } from "./redis-telemetry"

// ---------------------------------------------------------------------------
// DSN parsing + envelope building (pure)
// ---------------------------------------------------------------------------

/** Identidade do SDK no envelope e no `X-Sentry-Auth` — fonte única para os
 *  dois headers não divergirem ao bumpar versão. Derivada de duas constantes
 *  (sem parsing: um `split("/")` sumiria com a versão silenciosamente se o
 *  valor um dia não tivesse `/`). */
export const SDK_NAME = "realtime-mini-service"
export const SDK_VERSION = "1.0.0"
export const SDK_IDENT = `${SDK_NAME}/${SDK_VERSION}`

/** Parsed Sentry/GlitchTip DSN: `{protocol}://{publicKey}@{host}/{projectId}`. */
export interface SentryDsn {
  protocol: string
  host: string
  key: string
  projectId: string
}

export function parseDsn(dsn: string | undefined): SentryDsn | null {
  if (!dsn) return null
  try {
    const url = new URL(dsn)
    const path = url.pathname.replace(/^\/+|\/+$/g, "")
    // O DSN Sentry SEMPRE carrega a public key no username. Sem ela o
    // envelope seria 401 em todo POST (e o fail-open esconderia o problema)
    // — rejeita DSN malformado em vez de gerar sentry_key vazio.
    if (!url.hostname || !path || !url.username) return null
    return {
      protocol: url.protocol.replace(":", ""),
      host: url.host,
      key: url.username,
      projectId: path,
    }
  } catch {
    return null
  }
}

export function buildEnvelopeUrl(dsn: SentryDsn): string {
  return `${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/envelope/`
}

export type EnvelopeLevel = "error" | "info"

export interface EnvelopeOptions {
  eventId: string
  sentAt: string
  level: EnvelopeLevel
  message: string
  extra: Record<string, unknown>
}

/**
 * Build a Sentry v7 envelope body: one JSON header line, then per-item
 * `{type,length}` + payload lines. `length` is the BYTE length of the item
 * payload (Sentry contract). Pure — unit-tested.
 */
export function buildSentryEnvelope(opts: EnvelopeOptions): string {
  const envelopeHeader = JSON.stringify({
    event_id: opts.eventId,
    sent_at: opts.sentAt,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
  })
  const payload = JSON.stringify({
    event_id: opts.eventId,
    timestamp: opts.sentAt,
    platform: "javascript",
    level: opts.level,
    message: opts.message,
    extra: opts.extra,
  })
  const itemHeader = JSON.stringify({ type: "event", length: Buffer.byteLength(payload) })
  return `${envelopeHeader}\n${itemHeader}\n${payload}`
}

/** 32-char lowercase hex event id (Sentry contract). */
export function generateEventId(): string {
  const hex = crypto.randomUUID().replace(/-/g, "")
  return hex.slice(0, 32)
}

// ---------------------------------------------------------------------------
// Env parsing (pure — guard pattern do repo)
// ---------------------------------------------------------------------------

/**
 * Threshold para o alerta de sockets órfãos: alerta quando
 * `usersWithMultipleSockets > threshold`. Default 0 (qualquer órfão);
 * ajuste para acima do limite de sessões por role se multi-tab for legítimo.
 * Missing/empty/NaN → fallback; negativo → clamp a 0.
 */
export function parseOrphanAlertThreshold(raw: string | undefined, fallback = 0): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.floor(n))
}

/** Cooldown do alerta (ms): max 1 alerta por janela por direção. Clamp >= 60s. */
export function parseOrphanAlertCooldownMs(
  raw: string | undefined,
  fallback = 15 * 60_000,
): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n === 0) return fallback
  return Math.max(60_000, Math.floor(n))
}

// ---------------------------------------------------------------------------
// Alert scheduler (stateful, fail-open)
// ---------------------------------------------------------------------------

export type EnvelopeSender = (url: string, envelope: string) => Promise<unknown>

export interface OrphanAlertOptions {
  dsn: SentryDsn | null
  threshold?: number
  cooldownMs?: number
  /** Injectável para testes (relógio). */
  now?: () => number
  /** Injectável para testes (rede). Default: fetch + AbortSignal.timeout(10s). */
  send?: EnvelopeSender
}

export interface OrphanAlert {
  /**
   * Avalia um snapshot do /health (usersWithMultipleSockets etc.) e dispara
   * o alerta na CROSSING do threshold (com cooldown) ou a RECOVERY quando
   * cai de volta. Fail-open: nunca lança.
   */
  evaluate(sessions: TelemetrySessionsSnapshot): Promise<void>
}

const ALERT_TAG = "realtime:orphan-sockets"
const ALERT_SOURCE = "realtime-ops-alert"
const ALERT_TIMEOUT_MS = 10_000

export function createOrphanAlert(opts: OrphanAlertOptions): OrphanAlert {
  const threshold = Math.max(0, opts.threshold ?? 0)
  const cooldownMs = Math.max(60_000, opts.cooldownMs ?? 15 * 60_000)
  const nowFn = opts.now ?? (() => Date.now())
  const send =
    opts.send ??
    (async (url: string, envelope: string) => {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=${SDK_IDENT}, sentry_key=${opts.dsn?.key ?? ""}`,
        },
        body: envelope,
        signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
      })
    })

  let wasOver = false
  // -Infinity: o PRIMEIRO evento de cada direção (crossing/recovery) sempre
  // dispara — não há o que debouncear ainda. Inicializar com 0 suprimiria a
  // primeira recovery quando o relógio estiver perto de zero (bug real pego
  // pelo reviewer e pelo teste com clock injetado).
  let lastAlertedAt = Number.NEGATIVE_INFINITY
  let lastRecoveredAt = Number.NEGATIVE_INFINITY
  let warned = false

  async function deliver(
    level: EnvelopeLevel,
    message: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    try {
      if (!opts.dsn) return // sem DSN configurado → sem alerta (fail-open)
      const envelope = buildSentryEnvelope({
        eventId: generateEventId(),
        sentAt: new Date(nowFn()).toISOString(),
        level,
        message,
        extra: { tag: ALERT_TAG, source: ALERT_SOURCE, ...extra },
      })
      await send(buildEnvelopeUrl(opts.dsn), envelope)
      warned = false
    } catch (err) {
      // Log deduplicado: webhook fora do ar não vira spam a cada ciclo.
      if (!warned) {
        console.error(`[realtime] ${ALERT_SOURCE} webhook error (fail-open):`, err)
        warned = true
      }
    }
  }

  return {
    async evaluate(sessions) {
      const over = sessions.usersWithMultipleSockets > threshold
      const now = nowFn()
      const metrics = {
        usersWithMultipleSockets: sessions.usersWithMultipleSockets,
        maxSocketsPerUser: sessions.maxSocketsPerUser,
        total: sessions.total,
        byRole: sessions.byRole,
      }

      if (over) {
        if (!wasOver || now - lastAlertedAt >= cooldownMs) {
          lastAlertedAt = now
          await deliver(
            "error",
            `⚠️ ${sessions.usersWithMultipleSockets} usuário(s) com múltiplos sockets — possível socket órfão (HMR leak)`,
            metrics,
          )
          console.warn(
            `[realtime] ${ALERT_SOURCE}: orphans detected (usersWithMultipleSockets=${sessions.usersWithMultipleSockets}) — alert sent`,
          )
        }
      } else if (wasOver) {
        if (now - lastRecoveredAt >= cooldownMs) {
          lastRecoveredAt = now
          await deliver(
            "info",
            `✅ Sockets órfãos resolvidos (usersWithMultipleSockets voltou a ${sessions.usersWithMultipleSockets})`,
            metrics,
          )
          console.log(
            `[realtime] ${ALERT_SOURCE}: orphans resolved (usersWithMultipleSockets=${sessions.usersWithMultipleSockets}) — recovery sent`,
          )
        }
      }

      wasOver = over
    },
  }
}

/** Conveniência: resolve o DSN das envs do repo (GlitchTip primeiro — é o
 *  self-hosted do projeto; Sentry como alternativa). Docker-secret aware. */
export function resolveAlertDsn(): SentryDsn | null {
  return parseDsn(readSecret("GLITCHTIP_DSN") ?? readSecret("SENTRY_DSN"))
}
