/**
 * chat-ai-assistant.ts — Client-side helper for the AI chat copilot.
 *
 * Provides functions to request reply suggestions from the backend
 * and classify conversation intent/urgency locally.
 *
 * Used by MessagesView to display smart suggestion chips above the input.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatSuggestionResult = {
  suggestions: string[]
  intent: string
  urgency: "low" | "medium" | "high" | "critical"
}

export type AssistContext = {
  serviceCategory?: string
  bookingStatus?: string
}

type MessageForAssist = {
  role: "user" | "assistant"
  content: string
  fromName?: string
}

// ---------------------------------------------------------------------------
// Intent labels (PT-BR)
// ---------------------------------------------------------------------------

export const INTENT_LABELS: Record<string, string> = {
  orcamento: "💰 Pedido de Orçamento",
  agendamento: "📅 Agendamento",
  duvida: "❓ Dúvida",
  reclamacao: "⚠️ Reclamação",
  elogio: "⭐ Elogio",
  urgencia: "🚨 Urgência",
  geral: "💬 Conversa Geral",
}

export const URGENCY_COLORS: Record<string, string> = {
  low: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/30 dark:border-emerald-800/40",
  medium:
    "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-800/40",
  high: "text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950/30 dark:border-orange-800/40",
  critical:
    "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-800/40",
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

/**
 * Request AI-powered reply suggestions from the backend.
 * Sends the last N messages for context analysis.
 */
export async function fetchChatSuggestions(
  messages: MessageForAssist[],
  context?: AssistContext,
): Promise<ChatSuggestionResult> {
  const res = await fetch("/api/chat/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? "Erro ao gerar sugestões")
  }

  return res.json()
}

// ---------------------------------------------------------------------------
// Local heuristic (fast, no API call — for urgency badge)
// ---------------------------------------------------------------------------

const URGENCY_PATTERNS = {
  critical: /urgente|emergência|emergencia|vazando|curto[- ]?circuito|incêndio|risco|perigo/i,
  high: /rápido|rapido|logo|hoje|agora|amanhã|amanha|socorro|help/i,
  medium: /quando|disponível|disponivel|prazo|preço|preco|valor|orçamento|orcamento/i,
}

/**
 * Quick local urgency check (no API call required).
 * Scans the last 5 messages for urgency-related patterns.
 */
export function detectLocalUrgency(
  messages: Array<{ content: string }>,
): "low" | "medium" | "high" | "critical" {
  const recentText = messages
    .slice(-5)
    .map((m) => m.content)
    .join(" ")

  if (URGENCY_PATTERNS.critical.test(recentText)) return "critical"
  if (URGENCY_PATTERNS.high.test(recentText)) return "high"
  if (URGENCY_PATTERNS.medium.test(recentText)) return "medium"
  return "low"
}
