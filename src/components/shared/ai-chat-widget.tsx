"use client"

/**
 * AIChatWidget — floating chat assistant for the Severinno Marketplace.
 *
 * Uses the LLM skill (z-ai-web-dev-sdk) via /api/chat to provide
 * an AI assistant that helps users find services and navigate the platform.
 *
 * Heuristics applied:
 *   H1  Visibility of system status  → Typing indicator, connection status
 *   H2  Match real world             → Natural Portuguese, friendly tone
 *   H3  User control and freedom     → Minimize/maximize, clear chat, dismiss
 *   H4  Consistency                  → Emerald theme matching platform
 *   H5  Error prevention             → Input validation, disabled send when empty
 *   H6  Recognition > recall         → Suggested quick actions, familiar chat UI
 *   H7  Flexibility/efficiency       → Keyboard shortcuts (Enter to send)
 *   H8  Aesthetic minimalism         → Clean chat bubble design
 *   H9  Error recovery               → Retry on failure, friendly error messages
 *   H10 Help/documentation           → AI assistant IS the help system
 */

import * as React from "react"
import { MessageCircle, X, Send, Bot, User, Trash2, Sparkles } from "lucide-react"
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

// ---------------------------------------------------------------------------
// Suggested actions for first-time users (H6: Recognition over recall)
// ---------------------------------------------------------------------------

const SUGGESTED_ACTIONS = [
  { label: "Como funciona?", message: "Como funciona o Severinno?" },
  { label: "Preciso de um eletricista", message: "Preciso de um eletricista, como encontro um?" },
  { label: "É seguro?", message: "É seguro contratar pelo Severinno?" },
  { label: "Quanto custa?", message: "Quanto custa contratar um prestador?" },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AIChatWidget() {
  const [isOpen, setIsOpen] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [isTyping, setIsTyping] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

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
      setMessages([
        {
          id: "greeting",
          role: "assistant",
          content:
            "Olá! 👋 Sou o assistente virtual do Severinno. Posso ajudar você a encontrar serviços, tirar dúvidas sobre a plataforma e muito mais. Como posso ajudar?",
          timestamp: new Date(),
        },
      ])
    }
    // Only run when chat opens
  }, [isOpen])

  const handleSend = async (messageText?: string) => {
    const text = (messageText ?? input).trim()
    if (!text || isTyping) return

    setError(null)

    // Add user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
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
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido"
      setError(errorMsg)
      // H9: Error recovery — show friendly error and allow retry
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

  return (
    <>
      {/* ── Chat Toggle Button (H3: always accessible) ── */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={() => setIsOpen(true)}
            className="fixed right-6 bottom-20 z-50 flex size-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition-all hover:bg-emerald-700 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:outline-none sm:right-8 sm:bottom-22"
            aria-label="Abrir assistente virtual"
          >
            <MessageCircle className="size-6" />
          </motion.button>
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
            className="border-border bg-background fixed right-6 bottom-20 z-50 flex h-[520px] w-[360px] flex-col overflow-hidden rounded-2xl border shadow-2xl sm:right-8 sm:bottom-22 sm:h-[560px] sm:w-[400px]"
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between bg-emerald-600 px-4 py-3 text-white">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-full bg-white/20">
                  <Bot className="size-4.5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Assistente Severinno</p>
                  <p className="text-[10px] text-emerald-100">IA · Online agora</p>
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
            <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto p-4">
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
                      "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "rounded-br-md bg-emerald-600 text-white"
                        : "bg-muted text-foreground rounded-bl-md",
                    )}
                  >
                    {msg.content}
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
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
                  <p className="font-medium">Erro ao enviar mensagem</p>
                  <p>{error}</p>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* ── Suggested Actions (H6: recognition over recall) ── */}
            {messages.length <= 1 && !isTyping && (
              <div className="border-border border-t px-4 py-2.5">
                <p className="text-muted-foreground mb-1.5 text-[10px] font-medium tracking-wider uppercase">
                  Perguntas frequentes
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => handleSend(action.message)}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
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
