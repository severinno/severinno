/**
 * Lytex Pagamentos — HTTP Client
 *
 * Integração com a API Lytex para processamento de PIX e Cartão de Crédito.
 *
 * ## Autenticação
 * As credenciais (clientId + clientSecret) são obtidas no painel Lytex:
 *   https://pay.lytex.com.br > Configurações > Integrações > Gateway
 *
 * ## URLs
 * - docs:    https://docs-pay.lytex.com.br/ (requer autenticação)
 * - sandbox: https://sandbox-api.lytex.com.br/v1
 * - produção: https://api.lytex.com.br/v1
 *
 * ## Fluxo PIX
 * 1. createPixCharge() → retorna QR code + txid
 * 2. Cliente paga escaneando QR code
 * 3. Webhook confirma pagamento → confirmBookingPayment()
 *
 * ## Fluxo Cartão
 * 1. createCardCharge() → retorna transação (pode ser async: waitingPayment)
 * 2. Se waitingPayment, pool a cada 7min por até 20 tentativas (≈2.5h)
 * 3. Webhook também pode confirmar → confirmBookingPayment()
 *
 * ## Webhook
 * A Lytex envia POST para a URL configurada no painel sempre que um
 * pagamento é confirmado. Use verifyWebhookSignature() para validar.
 */

import { createHmac, timingSafeEqual } from "crypto"
import logger from "./logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LytexEnv = "sandbox" | "production"

export type LytexCustomer = {
  name: string
  email: string
  phone?: string
  cpfCnpj: string
}

export type LytexAddress = {
  street: string
  number: string
  complement?: string
  neighborhood: string
  city: string
  state: string
  zipCode: string
}

export type PixChargeRequest = {
  /** ID único do seu sistema (booking.id) */
  externalReference: string
  amount: number
  customer: LytexCustomer
  /** ISO date string — se omitido, vence em 24h */
  expiresAt?: string
  /** Descrição que aparece no comprovante PIX */
  description?: string
  /** Dados adicionais (opcional) */
  additionalInfo?: Array<{ key: string; value: string }>
}

export type CardChargeRequest = {
  externalReference: string
  amount: number
  customer: LytexCustomer
  card: {
    number: string
    holderName: string
    expiryMonth: string
    expiryYear: string
    cvv: string
  }
  /** Número de parcelas (1-12) */
  installments?: number
  /** Endereço de cobrança */
  billingAddress?: LytexAddress
  description?: string
}

export type LytexChargeStatus =
  "pending" | "waitingPayment" | "paid" | "canceled" | "refunded" | "expired" | "failed"

export type PixChargeResponse = {
  id: string
  status: LytexChargeStatus
  /** ID da transação no Lytex */
  transactionId: string
  /** Texto do QR Code (copiar e colar) */
  qrCode: string
  /** URL da imagem do QR Code */
  qrCodeImage: string
  /** Chave PIX do recebedor */
  pixKey: string
  /** Data de vencimento ISO */
  expiresAt: string
  /** Valor original */
  amount: number
  /** Status do Lytex */
  lytexStatus: string
  createdAt: string
}

export type CardChargeResponse = {
  id: string
  status: LytexChargeStatus
  transactionId: string
  /** Os 4 últimos dígitos do cartão */
  cardLastDigits: string
  /** Bandeira do cartão */
  cardBrand: string
  /** Número de parcelas */
  installments: number
  /** Valor total */
  amount: number
  /** Valor da parcela */
  installmentAmount: number
  lytexStatus: string
  createdAt: string
}

export type LytexWebhookPayload = {
  /** ID interno do Lytex */
  id: string
  /** ID da transação no Lytex */
  transactionId: string
  /** ID de referência externa (booking.id) */
  externalReference: string
  /** Novo status */
  status: LytexChargeStatus
  /** Método de pagamento: "PIX" | "CARD" | "BOLETO" */
  paymentMethod: string
  /** Valor pago (só se status=paid) */
  paidAmount?: number
  /** Data do pagamento ISO */
  paidAt?: string
  /** Últimos 4 dígitos do cartão (se cartão) */
  cardLastDigits?: string
  /** Bandeira (se cartão) */
  cardBrand?: string
  /** Número de parcelas (se cartão) */
  installments?: number
  /** Dados do QR Code PIX (se pagamento via PIX) */
  qrCode?: string
  /** URL da imagem do QR Code PIX */
  qrCodeImage?: string
  /** Metadados adicionais */
  metadata?: Record<string, unknown>
  /** Timestamp do evento ISO */
  eventDate: string
  /** Assinatura HMAC-SHA256 para verificação */
  signature: string
}

