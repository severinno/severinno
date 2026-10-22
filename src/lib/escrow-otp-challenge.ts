/**
 * escrow-otp-challenge.ts — Sentinela de Liberação de Custódia com Desafio OTP
 *
 * Exige confirmação por código OTP de 4 dígitos (via WhatsApp ou SMS) para:
 * 1. Agendamentos de alto valor (>= R$ 250,00).
 * 2. Casos com risco operacional (ex: ausência de telemetria de check-in GPS validada).
 * 3. Previne liberações acidentais quando o cliente responde "SIM" ou "OK" no WhatsApp.
 */

import crypto from "node:crypto"
import { cacheGet, cacheSet, cacheInvalidate } from "@/lib/redis"
import { toMoneyNumber, type MoneyInput } from "./money"

export const HIGH_VALUE_THRESHOLD = 250.0 // R$ 250,00
export const OTP_TTL_SECONDS = 600 // 10 minutos
export const MAX_OTP_ATTEMPTS = 3

interface EscrowOtpRecord {
  otpHash: string
  clientId: string
  attemptsLeft: number
  expiresAt: number
}

/**
 * Avalia se o agendamento exige desafio OTP para liberação da custódia financeira.
 */
export function requiresOtpForRelease(booking: {
  amount: MoneyInput
  geofenceVerified?: boolean
  isUrgent?: boolean
}): boolean {
  const amount = toMoneyNumber(booking.amount)
  if (amount >= HIGH_VALUE_THRESHOLD) {
    return true
  }
  // Se for agendamento sem validação presencial de geofence
  if (booking.geofenceVerified === false && amount >= 100) {
    return true
  }
  return false
}

/**
 * Gera um OTP seguro de 4 dígitos e armazena com TTL e limite de tentativas.
 */
export async function generateEscrowOtp(
  bookingId: string,
  clientId: string,
): Promise<{ otp: string; expiresAt: number }> {
  // Código numérico aleatório criptograficamente seguro entre 1000 e 9999
  const otpNumber = 1000 + crypto.randomInt(9000)
  const otp = otpNumber.toString()

  const otpHash = crypto.createHash("sha256").update(otp).digest("hex")
  const expiresAt = Date.now() + OTP_TTL_SECONDS * 1000

  const record: EscrowOtpRecord = {
    otpHash,
    clientId,
    attemptsLeft: MAX_OTP_ATTEMPTS,
    expiresAt,
  }

  await cacheSet(`escrow:otp:${bookingId}`, record, OTP_TTL_SECONDS)

  return { otp, expiresAt }
}

/**
 * Verifica o OTP com proteção anti-força-bruta e tempo constante.
 */
export async function verifyEscrowOtp(
  bookingId: string,
  inputOtp: string,
  clientId?: string,
): Promise<{ success: boolean; error?: string }> {
  const cacheKey = `escrow:otp:${bookingId}`
  const record = await cacheGet<EscrowOtpRecord>(cacheKey)

  if (!record || Date.now() > record.expiresAt) {
    return {
      success: false,
      error: "Código OTP expirado ou não encontrado. Solicite um novo código.",
    }
  }

  if (clientId && record.clientId !== clientId) {
    return {
      success: false,
      error: "Acesso não autorizado para validação deste código.",
    }
  }

  if (record.attemptsLeft <= 0) {
    await cacheInvalidate(cacheKey)
    return {
      success: false,
      error: "Limite de tentativas excedido. Código bloqueado por segurança.",
    }
  }

  const cleanInput = (inputOtp || "").replace(/\D/g, "")
  if (cleanInput.length !== 4) {
    return {
      success: false,
      error: "O código OTP deve conter exatamente 4 dígitos.",
    }
  }

  const inputHash = crypto.createHash("sha256").update(cleanInput).digest("hex")

  // Comparação em tempo constante para mitigar timing attack
  const isMatch =
    inputHash.length === record.otpHash.length &&
    crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(record.otpHash))

  if (!isMatch) {
    record.attemptsLeft--
    if (record.attemptsLeft > 0) {
      await cacheSet(
        cacheKey,
        record,
        Math.max(1, Math.floor((record.expiresAt - Date.now()) / 1000)),
      )
      return {
        success: false,
        error: `Código incorreto. Você tem mais ${record.attemptsLeft} tentativa(s).`,
      }
    } else {
      await cacheInvalidate(cacheKey)
      return {
        success: false,
        error: "Limite de tentativas excedido. O código foi invalidado.",
      }
    }
  }

  // Sucesso: consome o código para impedir reuso
  await cacheInvalidate(cacheKey)
  return { success: true }
}

/**
 * Formata o texto do desafio para WhatsApp.
 */
export function formatEscrowOtpWhatsAppMessage(
  booking: { id: string; amount: number; providerName?: string },
  otp: string,
): string {
  const shortId = booking.id.length > 8 ? booking.id.slice(-6).toUpperCase() : booking.id

  return (
    `🔒 *Confirmação de Liberação Segura — Severinno*\n\n` +
    `Você solicitou a liberação do pagamento sob custódia para o agendamento *#${shortId}* no valor de *R$ ${booking.amount.toFixed(2)}*.\n\n` +
    `Por se tratar de um valor protegido, seu código de segurança é:\n` +
    `👉 *${otp}*\n\n` +
    `Para concluir a liberação do repasse ao profissional, responda a esta mensagem digitando apenas o código de 4 dígitos (*${otp}*).\n\n` +
    `⏱️ _Válido por 10 minutos. Nunca informe este código para terceiros antes do serviço estar 100% finalizado._`
  )
}
