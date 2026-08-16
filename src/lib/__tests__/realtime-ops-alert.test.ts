/**
 * Tests for mini-services/realtime/ops-alert.ts
 *
 * Covers: DSN parsing, envelope building (Sentry v7 contract), env parsers,
 * and the orphan-alert scheduler (threshold crossing + cooldown + recovery)
 * with injected clock/sender — no network.
 */

import { describe, it, expect, vi } from "vitest"
import {
  parseDsn,
  buildEnvelopeUrl,
  buildSentryEnvelope,
  generateEventId,
  parseOrphanAlertThreshold,
  parseOrphanAlertCooldownMs,
  createOrphanAlert,
  type EnvelopeSender,
} from "../../../mini-services/realtime/ops-alert"
import type { TelemetrySessionsSnapshot } from "../../../mini-services/realtime/redis-telemetry"

const FLAT: TelemetrySessionsSnapshot = {
  total: 2,
  byRole: { PROVIDER: 2 },
  usersWithMultipleSockets: 0,
  maxSocketsPerUser: 1,
}
const ORPHAN: TelemetrySessionsSnapshot = {
  total: 4,
  byRole: { PROVIDER: 4 },
  usersWithMultipleSockets: 2,
  maxSocketsPerUser: 3,
}

// ---------------------------------------------------------------------------
// DSN + envelope (pure)
// ---------------------------------------------------------------------------

describe("parseDsn / buildEnvelopeUrl", () => {
  it("parseia um DSN Sentry/GlitchTip padrão", () => {
    expect(parseDsn("https://publicKey123@glitchtip.example.com/42")).toEqual({
      protocol: "https",
      host: "glitchtip.example.com",
      key: "publicKey123",
      projectId: "42",
    })
  })

  it("mantém porta e aceita http", () => {
    expect(parseDsn("http://key@localhost:9999/1")).toEqual({
      protocol: "http",
      host: "localhost:9999",
      key: "key",
      projectId: "1",
    })
  })

  it("retorna null para DSN inválido/ausente", () => {
    expect(parseDsn(undefined)).toBeNull()
    expect(parseDsn("")).toBeNull()
    expect(parseDsn("not-a-url")).toBeNull()
    expect(parseDsn("https://host-only-no-path")).toBeNull()
  })

  it("buildEnvelopeUrl monta o endpoint de ingest do envelope", () => {
    const dsn = parseDsn("https://key@glitchtip.example.com/42")!
    expect(buildEnvelopeUrl(dsn)).toBe("https://glitchtip.example.com/api/42/envelope/")
  })
})

