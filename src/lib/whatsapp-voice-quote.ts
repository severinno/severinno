/**
 * whatsapp-voice-quote.ts — Pipeline de Voice-to-Quote Inteligente para WhatsApp
 *
 * Transcreve áudios recebidos via Evolution API (utilizando Groq Whisper LPU
 * em < 500ms ou contingência) e extrai orçamentos estruturados com classificação,
 * urgência, faixa de preço e links de contratação instantânea protegida por Escrow.
 */

import logger from "@/lib/logger"
import { chatCompletionHybrid } from "./ai-client"

const log =
  typeof logger?.child === "function" ? logger.child({ module: "whatsapp-voice-quote" }) : logger

export interface StructuredVoiceQuote {
  category: string
  serviceTitle: string
  description: string
  urgency: "NORMAL" | "HIGH" | "EMERGENCY"
  estimatedPriceRange: [number, number]
  neighborhood: string
  confidence: number
}

export interface VoiceQuoteResult {
  transcription: string
  quote: StructuredVoiceQuote
  formattedReply: string
  quoteUrl: string
}

/**
 * Transcreve áudio (Buffer, base64 ou URL) usando Groq Whisper (modelo whisper-large-v3-turbo).
 */
export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  filename: string = "audio.ogg",
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY || process.env.AI_API_KEY

  if (!apiKey) {
    throw new Error("GROQ_API_KEY não configurada para transcrição Whisper")
  }

  const formData = new FormData()
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/ogg" })
  formData.append("file", blob, filename)
  formData.append("model", "whisper-large-v3-turbo")
  formData.append("language", "pt")
  formData.append("response_format", "json")

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    log.warn({ status: res.status, errorText }, "Falha na transcrição Whisper")
    throw new Error(`Erro na API Whisper: ${res.status}`)
  }

  const data = (await res.json()) as { text?: string }
  return (data.text || "").trim()
}

/**
 * Extrai os dados do orçamento a partir da transcrição em linguagem natural.
 */
export async function extractStructuredQuoteFromSpeech(
  transcription: string,
): Promise<StructuredVoiceQuote> {
  if (!transcription || transcription.trim().length === 0) {
    return {
      category: "Geral",
      serviceTitle: "Solicitação Geral de Serviço",
      description: "Serviço solicitado por áudio.",
      urgency: "NORMAL",
      estimatedPriceRange: [80, 150],
      neighborhood: "Governador Valadares",
      confidence: 0.5,
    }
  }

  const systemPrompt = `Você é o extrator de orçamentos e triagem da plataforma Severinno Marketplace em Governador Valadares, MG.
Dado o texto falado de um cliente, analise e responda ESTRITAMENTE em formato JSON puro, sem marcação markdown e sem texto antes ou depois:
{
  "category": "Eletricista" | "Encanador" | "Chaveiro" | "Pintura" | "Frete" | "Faxina" | "Montador de Móveis" | "Geral",
  "serviceTitle": "Título conciso com 3 a 6 palavras",
  "description": "Resumo objetivo do problema em 1 frase",
  "urgency": "NORMAL" | "HIGH" | "EMERGENCY",
  "estimatedPriceRange": [valorMinimoEmReais, valorMaximoEmReais],
  "neighborhood": "Bairro de GV detectado ou 'Governador Valadares'",
  "confidence": 0.0 a 1.0
}`

  try {
    const aiResult = await chatCompletionHybrid(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Áudio do cliente: "${transcription}"` },
      ],
      { temperature: 0.1, maxTokens: 400 },
    )

    if (aiResult.content) {
      // Extrai JSON mesmo se a IA envolver em blocos de código
      const jsonMatch = aiResult.content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          category: parsed.category || "Geral",
          serviceTitle: parsed.serviceTitle || "Serviço Residencial",
          description: parsed.description || transcription.slice(0, 100),
          urgency: ["NORMAL", "HIGH", "EMERGENCY"].includes(parsed.urgency)
            ? parsed.urgency
            : "NORMAL",
          estimatedPriceRange: Array.isArray(parsed.estimatedPriceRange)
            ? [
                Number(parsed.estimatedPriceRange[0]) || 80,
                Number(parsed.estimatedPriceRange[1]) || 160,
              ]
            : [80, 160],
          neighborhood: parsed.neighborhood || "Governador Valadares",
          confidence: Number(parsed.confidence) || 0.85,
        }
      }
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Falha ao extrair quote estruturado de áudio")
  }

  // Fallback heurístico em caso de falha de parsing
  const isEmergency =
    /vazamento|cano estourou|sem luz|trancad|chave quebr|curto-circuito|urgente/i.test(
      transcription,
    )
  return {
    category: "Geral",
    serviceTitle: "Atendimento Residencial",
    description: transcription.slice(0, 120),
    urgency: isEmergency ? "HIGH" : "NORMAL",
    estimatedPriceRange: [80, 180],
    neighborhood: "Governador Valadares",
    confidence: 0.6,
  }
}

/**
 * Constrói a mensagem rica de resposta via WhatsApp com card e link de 1 clique.
 */
export function buildVoiceQuoteWhatsAppReply(
  transcription: string,
  quote: StructuredVoiceQuote,
  baseUrl: string = "https://severinno.com.br",
): { replyText: string; quoteUrl: string } {
  const urgencyLabel =
    quote.urgency === "EMERGENCY"
      ? "🚨 *EMERGÊNCIA IMEDIATA*"
      : quote.urgency === "HIGH"
        ? "⚠️ *Alta Prioridade*"
        : "✅ *Normal*"

  const queryParams = new URLSearchParams({
    categoria: quote.category,
    servico: quote.serviceTitle,
    urgencia: quote.urgency,
    origem: "whatsapp_voice",
  })
  const quoteUrl = `${baseUrl.replace(/\/$/, "")}/?${queryParams.toString()}`

  const replyText =
    `🎙️ *Áudio Entendido com Sucesso!*\n\n` +
    `Entendemos o seu pedido:\n` +
    `🔧 *Serviço:* ${quote.serviceTitle}\n` +
    `📁 *Categoria:* ${quote.category}\n` +
    `📍 *Região:* ${quote.neighborhood}\n` +
    `⚡ *Urgência:* ${urgencyLabel}\n` +
    `💰 *Faixa Média Estimada:* R$ ${quote.estimatedPriceRange[0]} a R$ ${quote.estimatedPriceRange[1]}\n\n` +
    `📝 _"${transcription.length > 90 ? transcription.slice(0, 90) + "..." : transcription}"_\n\n` +
    `👉 *Toque no link abaixo para acionar os prestadores verificados disponíveis agora com garantia de pagamento seguro:*\n` +
    `${quoteUrl}\n\n` +
    `_Ou responda *CONFIRMAR* para despacharmos a chamada imediatamente aos profissionais mais próximos._`

  return { replyText, quoteUrl }
}

/**
 * Orquestrador completo: recebe transcrição prévia ou processa o áudio e gera o VoiceQuoteResult.
 */
export async function processVoiceQuote(
  transcriptionOrBuffer: string | Buffer,
  baseUrl?: string,
): Promise<VoiceQuoteResult> {
  let transcription = ""

  if (typeof transcriptionOrBuffer === "string") {
    transcription = transcriptionOrBuffer
  } else {
    transcription = await transcribeAudioBuffer(transcriptionOrBuffer)
  }

  const quote = await extractStructuredQuoteFromSpeech(transcription)
  const { replyText, quoteUrl } = buildVoiceQuoteWhatsAppReply(transcription, quote, baseUrl)

  return {
    transcription,
    quote,
    formattedReply: replyText,
    quoteUrl,
  }
}
