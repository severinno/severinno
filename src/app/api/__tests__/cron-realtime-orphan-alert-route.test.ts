/**
 * Tests for GET /api/cron/realtime-orphan-alert — alert job for PERSISTED
 * orphan sockets (flag realtime:telemetry:multi:flag + N consecutive buckets).
 *
 * Covers:
 *   - readOrphanPersistence (pure): N buckets confirm → persisted; missing
 *     bucket / corrupt JSON → NOT confirmed (fail-closed); snapshots newest-first
 *   - Flag ausente → completed, alerted:false (reason flag-clear), sem notify
 *   - Flag ativa + N buckets confirmam → alerted:true, notify chamado (Sentry
 *     + email), markCompleted chamado
 *   - Persistência insuficiente (só 2 de 5 buckets) → reason not-persisted
 *   - dryRun=1 → alerted:true reportado mas SEM notify e SEM markCompleted
 *   - Cooldown ativo → skipped (sem leitura, sem notify)
 *   - Redis fora (client null) → completed fail-open, sem notify
 *   - 401 quando CRON_SECRET setado e Bearer falta/errado
 *   - Acesso permitido quando CRON_SECRET é vazio
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

// ── Hoisted mocks (vi.mock factories run before static imports resolve) ────

const {
  mockGetClient,
  mockIsCooldownElapsed,
  mockMarkCompleted,
  mockCaptureMessage,
  mockSendMail,
} = vi.hoisted(() => {
  const client = vi.fn()
  const cooldown = vi.fn().mockResolvedValue(true)
  const mark = vi.fn().mockResolvedValue(undefined)
  const capture = vi.fn()
  const mail = vi.fn().mockResolvedValue(undefined)
  return {
    mockGetClient: client,
    mockIsCooldownElapsed: cooldown,
    mockMarkCompleted: mark,
    mockCaptureMessage: capture,
    mockSendMail: mail,
  }
})

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/redis", () => ({
  getClient: mockGetClient,
}))

vi.mock("@/lib/cron-cooldown", () => ({
  isCooldownElapsed: mockIsCooldownElapsed,
  markCompleted: mockMarkCompleted,
}))

vi.mock("@/lib/sentry", () => ({
  captureMessage: mockCaptureMessage,
}))

vi.mock("@/lib/mail", () => ({
  sendMail: mockSendMail,
}))

// ── Imports (must come after vi.mock) ──────────────────────────────────────

import {
  GET,
  readOrphanPersistence,
  buildMultiBucketKey,
  parseOrphanAlertMinutes,
  parseOrphanAlertCooldownMs,
} from "../cron/realtime-orphan-alert/route"

// ── Helpers ────────────────────────────────────────────────────────────────

const CRON_URL = "http://localhost/api/cron/realtime-orphan-alert"
const BEARER = { authorization: "Bearer my-cron-secret" }

// Clock FIXO: os testes usam um nowMs determinístico (relógio injetável do
// engine e nowMs explícito no readOrphanPersistence) — elimina o flake de
// cruzar a virada de minuto entre montar o map e a leitura. Os testes de ROTA
// ainda congelam o relógio real com vi.useFakeTimers({ now }) para o
// Date.now() interno do GET() coincidir com as chaves do mapa.
const FIXED_NOW_MS = 1_752_000_000_000 // 2025-07-09T12:00:00.000Z (epoch fixo)
const FIXED_BUCKET_NOW = Math.floor(FIXED_NOW_MS / 60_000)

/** Bucket key de `minutesAgo` atrás (relativo ao clock FIXO do teste). */
function bucketKey(minutesAgo: number): string {
  return buildMultiBucketKey(FIXED_BUCKET_NOW - minutesAgo)
}

function snapshotJson(usersWithMultipleSockets: number, total = 6): string {
  return JSON.stringify({
    total,
    byRole: { PROVIDER: total },
    usersWithMultipleSockets,
    maxSocketsPerUser: usersWithMultipleSockets > 0 ? 2 : 1,
  })
}

/** Fake client com mapa de chaves → valor (get resolve o valor ou null). */
function fakeClient(map: Record<string, string>) {
  return {
    get: vi.fn(async (key: string): Promise<string | null> => map[key] ?? null),
  }
}

function orphanMap(minutes: number, usersWithMultipleSockets = 2): Record<string, string> {
  const map: Record<string, string> = { "realtime:telemetry:multi:flag": "1" }
  for (let i = 0; i < minutes; i++) map[bucketKey(i)] = snapshotJson(usersWithMultipleSockets)
  return map
}

const _origCronSecret = process.env.CRON_SECRET
const _origAdminEmail = process.env.ADMIN_EMAIL

// ── Tests ──────────────────────────────────────────────────────────────────

