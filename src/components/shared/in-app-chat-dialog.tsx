"use client"

/**
 * InAppChatDialog — Real-Time In-App Chat Modal with Anti-Fraud Leakage Protection.
 */

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Loader2,
  MessageSquare,
  Send,
  Shield,
  Sparkles,
} from "lucide-react"

import { apiGet, apiPost } from "@/lib/api"
import { formatTime } from "@/lib/format"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type ChatMessage = {
  id: string
  bookingId: string
  senderId: string
  senderName: string
  senderRole: "CLIENT" | "PROVIDER"
  content: string
  safetyWarning: string | null
  createdAt: string
}

type InAppChatDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingId: string
  title?: string
}

const QUICK_ACTIONS = [
  "Estou a caminho! 🚗",
  "Cheguei no local 📍",
  "Pode abrir o portão? 🚪",
  "Qual o andar/apartamento? 🏢",
  "Serviço finalizado! ✅",
]

export function InAppChatDialog({
  open,
  onOpenChange,
  bookingId,
  title = "Chat do Atendimento",
}: InAppChatDialogProps) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [inputText, setInputText] = React.useState("")
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery<{ ok: boolean; counterpart: string; messages: ChatMessage[] }>({
    queryKey: ["booking-chat", bookingId],
    queryFn: () => apiGet<{ ok: boolean; counterpart: string; messages: ChatMessage[] }>(`/api/chat/${bookingId}`),
    enabled: open && !!bookingId,
    refetchInterval: open ? 3000 : false, // Poll every 3s when open
  })

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      apiPost(`/api/chat/${bookingId}`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["booking-chat", bookingId] })
      setInputText("")
    },
  })

  const messages = data?.messages ?? []

  // Auto-scroll to bottom on new messages
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!inputText.trim() || sendMutation.isPending) return
    sendMutation.mutate(inputText.trim())
  }

  const handleQuickAction = (text: string) => {
    sendMutation.mutate(text)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl flex flex-col h-[550px] p-0 overflow-hidden">
        <DialogHeader className="p-4 border-b bg-muted/30">
          <DialogTitle className="flex items-center justify-between text-sm font-bold">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-emerald-600" />
              <span>{data?.counterpart ? `Chat com ${data.counterpart}` : title}</span>
            </div>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 flex items-center gap-1">
              <Shield className="size-3" />
              Protegido
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Message stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="size-6 animate-spin text-emerald-600" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-xs text-muted-foreground p-4">
              <Sparkles className="size-8 text-emerald-600/40 mb-2" />
              <p className="font-semibold text-foreground">Inicie a conversa!</p>
              <p className="text-[11px] mt-0.5">
                Tire dúvidas, informe detalhes de acesso e combine a chegada com segurança.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const isMine = m.senderId === user?.id
              return (
                <div key={m.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed shadow-sm ${
                      isMine
                        ? "bg-emerald-600 text-white rounded-br-none"
                        : "bg-muted text-foreground rounded-bl-none border"
                    }`}
                  >
                    <p>{m.content}</p>
                    <div className={`mt-1 text-[9px] text-right ${isMine ? "text-emerald-200" : "text-muted-foreground"}`}>
                      {formatTime(m.createdAt)}
                    </div>
                  </div>

                  {/* Safety Warning if detected */}
                  {m.safetyWarning && (
                    <div className="mt-1 flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300">
                      <AlertTriangle className="size-3 text-amber-600 shrink-0" />
                      <span>{m.safetyWarning}</span>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Quick actions bar */}
        <div className="px-3 py-1.5 border-t bg-muted/20 flex gap-1.5 overflow-x-auto no-scrollbar">
          {QUICK_ACTIONS.map((action, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleQuickAction(action)}
              className="shrink-0 rounded-full border bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:border-emerald-600 hover:text-emerald-700 transition-colors"
            >
              {action}
            </button>
          ))}
        </div>

        {/* Input bar */}
        <form onSubmit={handleSend} className="p-3 border-t bg-background flex items-center gap-2">
          <Input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Digite sua mensagem..."
            className="text-xs h-9"
          />
          <Button
            type="submit"
            disabled={!inputText.trim() || sendMutation.isPending}
            size="sm"
            className="h-9 px-3 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
          >
            {sendMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
