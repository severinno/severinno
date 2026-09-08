/**
 * chat-fraud-detector.ts — Anti-Fraud & Off-Platform Bypass Detection Engine
 *
 * Protects users and providers from transaction circumvention, external payment scams,
 * and unsafe contact sharing before escrow or booking confirmation.
 *
 * 100% Client-Safe & Server-Compatible (Pure TypeScript with zero runtime dependencies).
 */

export type FraudRiskLevel = "none" | "low" | "medium" | "high"

export interface FraudDetectionResult {
  hasRisk: boolean
  riskLevel: FraudRiskLevel
  detectedPatterns: string[]
  warningTitle?: string
  warningMessage?: string
  isOffPlatformPayment: boolean
  isContactSharing: boolean
}

// Regex patterns for detection
const PATTERNS = {
  // Brazilian phone numbers: (XX) 9XXXX-XXXX, XX 9XXXXXXXX, etc.
  phone: /(?:\(?0?[1-9]{2}\)?\s*)?(?:9\s*)?[6-9]\d{3}[-\s.]?\d{4}/g,

  // Obfuscated phone patterns (e.g. "9 8 7 6 5 4 3 2 1" or "9.8.7.6.5...")
  spacedDigits: /\b\d(?:\s*[-.]?\s*\d){7,10}\b/g,

  // WhatsApp keywords
  whatsapp: /\b(?:zap|wpp|whats(?:app)?|chama\s+no\s+zap|manda\s+zap|meu\s+numero)\b/i,

  // Emails (often used as contact sharing or Pix keys)
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

  // Brazilian CPF (valid format)
  cpf: /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g,

  // Brazilian CNPJ
  cnpj: /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}\/?\d{4}[-\s]?\d{2}\b/g,

  // Off-platform payment suggestions
  offPlatformPayment:
    /\b(?:por\s+fora|pagar?\s+por\s+fora|faz\s+por\s+fora|sem\s+(?:a\s+)?taxa|sem\s+o\s+app|dep[oó]sito\s+direto|transfer[eê]ncia\s+direta|ted\s+diret[ao]|manda\s+(?:o\s+)?pix|chave\s+pix|pix\s+direto|meu\s+pix)\b/i,

  // Banking / wire cues
  bankingTerms: /\b(?:ag[eê]ncia\s+\d+|conta\s+corrente|chave\s+aleat[oó]ria)\b/i,
}

/**
 * Analyzes a chat message or draft and checks for safety & anti-fraud risks.
 */
export function detectChatFraud(text: string): FraudDetectionResult {
  if (!text || typeof text !== "string") {
    return {
      hasRisk: false,
      riskLevel: "none",
      detectedPatterns: [],
      isOffPlatformPayment: false,
      isContactSharing: false,
    }
  }

  const normalized = text.trim()
  const detectedPatterns: string[] = []
  let isOffPlatformPayment = false
  let isContactSharing = false

  // 1. Check Off-Platform Payment Keywords
  if (PATTERNS.offPlatformPayment.test(normalized)) {
    detectedPatterns.push("Menção a pagamento fora da plataforma")
    isOffPlatformPayment = true
  }

  if (PATTERNS.bankingTerms.test(normalized)) {
    detectedPatterns.push("Dados bancários ou chave de pagamento externa")
    isOffPlatformPayment = true
  }

  // 2. Check WhatsApp keywords
  if (PATTERNS.whatsapp.test(normalized)) {
    detectedPatterns.push("Solicitação de contato via WhatsApp / Zap")
    isContactSharing = true
  }

  // 3. Check Phone Numbers
  const phoneMatches = normalized.match(PATTERNS.phone) || normalized.match(PATTERNS.spacedDigits)
  if (phoneMatches && phoneMatches.length > 0) {
    // Exclude potential time or simple numbers (like 10:00 or 150.00)
    const filteredPhones = phoneMatches.filter((p) => p.replace(/\D/g, "").length >= 8)
    if (filteredPhones.length > 0) {
      detectedPatterns.push("Compartilhamento de número de telefone")
      isContactSharing = true
    }
  }

  // 4. Check Email
  if (PATTERNS.email.test(normalized)) {
    detectedPatterns.push("Endereço de e-mail / Chave Pix externa")
    isContactSharing = true
  }

  // 5. Check CPF / CNPJ
  const cpfMatches = normalized.match(PATTERNS.cpf)
  const cnpjMatches = normalized.match(PATTERNS.cnpj)
  if (cpfMatches || cnpjMatches) {
    detectedPatterns.push("Documento (CPF/CNPJ) ou possível chave Pix")
    isOffPlatformPayment = true
  }

  // Determine overall risk level
  let riskLevel: FraudRiskLevel = "none"
  if (isOffPlatformPayment && isContactSharing) {
    riskLevel = "high"
  } else if (isOffPlatformPayment) {
    riskLevel = "high"
  } else if (isContactSharing) {
    riskLevel = "medium"
  } else if (detectedPatterns.length > 0) {
    riskLevel = "low"
  }

  const hasRisk = riskLevel !== "none"

  let warningTitle: string | undefined
  let warningMessage: string | undefined

  if (riskLevel === "high") {
    warningTitle = "Aviso de Segurança — Pagamento Protegido"
    warningMessage =
      "Detectamos tentativa de combinar pagamentos ou dados bancários por fora. Negociações fora do Severinno perdem a Garantia contra Danos, o Seguro e a proteção do escrow."
  } else if (riskLevel === "medium") {
    warningTitle = "Mantenha a conversa no Severinno"
    warningMessage =
      "Para sua segurança, mantenha as conversas e orçamentos registrados aqui. O histórico é sua garantia em caso de imprevistos."
  } else if (riskLevel === "low") {
    warningTitle = "Dica de Segurança"
    warningMessage = "Priorize fechar orçamentos e agendamentos oficiais dentro da plataforma."
  }

  return {
    hasRisk,
    riskLevel,
    detectedPatterns,
    warningTitle,
    warningMessage,
    isOffPlatformPayment,
    isContactSharing,
  }
}
