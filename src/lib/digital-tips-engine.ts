/**
 * digital-tips-engine.ts — Gorjetas Digitais Instantâneas com Repasse 100% Líquido
 *
 * Permite ao cliente recompensar prestadores pelo atendimento de excelência no checkout
 * ou na avaliação pós-serviço.
 *
 * Regra de Negócio Irrevogável da Plataforma:
 * - A taxa do Severinno sobre gorjetas é rigorosamente 0.00% (Zero Taxa).
 * - 100% do valor da gorjeta é creditado integralmente na chave Pix do prestador.
 */

import { createHash, randomBytes } from "crypto"

export interface DigitalTipReceipt {
  tipId: string
  bookingId: string
  clientName: string
  providerName: string
  providerPixKey: string
  amount: number
  platformFee: number
  providerNetShare: number
  message?: string
  receiptHash: string
  createdAt: string
  pixTransferPayload: {
    amountCents: number
    destinationKey: string
    description: string
  }
  whatsappNotification: string
}

export interface CalculateTipParams {
  bookingId: string
  clientName: string
  providerName: string
  providerPixKey: string
  amount: number
  message?: string
}

const MIN_TIP_AMOUNT = 2.0 // R$ 2,00
const MAX_TIP_AMOUNT = 500.0 // R$ 500,00

/**
 * Valida e calcula a distribuição contábil da gorjeta (100% prestador / 0% plataforma).
 */
export function calculateTipDistribution(amount: number): {
  amount: number
  platformFee: number
  providerNetShare: number
  isValid: boolean
  error?: string
} {
  if (typeof amount !== "number" || isNaN(amount)) {
    return {
      amount: 0,
      platformFee: 0,
      providerNetShare: 0,
      isValid: false,
      error: "Valor da gorjeta inválido",
    }
  }

  const rounded = Math.round(amount * 100) / 100

  if (rounded < MIN_TIP_AMOUNT) {
    return {
      amount: rounded,
      platformFee: 0,
      providerNetShare: 0,
      isValid: false,
      error: `Valor mínimo da gorjeta é R$ ${MIN_TIP_AMOUNT.toFixed(2)}`,
    }
  }

  if (rounded > MAX_TIP_AMOUNT) {
    return {
      amount: rounded,
      platformFee: 0,
      providerNetShare: 0,
      isValid: false,
      error: `Valor máximo permitido de gorjeta é R$ ${MAX_TIP_AMOUNT.toFixed(2)}`,
    }
  }

  return {
    amount: rounded,
    platformFee: 0.0,
    providerNetShare: rounded,
    isValid: true,
  }
}

/**
 * Processa a gorjeta e gera o recibo digital criptográfico com payload Pix.
 */
export function processDigitalTip(params: CalculateTipParams): DigitalTipReceipt {
  const { bookingId, clientName, providerName, providerPixKey, amount, message } = params

  const calc = calculateTipDistribution(amount)
  if (!calc.isValid) {
    throw new Error(calc.error || "Erro ao calcular gorjeta")
  }

  const tipId = `tip_${Date.now()}_${randomBytes(4).toString("hex")}`
  const createdAt = new Date().toISOString()

  // Geração do selo digital SHA-256
  const canonicalData = `${tipId}|${bookingId}|${calc.amount.toFixed(2)}|${providerPixKey}|${createdAt}`
  const receiptHash = createHash("sha256").update(canonicalData).digest("hex")

  // Payload formatado para transferência Lytex / Pix imediata
  const pixTransferPayload = {
    amountCents: Math.round(calc.amount * 100),
    destinationKey: providerPixKey,
    description: `Gorjeta Severinno #${bookingId.slice(-6)} - ${clientName}`,
  }

  const whatsappNotification = `🎉 *Você recebeu uma Gorjeta de R$ ${calc.amount.toFixed(2)}!*\n\nO cliente *${clientName}* reconheceu seu ótimo atendimento no serviço #${bookingId.slice(-6)}!${message ? `\n\nMensagem do cliente: "${message}"` : ""}\n\n✅ 100% do valor já foi enviado via Pix para sua chave cadastrada sem nenhuma taxa da plataforma. Parabéns pelo excelente trabalho!`

  return {
    tipId,
    bookingId,
    clientName,
    providerName,
    providerPixKey,
    amount: calc.amount,
    platformFee: 0.0,
    providerNetShare: calc.amount,
    message,
    receiptHash,
    createdAt,
    pixTransferPayload,
    whatsappNotification,
  }
}
