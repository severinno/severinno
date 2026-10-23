"use client"

/**
 * AIChatWidget — floating chat assistant for the Severinno Marketplace.
 *
 * Uses the LLM skill via /api/chat with intelligent local domain fallback
 * to help users find services, get quotes, understand guarantees and navigate.
 *
 * Heuristics applied:
 *   H1  Visibility of system status  → Typing indicator, connection status
 *   H2  Match real world             → Natural Portuguese, friendly tone
 *   H3  User control and freedom     → Minimize/maximize, clear chat, dismiss
 *   H4  Consistency                  → Emerald theme matching platform
 *   H5  Error prevention             → Input validation, disabled send when empty
 *   H6  Recognition > recall         → Contextual quick-reply chips, familiar chat UI
 *   H7  Flexibility/efficiency       → Keyboard shortcuts (Enter to send)
 *   H8  Aesthetic minimalism         → Clean formatted chat bubble design
 *   H9  Error recovery               → Retry on failure, friendly error messages
 *   H10 Help/documentation           → AI assistant IS the help system
 */

import * as React from "react"
import { MessageCircle, X, Send, Bot, User, Trash2, Sparkles, RotateCcw } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

type SuggestedAction = {
  label: string
  message: string
  targetAnchor?: string
}

// ---------------------------------------------------------------------------
// Suggested actions for initial state
// ---------------------------------------------------------------------------

const INITIAL_SUGGESTIONS: SuggestedAction[] = [
  { label: "Como funciona?", message: "Como funciona o Severinno?" },
  { label: "Preciso de um eletricista", message: "Preciso de um eletricista, como encontro um?" },
  { label: "É seguro?", message: "É seguro contratar pelo Severinno?" },
  { label: "Quanto custa?", message: "Quanto custa contratar um prestador?" },
]

// ---------------------------------------------------------------------------
// Dynamic Follow-up Suggestions Generator (Contextual Quick Replies)
// ---------------------------------------------------------------------------

function getSuggestedFollowUps(lastContent: string): SuggestedAction[] {
  const norm = lastContent.toLowerCase()
  if (/eletric/i.test(norm)) {
    return [
      { label: "💰 Média de preços", message: "Quais os valores médios de serviços elétricos?" },
      {
        label: "⚡ Ver Eletricistas",
        message: "Quero ver eletricistas na vitrine",
        targetAnchor: "vitrine-results",
      },
      { label: "🛡️ É seguro?", message: "Como funciona a garantia do serviço?" },
    ]
  }
  if (/encanad|hidraul|vazamento/i.test(norm)) {
    return [
      { label: "💰 Quanto custa?", message: "Quanto custa o serviço de encanador?" },
      {
        label: "🔧 Ver Encanadores",
        message: "Quero ver encanadores na vitrine",
        targetAnchor: "vitrine-results",
      },
      { label: "🔒 Pagamento seguro", message: "Como funciona o pagamento com custódia?" },
    ]
  }
  if (/pinto|pintura/i.test(norm)) {
    return [
      { label: "💰 Preço por m²", message: "Quanto custa o metro quadrado de pintura?" },
      {
        label: "🎨 Ver Pintores",
        message: "Quero ver os pintores na vitrine",
        targetAnchor: "vitrine-results",
      },
      { label: "📋 Pedir orçamento", message: "Como solicitar um orçamento de pintura?" },
    ]
  }
  if (/diarista|faxina|limpeza/i.test(norm)) {
    return [
      {
        label: "🧹 Ver Diaristas",
        message: "Quero ver as diaristas disponíveis",
        targetAnchor: "vitrine-results",
      },
      { label: "💰 Valor da diária", message: "Quanto custa a diária de limpeza em GV?" },
      { label: "🛡️ Como é a verificação?", message: "Como os prestadores são verificados?" },
    ]
  }
  if (/segur|garantia|escrow/i.test(norm)) {
    return [
      { label: "💳 Formas de pagamento", message: "Quais formas de pagamento são aceitas?" },
      { label: "🔍 Como contratar?", message: "Como funciona o processo de contratação?" },
      {
        label: "⚡ Ver prestadores",
        message: "Quero ver os prestadores disponíveis",
        targetAnchor: "vitrine-results",
      },
    ]
  }
  if (/preco|quanto custa|valor|pagamento|pix/i.test(norm)) {
    return [
      { label: "🛡️ É seguro?", message: "É seguro contratar pelo Severinno?" },
      {
        label: "⚡ Ver prestadores",
        message: "Quero ver os prestadores de serviço",
        targetAnchor: "vitrine-results",
      },
      { label: "💡 Como funciona?", message: "Como funciona a plataforma?" },
    ]
  }
  return [
    { label: "⚡ Eletricista", message: "Preciso de um eletricista" },
    { label: "🔧 Encanador", message: "Preciso de um encanador" },
    { label: "🧹 Diarista", message: "Preciso de uma diarista" },
    { label: "💡 Como funciona?", message: "Como funciona o Severinno?" },
  ]
}

