"use client"

import * as React from "react"
import { Bell, Check, CheckCheck, ChevronRight, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { NOTIFICATION_TYPE_LABELS } from "@/lib/constants"
import { formatRelative } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { type NotificationItem, NOTIFICATION_ROUTES } from "./types"

import { triggerHaptic } from "@/lib/haptics"
import { playCoinSound } from "@/lib/sounds"

export function groupNotificationsByDate(
  items: NotificationItem[],
): Array<{ label: string; items: NotificationItem[] }> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const thisWeekStart = new Date(today)
  thisWeekStart.setDate(thisWeekStart.getDate() - today.getDay())
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const groups: Record<string, NotificationItem[]> = {
    today: [],
    yesterday: [],
    week: [],
    month: [],
    older: [],
  }

  for (const item of items) {
    const d = new Date(item.createdAt)
    if (d >= today) {
      groups.today.push(item)
    } else if (d >= yesterday) {
      groups.yesterday.push(item)
    } else if (d >= thisWeekStart) {
      groups.week.push(item)
    } else if (d >= thisMonthStart) {
      groups.month.push(item)
    } else {
      groups.older.push(item)
    }
  }

  const labels: Record<string, string> = {
    today: "Hoje",
    yesterday: "Ontem",
    week: "Esta semana",
    month: "Este mês",
    older: "Anterior",
  }

  return Object.entries(groups)
    .filter(([, groupItems]) => groupItems.length > 0)
    .map(([key, groupItems]) => ({ label: labels[key], items: groupItems }))
}

export function NotificationsBell({
  items,
  unreadCount,
  isLoading,
  onMarkRead,
  onMarkAllRead,
  markingAll,
  onNavigate,
  onOpenDrawer,
}: {
  items: NotificationItem[]
  unreadCount: number
  isLoading: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: (ids: string[]) => void
  markingAll: boolean
  onNavigate: (view: string) => void
  onOpenDrawer?: () => void
}) {
  const [filter, setFilter] = React.useState<"all" | "unread">("all")
  const unreadIds = React.useMemo(() => items.filter((n) => !n.read).map((n) => n.id), [items])
  const filteredItems = React.useMemo(
    () => (filter === "unread" ? items.filter((n) => !n.read) : items),
    [items, filter],
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground relative size-9"
          aria-label={`Notificações${unreadCount > 0 ? ` (${unreadCount} não lidas)` : ""}`}
        >
          <Bell className="size-[18px]" />
          {unreadCount > 0 ? (
            <span
              className="bg-primary text-primary-foreground ring-background absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ring-2"
              aria-hidden
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Notificações</p>
            {unreadCount > 0 ? (
              <Badge
                variant="secondary"
                className="bg-primary/10 text-primary h-5 px-1.5 text-[10px] font-semibold"
              >
                {unreadCount} nova{unreadCount > 1 ? "s" : ""}
              </Badge>
            ) : null}
          </div>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("success")
                try {
                  playCoinSound({ vibrate: true })
                } catch {}
                onMarkAllRead(unreadIds)
              }}
              disabled={markingAll}
              className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              {markingAll ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <CheckCheck className="size-3.5" />
              )}
              Marcar todas
            </button>
          ) : null}
        </div>

        {/* Filter bar: Todas / Não lidas */}
        <div className="bg-muted/30 flex items-center gap-1 border-b px-3 py-1.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setFilter("all")
              triggerHaptic("selection")
            }}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
              filter === "all"
                ? "bg-background text-foreground font-semibold shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Todas ({items.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setFilter("unread")
              triggerHaptic("selection")
            }}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
              filter === "unread"
                ? "bg-background text-foreground font-semibold shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Não lidas ({unreadCount})
          </button>
        </div>

        <ScrollArea className="max-h-80">
          {isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Carregando…
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              {filter === "unread" && items.length > 0 ? (
                <>
                  <span className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <CheckCheck className="size-5" />
                  </span>
                  <p className="text-foreground text-sm font-medium">Tudo em dia!</p>
                  <p className="text-muted-foreground text-xs">
                    Você não tem notificações não lidas.
                  </p>
                </>
              ) : (
                <>
                  <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
                    <Bell className="size-5" />
                  </span>
                  <p className="text-muted-foreground text-sm">Você não tem notificações.</p>
                </>
              )}
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {groupNotificationsByDate(filteredItems).map((group) => (
                <div key={group.label}>
                  <div className="bg-popover text-muted-foreground sticky top-0 z-10 px-3 py-1.5 text-[10px] font-medium tracking-wider uppercase">
                    {group.label}
                  </div>
                  <ul className="divide-y">
                    {group.items.map((n) => {
                      const typeLabel = NOTIFICATION_TYPE_LABELS[n.type]
                      const targetRoute = NOTIFICATION_ROUTES[n.type]
                      return (
                        <li
                          key={n.id}
                          className={cn(
                            "relative flex gap-3 px-3 py-2.5 transition-colors",
                            !n.read && "bg-primary/5",
                            targetRoute && "hover:bg-accent/50 cursor-pointer",
                          )}
                          onClick={() => {
                            triggerHaptic("selection")
                            if (targetRoute) {
                              onNavigate(targetRoute)
                            }
                          }}
                          onKeyDown={(e) => {
                            if ((e.key === "Enter" || e.key === " ") && targetRoute) {
                              e.preventDefault()
                              triggerHaptic("selection")
                              onNavigate(targetRoute)
                            }
                          }}
                          role={targetRoute ? "button" : undefined}
                          tabIndex={targetRoute ? 0 : undefined}
                          title={targetRoute ? `Ir para ${typeLabel ?? targetRoute}` : undefined}
                        >
                          <span
                            className={cn(
                              "mt-1.5 size-2 shrink-0 rounded-full",
                              n.read ? "ring-border bg-transparent ring-1" : "bg-primary",
                            )}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="text-sm leading-tight font-medium">{n.title}</p>
                              <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                                {formatRelative(n.createdAt)}
                              </span>
                            </div>
                            {n.body ? (
                              <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                                {n.body}
                              </p>
                            ) : null}
                            <div className="mt-1 flex items-center gap-2">
                              {typeLabel ? (
                                <Badge
                                  variant="outline"
                                  className="text-muted-foreground h-4 px-1.5 text-[10px] font-medium"
                                >
                                  {typeLabel}
                                </Badge>
                              ) : null}
                              {!n.read ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    triggerHaptic("selection")
                                    onMarkRead(n.id)
                                  }}
                                  className="text-primary inline-flex items-center gap-1 text-[10px] font-medium hover:underline"
                                >
                                  <Check className="size-3" />
                                  Marcar como lida
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {onOpenDrawer && (
          <div className="bg-muted/20 border-t p-2 text-center">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onOpenDrawer()
              }}
              className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs font-semibold hover:underline"
            >
              <span>Abrir central de notificações completa</span>
              <ChevronRight className="size-3" />
            </button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
