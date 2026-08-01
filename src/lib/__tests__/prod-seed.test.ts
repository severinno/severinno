/**
 * prod-seed.test.ts
 *
 * Unit tests for the production seed guard (isProdSeedAllowed).
 *
 * O seed-prod (prisma/seed-prod.ts) é a operação LEGÍTIMA de produção:
 * popula categorias + settings sem usuários demo. Por tocar o banco
 * produtivo, o guard exige NODE_ENV=production explícito:
 *   - production → permitido
 *   - development / test / staging / "" → RECUSADO
 *   - override PROD_SEED_ALLOW_DEV=1 → permitido em qualquer ambiente
 *     (usado pelo CI seed-prod-guard contra banco efêmero)
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { isProdSeedAllowed } from "../prod-seed"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("isProdSeedAllowed", () => {
  it("permite apenas NODE_ENV=production", () => {
    expect(isProdSeedAllowed("production")).toBe(true)
  })

  it("recusa em development / test / staging / vazio", () => {
    expect(isProdSeedAllowed("development")).toBe(false)
    expect(isProdSeedAllowed("test")).toBe(false)
    expect(isProdSeedAllowed("staging")).toBe(false)
    expect(isProdSeedAllowed("")).toBe(false)
    expect(isProdSeedAllowed(undefined)).toBe(false)
  })

  it("lê process.env.NODE_ENV quando chamado sem argumento", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(isProdSeedAllowed()).toBe(true)

    vi.stubEnv("NODE_ENV", "development")
    expect(isProdSeedAllowed()).toBe(false)
  })

  it("permite override explícito PROD_SEED_ALLOW_DEV=1 (banco efêmero/CI)", () => {
    // Em dev, sem o override → recusa
    expect(isProdSeedAllowed("development", undefined)).toBe(false)
    // Com o override → permite (validação local/CI)
    expect(isProdSeedAllowed("development", "1")).toBe(true)
    expect(isProdSeedAllowed("test", "1")).toBe(true)
  })

  it("lê PROD_SEED_ALLOW_DEV do ambiente quando chamado sem argumento", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("PROD_SEED_ALLOW_DEV", "1")
    expect(isProdSeedAllowed()).toBe(true)
  })
})
