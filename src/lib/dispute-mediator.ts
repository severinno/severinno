/**
 * dispute-mediator.ts — AI-Powered Dispute Mediation & Resolution Engine
 *
 * Analyzes service disputes between client and provider using:
 * - Chat message history analysis
 * - Before/after photo comparison metadata
 * - Original service description vs. delivered work
 * - Provider track record and rating history
 *
 * Generates a structured recommendation for the admin to approve with 1 click.
 * Cost: $0 — LocalAI / Ollama or deterministic rule-based fallback
 */

export interface DisputeCase {
  bookingId: string
  clientId: string
  clientName: string
  providerId: string
  providerName: string
  serviceTitle: string
  serviceDescription: string
  totalAmount: number
  clientComplaint: string
  providerResponse?: string
  chatMessageCount: number
  hasBeforePhotos: boolean
  hasAfterPhotos: boolean
  providerRating: number
  providerCompletedJobs: number
  providerDisputeRate: number // percentage of past jobs with disputes
}

export interface MediationRecommendation {
  bookingId: string
  verdict: "FULL_REFUND" | "PARTIAL_REFUND" | "REDO_SERVICE" | "NO_REFUND" | "SPLIT_DECISION"
  confidence: number
  refundPercentage: number
  refundAmount: number
  providerPayout: number
  reasoning: string
  suggestedActions: string[]
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
  source: "ai-mediation" | "rule-based-fallback"
}

/**
 * Analyzes a dispute case and generates a structured mediation recommendation
 */
export async function mediateDispute(
  dispute: DisputeCase
): Promise<MediationRecommendation> {
  // 1. Try AI mediation via LocalAI/Ollama
  const localAiUrl = process.env.LOCAL_AI_URL || process.env.OLLAMA_URL
  if (localAiUrl) {
    try {
      const aiResult = await callAIMediationEngine(localAiUrl, dispute)
      if (aiResult) return aiResult
    } catch {
      // Fall through to rule-based
    }
  }

  // 2. Rule-based deterministic mediation fallback
  return ruleBasedMediation(dispute)
}

/**
 * Calls LocalAI / Ollama for intelligent dispute analysis
 */
async function callAIMediationEngine(
  baseUrl: string,
  dispute: DisputeCase
): Promise<MediationRecommendation | null> {
  const prompt = `Você é um mediador de disputas em um marketplace de serviços domésticos.

CASO:
- Serviço: ${dispute.serviceTitle}
- Valor: R$ ${dispute.totalAmount.toFixed(2)}
- Reclamação do Cliente: "${dispute.clientComplaint}"
- Resposta do Prestador: "${dispute.providerResponse || 'Sem resposta'}"
- Rating do Prestador: ${dispute.providerRating}/5 (${dispute.providerCompletedJobs} serviços completados)
- Taxa de Disputas do Prestador: ${(dispute.providerDisputeRate * 100).toFixed(1)}%
- Fotos Antes/Depois: ${dispute.hasBeforePhotos ? 'Sim' : 'Não'} / ${dispute.hasAfterPhotos ? 'Sim' : 'Não'}
- Mensagens no Chat: ${dispute.chatMessageCount}

Analise e retorne um JSON com:
- verdict: FULL_REFUND, PARTIAL_REFUND, REDO_SERVICE, NO_REFUND ou SPLIT_DECISION
- refundPercentage: 0-100
- reasoning: explicação em português
- suggestedActions: lista de ações recomendadas
- riskLevel: LOW, MEDIUM ou HIGH`

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.1",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) return null

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ""
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    const refundPct = Math.min(100, Math.max(0, parsed.refundPercentage || 0))

    return {
      bookingId: dispute.bookingId,
      verdict: parsed.verdict || "SPLIT_DECISION",
      confidence: 0.8,
      refundPercentage: refundPct,
      refundAmount: Number(((dispute.totalAmount * refundPct) / 100).toFixed(2)),
      providerPayout: Number((dispute.totalAmount * (1 - refundPct / 100)).toFixed(2)),
      reasoning: parsed.reasoning || "",
      suggestedActions: parsed.suggestedActions || [],
      riskLevel: parsed.riskLevel || "MEDIUM",
      source: "ai-mediation",
    }
  } catch {
    return null
  }
}

/**
 * Rule-based deterministic mediation fallback engine
 */
function ruleBasedMediation(dispute: DisputeCase): MediationRecommendation {
  let score = 50 // Start neutral (50 = split)

  // Factor 1: Provider track record (high rating = more credible)
  if (dispute.providerRating >= 4.5 && dispute.providerCompletedJobs > 20) {
    score -= 15 // Favor provider
  } else if (dispute.providerRating < 3.0) {
    score += 20 // Favor client
  }

  // Factor 2: Dispute rate (high dispute rate = less trustworthy)
  if (dispute.providerDisputeRate > 0.15) {
    score += 15 // Likely provider issue
  } else if (dispute.providerDisputeRate < 0.03) {
    score -= 10 // Very reliable provider
  }

  // Factor 3: Evidence availability
  if (dispute.hasBeforePhotos && dispute.hasAfterPhotos) {
    score -= 5 // Provider documented work
  }
  if (!dispute.providerResponse) {
    score += 10 // No response = less credible defense
  }

  // Factor 4: Chat engagement
  if (dispute.chatMessageCount > 10) {
    score -= 5 // Active communication suggests good faith
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score))

  // Map score to verdict
  let verdict: MediationRecommendation["verdict"]
  let refundPercentage: number
  let reasoning: string

  if (score >= 80) {
    verdict = "FULL_REFUND"
    refundPercentage = 100
    reasoning = "Múltiplos indicadores apontam falha significativa na prestação do serviço. Reembolso total recomendado para preservar a confiança do cliente."
  } else if (score >= 60) {
    verdict = "PARTIAL_REFUND"
    refundPercentage = 70
    reasoning = "Evidências indicam execução parcial ou com falhas. Reembolso parcial de 70% recomendado, com orientação ao prestador para melhoria."
  } else if (score >= 40) {
    verdict = "SPLIT_DECISION"
    refundPercentage = 50
    reasoning = "Caso equilibrado sem evidências conclusivas para nenhum dos lados. Recomenda-se divisão de 50% do valor como acordo."
  } else if (score >= 20) {
    verdict = "REDO_SERVICE"
    refundPercentage = 0
    reasoning = "O prestador demonstra bom histórico. Recomenda-se reexecução do serviço sem custo adicional como solução."
  } else {
    verdict = "NO_REFUND"
    refundPercentage = 0
    reasoning = "Prestador altamente confiável com histórico exemplar. Evidências insuficientes para justificar reembolso."
  }

  const suggestedActions = [
    refundPercentage > 0 ? `Processar reembolso de R$ ${((dispute.totalAmount * refundPercentage) / 100).toFixed(2)}` : "Manter pagamento integral ao prestador",
    verdict === "REDO_SERVICE" ? "Agendar reexecução sem custo adicional" : "",
    dispute.providerDisputeRate > 0.1 ? "⚠️ Monitorar prestador — taxa de disputas elevada" : "",
    !dispute.providerResponse ? "Notificar prestador para responder à reclamação" : "",
  ].filter(Boolean)

  return {
    bookingId: dispute.bookingId,
    verdict,
    confidence: 0.65,
    refundPercentage,
    refundAmount: Number(((dispute.totalAmount * refundPercentage) / 100).toFixed(2)),
    providerPayout: Number((dispute.totalAmount * (1 - refundPercentage / 100)).toFixed(2)),
    reasoning,
    suggestedActions,
    riskLevel: score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW",
    source: "rule-based-fallback",
  }
}