describe("readOrphanPersistence — persistência (função pura)", () => {
  it("todos os N buckets confirmam órfãos → persisted:true com latest do mais recente", async () => {
    const client = fakeClient({
      [bucketKey(0)]: snapshotJson(2),
      [bucketKey(1)]: snapshotJson(3),
      [bucketKey(2)]: snapshotJson(1),
    })

    const res = await readOrphanPersistence(client, 3, FIXED_NOW_MS)

    expect(res.persisted).toBe(true)
    expect(res.confirmed).toBe(3)
    // Mais recente confirmado primeiro (bucket atual → usersWithMultipleSockets=2)
    expect(res.latest?.usersWithMultipleSockets).toBe(2)
    expect(client.get).toHaveBeenCalledTimes(3)
  })

  it("bucket ausente → NÃO confirmado (fail-closed na evidência)", async () => {
    const client = fakeClient({
      [bucketKey(0)]: snapshotJson(2),
      // bucketKey(1) ausente — o realtime não gravou naquele minuto
      [bucketKey(2)]: snapshotJson(1),
    })

    const res = await readOrphanPersistence(client, 3, FIXED_NOW_MS)

    expect(res.persisted).toBe(false)
    expect(res.confirmed).toBe(2)
  })

  it("JSON corrompido → tratado como ausente (fail-closed)", async () => {
    const client = fakeClient({
      [bucketKey(0)]: snapshotJson(2),
      [bucketKey(1)]: "{corrompido",
      [bucketKey(2)]: snapshotJson(1),
    })

    const res = await readOrphanPersistence(client, 3, FIXED_NOW_MS)

    expect(res.persisted).toBe(false)
    expect(res.confirmed).toBe(2)
  })

  it("bucket com usersWithMultipleSockets=0 → NÃO confirma", async () => {
    const client = fakeClient({
      [bucketKey(0)]: snapshotJson(0), // minuto sem órfãos — quebra a cadeia
      [bucketKey(1)]: snapshotJson(2),
      [bucketKey(2)]: snapshotJson(1),
    })

    const res = await readOrphanPersistence(client, 3, FIXED_NOW_MS)

    expect(res.persisted).toBe(false)
    expect(res.confirmed).toBe(2)
    expect(res.latest?.usersWithMultipleSockets).toBe(2)
  })
})

describe("parseOrphanAlertMinutes / parseOrphanAlertCooldownMs — env guard", () => {
  it("missing/empty/NaN → fallback", () => {
    expect(parseOrphanAlertMinutes(undefined)).toBe(5)
    expect(parseOrphanAlertMinutes("")).toBe(5)
    expect(parseOrphanAlertMinutes("abc")).toBe(5)
    expect(parseOrphanAlertCooldownMs(undefined)).toBe(60 * 60 * 1000)
  })

  it("clamp: min 1 / max 1440; cooldown min 60s", () => {
    expect(parseOrphanAlertMinutes("0")).toBe(1)
    expect(parseOrphanAlertMinutes("-3")).toBe(1)
    expect(parseOrphanAlertMinutes("99999")).toBe(1440)
    expect(parseOrphanAlertCooldownMs("1000")).toBe(60_000)
  })

  it("valores válidos passam", () => {
    expect(parseOrphanAlertMinutes("10")).toBe(10)
    expect(parseOrphanAlertCooldownMs("900000")).toBe(900_000)
  })
})

