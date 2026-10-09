/**
 * Lytex Pagamentos — HTTP Client (API v2 REAL)
 *
 * Integração com a API Lytex para processamento de PIX e Cartão de Crédito.
 *
 * ## API REAL (v2 de invoices)
 * Os hosts do desenho original (`api.lytex.com.br`/`sandbox-api.lytex.com.br`)
 * são NXDOMAIN (verificado por DoH em 2026-10-01). A API operada é:
 *   - produção: https://api-pay.lytex.com.br
 *     auth:     https://auth-pay.lytex.com.br/v1/oauth/obtain_token
 *   - sandbox:  https://sandbox-api-pay.lytex.com.br
 *     auth:     https://sandbox-api-pay.lytex.com.br/v2/auth/obtain_token
 * Spec OpenAPI completa extraída dos docs (docs-pay.lytex.com.br, bundle JS):
 * 86 paths, `POST /v2/invoices`, `PUT /v2/invoices/cancel/{id}`,
 * `POST /v2/refund-solicitation`, `GET /v2/wallet`, `GET /v2/splits/list/{type}`.
 *
 * ## Autenticação (v2 — OAuth2 client credentials)
 * 1. POST {authUrl} com {clientId, clientSecret} → {accessToken, expireAt}
 * 2. Chamadas à API com `Authorization: Bearer <accessToken>`
 * O token é cacheado em memória até 60s antes do expireAt; um 401 força
 * re-obtenção e UMA retry (evita loop infinito com credencial inválida).
 * O estilo Basic (`Authorization: Basic base64(id:secret)`) foi RECUSADO pela
 * API real (401 "Token inválido" — provado em produção 2026-10-06).
 *
 * ## Unidade monetária
 * A API fala CENTAVOS (inteiros). O domínio do app fala REAIS
 * (Booking.amount Decimal). A conversão vive AQUI, na fronteira (toCents).
 *
 * ## Webhook
 * A Lytex envia POST para a URL configurada no painel sempre que um
 * pagamento muda de status. Use verifyWebhookSignature() para validar
 * (HMAC-SHA256 com o client_secret como chave).
 *
 * ## MCP
 * A Lytex anuncia um MCP Server (`ai.lytex.com.br/mcp`; sandbox
 * `sandbox-ai.lytex.com.br/mcp`) — em 2026-10-06 ambos respondem 404
 * (anunciado, não ao vivo). A integração do app é a REST v2 acima.
 */

import { createHmac, timingSafeEqual } from "crypto"
import logger from "./logger"

// ---------------------------------------------------------------------------
// Types (assinaturas exportadas preservadas — call sites não mudam)
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
  /**
   * Valor em REAIS (ex.: 621.00 — o mesmo número do Booking.amount).
   * O client converte para CENTAVOS no wire (unidade da API da Lytex).
   */
  amount: number
  customer: LytexCustomer
  /** ISO date string — se omitido, vence em 24h (enviada como data YYYY-MM-DD) */
  expiresAt?: string
  /** Descrição que aparece no comprovante PIX */
  description?: string
  /** Dados adicionais (opcional) */
  additionalInfo?: Array<{ key: string; value: string }>
}

