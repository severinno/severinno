/**
 * leak-detector.ts — Anti-Fraud & Off-Platform Transaction Detection Engine.
 *
 * Protects platform users by detecting attempts to conduct transactions
 * outside Severinno's Escrow protection (e.g. direct PIX, "pagar por fora", "manda no zap").
 */

export type LeakDetectionResult = {
  isSuspicious: boolean
  riskLevel: "NONE" | "LOW" | "MEDIUM" | "HIGH"
  warning: string | null
  detectedPatterns: string[]
}

const SUSPICIOUS_PATTERNS = [
  {
    regex:
      /(?:pago|pagar|fa[çc]o|acerto|passo)\s+(?:por\s+fora|em\s+m[ãa]os|no\s+dinheiro|direto)/i,
    reason: "Tentativa de pagamento fora da plataforma",
    level: "HIGH" as const,
  },
  {
    regex: /(?:chave\s+pix|meu\s+pix|manda\s+o\s+pix|pix\s+direto|pix\s+pra\s+mim)/i,
    reason: "Solicitação de chave PIX direta externa",
    level: "HIGH" as const,
  },
  {
    regex:
      /(?:chama|manda|conversa|fala|adiciona)\s+(?:no\s+zap|no\s+whatsapp|no\s+whats|no\s+wpp)/i,
    reason: "Tentativa de desvio de atendimento para WhatsApp externo antes da contratação",
    level: "MEDIUM" as const,
  },
  {
    regex: /(?:\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4})/,
    reason: "Compartilhamento de número de telefone",
    level: "LOW" as const,
  },
  {
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    reason: "Compartilhamento de endereço de e-mail",
    level: "LOW" as const,
  },
]

/**
 * Analyze a chat message or quote note for off-platform disintermediation risks.
 */
export function analyzeMessageForLeakage(content: string): LeakDetectionResult {
  if (!content || typeof content !== "string") {
    return {
      isSuspicious: false,
      riskLevel: "NONE",
      warning: null,
      detectedPatterns: [],
    }
  }

  const detected: string[] = []
  let highestLevel: "NONE" | "LOW" | "MEDIUM" | "HIGH" = "NONE"

  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.regex.test(content)) {
      detected.push(pattern.reason)
      if (pattern.level === "HIGH") {
        highestLevel = "HIGH"
      } else if (pattern.level === "MEDIUM" && highestLevel !== "HIGH") {
        highestLevel = "MEDIUM"
      } else if (pattern.level === "LOW" && highestLevel === "NONE") {
        highestLevel = "LOW"
      }
    }
  }

  let warning: string | null = null
  if (highestLevel === "HIGH") {
    warning =
      "⚠️ Atenção: Pagamentos realizados fora do Severinno perdem a proteção de Custódia Segura (Escrow) e a garantia do serviço."
  } else if (highestLevel === "MEDIUM") {
    warning =
      "💡 Dica de Segurança: Mantenha as mensagens no chat do Severinno para registrar o histórico e assegurar a cobertura da garantia."
  }

  return {
    isSuspicious: detected.length > 0,
    riskLevel: highestLevel,
    warning,
    detectedPatterns: detected,
  }
}