describe("buildSentryEnvelope (contrato Sentry v7)", () => {
  it("serializa header + item com length em BYTES e os campos do evento", () => {
    const env = buildSentryEnvelope({
      eventId: "a".repeat(32),
      sentAt: "2026-08-16T12:00:00.000Z",
      level: "error",
      message: "socket órfão detectado",
      extra: { tag: "realtime:orphan-sockets", usersWithMultipleSockets: 2 },
    })

    const [headerLine, itemLine, payloadLine] = env.split("\n")
    const header = JSON.parse(headerLine!)
    expect(header.event_id).toBe("a".repeat(32))
    expect(header.sent_at).toBe("2026-08-16T12:00:00.000Z")
    // Identidade do SDK travada — fonte única SDK_NAME/SDK_VERSION/SDK_IDENT
    // (drift aqui quebraria a consistência com o X-Sentry-Auth).
    expect(header.sdk).toEqual({ name: "realtime-mini-service", version: "1.0.0" })

    const item = JSON.parse(itemLine!)
    expect(item.type).toBe("event")
    // O length DEVE ser o byte length do payload (Sentry rejeita se errado).
    expect(item.length).toBe(Buffer.byteLength(payloadLine!))

    const payload = JSON.parse(payloadLine!)
    expect(payload.level).toBe("error")
    expect(payload.message).toBe("socket órfão detectado")
    expect(payload.extra.usersWithMultipleSockets).toBe(2)
    expect(payload.platform).toBe("javascript")
  })

  it("generateEventId devolve 32 chars hex", () => {
    expect(generateEventId()).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe("env parsers (threshold/cooldown)", () => {
  it("parseOrphanAlertThreshold: default 0, clamp >= 0, floor", () => {
    expect(parseOrphanAlertThreshold(undefined)).toBe(0)
    expect(parseOrphanAlertThreshold("abc")).toBe(0)
    expect(parseOrphanAlertThreshold("0")).toBe(0)
    expect(parseOrphanAlertThreshold("3")).toBe(3)
    expect(parseOrphanAlertThreshold("2.9")).toBe(2)
    expect(parseOrphanAlertThreshold("-1")).toBe(0)
  })

  it("parseOrphanAlertCooldownMs: default 15min, clamp >= 60s", () => {
    expect(parseOrphanAlertCooldownMs(undefined)).toBe(15 * 60_000)
    expect(parseOrphanAlertCooldownMs("0")).toBe(15 * 60_000)
    expect(parseOrphanAlertCooldownMs("abc")).toBe(15 * 60_000)
    expect(parseOrphanAlertCooldownMs("120000")).toBe(120_000)
    expect(parseOrphanAlertCooldownMs("5000")).toBe(60_000) // clamp
  })
})

// ---------------------------------------------------------------------------
// Scheduler (threshold crossing + cooldown + recovery)
// ---------------------------------------------------------------------------

function makeScheduler(opts: {
  sender?: EnvelopeSender
  now?: () => number
  threshold?: number
  cooldownMs?: number
}) {
  const sender =
    opts.sender ??
    (async () => {
      /* no-op */
    })
  const now = opts.now ?? (() => 0)
  return createOrphanAlert({
    dsn: { protocol: "https", host: "glitchtip.example.com", key: "k", projectId: "1" },
    threshold: opts.threshold ?? 0,
    cooldownMs: opts.cooldownMs ?? 15 * 60_000,
    now,
    send: sender,
  })
}

describe("createOrphanAlert", () => {
  it("não alerta abaixo do threshold", async () => {
    const sender = vi.fn<EnvelopeSender>()
    const alert = makeScheduler({ sender })
    await alert.evaluate(FLAT)
    expect(sender).not.toHaveBeenCalled()
  })

  it("alerta na CROSSING do threshold (usersWithMultipleSockets > N) com level error", async () => {
    const sender = vi.fn<EnvelopeSender>()
    const alert = makeScheduler({ sender, threshold: 1 })
    await alert.evaluate(FLAT) // 0 > 1? não
    await alert.evaluate(ORPHAN) // 2 > 1 → crossing
    expect(sender).toHaveBeenCalledTimes(1)
    const [url, envelope] = sender.mock.calls[0]!
    expect(url).toBe("https://glitchtip.example.com/api/1/envelope/")
    expect(envelope).toContain('"level":"error"')
    expect(envelope).toContain("socket órfão")
    expect(envelope).toContain('"usersWithMultipleSockets":2')
  })

  it("cooldown: não re-alerta enquanto persistir dentro da janela; re-alerta após", async () => {
    const sender = vi.fn<EnvelopeSender>()
    let t = 0
    const alert = makeScheduler({ sender, cooldownMs: 60_000, now: () => t })
    await alert.evaluate(ORPHAN) // crossing em t=0
    t = 30_000
    await alert.evaluate(ORPHAN) // dentro do cooldown → sem novo alerta
    expect(sender).toHaveBeenCalledTimes(1)
    t = 60_000
    await alert.evaluate(ORPHAN) // cooldown vencido → re-alerta
    expect(sender).toHaveBeenCalledTimes(2)
  })

  it("recovery: alerta info quando cai de volta (uma vez por cooldown)", async () => {
    const sender = vi.fn<EnvelopeSender>()
    let t = 0
    const alert = makeScheduler({ sender, now: () => t })
    await alert.evaluate(ORPHAN) // crossing
    t = 61_000
    await alert.evaluate(FLAT) // recovery
    expect(sender).toHaveBeenCalledTimes(2)
    expect(sender.mock.calls[1]![1]).toContain('"level":"info"')
    expect(sender.mock.calls[1]![1]).toContain("resolvidos")
    // Sem novo recovery dentro do cooldown se voltar e cair de novo rápido.
    t = 62_000
    await alert.evaluate(ORPHAN) // re-crossing (crossing tem cooldown próprio → alerta)
    expect(sender).toHaveBeenCalledTimes(3)
    t = 63_000
    await alert.evaluate(FLAT) // recovery dentro do cooldown do recovery → sem
    expect(sender).toHaveBeenCalledTimes(3)
  })

  it("fail-open: sem DSN → resolve sem lançar e sem enviar", async () => {
    const alert = createOrphanAlert({ dsn: null, now: () => 0 })
    await expect(alert.evaluate(ORPHAN)).resolves.toBeUndefined()
  })

  it("fail-open: sender rejeita → resolve sem lançar (log dedup)", async () => {
    const sender = vi.fn<EnvelopeSender>().mockRejectedValue(new Error("webhook down"))
    const alert = makeScheduler({ sender })
    await expect(alert.evaluate(ORPHAN)).resolves.toBeUndefined()
    expect(sender).toHaveBeenCalledTimes(1)
  })
})