// ---------------------------------------------------------------------------
// Lightweight Markdown Formatter (Bold, Italic & Bullet Lists)
// ---------------------------------------------------------------------------

function FormattedMessage({ content, isUser }: { content: string; isUser: boolean }) {
  if (isUser) {
    return <span className="whitespace-pre-wrap">{content}</span>
  }

  const paragraphs = content.split(/\n\n+/)

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {paragraphs.map((para, i) => {
        const lines = para.split("\n")
        const isBulletList = lines.every((line) => {
          const trimmed = line.trim()
          return (
            !trimmed ||
            trimmed.startsWith("•") ||
            trimmed.startsWith("-") ||
            /^\d+\.\s/.test(trimmed)
          )
        })

        if (isBulletList && lines.some((l) => l.trim().length > 0)) {
          return (
            <ul key={i} className="my-1 space-y-1.5 pl-0.5">
              {lines.map((line, j) => {
                const trimmed = line.trim()
                if (!trimmed) return null
                const cleaned = trimmed.replace(/^[•\-\d.]\s*/, "")
                return (
                  <li key={j} className="flex items-start gap-1.5 text-xs sm:text-sm">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span>{renderInlineFormatting(cleaned)}</span>
                  </li>
                )
              })}
            </ul>
          )
        }

        return (
          <p key={i}>
            {lines.map((line, j) => (
              <React.Fragment key={j}>
                {renderInlineFormatting(line)}
                {j < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function renderInlineFormatting(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="text-foreground font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <em key={idx} className="text-foreground/90 italic">
          {part.slice(1, -1)}
        </em>
      )
    }
    return part
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AIChatWidget() {
  const [isOpen, setIsOpen] = React.useState(false)
  const [showBadge, setShowBadge] = React.useState(true)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [isTyping, setIsTyping] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [lastUserMessage, setLastUserMessage] = React.useState<string>("")

  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  // Focus input when chat opens
  React.useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Add initial greeting when chat first opens
  React.useEffect(() => {
    if (isOpen && messages.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed on open, no open-handler available
      setMessages([
        {
          id: "greeting",
          role: "assistant",
          content:
            "Olá! 👋 Sou o assistente virtual do **Severinno**.\n\nPosso te ajudar a encontrar os melhores prestadores verificados em Governador Valadares, tirar dúvidas sobre garantia, valores e formas de pagamento.\n\nComo posso ajudar você hoje?",
          timestamp: new Date(),
        },
      ])
    }
  }, [isOpen, messages.length])

  const handleSend = async (messageText?: string, targetAnchor?: string) => {
    const text = (messageText ?? input).trim()
    if (!text || isTyping) return

    if (targetAnchor) {
      const el =
        document.getElementById(targetAnchor) ||
        document.getElementById("vitrine-resultados") ||
        document.getElementById("vitrine-results")
      if (el) {
        el.scrollIntoView({ behavior: "smooth" })
      }
    }

    setError(null)
    setLastUserMessage(text)

    const now = Date.now()
    const userMsg: ChatMessage = {
      id: `user-${now}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setIsTyping(true)

    try {
      // Build history for context (last 10 messages)
      const history = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Erro ao enviar mensagem.")
      }

      const assistantMsg: ChatMessage = {
        id: `assistant-${now}`,
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido"
      setError(errorMsg)
    } finally {
      setIsTyping(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([
      {
        id: `greeting-${Date.now()}`,
        role: "assistant",
        content: "Conversa limpa! Como posso ajudar você agora? 😊",
        timestamp: new Date(),
      },
    ])
    setError(null)
  }

  // Derive follow-up chips from the last assistant message
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant")
  const followUpActions =
    messages.length > 1 && lastAssistantMessage
      ? getSuggestedFollowUps(lastAssistantMessage.content)
      : INITIAL_SUGGESTIONS

  return (
    <>
      {/* ── Chat Toggle Button & Badge (H3: always accessible) ── */}
      <AnimatePresence>
        {!isOpen && (
          <div className="fixed right-4 bottom-20 z-50 flex items-center sm:right-8 sm:bottom-22">
            {showBadge && (
              <motion.div
                initial={{ opacity: 0, x: 10, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="mr-3 hidden items-center gap-2 rounded-full border border-emerald-200/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-800 shadow-md backdrop-blur-xs sm:flex dark:border-emerald-800/80 dark:bg-slate-900/95 dark:text-slate-100"
              >
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <span>Dúvidas? Fale com a IA</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowBadge(false)
                  }}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  aria-label="Dispensar aviso"
                >
                  <X className="size-3" />
                </button>
              </motion.div>
            )}
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              onClick={() => {
                setIsOpen(true)
                setShowBadge(false)
              }}
              className="flex size-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition-all hover:bg-emerald-700 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              aria-label="Abrir assistente virtual"
            >
              <MessageCircle className="size-6" />
            </motion.button>
          </div>
        )}
      </AnimatePresence>

      {/* ── Chat Window ── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="border-border bg-background fixed right-4 bottom-20 z-50 flex h-[min(540px,calc(100dvh-6.5rem))] w-[calc(100vw-2rem)] max-w-[400px] flex-col overflow-hidden rounded-2xl border shadow-2xl sm:right-8 sm:bottom-22"
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between bg-emerald-600 px-4 py-3 text-white">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-full bg-white/20">
                  <Bot className="size-4.5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Assistente Severinno</p>
                  <div className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-emerald-300" />
                    <p className="text-[10px] text-emerald-100">IA · Online agora</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-white/80 hover:bg-white/20 hover:text-white"
                  onClick={handleClear}
                  aria-label="Limpar conversa"
                >
                  <Trash2 className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-white/80 hover:bg-white/20 hover:text-white"
                  onClick={() => setIsOpen(false)}
                  aria-label="Fechar chat"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>

            {/* ── Messages Area ── */}
            <div className="flex-1 scrollbar-thin space-y-3 overflow-y-auto p-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-2",
                    msg.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  {msg.role === "assistant" && (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                      <Sparkles className="size-3.5" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-2xs",
                      msg.role === "user"
                        ? "rounded-br-md bg-emerald-600 text-white"
                        : "bg-muted text-foreground rounded-bl-md",
                    )}
                  >
                    <FormattedMessage content={msg.content} isUser={msg.role === "user"} />
                  </div>
                  {msg.role === "user" && (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                      <User className="size-3.5" />
                    </div>
                  )}
                </div>
              ))}

              {/* Typing indicator (H1: visibility of system status) */}
              {isTyping && (
                <div className="flex gap-2">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                    <Sparkles className="size-3.5" />
                  </div>
                  <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex gap-1">
                      <span className="size-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:0ms]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:150ms]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}

              {/* Error state (H9: error recovery) */}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                  <p className="font-semibold">Erro ao enviar mensagem</p>
                  <p className="mt-0.5">{error}</p>
                  {lastUserMessage && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSend(lastUserMessage)}
                      className="mt-2 h-7 gap-1 border-red-200 text-xs text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                    >
                      <RotateCcw className="size-3" />
                      Tentar novamente
                    </Button>
                  )}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* ── Suggested Actions (H6: recognition over recall) ── */}
            {!isTyping && followUpActions.length > 0 && (
              <div className="border-border border-t px-4 py-2.5">
                <p className="text-muted-foreground mb-1.5 text-[10px] font-medium tracking-wider uppercase">
                  {messages.length <= 1 ? "Perguntas frequentes" : "Sugestões para você"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {followUpActions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => handleSend(action.message, action.targetAnchor)}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100 active:scale-95 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Input Area ── */}
            <div className="border-border border-t px-4 py-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSend()
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Digite sua mensagem..."
                  disabled={isTyping}
                  className="border-border bg-muted/50 placeholder:text-muted-foreground flex-1 rounded-xl border px-3.5 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none disabled:opacity-50"
                  aria-label="Mensagem para o assistente"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!input.trim() || isTyping}
                  className="size-9 shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                  aria-label="Enviar mensagem"
                >
                  <Send className="size-4" />
                </Button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
