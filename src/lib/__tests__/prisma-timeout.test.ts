/**
 * Tests for src/lib/prisma-timeout.ts
 *
 * Prisma 6.x removeu query_timeout/connection_limit das options do construtor;
 * os limites passam pela connection string (statement_timeout em ms,
 * connect_timeout/pool_timeout em segundos, connection_limit inteiro).
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { buildPrismaDatasourceUrl, PRISMA_CONNECTION_DEFAULTS } from "../prisma-timeout"

afterEach(() => {
  vi.unstubAllEnvs()
})

const BASE = "postgresql://user:pass@localhost:5432/severinno"

describe("buildPrismaDatasourceUrl", () => {
  it("aplica os 4 params de timeout com os defaults", () => {
    const url = new URL(buildPrismaDatasourceUrl(BASE))

    expect(url.searchParams.get("connection_limit")).toBe(
      String(PRISMA_CONNECTION_DEFAULTS.connectionLimit),
    )
    expect(url.searchParams.get("connect_timeout")).toBe(
      String(PRISMA_CONNECTION_DEFAULTS.connectTimeoutSec),
    )
    expect(url.searchParams.get("pool_timeout")).toBe(
      String(PRISMA_CONNECTION_DEFAULTS.poolTimeoutSec),
    )
    expect(url.searchParams.get("statement_timeout")).toBe(
      String(PRISMA_CONNECTION_DEFAULTS.statementTimeoutMs),
    )
  })

  it("não duplica params que já existem na URL", () => {
    const url = new URL(buildPrismaDatasourceUrl(`${BASE}?statement_timeout=30000&sslmode=require`))

    // Existentes: preservados sem duplicação
    expect(url.searchParams.getAll("statement_timeout")).toEqual(["30000"])
    expect(url.searchParams.get("sslmode")).toBe("require")
    // Ausentes: aplicados
    expect(url.searchParams.get("connection_limit")).toBe(
      String(PRISMA_CONNECTION_DEFAULTS.connectionLimit),
    )
  })

  it("permite override dos valores via env (guarda NaN/vazio → default)", () => {
    vi.stubEnv("PRISMA_STATEMENT_TIMEOUT_MS", "15000")
    vi.stubEnv("PRISMA_CONNECTION_LIMIT", "abc") // NaN → default

    const url = new URL(buildPrismaDatasourceUrl(BASE))
    expect(url.searchParams.get("statement_timeout")).toBe("15000")
    expect(url.searchParams.get("connection_limit")).toBe(
      String(PRISMA_CONNECTION_DEFAULTS.connectionLimit),
    )
  })

  it("clampa negativo para 1 (timeout mínimo seguro)", () => {
    vi.stubEnv("PRISMA_CONNECT_TIMEOUT_SEC", "-5")
    const url = new URL(buildPrismaDatasourceUrl(BASE))
    expect(url.searchParams.get("connect_timeout")).toBe("1")
  })

  it("não deixa o statement_timeout desabilitado (0) — fecha o gap do hang", () => {
    vi.stubEnv("PRISMA_STATEMENT_TIMEOUT_MS", "0") // falsy → default
    const url = new URL(buildPrismaDatasourceUrl(BASE))
    expect(url.searchParams.get("statement_timeout")).toBe(
      String(PRISMA_CONNECTION_DEFAULTS.statementTimeoutMs),
    )
  })
})
