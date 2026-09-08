"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { formatRelative } from "@/lib/format"
import { apiGet, apiPost } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  Send,
  MessagesSquare,
  Loader2,
  Check,
  CheckCheck,
  Paperclip,
  Mic,
  X,
  ShieldAlert,
  ShieldCheck,
  Clock,
  WifiOff,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { useRealtime } from "@/hooks/use-realtime"
import { playCoinSound } from "@/lib/sounds"
import { compressImageFile } from "@/lib/client-image-compression"
import { detectChatFraud } from "@/lib/chat-fraud-detector"
import { enqueueOfflineMutation, processSyncQueue } from "@/lib/offline-sync"
import {
  fetchChatSuggestions,
  INTENT_LABELS,
  URGENCY_COLORS,
  type ChatSuggestionResult,
} from "@/lib/chat-ai-assistant"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConversationPeer = {
  id: string
  name: string
  avatarUrl?: string | null
  role?: string
}

export type Conversation = {
  peerId: string
  peer: ConversationPeer | null
  lastMessage: string
  lastAt: string
  unreadCount: number
}

export type Message = {
  id: string
  fromId: string
  toId: string
  content: string
  read: boolean
  bookingId?: string | null
  createdAt: string
}

type MessagesViewProps = {
  /** Force a specific peer to be selected initially (e.g. a booking's client). */
  initialPeerId?: string
  /** Optional title for the empty state. */
  emptyTitle?: string
  /** Optional description for the empty state. */
  emptyDescription?: string
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name?: string) {
  if (!name) return "?"
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
}

function isImageUrl(url: string): boolean {
  return (
    url.startsWith("http") &&
    (/\.(jpeg|jpg|gif|png|webp|svg)($|\?)/i.test(url) || url.includes("/uploads/")) &&
    !isAudioUrl(url)
  )
}