export type CardChargeRequest = {
  externalReference: string
  /** Valor em REAIS — o client converte para centavos no wire. */
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
  /** URL da imagem do QR Code (a v2 não devolve imagem; fica vazio) */
  qrCodeImage: string
  /** Chave PIX do recebedor (a v2 embute a chave no qrcode; fica vazio) */
  pixKey: string
  /** Data de vencimento ISO */
  expiresAt: string
  /** Valor em CENTAVOS (unidade da API) */
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
  /** Valor total em CENTAVOS (unidade da API) */
  amount: number
  /** Valor da parcela em CENTAVOS (unidade da API) */
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
  /** Valor pago em CENTAVOS (só se status=paid) */
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
  /** Valor em CENTAVOS (unidade da API) */
  amount: number
  method: string
  /** Valor pago em CENTAVOS */
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
  /** Valor estornado em CENTAVOS (unidade da API) */
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

/** Resposta do endpoint OAuth da Lytex (obtain_token) */
type LytexTokenResponse = {
  accessToken: string
  refreshToken?: string
  /** ISO datetime — momento em que o access token expira */
  expireAt?: string
  refreshExpireAt?: string
}

/** Invoice da API v2 (campos que o client consome — a resposta tem ~50) */
type LytexInvoiceV2 = {
  _id?: string
  referenceId?: string | null
  status?: string
  totalValue?: number
  description?: string | null
  dueDate?: string
  createdAt?: string
  updatedAt?: string
  canceledAt?: string | null
  expiredAt?: string | null
  client?: { name?: string; cpfCnpj?: string; email?: string | null } | null
  paymentMethods?: {
    pix?: { enable?: boolean; qrcode?: string; txId?: string; operator?: string } | null
    boleto?: { enable?: boolean; digitableLine?: string; barcode?: string } | null
    creditCard?: { enable?: boolean } | null
  } | null
  linkCheckout?: string | null
  lastPayment?: {
    paidValue?: number
    paidAt?: string
    cardNumber?: string
    cardBrand?: string
  } | null
}

function getConfig() {
  const clientId = process.env.LYTEX_CLIENT_ID
  const clientSecret = process.env.LYTEX_CLIENT_SECRET
  const env = (process.env.LYTEX_ENV ?? "sandbox") as LytexEnv

  if (!clientId || !clientSecret) {
    throw new Error("Lytex não configurado. Defina LYTEX_CLIENT_ID e LYTEX_CLIENT_SECRET no .env")
  }

  const baseUrl =
    env === "production"
      ? (process.env.LYTEX_API_URL ?? "https://api-pay.lytex.com.br")
      : (process.env.LYTEX_SANDBOX_URL ?? "https://sandbox-api-pay.lytex.com.br")
  const authUrl =
    env === "production"
      ? (process.env.LYTEX_AUTH_URL ?? "https://auth-pay.lytex.com.br/v1/oauth/obtain_token")
      : (process.env.LYTEX_SANDBOX_AUTH_URL ??
        "https://sandbox-api-pay.lytex.com.br/v2/auth/obtain_token")

  return { clientId, clientSecret, env, baseUrl, authUrl }
}

// ---------------------------------------------------------------------------
// OAuth2 client credentials — token cache (v2)
// ---------------------------------------------------------------------------

let cachedToken: { token: string; expiresAtMs: number } | null = null

/**
 * Obtém um access token novo (client credentials).
 * A spec declara {clientId, clientSecret}; o endpoint também aceita
 * grantType/scopes extras (validado em produção 2026-10-06).
 */
async function obtainAccessToken(): Promise<{ token: string; expiresAtMs: number }> {
  const { clientId, clientSecret, authUrl } = getConfig()

  const res = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grantType: "clientCredentials",
      clientId,
      clientSecret,
      scopes: [
        "invoice",
        "invoice.create",
        "invoice.get",
        "invoice.update",
        "invoice.cancel",
        "invoice.refund",
      ],
    }),
  })

  const parsed = (await res.json().catch(() => null)) as LytexTokenResponse | null
  if (!res.ok || !parsed?.accessToken) {
    const message =
      parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message?: unknown }).message)
        : `Lytex auth error: ${res.status}`
    throw new LytexError(message, res.status)
  }

  // expireAt é ISO; margem de 60s para não usar token à beira da expiração
  const expiresAtMs = parsed.expireAt
    ? Math.max(Date.parse(parsed.expireAt) - 60_000, Date.now() + 30_000)
    : Date.now() + 10 * 60_000 // sem expireAt: assume 10min conservador

  return { token: parsed.accessToken, expiresAtMs }
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs) {
    return cachedToken.token
  }
  const fresh = await obtainAccessToken()
  cachedToken = fresh
  return fresh.token
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function lytexRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { baseUrl } = getConfig()
  const url = `${baseUrl}${path}`

  const doFetch = async (token: string): Promise<Response> =>
    fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  let res = await doFetch(await getAccessToken())

  // 401 → token possivelmente revogado/expirado no servidor: re-obtém UMA vez
  if (res.status === 401) {
    lytexLogger.warn({ path }, "lytex 401 — reobtendo access token")
    cachedToken = null
    res = await doFetch(await getAccessToken())
  }

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
// Unidade monetária — REAIS (domínio) → CENTAVOS (wire da API)
// ---------------------------------------------------------------------------