export type LytexQueryResponse = {
  id: string
  status: LytexChargeStatus
  transactionId: string
  externalReference: string
  amount: number
  method: string
  paidAmount?: number
  paidAt?: string
  qrCode?: string
  qrCodeImage?: string
  cardLastDigits?: string
  cardBrand?: string
  installments?: number
  lytexStatus: string
  createdAt: string
  updatedAt: string
}

export type LytexRefundResponse = {
  id: string
  status: "refunded"
  refundId: string
  refundedAmount: number
  refundedAt: string
}

export class LytexError extends Error {
  status: number
  lytexCode?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "LytexError"
    this.status = status
    this.lytexCode = code
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getConfig() {
  const clientId = process.env.LYTEX_CLIENT_ID
  const clientSecret = process.env.LYTEX_CLIENT_SECRET
  const env = (process.env.LYTEX_ENV ?? "sandbox") as LytexEnv

  if (!clientId || !clientSecret) {
    throw new Error("Lytex não configurado. Defina LYTEX_CLIENT_ID e LYTEX_CLIENT_SECRET no .env")
  }

  const baseUrl =
    env === "production"
      ? (process.env.LYTEX_API_URL ?? "https://api.lytex.com.br/v1")
      : (process.env.LYTEX_SANDBOX_URL ?? "https://sandbox-api.lytex.com.br/v1")

  return { clientId, clientSecret, env, baseUrl }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function lytexRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { clientId, clientSecret, baseUrl } = getConfig()
  const url = `${baseUrl}${path}`
  const credentials = btoa(`${clientId}:${clientSecret}`)

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const contentType = res.headers.get("content-type") ?? ""
  let parsed: unknown = null
  if (contentType.includes("application/json")) {
    parsed = await res.json().catch(() => null)
  }

  if (!res.ok) {
    const message =
      (parsed &&
      typeof parsed === "object" &&
      "message" in parsed &&
      typeof (parsed as { message?: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : undefined) ?? `Lytex API error: ${res.status} ${res.statusText}`
    const code =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error?: unknown }).error ?? "")
        : undefined
    throw new LytexError(message, res.status, code)
  }

