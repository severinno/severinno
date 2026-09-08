import "server-only"

/**
 * GeoHealthAlert — Tracks consecutive degradation of geo services (Nominatim,
 * ViaCEP, PostGIS) and alerts the admin when a service stays down for more
 * than 5 minutes.
 *
 * How it works:
 *   1. Called periodically by the cron endpoint GET /api/cron/geo-health-alert
 *      (recommended: every 5 minutes, via cron-job.org or systemd timer).
 *   2. Maintains in-memory state per service: consecutive failure count +
 *      timestamp when the current degradation streak began.
 *   3. After 2 consecutive checks (≈10 min, i.e. >5 min) sends a structured
 *      alert via Sentry + email to ADMIN_EMAIL.
 *   4. Optionally sends to a Slack webhook if SLACK_WEBHOOK_URL is configured.
 *   5. Sends a recovery notification when the service comes back.
 *
 * In-memory state resets on server restart — that's acceptable because the
 * monitor is designed for operational awareness, not audit-grade SLAs.
 */

import { sendMail } from "@/lib/mail"
import { notifyGeoAlert } from "@/lib/geo-alert-notify"
import logger from "@/lib/logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { type GeoServiceName } from "@/lib/geo-metrics"

export type { GeoServiceName }

export type GeoHealthAlertResult = {
  checked: number
  degraded: number
  alertsSent: number
  recoveriesSent: number
  slackSent: boolean
  services: Array<{
    name: GeoServiceName
    status: "ok" | "error"
    detail: string
    consecutiveFailures: number
    alerted: boolean
    recovered: boolean
  }>
}

