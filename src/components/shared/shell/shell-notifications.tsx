"use client"

import * as React from "react"
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react"

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
import {
  type NotificationItem,
  NOTIFICATION_ROUTES,
} from "./types"

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
}: {
  items: NotificationItem[]
  unreadCount: number
  isLoading: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: (ids: string[]) => void
  markingAll: boolean
  onNavigate: (view: string) => void
}) {
  const unreadIds = React.useMemo(
    () => items.filter((n) => !n.read).map((n) => n.id),
    [items],
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9 text-muted-foreground hover:text-foreground"
          aria-label={`Notificações${
            unreadCount > 0 ? ` (${unreadCount} não lidas)` : ""
          }`}
        >
          <Bell className="size-[18px]" />
          {unreadCount > 0 ? (
            <span
              className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-background"
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
                className="h-5 bg-primary/10 px-1.5 text-[10px] font-semibold text-primary"
              >
                {unreadCount} nova{unreadCount > 1 ? "s" : ""}
              </Badge>
            ) : null}
          </div>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => onMarkAllRead(unreadIds)}
              disabled={markingAll}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:text-primary/80 disabled:opacity-50"
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

        <ScrollArea className="max-h-80">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Bell className="size-5" />
              </span>
              <p className="text-sm text-muted-foreground">
                Você não tem notificações.
              </p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {groupNotificationsByDate(items).map((group) => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 bg-popover px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
                            targetRoute && "cursor-pointer hover:bg-accent/50",
                          )}
                          onClick={() => {
                            if (targetRoute) {
                              onNavigate(targetRoute)
                            }
                          }}
                          onKeyDown={(e) => {
                            if ((e.key === "Enter" || e.key === " ") && targetRoute) {
                              e.preventDefault()
                              onNavigate(targetRoute)
                            }
                          }}
                          role={targetRoute ? "button" : undefined}
                          tabIndex={targetRoute ? 0 : undefined}
                          title={
                            targetRoute ? `Ir para ${typeLabel ?? targetRoute}` : undefined
                          }
                        >
                          <span
                            className={cn(
                              "mt-1.5 size-2 shrink-0 rounded-full",
                              n.read ? "bg-transparent ring-1 ring-border" : "bg-primary",
                            )}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="text-sm font-medium leading-tight">
                                {n.title}
                              </p>
                              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                                {formatRelative(n.createdAt)}
                              </span>
                            </div>
                            {n.body ? (
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                {n.body}
                              </p>
                            ) : null}
                            <div className="mt-1 flex items-center gap-2">
                              {typeLabel ? (
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1.5 text-[10px] font-medium text-muted-foreground"
                                >
                                  {typeLabel}
                                </Badge>
                              ) : null}
                              {!n.read ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onMarkRead(n.id)
                                  }}
                                  className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
