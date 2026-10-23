/**
 * anti-disintermediation-guard.ts — Guardião Anti-Bypass e Proteção de Receita
 *
 * Intercepta mensagens no chat e canais da plataforma, detectando e mascarando
 * ativamente dados de contato (telefone, e-mail, CPF, chave Pix) e tentativas de
 * desvio do pagamento para fora da plataforma ("pagar por fora", "fazer no Pix").
 *
 * Garante a segurança financeira da plataforma e a proteção jurídica (seguro e garantia)
 * dos clientes e prestadores.
 */

import { detectChatFraud, FraudRiskLevel } from "./chat-fraud-detector"

export const MASK_BADGE = "[CONTATO OCULTO - TRANSAÇÃO SEGURA SEVERINNO]"

// Regex detalhados para substituição e mascaramento
const REDACTION_PATTERNS = [
  {
    type: "PHONE",
    regex: /(?:\(?0?[1-9]{2}\)?\s*)?(?:9\s*)?[6-9]\d{3}[-\s.]?\d{4}/g,
    description: "Telefone / Celular",
  },
  {
    type: "SPACED_PHONE",
    regex: /\b\d(?:\s*[-.]?\s*\d){7,10}\b/g,
    description: "Telefone com dígitos espaçados",
  },
  {
    type: "EMAIL",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    description: "Endereço de E-mail / Chave Pix E-mail",
  },
  {
    type: "CPF",
    regex: /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g,
    description: "CPF / Chave Pix Documento",
  },
  {
    type: "CNPJ",
    regex: /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}\/?\d{4}[-\s]?\d{2}\b/g,
    description: "CNPJ / Chave Pix Empresa",
  },
  {
    type: "OFF_PLATFORM_KEYWORD",
    regex:
      /\b(?:chama\s+no\s+zap|manda\s+zap|meu\s+zap|pagar?\s+por\s+fora|faz\s+por\s+fora|sem\s+(?:a\s+)?taxa|sem\s+o\s+app|pix\s+direto|meu\s+pix|manda\s+o\s+pix)\b/gi,
    description: "Termo explícito de desvio de pagamento",
  },
]

// Armazenamento em memória para tracking de reincidência com TTL (fallback ao Redis)
interface RecidivismRecord {
  count: number
  lastAttemptAt: number
}
const recidivismStore = new Map<string, RecidivismRecord>()

export interface GuardEvaluationResult {
  originalText: string
  safeText: string
  isMasked: boolean
  blocked: boolean
  riskLevel: FraudRiskLevel
  detectedViolations: string[]
  recidivismCount: number
  isRecidivist: boolean
  systemNotice?: string
}

/**
 * Mascara ativamente números, e-mails, chaves Pix e termos de desvio.
 */
export function maskOffPlatformData(text: string): {
  maskedText: string
  isModified: boolean
  detectedTypes: string[]
} {
  if (!text || typeof text !== "string") {
    return { maskedText: "", isModified: false, detectedTypes: [] }
  }

  let result = text
  const detectedTypes: string[] = []

  for (const pattern of REDACTION_PATTERNS) {
    if (pattern.regex.test(result)) {
      detectedTypes.push(pattern.description)
      result = result.replace(pattern.regex, MASK_BADGE)
    }
  }

  return {
    maskedText: result,
    isModified: result !== text,
    detectedTypes,
  }
}

/**
 * Registra tentativa de desintermediação e avalia reincidência do usuário.
 */
export function trackDisintermediationStrike(
  userId: string,
  now = Date.now(),
  windowMs = 60 * 60 * 1000, // janela de 1 hora
): { count: number; isRecidivist: boolean } {
  const existing = recidivismStore.get(userId)
  let count = 1

  if (existing && now - existing.lastAttemptAt < windowMs) {
    count = existing.count + 1
  }

  recidivismStore.set(userId, { count, lastAttemptAt: now })

  return {
    count,
    isRecidivist: count >= 3,
  }
}

/**
 * Limpa o histórico de strikes (usado em testes ou anistia administrativa).
 */
export function resetDisintermediationStrikes(userId: string): void {
  recidivismStore.delete(userId)
}

/**
 * Processa a mensagem completa com inspeção de risco, mascaramento ativo
 * e governança de reincidência.
 */
export function processChatMessageWithSafety(
  userId: string,
  rawText: string,
  options?: {
    bookingId?: string
    allowDirectContact?: boolean // se a reserva já tiver sido confirmada e o escrow pago
    now?: number
  },
): GuardEvaluationResult {
  // Se a reserva já estiver confirmada com escrow pago, o contato direto pode ser liberado se configurado
  if (options?.allowDirectContact) {
    return {
      originalText: rawText,
      safeText: rawText,
      isMasked: false,
      blocked: false,
      riskLevel: "none",
      detectedViolations: [],
      recidivismCount: 0,
      isRecidivist: false,
    }
  }

  // 1. Analisa risco com o motor de fraude
  const fraudCheck = detectChatFraud(rawText)

  // 2. Aplica mascaramento ativo
  const { maskedText, isModified, detectedTypes } = maskOffPlatformData(rawText)

  // 3. Avalia reincidência se houve infração
  let strikeInfo = { count: 0, isRecidivist: false }
  if (fraudCheck.hasRisk || isModified) {
    strikeInfo = trackDisintermediationStrike(userId, options?.now)
  }

  // 4. Se o usuário for reincidente grave (>= 3 tentativas em 1h com termos explícitos), bloqueia a mensagem
  const blocked = strikeInfo.isRecidivist && fraudCheck.riskLevel === "high"

  let systemNotice: string | undefined
  if (blocked) {
    systemNotice =
      "Mensagem bloqueada automaticamente. Você atingiu o limite de alertas de compartilhamento externo de contato. Mantenha a negociação no Severinno para sua segurança jurídica."
  } else if (isModified) {
    systemNotice =
      "Dados de contato e chaves financeiras foram ocultados por segurança. A negociação e pagamento devem ser concluídos na plataforma para garantir o seguro contra danos e o escrow."
  }

  return {
    originalText: rawText,
    safeText: blocked ? "[MENSAGEM BLOQUEADA PELO SISTEMA DE SEGURANÇA]" : maskedText,
    isMasked: isModified,
    blocked,
    riskLevel: fraudCheck.riskLevel,
    detectedViolations: detectedTypes.length > 0 ? detectedTypes : fraudCheck.detectedPatterns,
    recidivismCount: strikeInfo.count,
    isRecidivist: strikeInfo.isRecidivist,
    systemNotice,
  }
}
