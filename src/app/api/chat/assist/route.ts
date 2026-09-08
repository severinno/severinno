export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import ZAI from "z-ai-web-dev-sdk"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * POST /api/chat/assist
 *
 * AI copilot for the P2P chat — generates contextual reply suggestions
 * for providers during client negotiations.
 *
 * Body: {
 *   messages: Array<{ role: string, content: string, fromName?: string }>,
 *   context?: { serviceCategory?: string, bookingStatus?: string }
 * }
 *
 * Returns: {
 *   suggestions: string[],
 *   intent: string,
 *   urgency: "low" | "medium" | "high" | "critical"
 * }
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser()
    await assertRateLimit(req, RATE_LIMITS.general)

    const body = await req.json()
    const messages: Array<{ role: string; content: string; fromName?: string }> =
      body.messages ?? []
    const context: { serviceCategory?: string; bookingStatus?: string } = body.context ?? {}

    if (!messages.length) {
      return NextResponse.json({ error: "Mensagens são obrigatórias." }, { status: 400 })
    }

    // Build conversation transcript for the LLM
    const transcript = messages
      .slice(-15)
      .map((m) => {
        const name = m.fromName ?? (m.role === "user" ? "Cliente" : "Prestador")
        return `${name}: ${m.content}`
      })
      .join("\n")

    const contextInfo = [
      context.serviceCategory ? `Categoria do serviço: ${context.serviceCategory}` : null,
      context.bookingStatus ? `Status do agendamento: ${context.bookingStatus}` : null,
    ]
      .filter(Boolean)
      .join("\n")

    const systemPrompt = `Você é um assistente IA do Severinno Marketplace que ajuda PRESTADORES DE SERVIÇO a responder mensagens de clientes de forma profissional, rápida e eficiente.

CONTEXTO DA PLATAFORMA:
- Severinno é um marketplace de serviços residenciais verificados (encanador, eletricista, pintor, etc.)
- As conversas são entre prestadores e clientes que estão negociando serviços
- Pagamentos devem ser feitos SEMPRE pela plataforma (Severinno Escrow) para garantia mútua
${contextInfo ? `\nCONTEXTO DO SERVIÇO:\n${contextInfo}` : ""}

SUA TAREFA:
Analise a conversa abaixo e retorne um JSON com:
1. "suggestions": Array com exatamente 3 sugestões de resposta curtas (máx 120 chars cada) que o prestador pode enviar. Devem ser naturais, profissionais e em português brasileiro.
2. "intent": A intenção principal do cliente (uma de: "orcamento", "agendamento", "duvida", "reclamacao", "elogio", "urgencia", "geral")
3. "urgency": Nível de urgência ("low", "medium", "high", "critical")

REGRAS:
- Sugestões devem ser em 1ª pessoa do prestador
- Nunca sugira negociar fora da plataforma
- Se o cliente parecer insatisfeito, priorize empatia e resolução
- Se for pedido de orçamento, sugira valores razoáveis ou peça mais detalhes
- Respostas curtas e diretas (estilo WhatsApp)

CONVERSA:
${transcript}

Responda APENAS com o JSON válido, sem markdown ou texto adicional.`

    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant" as const, content: systemPrompt },
        { role: "user" as const, content: "Analise a conversa e gere as sugestões." },
      ],
      thinking: { type: "disabled" },
    })

    const raw = completion.choices[0]?.message?.content ?? ""

    // Parse JSON from response (handle markdown fences)
    let parsed: { suggestions: string[]; intent: string; urgency: string }
    try {
      const jsonStr = raw
        .replace(/```json\s*\n?/gi, "")
        .replace(/```\s*$/gi, "")
        .trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      // Fallback if LLM didn't return valid JSON
      parsed = {
        suggestions: [
          "Obrigado pelo contato! Posso ajudar sim.",
          "Vou verificar minha agenda e te retorno.",
          "Poderia me enviar mais detalhes sobre o serviço?",
        ],
        intent: "geral",
        urgency: "low",
      }
    }

    // Ensure valid structure
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.slice(0, 3).map(String)
      : ["Obrigado pelo contato!", "Vou verificar e te retorno.", "Poderia dar mais detalhes?"]

    const validIntents = [
      "orcamento",
      "agendamento",
      "duvida",
      "reclamacao",
      "elogio",
      "urgencia",
      "geral",
    ]
    const intent = validIntents.includes(parsed.intent) ? parsed.intent : "geral"

    const validUrgencies = ["low", "medium", "high", "critical"]
    const urgency = validUrgencies.includes(parsed.urgency) ? parsed.urgency : "low"

    return NextResponse.json({ suggestions, intent, urgency })
  } catch (e) {
    return handleError(e)
  }
}
