/**
 * Tests for src/lib/fetch-timeout.ts
 *
 * Shared helpers that eliminate the duplicated
 * `Math.max(1, Number(env) || default)` + `AbortSignal.timeout()` pattern.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { resolveTimeoutMs, envTimeoutSignal } from "../fetch-timeout"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("resolveTimeoutMs", () => {
  it("usa o fallback quando a env não existe", () => {
    vi.stubEnv("TEST_TIMEOUT_MS", "")
    expect(resolveTimeoutMs("TEST_TIMEOUT_MS", 10_000)).toBe(10_000)
    // env não definida (sem stub → não existe no process.env do teste)
    expect(resolveTimeoutMs("ENV_QUE_NAO_EXISTE_XYZ", 5_000)).toBe(5_000)
  })

  it("usa o valor da env quando é um número válido", () => {
    vi.stubEnv("TEST_TIMEOUT_MS", "2500")
    expect(resolveTimeoutMs("TEST_TIMEOUT_MS", 10_000)).toBe(2500)
  })

  it("cai para o fallback quando a env é NaN (não-numérica)", () => {
    vi.stubEnv("TEST_TIMEOUT_MS", "abc")
    expect(resolveTimeoutMs("TEST_TIMEOUT_MS", 10_000)).toBe(10_000)
  })

  it("cai para o fallback quando a env é '0' (falsy)", () => {
    vi.stubEnv("TEST_TIMEOUT_MS", "0")
    expect(resolveTimeoutMs("TEST_TIMEOUT_MS", 10_000)).toBe(10_000)
  })

  it("clampa negativo para 1 (timeout mínimo seguro)", () => {
    vi.stubEnv("TEST_TIMEOUT_MS", "-500")
    expect(resolveTimeoutMs("TEST_TIMEOUT_MS", 10_000)).toBe(1)
  })

  it("aceita valor decimal positivo", () => {
    vi.stubEnv("TEST_TIMEOUT_MS", "1234.5")
    expect(resolveTimeoutMs("TEST_TIMEOUT_MS", 10_000)).toBe(1234.5)
  })
})

describe("envTimeoutSignal", () => {
  it("retorna um AbortSignal do AbortSignal.timeout", () => {
    const signal = envTimeoutSignal("TEST_TIMEOUT_MS", 10_000)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  it("aplica o mesmo guard de invalidez do resolveTimeoutMs", () => {
    vi.stubEnv("TEST_TIMEOUT_MS", "abc")
    // Não deve lançar (o guard converte para fallback em vez de propagar NaN).
    expect(() => envTimeoutSignal("TEST_TIMEOUT_MS", 10_000)).not.toThrow()
    vi.stubEnv("TEST_TIMEOUT_MS", "-1")
    expect(() => envTimeoutSignal("TEST_TIMEOUT_MS", 10_000)).not.toThrow()
  })
})
