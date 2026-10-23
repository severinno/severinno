"use client"

/**
 * NotificationsDrawer — Drawer Lateral Unificado de Notificações.
 *
 * Apresenta a central de notificações completa do usuário em um painel lateral
 * acessível em todos os 3 painéis (Admin, Cliente e Prestador), com filtros
 * por abas, agrupamento por data, busca e atalhos de navegação direta.
 */

import * as React from "react"
import { Bell, CheckCheck, Clock, Inbox, Loader2, Search } from "lucide-react"

import { triggerHaptic } from "@/lib/haptics"
import { playCoinSound } from "@/lib/sounds"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { type NotificationItem, NOTIFICATION_ROUTES } from "@/components/shared/shell/types"
import { groupNotificationsByDate } from "@/components/shared/shell/shell-notifications"

interface NotificationsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: NotificationItem[]
  unreadCount: number
  isLoading: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: (ids: string[]) => void
  markingAll: boolean
  onNavigate: (view: string) => void
}

export function NotificationsDrawer({
  open,
  onOpenChange,
  items,
  unreadCount,
  isLoading,
  onMarkRead,
  onMarkAllRead,
  markingAll,
  onNavigate,
}: NotificationsDrawerProps) {
  const [activeTab, setActiveTab] = React.useState<"all" | "unread" | "trans">("all")
  const [searchQuery, setSearchQuery] = React.useState("")

  const unreadIds = React.useMemo(() => items.filter((n) => !n.read).map((n) => n.id), [items])

  const filteredItems = React.useMemo(() => {
    let result = items

    if (activeTab === "unread") {
      result = result.filter((n) => !n.read)
    } else if (activeTab === "trans") {
      result = result.filter(
        (n) =>
          n.type === "PAYMENT_CONFIRMED" ||
          n.type === "ESCROW_RELEASED" ||
          n.type === "SETTLEMENT_PAID" ||
          n.type === "QUOTE_ACCEPTED",
      )
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (n) =>
          n.title?.toLowerCase().includes(q) ||
          n.body?.toLowerCase().includes(q) ||
          n.type?.toLowerCase().includes(q),
      )
    }

    return result
  }, [items, activeTab, searchQuery])

  const grouped = React.useMemo(() => groupNotificationsByDate(filteredItems), [filteredItems])

  const handleItemClick = (item: NotificationItem) => {
    triggerHaptic("selection")
    if (!item.read) {
      onMarkRead(item.id)
    }

    const route = NOTIFICATION_ROUTES[item.type]
    if (route) {
      onNavigate(route)
      onOpenChange(false)
    }
  }

  const handleMarkAll = () => {
    triggerHaptic("success")
    try {
      playCoinSound({ vibrate: true })
    } catch {}
    onMarkAllRead(unreadIds)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
        {/* Header */}
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
                <Bell className="size-4" />
              </span>
              <div>
                <SheetTitle className="text-base font-bold">Notificações</SheetTitle>
                <SheetDescription className="text-xs">
                  Alertas em tempo real e histórico de atividades
                </SheetDescription>
              </div>
            </div>

            {unreadCount > 0 ? (
              <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 text-xs font-semibold">
                {unreadCount} nova{unreadCount > 1 ? "s" : ""}
              </Badge>
            ) : null}
          </div>

          {/* Quick Mark All Read */}
          {unreadCount > 0 && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={markingAll}
                className="text-primary hover:text-primary/80 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {markingAll ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="size-3.5" />
                )}
                Marcar todas como lidas
              </button>
            </div>
          )}
        </SheetHeader>

        {/* Filter Pills + Search */}
        <div className="bg-muted/20 space-y-2 border-b px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setActiveTab("all")
              }}
              className={cn(
                "h-7 rounded-lg px-2.5 text-xs font-medium transition-all active:scale-95",
                activeTab === "all"
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Todas ({items.length})
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setActiveTab("unread")
              }}
              className={cn(
                "h-7 rounded-lg px-2.5 text-xs font-medium transition-all active:scale-95",
                activeTab === "unread"
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Não lidas ({unreadCount})
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setActiveTab("trans")
              }}
              className={cn(
                "h-7 rounded-lg px-2.5 text-xs font-medium transition-all active:scale-95",
                activeTab === "trans"
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Transações
            </button>
          </div>

          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar nas notificações..."
              className="border-border/60 bg-background text-foreground placeholder:text-muted-foreground/70 focus:ring-primary h-8 w-full rounded-lg border pr-3 pl-8 text-xs focus:ring-1 focus:outline-none"
            />
          </div>
        </div>

        {/* Notifications List */}
        <ScrollArea className="flex-1 px-4 py-2">
          {isLoading ? (
            <div className="text-muted-foreground flex h-48 items-center justify-center text-xs">
              <Loader2 className="mr-2 size-4 animate-spin" /> Carregando notificações...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
              <div className="bg-muted/60 text-muted-foreground flex size-11 items-center justify-center rounded-2xl">
                <Inbox className="size-5 opacity-70" />
              </div>
              <p className="text-foreground text-xs font-semibold">Nenhuma notificação</p>
              <p className="text-muted-foreground text-[11px]">
                {activeTab === "unread"
                  ? "Você leu todas as notificações recentes!"
                  : "Não há avisos correspondentes ao filtro atual."}
              </p>
            </div>
          ) : (
            <div className="space-y-4 pb-4">
              {grouped.map((group) => (
                <div key={group.label} className="space-y-1.5">
                  <p className="text-muted-foreground px-1 text-[11px] font-bold tracking-wider uppercase">
                    {group.label}
                  </p>
                  <div className="space-y-1.5">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleItemClick(item)}
                        className={cn(
                          "group relative flex w-full items-start gap-3 rounded-xl border p-3 text-left shadow-2xs transition-all",
                          item.read
                            ? "border-border/40 bg-card hover:bg-muted/40"
                            : "border-primary/30 bg-primary/5 hover:bg-primary/10",
                        )}
                      >
                        {!item.read && (
                          <span
                            className="bg-primary absolute top-3.5 right-3 size-2 rounded-full"
                            aria-label="Não lida"
                          />
                        )}

                        <div
                          className={cn(
                            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border text-xs shadow-2xs",
                            item.read
                              ? "bg-muted text-muted-foreground border-border/50"
                              : "bg-primary/15 text-primary border-primary/25",
                          )}
                        >
                          <Bell className="size-3.5" />
                        </div>

                        <div className="min-w-0 flex-1 pr-3">
                          <p
                            className={cn(
                              "truncate text-xs font-semibold",
                              item.read ? "text-foreground" : "text-foreground font-bold",
                            )}
                          >
                            {item.title}
                          </p>
                          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px] leading-relaxed">
                            {item.body}
                          </p>
                          <p className="text-muted-foreground/75 mt-1 flex items-center gap-1 text-[10px]">
                            <Clock className="size-2.5" />
                            <span>{formatRelative(item.createdAt)}</span>
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