  return parsed as T
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Criar cobrança PIX.
 * Retorna QR code para o cliente pagar escaneando.
 */
export async function createPixCharge(req: PixChargeRequest): Promise<PixChargeResponse> {
  const body = {
    external_reference: req.externalReference,
    amount: req.amount,
    customer: {
      name: req.customer.name,
      email: req.customer.email,
      phone: req.customer.phone,
      cpf_cnpj: req.customer.cpfCnpj,
    },
    expires_at: req.expiresAt,
    description: req.description,
    additional_info: req.additionalInfo?.map((i) => ({
      key: i.key,
      value: i.value,
    })),
  }

  return lytexRequest<PixChargeResponse>("POST", "/charges/pix", body)
}

/**
 * Criar cobrança no Cartão de Crédito.
 * Pode retornar status "waitingPayment" se o processamento for assíncrono.
 */
export async function createCardCharge(req: CardChargeRequest): Promise<CardChargeResponse> {
  const body = {
    external_reference: req.externalReference,
    amount: req.amount,
    customer: {
      name: req.customer.name,
      email: req.customer.email,
      phone: req.customer.phone,
      cpf_cnpj: req.customer.cpfCnpj,
    },
    card: {
      number: req.card.number,
      holder_name: req.card.holderName,
      expiry_month: req.card.expiryMonth,
      expiry_year: req.card.expiryYear,
      cvv: req.card.cvv,
    },
    installments: req.installments ?? 1,
    billing_address: req.billingAddress
      ? {
          street: req.billingAddress.street,
          number: req.billingAddress.number,
          complement: req.billingAddress.complement,
          neighborhood: req.billingAddress.neighborhood,
          city: req.billingAddress.city,
          state: req.billingAddress.state,
          zip_code: req.billingAddress.zipCode,
        }
      : undefined,
    description: req.description,
  }

  return lytexRequest<CardChargeResponse>("POST", "/charges/card", body)
}

/**
 * Consultar status de uma cobrança.
 */
export async function getCharge(chargeId: string): Promise<LytexQueryResponse> {
  return lytexRequest<LytexQueryResponse>("GET", `/charges/${chargeId}`)
}

/**
 * Cancelar uma cobrança (antes de ser paga).
 */
export async function cancelCharge(chargeId: string): Promise<void> {
  await lytexRequest("POST", `/charges/${chargeId}/cancel`)
}

/**
 * Estornar/reembolsar uma cobrança já paga.
 * Requer configuração de `dias_limite_estornar` no painel Lytex.
 */
export async function refundCharge(
  chargeId: string,
  amount?: number,
): Promise<LytexRefundResponse> {
  return lytexRequest<LytexRefundResponse>(
    "POST",
    `/charges/${chargeId}/refund`,
    amount !== undefined ? { amount } : undefined,
  )
}

/**
 * Buscar cobrança pelo ID de referência externa (booking.id).
 */
export async function getChargeByExternalReference(
  externalReference: string,
): Promise<LytexQueryResponse | null> {
  try {
    return lytexRequest<LytexQueryResponse>(
      "GET",
      `/charges/external/${encodeURIComponent(externalReference)}`,
    )
  } catch (e) {
    if (e instanceof LytexError && e.status === 404) return null
    throw e
  }
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/**
 * Verificar assinatura do webhook enviado pela Lytex.
 *
 * A Lytex assina o payload com HMAC-SHA256 usando o client_secret.
 * Deve ser chamada ANTES de processar o webhook.
 *
 * @returns true se a assinatura é válida
 */
export function verifyWebhookSignature(payload: LytexWebhookPayload): boolean {
  const { clientSecret } = getConfig()

  // A assinatura esperada é HMAC-SHA256 do JSON do payload (sem o campo signature)
  // usando client_secret como chave
  const { signature: _ignored, ...payloadWithoutSignature } = payload
  const payloadStr = JSON.stringify(payloadWithoutSignature)

  // HMAC via crypto.createHmac (Node.js) — importado no topo do módulo
  const expected = createHmac("sha256", clientSecret).update(payloadStr).digest("hex")

  // Timing-safe comparison
  const a = Buffer.from(payload.signature, "hex")
  const b = Buffer.from(expected, "hex")
  if (a.length !== b.length) return false

  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Extrair o ID externo (booking.id) de um webhook.
 * O externalReference deve seguir o formato: "booking:{bookingId}"
 */
export function parseExternalReference(
  externalReference: string,
): { type: string; id: string } | null {
  const parts = externalReference.split(":")
  if (parts.length !== 2) return null
  return { type: parts[0], id: parts[1] }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mapa de status Lytex → nosso sistema
 */
export function mapLytexStatus(lytexStatus: string): "PENDING" | "PAID" | "REFUNDED" {
  switch (lytexStatus) {
    case "paid":
      return "PAID"
    case "refunded":
      return "REFUNDED"
    case "canceled":
    case "expired":
      return "REFUNDED"
    default:
      return "PENDING"
  }
}

/**
 * Aguarda o processamento de uma transação waitingPayment.
 * Faz polling a cada 7s por até 20 tentativas.
 * Retorna o status final.
 */
export async function pollChargeStatus(
  chargeId: string,
  maxAttempts = 20,
  intervalMs = 7_000,
): Promise<LytexQueryResponse> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await getCharge(chargeId)
    if (result.status !== "waitingPayment") {
      return result
    }
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  // Última tentativa
  return getCharge(chargeId)
}

// ---------------------------------------------------------------------------
// Wallet / Split operations (used by provider/lytex/route.ts)
// ---------------------------------------------------------------------------

/**
 * Result type for Lytex wallet query.
 */
export type LytexWallet = {
  balance: number
  pendingBalance: number
  totalReceived: number
}

/**
 * Result type for a Lytex split (payment split between platform and provider).
 */
export type LytexSplit = {
  _id: string
  _invoiceId: string
  value: number
  status: string
  createdAt: string
}

/**
 * Fetch wallet balance for a Lytex recipient.
 *
 * @param recipientId - Lytex recipient ID (stored in User.lytexRecipientId)
 * @returns Wallet balance information
 */
export async function getWallet(recipientId: string): Promise<LytexWallet> {
  return lytexRequest<LytexWallet>("GET", `/recipients/${encodeURIComponent(recipientId)}/wallet`)
}

/**
 * List payment splits (transfers) for a Lytex recipient.
 *
 * @param recipientId - Lytex recipient ID
 * @param limit - Max results (default 50)
 * @returns Array of splits/transfers
 */
export async function listSplits(recipientId: string, limit = 50): Promise<LytexSplit[]> {
  return lytexRequest<LytexSplit[]>(
    "GET",
    `/recipients/${encodeURIComponent(recipientId)}/splits?limit=${limit}`,
  )
}

/**
 * Logger com prefixo [Lytex]
 */
const lytexLogger = logger.child({ module: "lytex" })

export { lytexLogger }