describe("GET /api/cron/realtime-orphan-alert", () => {
  beforeEach(() => {
    // Congela o relógio real: o GET() chama runRealtimeOrphanAlert({dryRun})
    // SEM now injetado → Date.now() interno precisa bater com as chaves do
    // mapa (FIXED_BUCKET_NOW). Sem fake timers, os testes de rota leriam
    // buckets do relógio real ≠ chaves fixas → persisted:false (falha).
    vi.useFakeTimers({ now: FIXED_NOW_MS })
    process.env.CRON_SECRET = "my-cron-secret"
    process.env.ADMIN_EMAIL = "ops@severinno.com"
    mockGetClient.mockReset()
    mockIsCooldownElapsed.mockClear().mockResolvedValue(true)
    mockMarkCompleted.mockClear()
    mockCaptureMessage.mockClear()
    mockSendMail.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    vi.useRealTimers()
    process.env.CRON_SECRET = _origCronSecret
    process.env.ADMIN_EMAIL = _origAdminEmail
  })

  it("flag ausente → completed sem alerta (reason flag-clear), sem notify", async () => {
    mockGetClient.mockReturnValue(fakeClient({}))

    const res = await GET(new Request(CRON_URL, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.status).toBe("completed")
    expect(data.alerted).toBe(false)
    expect(data.reason).toBe("flag-clear")
    expect(data.flag).toBe(false)
    expect(mockCaptureMessage).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
    expect(mockMarkCompleted).not.toHaveBeenCalled()
  })

  it("flag ativa + N buckets confirmam → alerted:true, Sentry + email, markCompleted", async () => {
    mockGetClient.mockReturnValue(fakeClient(orphanMap(5)))

    const res = await GET(new Request(CRON_URL, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.alerted).toBe(true)
    expect(data.reason).toBe("alerted")
    expect(data.available).toBe(true)
    expect(data.flag).toBe(true)
    expect(data.persisted).toBe(true)
    expect(data.minutes).toBe(5)
    expect(data.confirmed).toBe(5)
    expect(data.latest).toBe(2)
    // Sentry (captureMessage) + email (sendMail para ADMIN_EMAIL)
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("múltiplos sockets"),
      "error",
      expect.objectContaining({ source: "realtime-orphan-alert", minutes: 5 }),
    )
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "ops@severinno.com" }))
    // Cooldown marcado SÓ em alerta real
    expect(mockMarkCompleted).toHaveBeenCalledWith("realtime-orphan-alert", expect.any(Number))
  })

  it("flag ativa mas persistência insuficiente (2 de 5 buckets) → reason not-persisted", async () => {
    const map: Record<string, string> = { "realtime:telemetry:multi:flag": "1" }
    map[bucketKey(0)] = snapshotJson(2)
    map[bucketKey(1)] = snapshotJson(2)
    mockGetClient.mockReturnValue(fakeClient(map))

    const res = await GET(new Request(CRON_URL, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.alerted).toBe(false)
    expect(data.reason).toBe("not-persisted")
    expect(data.persisted).toBe(false)
    expect(data.confirmed).toBe(2)
    expect(mockCaptureMessage).not.toHaveBeenCalled()
    expect(mockMarkCompleted).not.toHaveBeenCalled()
  })

  it("dryRun reporta o que seria alertado sem notificar nem marcar cooldown", async () => {
    mockGetClient.mockReturnValue(fakeClient(orphanMap(5)))

    const res = await GET(new Request(`${CRON_URL}?dryRun=1`, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.dryRun).toBe(true)
    expect(data.alerted).toBe(true) // reportaria o alerta…
    expect(mockCaptureMessage).not.toHaveBeenCalled() // …mas não notifica
    expect(mockSendMail).not.toHaveBeenCalled()
    expect(mockMarkCompleted).not.toHaveBeenCalled()
  })

  it("cooldown ativo → skipped sem ler Redis nem notificar", async () => {
    mockIsCooldownElapsed.mockResolvedValueOnce(false)

    const res = await GET(new Request(CRON_URL, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.status).toBe("skipped")
    expect(data.reason).toBe("cooldown")
    expect(mockGetClient).not.toHaveBeenCalled()
    expect(mockCaptureMessage).not.toHaveBeenCalled()
    expect(mockMarkCompleted).not.toHaveBeenCalled()
  })

  it("Redis fora (client null) → completed fail-open, reason redis-unavailable, available:false", async () => {
    mockGetClient.mockReturnValue(null)

    const res = await GET(new Request(CRON_URL, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.alerted).toBe(false)
    expect(data.available).toBe(false)
    expect(data.reason).toBe("redis-unavailable")
    expect(data.flag).toBe(false)
    expect(mockCaptureMessage).not.toHaveBeenCalled()
    expect(mockMarkCompleted).not.toHaveBeenCalled()
  })

  it("leitura falha (get rejeita) → completed fail-open, reason redis-unavailable, sem notificar", async () => {
    const client = fakeClient({})
    client.get.mockRejectedValueOnce(new Error("redis timeout"))
    mockGetClient.mockReturnValue(client)

    const res = await GET(new Request(CRON_URL, { headers: BEARER }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.alerted).toBe(false)
    expect(data.available).toBe(false)
    expect(data.reason).toBe("redis-unavailable")
    expect(mockCaptureMessage).not.toHaveBeenCalled()
    expect(mockMarkCompleted).not.toHaveBeenCalled()
  })

  it("retorna 401 quando CRON_SECRET está setado e o Bearer falta", async () => {
    const res = await GET(new Request(CRON_URL))
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error).toBe("Unauthorized")
    expect(mockGetClient).not.toHaveBeenCalled()
  })

  it("retorna 401 quando o Bearer está errado", async () => {
    const res = await GET(new Request(CRON_URL, { headers: { authorization: "Bearer wrong" } }))
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error).toBe("Unauthorized")
  })

  it("permite acesso quando CRON_SECRET é vazio (sem auth configurado)", async () => {
    process.env.CRON_SECRET = ""
    mockGetClient.mockReturnValue(fakeClient({}))

    const res = await GET(new Request(CRON_URL))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.status).toBe("completed")
  })

  it("aceita clock injetável (now) — bucket relativo ao nowMs do teste, determinístico", async () => {
    // Chama a engine DIRETAMENTE (não a rota) com now fixo + notify espião:
    // prova que o relógio injetável é usado no readOrphanPersistence e que o
    // notify recebe o snapshot do bucket mais recente. Fake timers liberados
    // aqui (now explícito dispensa congelar o relógio global).
    vi.useRealTimers()
    const notify = vi.fn().mockResolvedValue(undefined)
    const { runRealtimeOrphanAlert } = await import("@/lib/realtime-orphan-alert")
    mockGetClient.mockReturnValue(fakeClient(orphanMap(5)))

    const res = await runRealtimeOrphanAlert({
      dryRun: false,
      now: () => FIXED_NOW_MS,
      notify,
    })

    expect(res.ok).toBe(true)
    if (res.ok && res.status === "completed") {
      expect(res.alerted).toBe(true)
      expect(res.available).toBe(true)
      expect(res.latest).toBe(2)
    }
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        minutes: 5,
        latest: expect.objectContaining({ usersWithMultipleSockets: 2 }),
      }),
    )
  })
})
