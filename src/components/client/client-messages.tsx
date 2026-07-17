"use client"

/**
 * ClientMessages — chat interface.
 *
 * Two-pane layout:
 *  - Left: conversation list (peers the client has exchanged messages with)
 *  - Right: message thread with the selected peer
 *
 * Mobile: stacked — list view shown first; tapping a conversation opens the
 * thread view; a back button returns to the list.
 *
 * Realtime: uses `useRealtime()` to listen for `message:new` events; when a
 * new message arrives for the active thread it is appended optimistically
 * and the conversations list is invalidated. Toasts for messages from other
 * peers.
 *
 * API:
 *  - GET  /api/messages                → { items: Conversation[] }
 *  - GET  /api/messages?with=<userId>  → { peer, items: Message[] }
 *    (the server marks inbound messages as read on this call)
 *  - POST /api/messages { toId, content }
 */

import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  Send,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { apiGet, apiPost } from "@/lib/api"
import { formatDateTime, formatRelative } from "@/lib/format"
import { useRealtime } from "@/hooks/use-realtime"
import { useAuthStore, useViewStore } from "@/store"

import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
  EmptyState,
  SectionTitle,
} from "@/components/shared/dashboard-shell"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Conversation = {
  peerId: string
  lastMessage: string
  lastAt: string
  unreadCount: number
  peer: {
    id: string
    name: string
    avatarUrl?: string | null
    role?: string
  } | null
}

type ConversationsResponse = { items: Conversation[] }

type Message = {
  id: string
  fromId: string
  toId: string
  content: string
  read: boolean
  createdAt: string
  bookingId?: string | null
}