/**
 * Converte reais → centavos, arredondando ao centavo (Math.round — entradas
 * vêm de toMoneyNumber, já com no máximo 2 casas; o round é proteção contra
 * resíduo binário: 19.9 * 100 = 1989.9999... → 1990).
 */
function toCents(reais: number): number {
  return Math.round(reais * 100)
}

// ---------------------------------------------------------------------------
// Mapeamento v2 — Invoice ↔ tipos do app
// ---------------------------------------------------------------------------

/** Status observados na v2 (faturas reais): pending/paid/canceled/… */
function normalizeInvoiceStatus(raw: string | undefined): LytexChargeStatus {
  switch (raw) {
    case "paid":
      return "paid"
    case "canceled":
      return "canceled"
    case "expired":
      return "expired"
    case "refunded":
      return "refunded"
    case "failed":
      return "failed"
    case "waitingPayment":
      return "waitingPayment"
    default:
      return "pending"
  }
}

function mapInvoiceToQueryResponse(inv: LytexInvoiceV2): LytexQueryResponse {
  const status = normalizeInvoiceStatus(inv.status)
  const pix = inv.paymentMethods?.pix ?? null
  const isCard = !pix?.qrcode
  return {
    id: inv._id ?? "",
    status,
    transactionId: pix?.txId ?? inv._id ?? "",
    externalReference: inv.referenceId ?? "",
    amount: inv.totalValue ?? 0,
    method: pix?.qrcode ? "PIX" : "CARD",
    paidAmount: inv.lastPayment?.paidValue,
    paidAt: inv.lastPayment?.paidAt,
    qrCode: pix?.qrcode ?? undefined,
    cardLastDigits: inv.lastPayment?.cardNumber,
    cardBrand: inv.lastPayment?.cardBrand,
    lytexStatus: inv.status ?? "pending",
    createdAt: inv.createdAt ?? "",
    updatedAt: inv.updatedAt ?? inv.createdAt ?? "",
    // isCard evita undefined em objeto retornado a consumers
    ...(isCard ? {} : { qrCodeImage: undefined }),
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Normaliza o celular do cliente ao formato da API: somente dígitos, 10 ou 11
 * posições (DDD + número; prefixo de país é descartado com slice(-11)).
 *
 * A v2 EXIGE celular com dígitos para criar fatura: enviar null ou omitir
 * rejeita com 400 genérico em cliente novo (provado E2E 2026-10-06 —
 * L2=201 com celular, N1/N2/P3=400 sem). Falha aqui, cedo e com mensagem
 * acionável, em vez de transtornar com o 400 opaco da API.
 */
function normalizeContactPhone(rawPhone: string | undefined): string {
  const digits = (rawPhone ?? "").replace(/\D/g, "").slice(-11)
  if (digits.length < 10) {
    throw new LytexError(
      "Cobrança Lytex exige celular do cliente com DDD (10 ou 11 dígitos)",
      400,
      "client_contact_required",
    )
  }
  return digits
}

/**
 * Bloco `client` do create de invoice (variante com dados completos).
 *
 * Regras provadas E2E contra a API real (2026-10-06):
 * - `cellphone` com dígitos é OBRIGATÓRIO (acima);
 * - `email`: obrigatório no cadastro do cliente NOVO; se ausente, a chave
 *   deve ser OMITIDA — `email: null` rejeita com 400 genérico; cliente já
 *   cadastrado aceita sem email (201).
 */
function buildClientV2(customer: LytexCustomer) {
  const digits = customer.cpfCnpj.replace(/\D/g, "")
  return {
    type: (digits.length <= 11 ? "pf" : "pj") as "pf" | "pj",
    name: customer.name,
    cpfCnpj: digits,
    ...(customer.email ? { email: customer.email } : {}),
    cellphone: normalizeContactPhone(customer.phone),
  }
}

/**
 * Criar cobrança PIX.
 * Cria uma INVOICE v2 com paymentMethods.pix habilitado e retorna o QR code
 * copia-e-cola gerado pela Lytex.
 */
export async function createPixCharge(req: PixChargeRequest): Promise<PixChargeResponse> {
  const cents = toCents(req.amount)
  const body = {
    client: buildClientV2(req.customer),
    items: [
      {
        name: req.description ?? `Serviço Severinno (${req.externalReference})`,
        quantity: 1,
        value: cents,
      },
    ],
    // Sem `description` e sem `totalValue`: na v2, items e description são
    // MUTUAMENTE EXCLUSIVOS (400 "Os campos items e description não podem
    // ser enviados simultaneamente" — provado E2E 2026-10-06) e items já
    // determina o total (fatura R$2 criada sem totalValue → 201).
    dueDate: req.expiresAt ? req.expiresAt.slice(0, 10) : undefined,
    // Referência externa (booking.id) — consulta via GET /v2/invoices?referenceId=
    // (formato com ':' aceito e pesquisável — provado E2E 2026-10-06)
    referenceId: req.externalReference,
    paymentMethods: {
      pix: { enable: true },
      boleto: { enable: false },
      creditCard: { enable: false },
    },
  }

  const inv = await lytexRequest<LytexInvoiceV2>("POST", "/v2/invoices", body)

  return {
    id: inv._id ?? "",
    status: normalizeInvoiceStatus(inv.status),
    transactionId: inv.paymentMethods?.pix?.txId ?? inv._id ?? "",
    qrCode: inv.paymentMethods?.pix?.qrcode ?? "",
    qrCodeImage: "",
    pixKey: "",
    expiresAt: inv.dueDate ?? req.expiresAt ?? "",
    amount: inv.totalValue ?? cents,
    lytexStatus: inv.status ?? "pending",
    createdAt: inv.createdAt ?? new Date().toISOString(),
  }
}

/**
 * Criar cobrança no Cartão de Crédito.
 * Fluxo v2: tokeniza o cartão (/v2/invoices/card_token) e cria a invoice com
 * creditCardToken + paymentMethods.creditCard habilitado (maxParcels).
 */
export async function createCardCharge(req: CardChargeRequest): Promise<CardChargeResponse> {
  const cents = toCents(req.amount)
  const digits = req.customer.cpfCnpj.replace(/\D/g, "")
  const cardDigits = req.card.number.replace(/\D/g, "")

  const tokenRes = await lytexRequest<{ cardToken?: string; brand?: string }>(
    "POST",
    "/v2/invoices/card_token",
    {
      cpfCnpj: digits,
      number: cardDigits,
      holder: req.card.holderName,
      expiry: `${req.card.expiryMonth}${req.card.expiryYear}`.slice(0, 6),
      cvc: req.card.cvv,
    },
  )

  const installments = Math.min(Math.max(req.installments ?? 1, 1), 12)
  const body = {
    client: buildClientV2(req.customer),
    items: [
      {
        name: req.description ?? `Serviço Severinno (${req.externalReference})`,
        quantity: 1,
        value: cents,
      },
    ],
    // Sem `description` e sem `totalValue` — idem createPixCharge (regras
    // mutuamente exclusivas da v2, provadas E2E).
    dueDate: new Date().toISOString().slice(0, 10),
    referenceId: req.externalReference,
    creditCardToken: tokenRes.cardToken,
    paymentMethods: {
      pix: { enable: false },
      boleto: { enable: false },
      creditCard: { enable: true, maxParcels: installments },
    },
  }

  const inv = await lytexRequest<LytexInvoiceV2>("POST", "/v2/invoices", body)
  const status = normalizeInvoiceStatus(inv.status)

  return {
    id: inv._id ?? "",
    status,
    transactionId: inv._id ?? "",
    cardLastDigits: cardDigits.slice(-4),
    cardBrand: tokenRes.brand ?? "",
    installments,
    amount: inv.totalValue ?? cents,
    installmentAmount: Math.round((inv.totalValue ?? cents) / installments),
    lytexStatus: inv.status ?? "pending",
    createdAt: inv.createdAt ?? new Date().toISOString(),
  }
}

/**
 * Consultar status de uma fatura.
 */
export async function getCharge(chargeId: string): Promise<LytexQueryResponse> {
  const inv = await lytexRequest<LytexInvoiceV2>(
    "GET",
    `/v2/invoices/${encodeURIComponent(chargeId)}`,
  )
  return mapInvoiceToQueryResponse(inv)
}

/**
 * Cancelar uma fatura (antes de ser paga). A v2 usa PUT para cancelar.
 */
export async function cancelCharge(chargeId: string): Promise<void> {
  await lytexRequest("PUT", `/v2/invoices/cancel/${encodeURIComponent(chargeId)}`, {})
}

/**
 * Solicitar estorno/reembolso de uma fatura paga.
 * A v2 usa "solicitação de reembolso": POST /v2/refund-solicitation com
 * { _invoiceId, refundValue }.
 *
 * @param amount valor em CENTAVOS (unidade da API); omitir = estorno total
 */
export async function refundCharge(
  chargeId: string,
  amount?: number,
): Promise<LytexRefundResponse> {
  const body: Record<string, unknown> = {
    _invoiceId: chargeId,
    // refundValue é float na spec (minimum 1) — assumido em REAIS; o valor
    // do domínio chega em centavos e é convertido aqui.
    refundValue: amount !== undefined ? amount / 100 : undefined,
  }
  const res = await lytexRequest<Record<string, unknown>>("POST", "/v2/refund-solicitation", body)
  return {
    id: String(res._id ?? chargeId),
    status: "refunded",
    refundId: String(res._id ?? res.refundId ?? chargeId),
    refundedAmount: amount ?? Number(res.refundValue ?? 0),
    refundedAt: new Date().toISOString(),
  }
}

/**
 * Buscar fatura pelo ID de referência externa (booking.id).
 * A v2 filtra a listagem por `referenceId`.
 */
export async function getChargeByExternalReference(
  externalReference: string,
): Promise<LytexQueryResponse | null> {
  try {
    const res = await lytexRequest<{ results?: LytexInvoiceV2[] }>(
      "GET",
      `/v2/invoices?referenceId=${encodeURIComponent(externalReference)}`,
    )
    const first = res.results?.[0]
    return first ? mapInvoiceToQueryResponse(first) : null
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
export function verifyWebhookSignature(
  payload: LytexWebhookPayload,
  headerSignature?: string | null,
  rawBody?: string,
): boolean {
  const { clientSecret } = getConfig()
  if (!clientSecret || !payload) return false

  const rawSig = headerSignature || payload?.signature
  if (!rawSig || typeof rawSig !== "string") return false

  // Preferir o raw body bruto da requisição para o HMAC — evita problemas
  // de reordenação de chaves ou whitespace causados por JSON.stringify().
  // Fallback para JSON.stringify apenas em código legado/testes que não
  // passam rawBody (compatibilidade retroativa).
  let payloadStr: string
  if (rawBody) {
    // Se o body bruto contém o campo "signature", precisamos removê-lo
    // para o cálculo do HMAC (a Lytex assina sem ele).
    try {
      const parsed = JSON.parse(rawBody)
      delete parsed.signature
      payloadStr = JSON.stringify(parsed)
    } catch {
      payloadStr = rawBody
    }
  } else {
    const { signature: _ignored, ...payloadWithoutSignature } = payload
    payloadStr = JSON.stringify(payloadWithoutSignature)
  }

  // HMAC via crypto.createHmac (Node.js) — importado no topo do módulo
  const expected = createHmac("sha256", clientSecret).update(payloadStr).digest("hex")

  try {
    const a = Buffer.from(rawSig, "hex")
    const b = Buffer.from(expected, "hex")
    if (a.length !== b.length || a.length === 0) return false
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
 * Aguarda o processamento de uma transação assíncrona (cartão).
 * Faz polling a cada 7s por até 20 tentativas.
 * Retorna o status final.
 */
export async function pollChargeStatus(
  chargeId: string,
  maxAttempts = 20,
  intervalMs = 7_000,
): Promise<LytexQueryResponse> {
  let last: LytexQueryResponse | undefined
  for (let i = 0; i < maxAttempts; i++) {
    last = await getCharge(chargeId)
    if (last.status !== "waitingPayment" && last.status !== "pending") {
      return last
    }
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  // O loop esgotou: devolve a última consulta. Guarda extra para maxAttempts < 1
  // (nenhuma tentativa feita) — nesse caso consulta uma vez para devolver algo.
  return last ?? (await getCharge(chargeId))
}

// ---------------------------------------------------------------------------
// Wallet / Split operations (used by provider/lytex/route.ts)
// ---------------------------------------------------------------------------

/**
 * Result type for Lytex wallet query.
 */
export type LytexWallet = {
  /** Saldos em CENTAVOS (unidade da API) */
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
 * Fetch wallet balance.
 *
 * Na v2 a carteira é do ESTABELECIMENTO (`GET /v2/wallet`) — o recipientId
 * permanece na assinatura por compatibilidade com os call sites, mas não
 * compõe a URL. Mapeamento: pendingBalance ← futureBalance; totalReceived
 * não existe na v2 e é preenchido com o balance (melhor esforço, documentado).
 */
export async function getWallet(recipientId: string): Promise<LytexWallet> {
  void recipientId // compatibilidade de assinatura — ver doc acima
  const res = await lytexRequest<{
    balance?: number
    futureBalance?: number
  }>("GET", "/v2/wallet")
  return {
    balance: res.balance ?? 0,
    pendingBalance: res.futureBalance ?? 0,
    totalReceived: res.balance ?? 0,
  }
}

/**
 * List payment splits (transfers).
 *
 * Na v2: `GET /v2/splits/list/{type}` — usa type "all" com perPage=limit;
 * o recipientId permanece na assinatura por compatibilidade.
 */
export async function listSplits(recipientId: string, limit = 50): Promise<LytexSplit[]> {
  void recipientId // compatibilidade de assinatura — ver doc acima
  const res = await lytexRequest<{
    results?: Array<{
      _id?: string
      _hashId?: string
      _invoiceId?: string
      splitValue?: number
      status?: string
      createdAt?: string
    }>
  }>("GET", `/v2/splits/list/all?perPage=${limit}`)
  return (res.results ?? []).map((r) => ({
    _id: r._id ?? r._hashId ?? "",
    _invoiceId: r._invoiceId ?? "",
    value: r.splitValue ?? 0,
    status: r.status ?? "",
    createdAt: r.createdAt ?? "",
  }))
}

/**
 * Logger com prefixo [Lytex]
 */
export const lytexLogger = logger.child({ module: "lytex" })
