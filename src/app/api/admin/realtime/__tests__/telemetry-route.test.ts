/**
 * Tests for GET /api/admin/realtime/telemetry — persisted realtime telemetry
 * (emit counters + orphan-socket signal) read from Redis.
 *
 * Coverage:
 *   1. 401/403 when requireRole rejects (admin only)
 *   2. Degradation: Redis client unavailable → { ok: false, available: false }
 *   3. Reads the minute buckets (emits hashes + multi snapshots) + the flag
 *      via a single pipeline, aggregating emits over the window
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

const { mockRequireRole, mockGetClient, mockHandleError } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockGetClient: vi.fn(),
  mockHandleError: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireRole: mockRequireRole,
}))
vi.mock("@/lib/redis", () => ({
  getClient: mockGetClient,
}))
vi.mock("@/lib/api-server", () => ({
  handleError: mockHandleError,
}))

import { GET } from "../telemetry/route"

function fakePipeline(results: Array<[Error | null, unknown]>) {
  // A route encadeia hgetall/get no pipeline ANTES do exec — o fake precisa
  // dos mesmos métodos (chainable) para o teste chegar ao exec.
  const p = {
    hgetall: vi.fn(() => p),
    get: vi.fn(() => p),
    exec: vi.fn().mockResolvedValue(results),
  }
  return p
}

function fakeClient(pipeline: { exec: ReturnType<typeof vi.fn> }) {
  return { multi: vi.fn(() => pipeline) }
}

const ADMIN = { userId: "admin-1", role: "ADMIN" }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/admin/realtime/telemetry", () => {
  it("rejeita sem role ADMIN (requireRole lança → handleError)", async () => {
    mockRequireRole.mockRejectedValue(new Error("UNAUTHORIZED"))
    mockHandleError.mockReturnValue(NextResponse.json({ error: "Não autorizado" }, { status: 401 }))

    const res = await GET(new Request("http://localhost/api/admin/realtime/telemetry"))
    expect(res.status).toBe(401)
    expect(mockHandleError).toHaveBeenCalled()
  })

  it("degradação graciosa: Redis indisponível → ok:false, available:false", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)
    mockGetClient.mockReturnValue(null)

    const res = await GET(new Request("http://localhost/api/admin/realtime/telemetry"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ ok: false, available: false, emits: {}, multi: [], flag: false })
  })

  it("agrega os buckets da janela (emits por evento) + série multi + flag", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)

    const bucketNow = Math.floor(Date.now() / 60_000)
    const bucketPrev = bucketNow - 1
    const multiNow = JSON.stringify({
      total: 4,
      byRole: { PROVIDER: 4 },
      usersWithMultipleSockets: 2,
      maxSocketsPerUser: 3,
    })
    const multiPrev = JSON.stringify({
      total: 1,
      byRole: { CLIENT: 1 },
      usersWithMultipleSockets: 0,
      maxSocketsPerUser: 1,
    })

    // minutes=2 → comandos: hgetall(prev), get(prev), hgetall(now), get(now), get(flag)
    const results: Array<[Error | null, unknown]> = [
      [null, { "notification:new": "5" }],
      [null, multiPrev],
      [null, { "notification:new": "2", "booking:update": "1" }],
      [null, multiNow],
      [null, "1"],
    ]
    mockGetClient.mockReturnValue(fakeClient(fakePipeline(results)))

    const res = await GET(new Request("http://localhost/api/admin/realtime/telemetry?minutes=2"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      available: boolean
      minutes: number
      emits: Record<string, number>
      multi: Array<{ bucket: number; usersWithMultipleSockets: number; total: number }>
      flag: boolean
    }

    expect(body.ok).toBe(true)
    expect(body.available).toBe(true)
    expect(body.minutes).toBe(2)
    // Soma dos dois buckets da janela.
    expect(body.emits).toEqual({ "notification:new": 7, "booking:update": 1 })
    // Série ordenada oldest → newest, com o bucket derivado.
    expect(body.multi).toHaveLength(2)
    expect(body.multi[0]!.bucket).toBe(bucketPrev)
    expect(body.multi[0]!.usersWithMultipleSockets).toBe(0)
    expect(body.multi[1]!.bucket).toBe(bucketNow)
    expect(body.multi[1]!.usersWithMultipleSockets).toBe(2)
    expect(body.multi[1]!.total).toBe(4)
    expect(body.flag).toBe(true)
  })

  it("flag false quando o Redis não tem o sinal; buckets corrompidos são ignorados", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)
    const bucketNow = Math.floor(Date.now() / 60_000)
    const results: Array<[Error | null, unknown]> = [
      [null, { "message:send": "3" }],
      [null, "not-json{"], // bucket corrompido → ignorado
      [null, null], // flag ausente
    ]
    mockGetClient.mockReturnValue(fakeClient(fakePipeline(results)))

    const res = await GET(new Request("http://localhost/api/admin/realtime/telemetry?minutes=1"))
    const body = (await res.json()) as {
      emits: Record<string, number>
      multi: Array<unknown>
      flag: boolean
    }
    expect(body.emits).toEqual({ "message:send": 3 })
    expect(body.multi).toHaveLength(0)
    expect(body.flag).toBe(false)
    expect(bucketNow).toBeGreaterThan(0)
  })

  it("clampa minutes ao range [1, 1440]", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)
    // results com o tamanho exato dos comandos do pipeline: 2×minutes + 1.
    const emptyResults = (n: number): Array<[Error | null, unknown]> =>
      Array.from({ length: n }, () => [null, null] as [Error | null, unknown])
    mockGetClient
      .mockReturnValueOnce(fakeClient(fakePipeline(emptyResults(1440 * 2 + 1))))
      .mockReturnValueOnce(fakeClient(fakePipeline(emptyResults(1 * 2 + 1))))

    const resMax = await GET(
      new Request("http://localhost/api/admin/realtime/telemetry?minutes=999999"),
    )
    expect(((await resMax.json()) as { minutes: number }).minutes).toBe(1440)

    const resMin = await GET(new Request("http://localhost/api/admin/realtime/telemetry?minutes=0"))
    expect(((await resMin.json()) as { minutes: number }).minutes).toBe(1)
  })
})