type ThreadResponse = {
  peer: {
    id: string
    name: string
    avatarUrl?: string | null
    role?: string
  }
  items: Message[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name?: string | null): string {
  if (!name) return "?"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientMessages() {
  const { user } = useAuthStore()
  const params = useViewStore((s) => s.params) as { with?: string }
  const qc = useQueryClient()

  const [selectedPeerId, setSelectedPeerId] = React.useState<string | null>(
    params.with ?? null,
  )
  const [mobileThreadOpen, setMobileThreadOpen] = React.useState(
    !!params.with,
  )

  // Conversations list
  const conversationsQuery = useQuery<ConversationsResponse>({
    queryKey: ["messages", "conversations"],
    queryFn: () => apiGet<ConversationsResponse>("/api/messages"),
    refetchInterval: 20_000,
  })

  // Active thread
  const threadQuery = useQuery<ThreadResponse>({
    queryKey: ["messages", "thread", selectedPeerId],
    queryFn: () =>
      apiGet<ThreadResponse>("/api/messages", { with: selectedPeerId }),
    enabled: !!selectedPeerId,
    refetchInterval: 15_000,
  })

  // ---- Realtime ----------------------------------------------------------------
  const { on, isConnected } = useRealtime()
  React.useEffect(() => {
    if (!user?.id) return
    const off1 = on<{ fromId: string; toId: string; content: string }>(
      "message:new",
      (data) => {
        // Invalidate the conversations list so ordering/unread update.
        qc.invalidateQueries({ queryKey: ["messages", "conversations"] })
        if (data?.fromId && data.fromId === selectedPeerId) {
          // Active thread — invalidate the thread (server marks read on GET).
          qc.invalidateQueries({
            queryKey: ["messages", "thread", selectedPeerId],
          })
        } else if (data?.fromId && data.toId === user.id) {
          // Other conversation — toast + invalidate its thread if cached.
          toast.info("Nova mensagem recebida.", {
            description: data.content?.slice(0, 80),
          })
        }
      },
    )
    return () => {
      off1()
    }
  }, [on, qc, selectedPeerId, user?.id])

  // ---- Send message ------------------------------------------------------------
  const [draft, setDraft] = React.useState("")
  const sendMutation = useMutation({
    mutationFn: (vars: { toId: string; content: string }) =>
      apiPost("/api/messages", vars),
    onSuccess: () => {
      setDraft("")
      qc.invalidateQueries({
        queryKey: ["messages", "thread", selectedPeerId],
      })
      qc.invalidateQueries({ queryKey: ["messages", "conversations"] })
    },
    onError: (e: { message?: string }) =>
      toast.error(e?.message || "Não foi possível enviar a mensagem."),
  })

  const handleSend = () => {
    const content = draft.trim()
    if (!content || !selectedPeerId) return
    sendMutation.mutate({ toId: selectedPeerId, content })
  }

  const handleSelectPeer = (peerId: string) => {
    setSelectedPeerId(peerId)
    setMobileThreadOpen(true)
  }

  const handleBackToList = () => {
    setMobileThreadOpen(false)
  }

  const conversations = conversationsQuery.data?.items ?? []
  const peer = threadQuery.data?.peer ?? null
  const messages = threadQuery.data?.items ?? []

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Mensagens"
        description="Converse com seus prestadores."
      />

      <Card className="grid h-[70vh] grid-cols-1 overflow-hidden py-0 md:grid-cols-[20rem_1fr]">
        {/* Conversation list */}
        <div
          className={cn(
            "flex flex-col border-r",
            mobileThreadOpen && "hidden md:flex",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
            <p className="text-sm font-semibold">Conversas</p>
            <Badge
              variant="outline"
              className={cn(
                "gap-1 text-[10px]",
                isConnected ? "text-emerald-600" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isConnected ? "bg-emerald-500" : "bg-muted-foreground",
                )}
              />
              {isConnected ? "Online" : "Reconectando"}
            </Badge>
          </div>

          <ScrollArea className="flex-1">
            {conversationsQuery.isLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Carregando…
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-6 text-center">
                <MessageSquare className="size-6 text-muted-foreground/60" />
                <p className="text-xs text-muted-foreground">
                  Nenhuma conversa ainda. Inicie uma conversa a partir do
                  perfil de um prestador.
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {conversations.map((c) => {
                  const active = c.peerId === selectedPeerId
                  return (
                    <li key={c.peerId}>
                      <button
                        type="button"
                        onClick={() => handleSelectPeer(c.peerId)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors",
                          active
                            ? "bg-primary/10"
                            : "hover:bg-accent/50",
                        )}
                      >
                        <Avatar className="size-9 shrink-0">
                          {c.peer?.avatarUrl ? (
                            <AvatarImage
                              src={c.peer.avatarUrl}
                              alt={c.peer.name}
                            />
                          ) : null}
                          <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                            {initials(c.peer?.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-sm font-medium">
                              {c.peer?.name ?? "Usuário"}
                            </p>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {formatRelative(c.lastAt)}
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {c.lastMessage}
                          </p>
                        </div>
                        {c.unreadCount > 0 ? (
                          <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                            {c.unreadCount}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </ScrollArea>
        </div>

        {/* Thread */}
        <div
          className={cn(
            "flex flex-col",
            !mobileThreadOpen && "hidden md:flex",
          )}
        >
          {!selectedPeerId || !peer ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div className="space-y-2">
                <MessageSquare className="mx-auto size-10 text-muted-foreground/60" />
                <p className="text-sm font-medium">
                  Selecione uma conversa
                </p>
                <p className="mx-auto max-w-xs text-xs text-muted-foreground">
                  Escolha um prestador na lista ao lado para ver as mensagens.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-2 border-b px-3 py-2.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 md:hidden"
                  onClick={handleBackToList}
                  aria-label="Voltar"
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <Avatar className="size-9">
                  {peer.avatarUrl ? (
                    <AvatarImage src={peer.avatarUrl} alt={peer.name} />
                  ) : null}
                  <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                    {initials(peer.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{peer.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {peer.role === "PROVIDER" ? "Prestador" : peer.role}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1">
                <div className="flex flex-col gap-2 p-3">
                  {threadQuery.isLoading ? (
                    <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Carregando mensagens…
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="p-6 text-center text-xs text-muted-foreground">
                      Nenhuma mensagem ainda. Diga olá!
                    </div>
                  ) : (
                    messages.map((m) => {
                      const mine = m.fromId === user?.id
                      return (
                        <div
                          key={m.id}
                          className={cn(
                            "flex",
                            mine ? "justify-end" : "justify-start",
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[78%] rounded-2xl px-3 py-2 text-sm",
                              mine
                                ? "rounded-br-sm bg-primary text-primary-foreground"
                                : "rounded-bl-sm border bg-card text-card-foreground",
                            )}
                          >
                            <p className="whitespace-pre-line break-words">
                              {m.content}
                            </p>
                            <p
                              className={cn(
                                "mt-1 text-right text-[10px] tabular-nums",
                                mine
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground",
                              )}
                            >
                              {formatDateTime(m.createdAt)}
                            </p>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </ScrollArea>

              {/* Composer */}
              <div className="border-t p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleSend()
                  }}
                  className="flex items-center gap-2"
                >
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Escreva uma mensagem…"
                    className="h-11 flex-1"
                    maxLength={2000}
                    aria-label="Mensagem"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="size-11 shrink-0"
                    disabled={!draft.trim() || sendMutation.isPending}
                    aria-label="Enviar"
                  >
                    {sendMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </Button>
                </form>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
