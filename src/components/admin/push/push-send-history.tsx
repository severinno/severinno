"use client"

import * as React from "react"
import { Bell, CheckCircle2, XCircle } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export interface PushHistoryItem {
  id: string
  title: string
  usersCount: number
  timestamp: Date
  success: number
  errors: number
}

export function PushSendHistory({ history }: { history: PushHistoryItem[] }) {
  if (history.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bell className="size-4" /> Histórico da sessão
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-0">
        {history.map((h) => (
          <div
            key={h.id}
            className="flex items-center justify-between border-b px-4 py-2.5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{h.title}</p>
              <p className="text-muted-foreground text-[10px]">
                {h.usersCount} usuário(s) · {h.timestamp.toLocaleTimeString("pt-BR")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {h.errors > 0 ? (
                <>
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                  <span className="text-xs text-emerald-500 tabular-nums">{h.success}</span>
                  <XCircle className="text-destructive size-3.5" />
                  <span className="text-destructive text-xs tabular-nums">{h.errors}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                  <span className="text-xs text-emerald-500 tabular-nums">{h.success}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
