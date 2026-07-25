"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatRelative } from "@/lib/format";
import { apiGet, apiPost } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Send, MessagesSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRealtime } from "@/hooks/use-realtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConversationPeer = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role?: string;
};

export type Conversation = {
  peerId: string;
  peer: ConversationPeer | null;
  lastMessage: string;
  lastAt: string;
  unreadCount: number;
};

export type Message = {
  id: string;
  fromId: string;
  toId: string;
  content: string;
  read: boolean;
  bookingId?: string | null;
  createdAt: string;
};

type MessagesViewProps = {
  /** Force a specific peer to be selected initially (e.g. a booking's client). */
  initialPeerId?: string;
  /** Optional title for the empty state. */
  emptyTitle?: string;
  /** Optional description for the empty state. */
  emptyDescription?: string;
  className?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name?: string) {
  if (!name) return "?";
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Shared two-pane chat UI used by both the client and provider panels.
 *
 * - Left: list of conversations (peer + last message + unread badge).
 * - Right: thread with the selected peer (messages + composer).
 *
 * Realtime: subscribes to `message:new` from the WebSocket mini-service
 * and invalidates the relevant queries.
 */
export function MessagesView({
  initialPeerId,
  emptyTitle = "Suas mensagens",
  emptyDescription = "Converse com seus clientes e prestadores em tempo real.",
  className,
}: MessagesViewProps) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [selectedPeerId, setSelectedPeerId] = React.useState<string | undefined>(initialPeerId);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { on, isConnected, join } = useRealtime();

  // --- Realtime subscription ---
  React.useEffect(() => {
    if (!isConnected || !user) return;
    join({ userId: user.id, role: user.role.toLowerCase() });
  }, [isConnected, user, join]);

  React.useEffect(() => {
    const unsub = on<{ fromId: string; toId: string }>("message:new", (msg) => {
      if (!msg) return;
      // Invalidate conversations list + thread if relevant
      qc.invalidateQueries({ queryKey: ["messages", "conversations"] });
      if (selectedPeerId && (msg.fromId === selectedPeerId || msg.toId === selectedPeerId)) {
        qc.invalidateQueries({
          queryKey: ["messages", "thread", selectedPeerId],
        });
      }
    });
    return () => unsub();
  }, [on, qc, selectedPeerId]);

  // --- Conversations list ---
  const conversationsQuery = useQuery<Conversation[]>({
    queryKey: ["messages", "conversations"],
    queryFn: async () => {
      const data = await apiGet<{ items: Conversation[] }>("/api/messages");
      return data?.items ?? [];
    },
    refetchInterval: 15_000,
  });

  // Auto-select first conversation on first load
  React.useEffect(() => {
    if (!selectedPeerId && conversationsQuery.data && conversationsQuery.data.length > 0) {
      setSelectedPeerId(conversationsQuery.data[0].peerId);
    }
  }, [conversationsQuery.data, selectedPeerId]);

  // --- Thread ---
  const threadQuery = useQuery<{ peer: ConversationPeer; items: Message[] }>({
    queryKey: ["messages", "thread", selectedPeerId],
    queryFn: async () => {
      if (!selectedPeerId) throw new Error("no peer");
      return apiGet<{ peer: ConversationPeer; items: Message[] }>("/api/messages", {
        with: selectedPeerId,
      });
    },
    enabled: !!selectedPeerId,
    refetchInterval: 10_000,
  });

  // Scroll to bottom on new messages
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadQuery.data]);

  const send = async () => {
    if (!selectedPeerId || !draft.trim()) return;
    setSending(true);
    try {
      await apiPost("/api/messages", {
        toId: selectedPeerId,
        content: draft.trim(),
      });
      setDraft("");
      qc.invalidateQueries({
        queryKey: ["messages", "thread", selectedPeerId],
      });
      qc.invalidateQueries({ queryKey: ["messages", "conversations"] });
    } catch (_e) {
      toast.error("Não foi possível enviar a mensagem. Tente novamente.");
    } finally {
      setSending(false);
    }
  };

  const conversations = conversationsQuery.data ?? [];
  const thread = threadQuery.data?.items ?? [];
  const peer = threadQuery.data?.peer;

  return (
    <div
      className={cn(
        "grid h-[calc(100vh-12rem)] min-h-[480px] grid-cols-1 overflow-hidden rounded-xl border bg-card md:grid-cols-[320px_1fr]",
        className,
      )}
    >
      {/* Conversations list */}
      <aside className="flex flex-col border-b md:border-b-0 md:border-r">
        <div className="border-b p-3">
          <h2 className="text-sm font-semibold">Conversas</h2>
          <p className="text-xs text-muted-foreground">
            {conversations.length} conversa{conversations.length === 1 ? "" : "s"}
          </p>
        </div>
        <ScrollArea className="flex-1">
          {conversationsQuery.isLoading ? (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Carregando…
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma conversa ainda.
            </div>
          ) : (
            <ul className="divide-y">
              {conversations.map((c) => {
                const active = c.peerId === selectedPeerId;
                return (
                  <li key={c.peerId}>
                    <button
                      type="button"
                      onClick={() => setSelectedPeerId(c.peerId)}
                      className={cn(
                        "flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-accent/50",
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
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatRelative(c.lastAt)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{c.lastMessage}</p>
                      </div>
                      {c.unreadCount > 0 && (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">
                          {c.unreadCount}
                        </span>
                      )}
                    </button>
                  </li>
                );
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
              <p className="mt-1 text-xs text-muted-foreground">{emptyDescription}</p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b p-3">
              <Avatar className="size-9 border">
                {peer.avatarUrl && <AvatarImage src={peer.avatarUrl} alt={peer.name} />}
                <AvatarFallback className="bg-emerald-600 text-xs text-white">
                  {initials(peer.name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-semibold">{peer.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {peer.role === "PROVIDER"
                    ? "Prestador"
                    : peer.role === "CLIENT"
                      ? "Cliente"
                      : (peer.role ?? "")}
                </p>
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
              {threadQuery.isLoading ? (
                <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Carregando…
                </div>
              ) : thread.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Nenhuma mensagem ainda. Diga olá!
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {thread.map((m) => {
                    const mine = m.fromId === user?.id;
                    return (
                      <li
                        key={m.id}
                        className={cn("flex flex-col gap-0.5", mine ? "items-end" : "items-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                            mine ? "bg-emerald-600 text-white" : "bg-muted text-foreground",
                          )}
                        >
                          {m.content}
                        </div>
                        <span className="px-2 text-[10px] text-muted-foreground">
                          {new Date(m.createdAt).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <footer className="border-t p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                className="flex items-center gap-2"
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escreva uma mensagem…"
                  disabled={sending}
                  className="flex-1"
                  maxLength={2000}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={sending || !draft.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </form>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

export default MessagesView;