export type GeoHealthInput = {
  nominatim: { status: "ok" | "error"; detail: string }
  viacep: { status: "ok" | "error"; detail: string }
  postgis: { status: "ok" | "error"; detail: string }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Alert threshold — consecutive failures before sending notification.
 *  With a 5-minute cron interval, 2 failures = ~10 min of downtime (>5 min). */
const CONSECUTIVE_FAILURES_THRESHOLD = 2

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com.br"

const SERVICE_LABELS: Record<GeoServiceName, string> = {
  nominatim: "Nominatim (OpenStreetMap)",
  viacep: "ViaCEP",
  postgis: "PostGIS",
}

const SERVICE_ICONS: Record<GeoServiceName, string> = {
  nominatim: "🌍",
  viacep: "📮",
  postgis: "🗄️",
}

/** PostGIS degradation is more critical — it affects spatial queries directly. */
const CRITICAL_SERVICES: Set<GeoServiceName> = new Set(["postgis"])

// ---------------------------------------------------------------------------
// In-memory state (hydrated from Redis on first access)
// ---------------------------------------------------------------------------

type ServiceState = {
  name: GeoServiceName
  consecutiveFailures: number
  firstDegradedAt: number | null
  lastAlertedAt: number | null
  lastStatus: "ok" | "error" | null
}

const state = new Map<GeoServiceName, ServiceState>()

/** Redis key prefix for health alert state. TTL = 1 hour. */
const HEALTH_STATE_PREFIX = "geo:health:state:"
const HEALTH_STATE_TTL = 3600 // 1 hour

/**
 * Get the current state for a service.
 * On first call, attempts to hydrate from Redis (survives server restarts).
 * Falls back to fresh in-memory state if Redis is unavailable.
 */
async function getState(name: GeoServiceName): Promise<ServiceState> {
  let s = state.get(name)
  if (s) return s

  // Try to hydrate from Redis (survives deploys/restarts)
  try {
    const { cacheGet } = await import("@/lib/redis")
    const persisted = await cacheGet<ServiceState>(`${HEALTH_STATE_PREFIX}${name}`)
    if (persisted && typeof persisted.consecutiveFailures === "number") {
      state.set(name, persisted)
      return persisted
    }
  } catch (err) {
    // Redis unavailable — start fresh
    logger.debug({ err }, "geo-health-alert: Redis hydration failed, starting fresh")
  }

  s = {
    name,
    consecutiveFailures: 0,
    firstDegradedAt: null,
    lastAlertedAt: null,
    lastStatus: null,
  }
  state.set(name, s)
  return s
}

/**
 * Persist the current state to Redis (best-effort, fire-and-forget).
 * Called after every state change so the next server instance picks it up.
 */
async function saveState(s: ServiceState): Promise<void> {
  try {
    const { cacheSet } = await import("@/lib/redis")
    await cacheSet(`${HEALTH_STATE_PREFIX}${s.name}`, s, HEALTH_STATE_TTL)
  } catch (err) {
    // Redis unavailable — in-memory state is still valid for this instance
    logger.debug({ err }, "geo-health-alert: Redis save failed")
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read config lazily so env changes are picked up at runtime. */
function getAdminEmail(): string {
  return process.env.ADMIN_EMAIL ?? ""
}

function getSlackWebhook(): string {
  return process.env.SLACK_WEBHOOK_URL ?? ""
}

function formatDuration(start: number): string {
  const elapsed = Date.now() - start
  const minutes = Math.floor(elapsed / 60000)
  const seconds = Math.floor((elapsed % 60000) / 1000)
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return `${h}h${m > 0 ? ` ${m}min` : ""}`
  }
  if (minutes > 0) return `${minutes}min ${seconds}s`
  return `${seconds}s`
}

// ---------------------------------------------------------------------------
// Slack notification
// ---------------------------------------------------------------------------

async function sendSlackNotification(payload: {
  text: string
  attachments?: Array<{
    color: string
    fields: Array<{ title: string; value: string; short?: boolean }>
  }>
}): Promise<void> {
  const webhookUrl = getSlackWebhook()
  if (!webhookUrl) return

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    logger.info("geo-health-alert: slack notification sent")
  } catch (err) {
    logger.warn({ err }, "geo-health-alert: slack notification failed")
  }
}

// ---------------------------------------------------------------------------
// Email notification
// ---------------------------------------------------------------------------

function geoDegradationHtml(opts: {
  services: Array<{ name: string; icon: string; detail: string; duration: string }>
  totalDegraded: number
}): string {
  const serviceCards = opts.services
    .map(
      (s) => `
      <tr>
        <td style="padding:16px;border-bottom:1px solid #e5e7eb">
          <p style="margin:0;font-size:15px;font-weight:600;color:#111827">
            ${escapeHtml(s.icon)} ${escapeHtml(s.name)}
          </p>
          <p style="margin:4px 0 0;font-size:13px;color:#6b7280">
            ${escapeHtml(s.detail)}
          </p>
          <p style="margin:2px 0 0;font-size:12px;color:#dc2626;font-weight:500">
            🔴 Indisponível há ${escapeHtml(s.duration)}
          </p>
        </td>
      </tr>`,
    )
    .join("")

  return `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">
      ⚠️ Serviço(s) de geolocalização degradado(s)
    </h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      O monitor automático detectou que <strong style="color:#111827">${opts.totalDegraded} serviço(s) geo</strong>
      estão indisponíveis há mais de 5 minutos consecutivos.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;overflow:hidden">
      ${serviceCards}
    </table>
    <p style="margin:24px 0 0;color:#6b7280;font-size:13px;line-height:1.5">
      📋 <strong>Impacto esperado:</strong><br>
      • Busca por endereço (Nominatim) — <em>autocomplete pode falhar</em><br>
      • Consulta de CEP (ViaCEP) — <em>detecção de CEP pode falhar</em><br>
      • Filtro por distância (PostGIS) — <em>fallback para Haversine JS</em><br><br>
      🔧 <strong>Ações recomendadas:</strong><br>
      • Verifique o <a href="${APP_URL}/api/health" style="color:#059669">health check</a> para detalhes<br>
      • Consulte os logs no painel admin<br>
      • Se aplicável, verifique a conectividade de rede externa
    </p>
    <p style="margin:16px 0 0;padding:16px 0 0;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px">
      Esta é uma notificação automática do monitor de saúde do Severinno.<br>
      Para desativar, configure a variável de ambiente <code>ADMIN_EMAIL</code> como vazia.
    </p>
  `
}

function geoRecoveryHtml(opts: {
  services: Array<{ name: string; icon: string; duration: string }>
}): string {
  const list = opts.services
    .map(
      (s) =>
        `<li style="margin:8px 0;color:#059669;font-size:14px;font-weight:500">${escapeHtml(s.icon)} ${escapeHtml(s.name)} — voltou após ${escapeHtml(s.duration)}</li>`,
    )
    .join("")

  return `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">
      ✅ Serviço(s) de geolocalização recuperado(s)
    </h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      O monitor automático detectou que o(s) seguinte(s) serviço(s) voltaram a
      funcionar normalmente:
    </p>
    <ul style="padding-left:20px">${list}</ul>
    <p style="margin:16px 0 0;color:#6b7280;font-size:13px">
      ✅ Os fallbacks automáticos (Haversine JS, cache local) já foram desativados
      para esses serviços.
    </p>
    <p style="margin:16px 0 0;padding:16px 0 0;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px">
      <a href="${APP_URL}/api/health" style="color:#059669">Ver health check completo →</a>
    </p>
  `
}

/** Basic HTML entity escaping to prevent injection in email/Slack content. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

async function sendAlertEmail(opts: { subject: string; html: string }): Promise<void> {
  const adminEmail = getAdminEmail()
  if (!adminEmail) {
    logger.warn({ subject: opts.subject }, "geo-health-alert: ADMIN_EMAIL not set — skipping email")
    return
  }

  await sendMail({
    to: adminEmail,
    subject: `[Severinno] ${opts.subject}`,
    html: opts.html,
  })
}

// ---------------------------------------------------------------------------
// Core check function
// ---------------------------------------------------------------------------

/**
 * Evaluate geo service health and send alerts if any service has been
 * degraded for more than CONSECUTIVE_FAILURES_THRESHOLD checks.
 *
 * Call this from the cron endpoint GET /api/cron/geo-health-alert.
 *
 * Alerts are sent via:
 *   1. Sentry (captureMessage) — always
 *   2. Email (ADMIN_EMAIL) — if configured
 *   3. Slack (SLACK_WEBHOOK_URL) — if configured
 *
 * @param checks - Current health status of geo services (from /api/health)
 * @returns Summary of what happened (alerts sent, recoveries, etc.)
 */
export async function evaluateGeoHealth(checks: GeoHealthInput): Promise<GeoHealthAlertResult> {
  const result: GeoHealthAlertResult = {
    checked: 0,
    degraded: 0,
    alertsSent: 0,
    recoveriesSent: 0,
    slackSent: false,
    services: [],
  }

  const degradedServices: Array<{
    name: string
    icon: string
    detail: string
    duration: string
    critical: boolean
  }> = []

  const recoveredServices: Array<{
    name: string
    icon: string
    duration: string
  }> = []

  // Collect notification promises so we can await them all before returning
  const notifyPromises: Promise<unknown>[] = []

  for (const [name, check] of Object.entries(checks) as [
    GeoServiceName,
    { status: "ok" | "error"; detail: string },
  ][]) {
    const s = await getState(name)
    const isError = check.status === "error"
    const isCritical = CRITICAL_SERVICES.has(name)

    result.checked++

    if (isError) {
      // ── Degradation ──────────────────────────────────────────────
      s.consecutiveFailures++
      if (s.firstDegradedAt === null) s.firstDegradedAt = Date.now()

      const duration = s.firstDegradedAt ? formatDuration(s.firstDegradedAt) : "N/A"

      // Alert when consecutive failures exceed threshold
      const shouldAlert =
        s.consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD &&
        (s.lastAlertedAt === null || Date.now() - s.lastAlertedAt > 5 * 60 * 1000) // debounce: max 1 alert per 5 min

      if (shouldAlert) {
        s.lastAlertedAt = Date.now()

        const label = SERVICE_LABELS[name]
        const icon = SERVICE_ICONS[name]

        // Unified notification: Sentry + push to all admins
        notifyPromises.push(
          notifyGeoAlert({
            title: `${isCritical ? "🛑" : "🔴"} ${label} degradado — ${duration}`,
            body: `${check.detail}\n\nO serviço está indisponível há ${duration}. Fallbacks locais ativados.`,
            severity: isCritical ? "error" : "warning",
            url: "/admin/geo-metrics",
            tag: `geo-health:${name}:degraded`,
            source: "geo-health-alert",
            context: {
              service: name,
              critical: isCritical,
              consecutiveFailures: s.consecutiveFailures,
              duration,
              detail: check.detail,
              firstDegradedAt: s.firstDegradedAt ? new Date(s.firstDegradedAt).toISOString() : null,
            },
          }).catch(() => {
            // Notification is best-effort — don't block the health check
          }),
        )

        degradedServices.push({
          name: label,
          icon,
          detail: check.detail,
          duration,
          critical: isCritical,
        })
        result.alertsSent++
      }

      result.services.push({
        name,
        status: "error",
        detail: check.detail,
        consecutiveFailures: s.consecutiveFailures,
        alerted: shouldAlert,
        recovered: false,
      })
    } else {
      // ── Recovery ─────────────────────────────────────────────────
      const wasDegraded = s.consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD
      const hadAlert = s.lastAlertedAt !== null

      s.consecutiveFailures = 0
      s.firstDegradedAt = null
      s.lastStatus = "ok"

      if (wasDegraded && hadAlert) {
        const label = SERVICE_LABELS[name]
        const icon = SERVICE_ICONS[name]

        // Unified notification: Sentry (info) + push recovery to admins
        notifyPromises.push(
          notifyGeoAlert({
            title: `✅ ${label} recuperado`,
            body: `O serviço voltou a funcionar normalmente após o período de degradação. Detalhe: ${check.detail}`,
            severity: "info",
            url: "/admin/geo-metrics",
            tag: `geo-health:${name}:recovery`,
            source: "geo-health-alert",
            context: {
              service: name,
              detail: check.detail,
            },
          }).catch(() => {
            // Notification is best-effort
          }),
        )

        recoveredServices.push({
          name: label,
          icon,
          duration: "período anterior",
        })
        result.recoveriesSent++
      }

      result.services.push({
        name,
        status: "ok",
        detail: check.detail,
        consecutiveFailures: 0,
        alerted: false,
        recovered: wasDegraded && hadAlert,
      })
    }

    s.lastStatus = isError ? "error" : "ok"
    saveState(s)
  }

  result.degraded = result.services.filter((s) => s.status === "error").length

  // ── Send consolidated email (one email for all degraded services) ──
  if (degradedServices.length > 0) {
    const subject = `⚠️ Geo: ${degradedServices.map((s) => s.name).join(", ")} indisponível(is)`
    await sendAlertEmail({
      subject,
      html: geoDegradationHtml({
        services: degradedServices,
        totalDegraded: degradedServices.length,
      }),
    })
  }

  // ── Send recovery email ──
  if (recoveredServices.length > 0) {
    const names = recoveredServices.map((s) => s.name).join(", ")
    await sendAlertEmail({
      subject: `✅ Geo: ${names} recuperado(s)`,
      html: geoRecoveryHtml({ services: recoveredServices }),
    })
  }

  // ── Send consolidated Slack notification ──
  if (degradedServices.length > 0 || recoveredServices.length > 0) {
    const slackFields: Array<{ title: string; value: string; short?: boolean }> = []

    for (const s of degradedServices) {
      slackFields.push({
        title: `${s.icon} ${s.name}`,
        value: `🔴 Indisponível há ${s.duration}\nDetalhe: ${s.detail}`,
        short: true,
      })
    }

    for (const s of recoveredServices) {
      slackFields.push({
        title: `${s.icon} ${s.name}`,
        value: `✅ Recuperado - ${s.duration}`,
        short: true,
      })
    }

    await sendSlackNotification({
      text:
        degradedServices.length > 0
          ? `⚠️ *Geo Health Alert* — ${degradedServices.length} serviço(s) degradado(s)`
          : `✅ *Geo Health Recovery* — ${recoveredServices.length} serviço(s) recuperado(s)`,
      attachments: [
        {
          color: degradedServices.length > 0 ? "#dc2626" : "#059669",
          fields: slackFields,
        },
      ],
    })
    result.slackSent = true
  }

  // Await all notification promises before returning
  // This ensures Sentry events are recorded before callers check state
  await Promise.allSettled(notifyPromises)

  logger.info(
    {
      checked: result.checked,
      degraded: result.degraded,
      alertsSent: result.alertsSent,
      recoveriesSent: result.recoveriesSent,
      slackSent: result.slackSent,
    },
    "geo-health-alert: evaluation complete",
  )

  return result
}

/**
 * Reset all in-memory state. Useful for testing.
 */
export function resetGeoHealthState(): void {
  state.clear()
}
