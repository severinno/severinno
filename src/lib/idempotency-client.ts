/**
 * idempotency-client.ts — lado CLIENTE da idempotência de pagamento.
 *
 * O servidor (`/api/bookings/[id]/pay`) responde 409 com um `code` no corpo:
 *
 *   { error: "...", code: "IDEMPOTENCY_IN_FLIGHT" | "IDEMPOTENCY_FAILED"
 *                        | "IDEMPOTENCY_CONFLICT" }
 *
 * O wrapper `apiPost`/`payBooking` lança um objeto `{ status, message, data }`
 * (NÃO é `instanceof Error`!) com o corpo em `data`. `describePayError`
 * traduz isso para mensagem amigável + ação de recuperação:
 *
 *   - IN_FLIGHT  → manter a MESMA chave e tentar de novo em instantes: quando
 *                  a execução original terminar, o retry recebe REPLAY com o
 *                  QR já criado (a UI tenta o status endpoint antes de erro).
 *   - FAILED     → a tentativa anterior falhou de verdade: gerar chave NOVA.
 *   - CONFLICT   → a chave foi usada em outra operação: gerar chave NOVA.
 */

/** Códigos 409 emitidos por @/lib/idempotency (servidor). */
export type IdempotencyErrorCode =
  "IDEMPOTENCY_IN_FLIGHT" | "IDEMPOTENCY_FAILED" | "IDEMPOTENCY_CONFLICT"

/** Ação de recuperação que a UI deve executar no retry. */
export type PayErrorAction = "wait_and_retry" | "new_key_retry"

export type PayErrorOutcome = {
  /** Título curto e amigável (card de erro + toast). */
  title: string
  /** Explicação do que aconteceu e o que fazer. */
  message: string
  /** Rótulo do botão de retry. */
  retryLabel: string
  action: PayErrorAction
  /** Código do servidor quando identificado; null para erros genéricos. */
  code: IdempotencyErrorCode | null
}

/** Extrai `data.code` (ou `code`) de um ApiError sem assumir tipo rígido. */
function readErrorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null
  const data = (e as { data?: unknown }).data
  if (typeof data === "object" && data !== null) {
    const code = (data as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  const root = (e as { code?: unknown }).code
  return typeof root === "string" ? root : null
}

/** Extrai a mensagem do servidor, se houver (ApiError não é Error). */
function readErrorMessage(e: unknown): string | null {
  if (typeof e === "string") return e
  if (typeof e !== "object" || e === null) return null
  const message = (e as { message?: unknown }).message
  return typeof message === "string" && message.trim() !== "" ? message : null
}

/**
 * Traduz qualquer erro do fluxo de pagamento em mensagem amigável + ação.
 * Erros conhecidos de idempotência (409) têm tratamento específico; todo o
 * resto cai no fallback com a mensagem do servidor quando disponível.
 */
export function describePayError(e: unknown): PayErrorOutcome {
  const code = readErrorCode(e)

  if (code === "IDEMPOTENCY_IN_FLIGHT") {
    return {
      title: "Pagamento já em andamento",
      message:
        "Já existe uma cobrança sendo criada para esta tentativa. Aguarde alguns instantes e tente de novo — se ela já tiver sido criada, exibimos o QR Code automaticamente.",
      retryLabel: "Aguardar e tentar de novo",
      action: "wait_and_retry",
      code,
    }
  }

  if (code === "IDEMPOTENCY_FAILED") {
    return {
      title: "A tentativa anterior falhou",
      message:
        "Não foi possível criar a cobrança na tentativa anterior. Toque em tentar novamente: vamos iniciar uma nova tentativa de pagamento.",
      retryLabel: "Tentar novamente",
      action: "new_key_retry",
      code,
    }
  }

  if (code === "IDEMPOTENCY_CONFLICT") {
    return {
      title: "Tentativa de pagamento inválida",
      message:
        "Esta tentativa já foi usada para outro pagamento. Toque em tentar novamente: vamos iniciar uma tentativa nova para você.",
      retryLabel: "Iniciar nova tentativa",
      action: "new_key_retry",
      code,
    }
  }

  return {
    title: "Erro ao gerar PIX",
    message:
      readErrorMessage(e) ??
      "Não foi possível gerar o QR Code. Tente novamente em alguns instantes.",
    retryLabel: "Tentar novamente",
    action: "wait_and_retry",
    code: null,
  }
}
