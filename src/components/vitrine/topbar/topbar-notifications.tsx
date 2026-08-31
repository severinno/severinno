"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Bell } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { NOTIFICATION_TYPE_LABELS } from "@/lib/constants"
import { formatRelative } from "@/lib/format"
import { type NotificationsResponse, NOTIFICATION_ROUTES } from "./types"

function groupNotificationsByDate(items: NotificationsResponse["items"]) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const thisWeekStart = new Date(today)
  thisWeekStart.setDate(thisWeekStart.getDate() - today.getDay())
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const groups: { label: string; items: NotificationsResponse["items"] }[] = []

  const buckets: Record<string, NotificationsResponse["items"]> = {
    Hoje: [],
    Ontem: [],
    "Esta semana": [],
    "Este mês": [],
    Anterior: [],
  }

  for (const item of items) {
    const date = new Date(item.createdAt)
    const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    if (dateStart.getTime() === today.getTime()) {
      buckets["Hoje"].push(item)
    } else if (dateStart.getTime() === yesterday.getTime()) {
      buckets["Ontem"].push(item)
    } else if (dateStart >= thisWeekStart) {
      buckets["Esta semana"].push(item)
    } else if (dateStart >= thisMonthStart) {
      buckets["Este mês"].push(item)
    } else {
      buckets["Anterior"].push(item)
    }
  }

  for (const [label, bucketItems] of Object.entries(buckets)) {
    if (bucketItems.length > 0) {
      groups.push({ label, items: bucketItems })
    }
  }

  return groups
}

export function TopbarNotifications({
  notificationsData,
  unreadCount,
  onNavigateAll,
  onNavigateRoute,
}: {
  notificationsData?: NotificationsResponse
  unreadCount: number
  onNavigateAll: () => void
  onNavigateRoute: (route: string) => void
}) {
  return (
    <Popover>
      <PopoverAnchor asChild>
        <Button
          variant="ghost"
          size="icon"
          className="group text-muted-foreground hover:bg-accent hover:text-foreground relative size-9 rounded-xl transition-all"
          aria-label="Notificações"
          title="Notificações"
        >
          <Bell className="size-[18px] transition-transform duration-200 group-hover:rotate-12" />
          <AnimatePresence>
            {unreadCount > 0 ? (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 20 }}
                className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-red-400 text-[9px] font-bold text-white shadow-sm"
                aria-live="polite"
                aria-atomic="true"
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </Button>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="shadow-primary/5 w-80 rounded-2xl border-0 p-0 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notificações</h3>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {unreadCount} não lida{unreadCount > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {(notificationsData?.items ?? []).length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Bell className="text-muted-foreground/30 size-8" />
              <p className="text-muted-foreground text-sm">Nenhuma notificação</p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {groupNotificationsByDate(notificationsData?.items ?? []).map((group) => (
                <div key={group.label}>
                  <div className="bg-popover text-muted-foreground sticky top-0 z-10 px-4 py-1.5 text-[10px] font-medium tracking-wider uppercase">
                    {group.label}
                  </div>
                  {group.items.map((n) => {
                    const typeLabel = NOTIFICATION_TYPE_LABELS[n.type]
                    const targetRoute = NOTIFICATION_ROUTES[n.type]
                    return (
                      <div
                        key={n.id}
                        className={cn(
                          "flex gap-3 px-4 py-3 transition-colors",
                          !n.read && "bg-primary/5",
                          targetRoute && "hover:bg-muted/50 cursor-pointer",
                        )}
                        onClick={() => {
                          if (targetRoute) onNavigateRoute(targetRoute)
                        }}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && targetRoute) {
                            e.preventDefault()
                            onNavigateRoute(targetRoute)
                          }
                        }}
                        role={targetRoute ? "button" : undefined}
                        tabIndex={targetRoute ? 0 : undefined}
                      >
                        <div className="bg-primary/10 text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
                          <Bell className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm leading-snug", !n.read && "font-medium")}>
                            {n.title || n.body}
                          </p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {formatRelative(n.createdAt)}
                          </p>
                          {typeLabel ? (
                            <Badge variant="outline" className="mt-1 h-4 text-[9px] font-medium">
                              {typeLabel}
                            </Badge>
                          ) : null}
                        </div>
                        {!n.read && (
                          <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" />
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="border-t px-4 py-2.5">
          <Button
            variant="ghost"
            size="sm"
            className="text-primary hover:text-primary/80 w-full text-xs font-medium"
            onClick={onNavigateAll}
          >
            Ver todas as notificações
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
