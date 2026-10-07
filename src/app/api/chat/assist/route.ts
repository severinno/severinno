export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import ZAI from "z-ai-web-dev-sdk"
import { requireUser } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withRoute } from "@/lib/api-route"

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
export const POST = withRoute("api.chat.assist.POST", async (req) => {
  await requireUser()
  await assertRateLimit(req, RATE_LIMITS.general)

  const body = await req.json()
  const messages: Array<{ role: string; content: string; fromName?: string }> = body.messages ?? []
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

  let suggestions: string[] = []
  let intent = "geral"
  let urgency = "low"

  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant" as const, content: systemPrompt },
        { role: "user" as const, content: "Analise a conversa e gere as sugestões." },
      ],
      thinking: { type: "disabled" },
    })

    const raw = completion.choices[0]?.message?.content ?? ""
    const jsonStr = raw
      .replace(/```json\s*\n?/gi, "")
      .replace(/```\s*$/gi, "")
      .trim()
    const parsed = JSON.parse(jsonStr)

    if (Array.isArray(parsed.suggestions)) {
      suggestions = parsed.suggestions.slice(0, 3).map(String)
    }
    if (parsed.intent) intent = parsed.intent
    if (parsed.urgency) urgency = parsed.urgency
  } catch {
    // Fallback: rule-based contextual generator when ZAI is unavailable or fails
    const lastMsg = (messages[messages.length - 1]?.content || "").toLowerCase()
    if (/preço|quanto|valor|orçamento|cobrar|custa/.test(lastMsg)) {
      intent = "orcamento"
      suggestions = [
        "Consigo te passar um valor mais exato se me enviar fotos.",
        "Para esse tipo de serviço, a média é entre R$ 100 e R$ 250.",
        "Posso fazer uma visita técnica sem compromisso para avaliar.",
      ]
    } else if (/hora|quando|chega|onde|chegando|atras|previsão/.test(lastMsg)) {
      intent = "agendamento"
      urgency = "medium"
      suggestions = [
        "Estou a caminho! Devo chegar em cerca de 30 minutos.",
        "Estou finalizando um atendimento e já sigo para o local.",
        "Podemos confirmar para as 14h? Já estou com os materiais.",
      ]
    } else if (/vazamento|urgente|emergência|cano|inunda|fogo|choque|perigo/.test(lastMsg)) {
      intent = "urgencia"
      urgency = "high"
      suggestions = [
        "Recomendo fechar o registro geral imediatamente! Já estou a caminho.",
        "Chego em 20 minutos. Desligue a chave geral por segurança.",
        "Entendido! Estou priorizando seu atendimento agora.",
      ]
    } else if (/obrigad|valeu|ótimo|perfeito|excelente|bom/.test(lastMsg)) {
      intent = "elogio"
      suggestions = [
        "Disponha sempre! Qualquer dúvida estou à disposição.",
        "Perfeito! Nos vemos em breve.",
        "Obrigado você pela confiança! Até logo.",
      ]
    } else {
      suggestions = [
        "Obrigado pelo contato! Posso ajudar com isso sim.",
        "Vou verificar minha agenda e te confirmo o horário.",
        "Poderia me enviar mais detalhes ou uma foto do local?",
      ]
    }
  }

  if (!suggestions.length) {
    suggestions = [
      "Obrigado pelo contato!",
      "Vou verificar e te retorno.",
      "Poderia dar mais detalhes?",
    ]
  }

  const validIntents = [
    "orcamento",
    "agendamento",
    "duvida",
    "reclamacao",
    "elogio",
    "urgencia",
    "geral",
  ]
  const finalIntent = validIntents.includes(intent) ? intent : "geral"

  const validUrgencies = ["low", "medium", "high", "critical"]
  const finalUrgency = validUrgencies.includes(urgency) ? urgency : "low"

  return NextResponse.json({ suggestions, intent: finalIntent, urgency: finalUrgency })
})