function isAudioUrl(url: string): boolean {
  return (
    url.startsWith("http") &&
    (/\.(webm|ogg|mp3|m4a|wav)($|\?)/i.test(url) || url.includes("audio-"))
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MessagesView({
  initialPeerId,
  emptyTitle = "Suas mensagens",
  emptyDescription = "Converse com seus clientes e prestadores em tempo real.",
  className,
}: MessagesViewProps) {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [selectedPeerId, setSelectedPeerId] = React.useState<string | undefined>(initialPeerId)
  const [draft, setDraft] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [isPeerTyping, setIsPeerTyping] = React.useState(false)
  const [offlinePendingMessages, setOfflinePendingMessages] = React.useState<Message[]>([])
  const [isOnline, setIsOnline] = React.useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  )

  const fraudResult = React.useMemo(() => detectChatFraud(draft), [draft])

  // Online / Offline synchronization listener
  React.useEffect(() => {
    if (typeof window === "undefined") return

    const handleOnline = async () => {
      setIsOnline(true)
      const res = await processSyncQueue(async (mutation) => {
        if (mutation.action === "SEND_MESSAGE") {
          const payload = mutation.payload as { toId: string; content: string }
          await apiPost("/api/messages", { toId: payload.toId, content: payload.content })
          return true
        }
        return true
      })
      if (res.succeeded > 0) {
        toast.success(
          `Conexão restabelecida! ${res.succeeded} ${res.succeeded === 1 ? "mensagem sincronizada" : "mensagens sincronizadas"}.`,
        )
        setOfflinePendingMessages([])
        qc.invalidateQueries({ queryKey: ["messages"] })
      }
    }

    const handleOffline = () => {
      setIsOnline(false)
      toast.warning(
        "Modo offline ativado. Suas mensagens serão enviadas automaticamente ao reconectar.",
      )
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [qc])

  // Voice recording state
  const [isRecording, setIsRecording] = React.useState(false)
  const [recordingSeconds, setRecordingSeconds] = React.useState(0)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const audioChunksRef = React.useRef<Blob[]>([])
  const recordingTimerRef = React.useRef<NodeJS.Timeout | null>(null)

  const typingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const lastTypingSentRef = React.useRef<number>(0)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const { on, emit, isConnected, join } = useRealtime()

  // --- Realtime subscription ---
  React.useEffect(() => {
    if (!isConnected || !user) return
    join({ userId: user.id, role: user.role.toLowerCase() })
  }, [isConnected, user, join])

  // Realtime message & typing listener
  React.useEffect(() => {
    const unsubMsg = on<{ fromId: string; toId: string }>("message:new", (msg) => {
      if (!msg) return

      // Play audio notification on incoming message
      if (user && msg.toId === user.id) {
        playCoinSound({ vibrate: true })
      }

      // Invalidate conversations list + thread if relevant
      qc.invalidateQueries({ queryKey: ["messages", "conversations"] })
      if (selectedPeerId && (msg.fromId === selectedPeerId || msg.toId === selectedPeerId)) {
        qc.invalidateQueries({
          queryKey: ["messages", "thread", selectedPeerId],
        })
      }
    })

    const unsubTyping = on<{ fromId: string }>("chat:typing", (payload) => {
      if (payload?.fromId === selectedPeerId) {
        setIsPeerTyping(true)
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = setTimeout(() => {
          setIsPeerTyping(false)
        }, 3000)
      }
    })

    return () => {
      unsubMsg()
      unsubTyping()
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [on, qc, selectedPeerId, user])

  // --- Conversations list ---
  const conversationsQuery = useQuery<Conversation[]>({
    queryKey: ["messages", "conversations"],
    queryFn: async () => {
      const data = await apiGet<{ items: Conversation[] }>("/api/messages")
      return data?.items ?? []
    },
    refetchInterval: 15_000,
  })

  // Auto-select first conversation on first load
  const [prevConversations, setPrevConversations] = React.useState(conversationsQuery.data)
  if (
    !selectedPeerId &&
    conversationsQuery.data &&
    conversationsQuery.data.length > 0 &&
    prevConversations !== conversationsQuery.data
  ) {
    setPrevConversations(conversationsQuery.data)
    setSelectedPeerId(conversationsQuery.data[0].peerId)
  }

  // --- Thread ---
  const threadQuery = useQuery<{ peer: ConversationPeer; items: Message[] }>({
    queryKey: ["messages", "thread", selectedPeerId],
    queryFn: async () => {
      if (!selectedPeerId) throw new Error("no peer")
      return apiGet<{ peer: ConversationPeer; items: Message[] }>("/api/messages", {
        with: selectedPeerId,
      })
    },
    enabled: !!selectedPeerId,
    refetchInterval: 10_000,
  })

  // Scroll to bottom on new messages
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [threadQuery.data, isPeerTyping])

  // Broadcast typing indicator debounced
  const handleDraftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value)

    if (!selectedPeerId || !isConnected) return
    const now = Date.now()
    if (now - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = now
      emit("chat:typing", {
        fromId: user?.id,
        toId: selectedPeerId,
      })
    }
  }

  const send = async (contentToSend?: string) => {
    const text = contentToSend ?? draft.trim()
    if (!selectedPeerId || !text) return

    // If device is offline, enqueue locally and show optimistic message
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      enqueueOfflineMutation("SEND_MESSAGE", selectedPeerId, {
        toId: selectedPeerId,
        content: text,
      })
      const optimisticMsg: Message = {
        id: `offline-${Date.now()}`,
        fromId: user?.id ?? "",
        toId: selectedPeerId,
        content: text,
        read: false,
        createdAt: new Date().toISOString(),
      }
      setOfflinePendingMessages((prev) => [...prev, optimisticMsg])
      if (!contentToSend) setDraft("")
      toast.info("Mensagem salva offline. Será enviada automaticamente ao reconectar.")
      return
    }

    setSending(true)
    try {
      await apiPost("/api/messages", {
        toId: selectedPeerId,
        content: text,
      })
      if (!contentToSend) setDraft("")
      qc.invalidateQueries({
        queryKey: ["messages", "thread", selectedPeerId],
      })
      qc.invalidateQueries({ queryKey: ["messages", "conversations"] })
    } catch (_e) {
      // Network failed during send, fallback to offline queue
      enqueueOfflineMutation("SEND_MESSAGE", selectedPeerId, {
        toId: selectedPeerId,
        content: text,
      })
      const optimisticMsg: Message = {
        id: `offline-${Date.now()}`,
        fromId: user?.id ?? "",
        toId: selectedPeerId,
        content: text,
        read: false,
        createdAt: new Date().toISOString(),
      }
      setOfflinePendingMessages((prev) => [...prev, optimisticMsg])
      if (!contentToSend) setDraft("")
      toast.warning("Falha temporária de rede. Mensagem salva para reenvio automático.")
    } finally {
      setSending(false)
    }
  }

  // Handle image upload with client compression
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedPeerId) return

    setUploading(true)
    try {
      // Compress image client-side before upload
      const compressed = await compressImageFile(file, {
        maxDimension: 1200,
        quality: 0.8,
      })

      const formData = new FormData()
      formData.append("file", compressed)

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })
      if (!res.ok) throw new Error("Falha no upload da imagem")
      const data = await res.json()
      if (data.url) {
        await send(data.url)
        toast.success("Imagem enviada com sucesso!")
      }
    } catch {
      toast.error("Erro ao enviar imagem. Verifique o tamanho do arquivo.")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // Handle voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingSeconds(0)
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1)
      }, 1000)
    } catch {
      toast.error("Permissão de microfone negada ou microfone indisponível.")
    }
  }

  const stopAndSendRecording = () => {
    if (!mediaRecorderRef.current) return
    const recorder = mediaRecorderRef.current

    recorder.onstop = async () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      setIsRecording(false)

      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })
      recorder.stream.getTracks().forEach((t) => t.stop())

      if (audioBlob.size < 200) return

      setUploading(true)
      const audioFile = new File([audioBlob], `audio-${Date.now()}.webm`, {
        type: "audio/webm",
      })
      const formData = new FormData()
      formData.append("file", audioFile)

      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData })
        if (!res.ok) throw new Error("Falha ao enviar áudio")
        const data = await res.json()
        if (data.url) {
          await send(data.url)
          toast.success("Mensagem de voz enviada!")
        }
      } catch {
        toast.error("Erro ao enviar áudio.")
      } finally {
        setUploading(false)
      }
    }

    recorder.stop()
  }

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop())
      mediaRecorderRef.current = null
      setIsRecording(false)
      setRecordingSeconds(0)
    }
  }

  const conversations = conversationsQuery.data ?? []
  const currentPeerOffline = React.useMemo(() => {
    return offlinePendingMessages.filter((m) => m.toId === selectedPeerId)
  }, [offlinePendingMessages, selectedPeerId])
  const thread = React.useMemo(() => {
    return [...(threadQuery.data?.items ?? []), ...currentPeerOffline]
  }, [threadQuery.data?.items, currentPeerOffline])
  const peer = threadQuery.data?.peer

  const [aiSuggestions, setAiSuggestions] = React.useState<ChatSuggestionResult | null>(null)
  const [aiLoading, setAiLoading] = React.useState(false)

  const handleFetchSuggestions = async () => {
    if (!selectedPeerId || thread.length === 0) return
    setAiLoading(true)
    try {
      const msgs = thread.slice(-10).map((m) => ({
        role: (m.fromId === user?.id ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }))
      const result = await fetchChatSuggestions(msgs)
      setAiSuggestions(result)
    } catch {
      toast.error("Não foi possível gerar sugestões no momento.")
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div
      className={cn(
        "bg-card grid h-[calc(100vh-12rem)] min-h-[480px] grid-cols-1 overflow-hidden rounded-xl border md:grid-cols-[320px_1fr]",
        className,
      )}
    >
      {/* Conversations list */}
      <aside className="flex flex-col border-b md:border-r md:border-b-0">
        <div className="border-b p-3">
          <h2 className="text-sm font-semibold">Conversas</h2>
          <p className="text-muted-foreground text-xs">
            {conversations.length} conversa{conversations.length === 1 ? "" : "s"}
          </p>
        </div>
        <ScrollArea className="flex-1">
          {conversationsQuery.isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center p-6 text-sm">
              <Loader2 className="mr-2 size-4 animate-spin" /> Carregando…
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-sm">
              Nenhuma conversa ainda.
            </div>
          ) : (
            <ul className="divide-y">
              {conversations.map((c) => {
                const active = c.peerId === selectedPeerId
                return (
                  <li key={c.peerId}>
                    <button
                      type="button"
                      onClick={() => setSelectedPeerId(c.peerId)}
                      className={cn(
                        "hover:bg-accent/50 flex w-full items-start gap-3 p-3 text-left transition-colors",
                        active && "bg-emerald-50/60 dark:bg-emerald-950/20",
                      )}
                    >
                      <Avatar className="size-9 border">
                        {c.peer?.avatarUrl && (
                          <AvatarImage src={c.peer.avatarUrl} alt={c.peer.name} />
                        )}
                        <AvatarFallback className="bg-emerald-600 text-xs text-white">
                          {initials(c.peer?.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 overflow-hidden">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">
                            {c.peer?.name ?? "Usuário"}
                          </p>
                          <span className="text-muted-foreground shrink-0 text-[10px]">
                            {formatRelative(c.lastAt)}
                          </span>
                        </div>
                        <p className="text-muted-foreground truncate text-xs">
                          {isAudioUrl(c.lastMessage)
                            ? "🎤 Mensagem de voz"
                            : isImageUrl(c.lastMessage)
                              ? "📷 Imagem enviada"
                              : c.lastMessage}
                        </p>
                      </div>
                      {c.unreadCount > 0 && (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">
                          {c.unreadCount}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </ScrollArea>
      </aside>

      {/* Thread */}
      <section className="flex flex-col">
        {!selectedPeerId || !peer ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <MessagesSquare className="size-6" />
            </div>
            <div>
              <p className="text-sm font-semibold">{emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-xs">{emptyDescription}</p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b p-3">
              <div className="flex items-center gap-3">
                <Avatar className="size-9 border">
                  {peer.avatarUrl && <AvatarImage src={peer.avatarUrl} alt={peer.name} />}
                  <AvatarFallback className="bg-emerald-600 text-xs text-white">
                    {initials(peer.name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-semibold">{peer.name}</p>
                  <p className="text-muted-foreground text-[10px]">
                    {peer.role === "PROVIDER"
                      ? "Prestador"
                      : peer.role === "CLIENT"
                        ? "Cliente"
                        : (peer.role ?? "")}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isPeerTyping && (
                  <div className="flex animate-pulse items-center gap-1.5 text-xs font-medium text-emerald-600">
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-600" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-600 delay-150" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-600 delay-300" />
                    </span>
                    digitando...
                  </div>
                )}
                {!isOnline && (
                  <div className="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    <WifiOff className="size-3" />
                    <span>Modo Offline</span>
                  </div>
                )}
                <div className="hidden items-center gap-1 rounded-full border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 sm:flex dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Garantia Severinno</span>
                </div>
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
              {threadQuery.isLoading ? (
                <div className="text-muted-foreground flex items-center justify-center p-6 text-sm">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Carregando…
                </div>
              ) : thread.length === 0 ? (
                <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                  Nenhuma mensagem ainda. Diga olá!
                </div>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {thread.map((m) => {
                    const mine = m.fromId === user?.id
                    const isImage = isImageUrl(m.content)
                    const isAudio = isAudioUrl(m.content)

                    return (
                      <li
                        key={m.id}
                        className={cn("flex flex-col gap-0.5", mine ? "items-end" : "items-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] overflow-hidden rounded-2xl text-sm",
                            mine
                              ? "rounded-br-xs bg-emerald-600 text-white"
                              : "bg-muted text-foreground rounded-bl-xs",
                            isImage ? "p-1" : isAudio ? "p-2" : "px-3.5 py-2",
                          )}
                        >
                          {isAudio ? (
                            <div className="flex items-center gap-2">
                              <audio
                                controls
                                src={m.content}
                                className="h-8 max-w-[220px] sm:max-w-[280px]"
                              />
                            </div>
                          ) : isImage ? (
                            <a href={m.content} target="_blank" rel="noopener noreferrer">
                              <img
                                src={m.content}
                                alt="Anexo"
                                className="max-h-60 w-auto rounded-xl object-cover transition-opacity hover:opacity-95"
                              />
                            </a>
                          ) : (
                            m.content
                          )}
                        </div>

                        <div className="text-muted-foreground flex items-center gap-1 px-1.5 text-[10px]">
                          <span>
                            {new Date(m.createdAt).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {m.id.startsWith("offline-") ? (
                            <span
                              title="Pendente de sincronização (offline)"
                              className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"
                            >
                              <Clock className="inline size-3" />
                              <span>offline</span>
                            </span>
                          ) : (
                            mine &&
                            (m.read ? (
                              <span title="Lida">
                                <CheckCheck className="inline h-3.5 w-3.5 text-blue-500" />
                              </span>
                            ) : (
                              <span title="Enviada">
                                <Check className="text-muted-foreground inline h-3 w-3" />
                              </span>
                            ))
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <footer className="bg-background border-t p-3">
              {/* ── AI Suggestion Panel ── */}
              {aiSuggestions && (
                <div className="mb-2.5 space-y-2 rounded-xl border border-violet-200/80 bg-violet-50/50 p-2.5 dark:border-violet-800/40 dark:bg-violet-950/20">
                  {aiSuggestions.intent && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400">
                        {INTENT_LABELS[aiSuggestions.intent] ?? aiSuggestions.intent}
                      </span>
                      {aiSuggestions.urgency !== "low" && (
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[9px] font-semibold",
                            URGENCY_COLORS[aiSuggestions.urgency] ?? "",
                          )}
                        >
                          {aiSuggestions.urgency === "critical"
                            ? "🚨 Crítico"
                            : aiSuggestions.urgency === "high"
                              ? "⚡ Urgente"
                              : "⏰ Moderado"}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {aiSuggestions.suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setDraft(s)
                          setAiSuggestions(null)
                        }}
                        className="rounded-full border border-violet-300/60 bg-white px-3 py-1 text-xs text-violet-700 transition-colors hover:border-violet-400 hover:bg-violet-100 active:bg-violet-200 dark:border-violet-700/40 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/40"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setAiSuggestions(null)}
                    className="text-[10px] text-violet-400 hover:text-violet-600 dark:hover:text-violet-300"
                  >
                    Fechar sugestões
                  </button>
                </div>
              )}

              {/* ── AI Suggest Button ── */}
              {!aiSuggestions && !aiLoading && thread.length > 0 && (
                <div className="mb-2">
                  <button
                    type="button"
                    onClick={handleFetchSuggestions}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-medium text-violet-600 transition-colors hover:bg-violet-100 dark:border-violet-800/40 dark:bg-violet-950/30 dark:text-violet-400 dark:hover:bg-violet-900/40"
                  >
                    <Sparkles className="size-3" />
                    Sugerir resposta IA
                  </button>
                </div>
              )}
              {aiLoading && (
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-violet-500">
                  <Loader2 className="size-3 animate-spin" />
                  Gerando sugestões…
                </div>
              )}
              {fraudResult.hasRisk && (
                <div className="mb-2.5 flex items-start gap-2.5 rounded-xl border border-amber-300/80 bg-amber-50/95 p-2.5 text-xs text-amber-950 shadow-xs dark:border-amber-700/50 dark:bg-amber-950/50 dark:text-amber-200">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="flex-1">
                    <p className="font-semibold">{fraudResult.warningTitle}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                      {fraudResult.warningMessage}
                    </p>
                  </div>
                </div>
              )}
              {isRecording ? (
                <div className="bg-destructive/10 border-destructive/20 flex w-full items-center justify-between rounded-xl border p-2 px-3">
                  <div className="text-destructive flex items-center gap-2 text-xs font-medium">
                    <span className="bg-destructive h-2.5 w-2.5 animate-ping rounded-full" />
                    <span>
                      Gravando: {Math.floor(recordingSeconds / 60)}:
                      {String(recordingSeconds % 60).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={cancelRecording}
                      className="text-muted-foreground hover:text-destructive h-8 gap-1 text-xs"
                    >
                      <X className="size-3.5" /> Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={stopAndSendRecording}
                      className="h-8 gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                    >
                      <Send className="size-3.5" /> Enviar
                    </Button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    send()
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={uploading || sending}
                    onClick={() => fileInputRef.current?.click()}
                    title="Anexar imagem"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    {uploading ? (
                      <Loader2 className="text-primary size-4 animate-spin" />
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={uploading || sending}
                    onClick={startRecording}
                    title="Gravar mensagem de voz"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <Mic className="size-4" />
                  </Button>

                  <Input
                    value={draft}
                    onChange={handleDraftChange}
                    placeholder="Escreva uma mensagem…"
                    disabled={sending}
                    className="flex-1"
                    maxLength={2000}
                  />

                  <Button
                    type="submit"
                    size="icon"
                    disabled={sending || !draft.trim()}
                    className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {sending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </Button>
                </form>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  )
}

export default MessagesView
