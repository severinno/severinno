/**
 * route.test.ts — POST /api/rum/vitrine
 *
 * O endpoint é o consumidor dos beacons de RUM das medidas User Timing da
 * paginação (src/lib/vitrine-rum.ts → log estruturado).
 *
 * Coverage:
 *   ✅ 204 + log estruturado para payload válido (campos EXATAMENTE os da whitelist)
 *   ✅ SEM PII: campo extra do beacon é DESCARTADO no parse — o log carrega
 *      só a whitelist (o corpo cru nunca é logado, nem no payload inválido)
 *   ✅ 204 silencioso para inválido (nome desconhecido, duração negativa,
 *      target fora do range, entries vazio/excedido, JSON quebrado, body gigante)
 *   ✅ RUM nunca sinaliza erro: resposta 204 SEM CORPO em todo caminho
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

// O wrapper withRoute (api-route.ts) consulta o gate de manutenção ANTES do
// handler; a leitura dinâmica da chave usa o db — fora do escopo deste teste
// (o contrato do gate é da suíte maintenance-mode). Dublê fail-closed: chave
// LIGADA faria o teste ver 503 em vez do contrato da rota.
vi.mock("@/lib/maintenance-mode", () => ({
  requireMaintenanceAccessible: vi.fn(async () => {}),
}))

import logger from "@/lib/logger"
import { POST } from "@/app/api/rum/vitrine/route"

const VITRINE_URL = "http://localhost:3000/api/rum/vitrine"

function beacon(entries: unknown, extraHeaders?: Record<string, string>): Request {
  return new Request(VITRINE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(entries),
  })
}

const ENTRADA_VALIDA = {
  name: "vitrine:pagina:render",
  duration: 110.4,
  target: 3,
  direction: "proxima",
  warm: true,
  inFlight: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/rum/vitrine — payload válido", () => {
  it("204 sem corpo + log estruturado com a medida", async () => {
    const res = await POST(beacon({ entries: [ENTRADA_VALIDA] }))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe("")

    expect(logger.info).toHaveBeenCalledTimes(1)
    const [campo, msg] = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(campo.count).toBe(1)
    expect(campo.rum).toEqual([ENTRADA_VALIDA])
    expect(msg).toContain("1 medida")
  })

  it("batch de até 20 medidas loga todas (a caminhada rápida fecha exato em 5)", async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ ...ENTRADA_VALIDA, target: i + 1 }))
    const res = await POST(beacon({ entries }))
    expect(res.status).toBe(204)
    expect((logger.info as ReturnType<typeof vi.fn>).mock.calls[0][0].count).toBe(20)
  })

  it("campos opcionais ausentes passam (walk reverso só tem target)", async () => {
    const res = await POST(
      beacon({ entries: [{ name: "vitrine:walk:render", duration: 238.6, target: 2 }] }),
    )
    expect(res.status).toBe(204)
    expect((logger.info as ReturnType<typeof vi.fn>).mock.calls[0][0].rum).toEqual([
      { name: "vitrine:walk:render", duration: 238.6, target: 2 },
    ])
  })
})

describe("POST /api/rum/vitrine — SEM PII", () => {
  it("campo extra do beacon é descartado: o log carrega SÓ a whitelist", async () => {
    const res = await POST(
      beacon({
        entries: [
          {
            ...ENTRADA_VALIDA,
            email: "maria@severinno.com",
            userId: "cmu9uxwll01sssmlegczbuim01nbsmletcwh5hfj",
            cursor: "eyJzIjoicmF0aW5nIn0",
          },
        ],
      }),
    )
    expect(res.status).toBe(204)
    const campo = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const serializado = JSON.stringify(campo.rum)
    expect(serializado).not.toContain("maria@")
    expect(serializado).not.toContain("userId")
    expect(serializado).not.toContain("cursor")
    expect(campo.rum[0]).toEqual(ENTRADA_VALIDA)
  })

  it("corpo cru NUNCA vira log — nem no payload inválido", async () => {
    await POST(beacon({ entries: [{ name: "intruso", email: "maria@severinno.com" }] }))
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    // Nenhuma chamada de log carrega o corpo cru:
    for (const log of [logger.info, logger.error, logger.warn] as ReturnType<typeof vi.fn>[]) {
      for (const call of log.mock.calls) {
        expect(JSON.stringify(call)).not.toContain("maria@")
      }
    }
  })
})

describe("POST /api/rum/vitrine — inválido é 204 silencioso", () => {
  const casosInvalidos: [string, unknown][] = [
    ["nome desconhecido", { entries: [{ ...ENTRADA_VALIDA, name: "outra-coisa" }] }],
    ["duração negativa", { entries: [{ ...ENTRADA_VALIDA, duration: -1 }] }],
    ["duração além do teto", { entries: [{ ...ENTRADA_VALIDA, duration: 61_000 }] }],
    ["target 0", { entries: [{ ...ENTRADA_VALIDA, target: 0 }] }],
    ["target fracionário", { entries: [{ ...ENTRADA_VALIDA, target: 2.5 }] }],
    ["direction fora do enum", { entries: [{ ...ENTRADA_VALIDA, direction: "cima" }] }],
    ["entries vazio", { entries: [] }],
    ["entries além do teto", { entries: Array.from({ length: 21 }, () => ENTRADA_VALIDA) }],
    ["sem entries", {}],
    ["não é objeto", [ENTRADA_VALIDA]],
  ]

  for (const [descricao, corpo] of casosInvalidos) {
    it(`204 sem log: ${descricao}`, async () => {
      const res = await POST(beacon(corpo))
      expect(res.status).toBe(204)
      expect(logger.info).not.toHaveBeenCalled()
    })
  }

  it("204 sem log: JSON quebrado", async () => {
    const res = await POST(
      new Request(VITRINE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"entries": [{"name":',
      }),
    )
    expect(res.status).toBe(204)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it("204 sem log: content-length acima do teto (nem lê o corpo)", async () => {
    const res = await POST(beacon({ entries: [ENTRADA_VALIDA] }, { "content-length": "999999" }))
    expect(res.status).toBe(204)
    expect(logger.info).not.toHaveBeenCalled()
  })
})
