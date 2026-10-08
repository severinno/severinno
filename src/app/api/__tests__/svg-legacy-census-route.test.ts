/**
 * Tests for GET /api/cron/svg-legacy-census — censo semanal de SVG legado.
 *
 * A rota roda o reprocess-svg-uploads.ts em DRY-RUN (leitura pura) contra o
 * bucket e ALERTA (notifyGeoAlert + logger.warn) se svgFound > 0. O alarme
 * dispara toda semana até a remediação (--apply na VPS) zerar a contagem.
 *
 * Cobertura:
 *   - 401 fail-closed (sem header / sem CRON_SECRET configurado)
 *   - svgFound = 0 → alerted=false, NENHUM alerta enviado
 *   - svgFound > 0 → alerted=true, notifyGeoAlert com tag estável e plano
 *     de remediação no corpo, logger.warn com o número
 *   - DRY-RUN permanente: adapter NUNCA grava (put/copy/del ausentes no
 *     caminho delete dry-run) e a rota sempre passa apply:false
 *   - params: prefix/max repassados ao censo
 *   - erro do bucket → 500 com mensagem (degradação honesta)
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { runReprocess, buildS3Adapter, notifyGeoAlert } = vi.hoisted(() => ({
  // O runReprocess é MOCKADO (a rota o chama via import lazy do script real):
  // o comportamento do script em si já é coberto pelo
  // reprocess-svg-uploads.test.ts; aqui interessa a FIAÇÃO da rota.
  runReprocess: vi.fn(),
  buildS3Adapter: vi.fn(() => ({ __fake: "adapter" })),
  notifyGeoAlert: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

// O wrapper withRoute (api-route.ts) consulta o gate de manutenção ANTES do
// handler; a leitura dinâmica da chave usa o db — fora do escopo deste teste
// (o contrato do gate é da suíte maintenance-mode). Sem o dublê, o findUnique
// do db REAL explode e o warn fail-safe do gate polui as asserções de log.
vi.mock("@/lib/maintenance-mode", () => ({
  requireMaintenanceAccessible: vi.fn(async () => {}),
}))

vi.mock("@/lib/geo-alert-notify", () => ({
  notifyGeoAlert,
}))

// O import lazy da rota aponta para o SCRIPT real — mockamos o módulo dele
// (o reprocess-svg-uploads.test.ts prova as funções; aqui provamos o uso).
// 4 níveis: src/app/api/__tests__ → src/app/api → src/app → src → RAIZ.
// (a rota usa 5 níveis porque vive um diretório mais fundo; vi.mock resolve
// relativo a ESTE arquivo — níveis errados registram mock num path fantasma
// fora do projeto e a rota carregaria o módulo REAL).
vi.mock("../../../../scripts/reprocess-svg-uploads", () => ({
  runReprocess,
  buildS3Adapter,
}))

// withRoute real: o guard check-route-handler-style exige o wrapper; o teste
// o executa de verdade (o comportamento de tracing é coberto no teste dele).
vi.mock("@/lib/api-route", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-route")>()),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../cron/svg-legacy-census/route"
import logger from "@/lib/logger"

const _origCronSecret = process.env.CRON_SECRET

function req(headers?: Record<string, string>, query = ""): Request {
  return new Request(`http://localhost:3000/api/cron/svg-legacy-census${query}`, { headers })
}

function summaryOf(overrides: Record<string, unknown> = {}) {
  return {
    mode: "delete",
    dryRun: true,
    scanned: 100,
    svgFound: 0,
    notSvg: 100,
    skippedTooLarge: 0,
    converted: 0,
    deleted: 0,
    wouldConvert: 0,
    wouldDelete: 0,
    failed: 0,
    errors: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = "test-cron-secret"
  // A rota encadeia .catch no retorno — o mock precisa ser uma promessa.
  notifyGeoAlert.mockResolvedValue(undefined)
})

afterAll(() => {
  process.env.CRON_SECRET = _origCronSecret
})

// ── Auth ───────────────────────────────────────────────────────────────────

describe("auth fail-closed", () => {
  it("401 sem header Authorization — e NÃO roda o censo", async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(runReprocess).not.toHaveBeenCalled()
  })

  it("401 com Bearer errado", async () => {
    const res = await GET(req({ Authorization: "Bearer wrong" }))
    expect(res.status).toBe(401)
    expect(runReprocess).not.toHaveBeenCalled()
  })

  it("401 quando CRON_SECRET não está configurado (fail-closed)", async () => {
    process.env.CRON_SECRET = ""
    const res = await GET(req({ Authorization: "Bearer test-cron-secret" }))
    expect(res.status).toBe(401)
    expect(runReprocess).not.toHaveBeenCalled()
  })
})

// ── Censo limpo vs sujo ────────────────────────────────────────────────────

describe("censo semanal", () => {
  it("svgFound = 0 → alerted=false e NENHUM alerta (bucket limpo é silencioso)", async () => {
    runReprocess.mockResolvedValue(summaryOf({ svgFound: 0, scanned: 1234 }))

    const res = await GET(req({ Authorization: "Bearer test-cron-secret" }))
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.svgFound).toBe(0)
    expect(body.alerted).toBe(false)
    expect(body.scanned).toBe(1234)
    expect(notifyGeoAlert).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("svgFound > 0 → alerted=true, notifyGeoAlert com tag estável e plano no corpo", async () => {
    runReprocess.mockResolvedValue(
      summaryOf({ svgFound: 7, scanned: 500, errors: [{ key: "a", error: "x" }] }),
    )

    const res = await GET(req({ Authorization: "Bearer test-cron-secret" }))
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.svgFound).toBe(7)
    expect(body.alerted).toBe(true)

    expect(notifyGeoAlert).toHaveBeenCalledTimes(1)
    const payload = notifyGeoAlert.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.tag).toBe("svg-legacy:census")
    expect(payload.severity).toBe("warning")
    expect(String(payload.title)).toContain("7")
    // O alerta carrega o COMANDO da remediação — quem acorda de madrugada
    // precisa do próximo passo, não de uma contagem solta.
    expect(String(payload.body)).toContain("--apply")
    expect(payload.context).toMatchObject({ svgFound: 7, scanned: 500 })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ svgFound: 7, scanned: 500 }),
      expect.stringContaining("remediação pendente"),
    )
  })

  it("DRY-RUN permanente: roda sempre com apply:false e mode delete (sem sharp)", async () => {
    runReprocess.mockResolvedValue(summaryOf())

    await GET(req({ Authorization: "Bearer test-cron-secret" }))

    expect(runReprocess).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "delete", apply: false }),
      expect.anything(),
      expect.anything(),
    )
    expect(buildS3Adapter).toHaveBeenCalledTimes(1)
  })

  it("params: prefix e max são repassados ao censo", async () => {
    runReprocess.mockResolvedValue(summaryOf())

    await GET(req({ Authorization: "Bearer test-cron-secret" }, "?prefix=uploads%2F&max=500"))

    expect(runReprocess).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "uploads/", maxObjects: 500 }),
      expect.anything(),
      expect.anything(),
    )
  })

  it("erro do bucket → 500 (degradação honesta, não silêncio; detalhe vai no log do withRoute)", async () => {
    runReprocess.mockRejectedValue(new Error("NoSuchBucket"))

    const res = await GET(req({ Authorization: "Bearer test-cron-secret" }))
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(500)
    expect(typeof body.error).toBe("string")
  })
})
