/**
 * Tests for src/lib/idempotency-client.ts — tradução dos 409 de idempotência
 * em mensagens amigáveis + ação de recuperação para a UI de checkout.
 *
 * O formato do erro simulado é o que `payBooking`/`apiPost` realmente lançam:
 * objeto `{ status, message, data }` (NÃO é instanceof Error), com o corpo da
 * resposta em `data` — ex.: { status: 409, message: "...", data: { error,
 * code: "IDEMPOTENCY_IN_FLIGHT" } }.
 */

import { describe, it, expect } from "vitest"
import { describePayError } from "../idempotency-client"

/** ApiError como o wrapper de fetch lança (objeto simples, data = corpo). */
function apiError(status: number, body: unknown): unknown {
  return {
    status,
    message:
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: string }).error)
        : `Erro ${status}`,
    data: body,
  }
}

describe("describePayError — códigos de idempotência (409)", () => {
  it("IN_FLIGHT → aguardar e manter a MESMA chave (replay resolve)", () => {
    const outcome = describePayError(
      apiError(409, { error: "Pagamento já em processamento", code: "IDEMPOTENCY_IN_FLIGHT" }),
    )

    expect(outcome.code).toBe("IDEMPOTENCY_IN_FLIGHT")
    expect(outcome.action).toBe("wait_and_retry")
    expect(outcome.title).toContain("em andamento")
    expect(outcome.retryLabel).toContain("Aguardar")
    // A mensagem explica o porquê (replay/recuperação automática)
    expect(outcome.message).toContain("Aguarde")
  })

  it("FAILED → nova chave (a tentativa anterior falhou de verdade)", () => {
    const outcome = describePayError(
      apiError(409, { error: "Tentativa anterior falhou: Lytex caiu", code: "IDEMPOTENCY_FAILED" }),
    )

    expect(outcome.code).toBe("IDEMPOTENCY_FAILED")
    expect(outcome.action).toBe("new_key_retry")
    expect(outcome.retryLabel).toBe("Tentar novamente")
    expect(outcome.message).toContain("nova tentativa")
  })

  it("CONFLICT → nova chave (chave usada em outra operação)", () => {
    const outcome = describePayError(
      apiError(409, {
        error: "Idempotency-Key já usada para outra operação.",
        code: "IDEMPOTENCY_CONFLICT",
      }),
    )

    expect(outcome.code).toBe("IDEMPOTENCY_CONFLICT")
    expect(outcome.action).toBe("new_key_retry")
    expect(outcome.retryLabel).toContain("nova tentativa")
  })
})

describe("describePayError — erros genéricos (fallback)", () => {
  it("400 do servidor (ex. Lytex) usa a mensagem do servidor", () => {
    const outcome = describePayError(apiError(400, { error: "Lytex: Saldo insuficiente na conta" }))

    expect(outcome.code).toBeNull()
    expect(outcome.action).toBe("wait_and_retry")
    expect(outcome.message).toContain("Lytex: Saldo insuficiente na conta")
  })

  it("erro de rede sem mensagem vira fallback amigável", () => {
    const outcome = describePayError({ status: 0, message: "Erro de rede." })

    expect(outcome.code).toBeNull()
    expect(outcome.message).toContain("Erro de rede.")
  })

  it("entrada não-objeto (string/null) não quebra", () => {
    expect(describePayError(null).message).toBeTruthy()
    expect(describePayError("boom").message).toBe("boom")
    expect(describePayError(undefined).title).toBeTruthy()
  })

  it("message vazia do servidor cai no default", () => {
    const outcome = describePayError({ status: 500, message: "   ", data: {} })
    expect(outcome.message).toContain("Tente novamente")
  })
})
