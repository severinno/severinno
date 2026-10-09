import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Mocks ──────────────────────────────────────────────────────────────────
const findUnique = vi.fn()

vi.mock("@/lib/db", () => ({
  db: { setting: { findUnique } },
}))

vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// `requireMaintenanceAccessible` importa dinamicamente — mocks nomeados.
const getSession = vi.fn()

vi.mock("@/lib/auth", () => ({
  getSession,
}))

vi.mock("@/lib/api-server", () => ({
  HttpError: class HttpErrorMock extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

import {
  MAINTENANCE_MODE_KEY,
  MAINTENANCE_ALLOWED_IPS_KEY,
  isMaintenanceMode,
  getAllowedMaintenanceIps,
  isClientAllowedDuringMaintenance,
  isMaintenanceAccessible,
  requireMaintenanceAccessible,
  resetMaintenanceModeCache,
} from "@/lib/maintenance-mode"

beforeEach(() => {
  vi.resetModules()
  resetMaintenanceModeCache()
  findUnique.mockReset()
  getSession.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function row(value: string) {
  return { key: MAINTENANCE_MODE_KEY, value }
}

// ── isMaintenanceMode ──────────────────────────────────────────────────────
describe("isMaintenanceMode", () => {
  it("a chave ausente (ou linha inexistente) = site acessível", async () => {
    findUnique.mockResolvedValue(null)
    await expect(isMaintenanceMode()).resolves.toBe(false)
    expect(findUnique).toHaveBeenCalledWith({ where: { key: MAINTENANCE_MODE_KEY } })
  })

  it('lê "true" da tabela Setting como ligado', async () => {
    findUnique.mockResolvedValue(row("true"))
    await expect(isMaintenanceMode()).resolves.toBe(true)
  })

  it("valores estranhos caem em false (fail-safe de interpretação)", async () => {
    for (const v of ["false", "0", "no", "", "sim", null]) {
      findUnique.mockResolvedValue(row(v as string))
      resetMaintenanceModeCache()
      await expect(isMaintenanceMode()).resolves.toBe(false)
    }
  })

  it("aceita variantes de caixa/espaço do valor verdadeiro (contrato toBool do repo)", async () => {
    for (const v of ["true", "TRUE", " True ", "1", "YES"]) {
      findUnique.mockResolvedValue(row(v))
      resetMaintenanceModeCache()
      await expect(isMaintenanceMode()).resolves.toBe(true)
    }
  })

  it("DB fora do ar NUNCA liga a manutenção (fail-safe operacional)", async () => {
    findUnique.mockRejectedValue(new Error("P1001: can't reach database"))
    await expect(isMaintenanceMode()).resolves.toBe(false)
  })

  it("cache de 15s: segunda leitura não re-consulta o DB", async () => {
    findUnique.mockResolvedValue(row("true"))
    await isMaintenanceMode()
    await isMaintenanceMode()
    expect(findUnique).toHaveBeenCalledTimes(1)
  })

  it("resetMaintenanceModeCache força releitura", async () => {
    findUnique.mockResolvedValue(row("true"))
    await isMaintenanceMode()
    resetMaintenanceModeCache()
    await isMaintenanceMode()
    expect(findUnique).toHaveBeenCalledTimes(2)
  })
})

// ── requireMaintenanceAccessible ───────────────────────────────────────────
describe("requireMaintenanceAccessible", () => {
  it("com a chave desligada, qualquer request passa sem tocar em sessão", async () => {
    findUnique.mockResolvedValue(row("false"))
    await expect(requireMaintenanceAccessible()).resolves.toBeUndefined()
    expect(getSession).not.toHaveBeenCalled()
  })

  it("com a chave ligada, ADMIN atravessa", async () => {
    findUnique.mockResolvedValue(row("true"))
    getSession.mockResolvedValue({ userId: "u1", role: "ADMIN" })
    await expect(requireMaintenanceAccessible()).resolves.toBeUndefined()
  })

  it("com a chave ligada, CLIENT/PROVIDER e anônimo tomam HttpError 503", async () => {
    findUnique.mockResolvedValue(row("true"))

    getSession.mockResolvedValue({ userId: "u2", role: "CLIENT" })
    await expect(requireMaintenanceAccessible()).rejects.toMatchObject({ status: 503 })

    resetMaintenanceModeCache()
    getSession.mockResolvedValue({ userId: "u3", role: "PROVIDER" })
    await expect(requireMaintenanceAccessible()).rejects.toMatchObject({ status: 503 })

    resetMaintenanceModeCache()
    getSession.mockResolvedValue(null)
    await expect(requireMaintenanceAccessible()).rejects.toMatchObject({ status: 503 })
  })

  it("a mensagem de 503 é a promessa pública: em breve online para melhor atender", async () => {
    findUnique.mockResolvedValue(row("true"))
    getSession.mockResolvedValue(null)
    await expect(requireMaintenanceAccessible()).rejects.toMatchObject({
      message: expect.stringContaining("em breve estaremos online para melhor atender"),
    })
  })

  it("com a chave ligada, cliente com IP na whitelist atravessa sem precisar de sessão ADMIN", async () => {
    findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === MAINTENANCE_MODE_KEY) return row("true")
      if (where.key === MAINTENANCE_ALLOWED_IPS_KEY) {
        return { key: MAINTENANCE_ALLOWED_IPS_KEY, value: JSON.stringify(["203.0.113.195"]) }
      }
      return null
    })

    getSession.mockResolvedValue(null) // anônimo / sem cookie
    await expect(requireMaintenanceAccessible(undefined, "203.0.113.195")).resolves.toBeUndefined()
  })

  it("com a chave ligada, cliente em localhost/loopback sempre atravessa (acesso local)", async () => {
    findUnique.mockResolvedValue(row("true"))
    getSession.mockResolvedValue(null)

    await expect(requireMaintenanceAccessible(undefined, "127.0.0.1")).resolves.toBeUndefined()
    await expect(requireMaintenanceAccessible(undefined, "::1")).resolves.toBeUndefined()
    await expect(requireMaintenanceAccessible(undefined, "localhost")).resolves.toBeUndefined()
  })
})

// ── isClientAllowedDuringMaintenance & isMaintenanceAccessible ─────────────
describe("isClientAllowedDuringMaintenance & isMaintenanceAccessible", () => {
  it("reconhece loopback e localhost como permitidos", async () => {
    await expect(isClientAllowedDuringMaintenance("127.0.0.1")).resolves.toBe(true)
    await expect(isClientAllowedDuringMaintenance("::1")).resolves.toBe(true)
    await expect(isClientAllowedDuringMaintenance("localhost")).resolves.toBe(true)
  })

  it("isMaintenanceAccessible devolve true se manutenção estiver desligada", async () => {
    findUnique.mockResolvedValue(row("false"))
    await expect(isMaintenanceAccessible({ ip: "198.51.100.1" })).resolves.toBe(true)
  })

  it("isMaintenanceAccessible devolve true se IP estiver autorizado", async () => {
    findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === MAINTENANCE_MODE_KEY) return row("true")
      if (where.key === MAINTENANCE_ALLOWED_IPS_KEY) {
        return { key: MAINTENANCE_ALLOWED_IPS_KEY, value: "198.51.100.42" }
      }
      return null
    })
    await expect(isMaintenanceAccessible({ ip: "198.51.100.42" })).resolves.toBe(true)
  })

  it("isMaintenanceAccessible devolve false se IP não autorizado e sem sessão ADMIN", async () => {
    findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === MAINTENANCE_MODE_KEY) return row("true")
      if (where.key === MAINTENANCE_ALLOWED_IPS_KEY) {
        return { key: MAINTENANCE_ALLOWED_IPS_KEY, value: "198.51.100.42" }
      }
      return null
    })
    await expect(
      isMaintenanceAccessible({ ip: "198.51.100.99", session: { role: "CLIENT" } }),
    ).resolves.toBe(false)
  })
})
