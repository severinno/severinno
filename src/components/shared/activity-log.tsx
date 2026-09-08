"use client"

import * as React from "react"
import {
  Shield,
  KeyRound,
  LogIn,
  FileCheck2,
  UserCheck,
  Clock,
  RefreshCw,
  History,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageTransition } from "@/components/shared/page-transition"
import { EmptyState } from "@/components/shared/empty-state"

type Activity = {
  id: string
  type: string
  title: string
  description?: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export function ActivityLog() {
  const [activities, setActivities] = React.useState<Activity[]>([])
  const [loading, setLoading] = React.useState(true)

  const fetchActivities = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/auth/activity")
      if (!res.ok) throw new Error("Falha ao buscar atividades")
      const data = await res.json()
      setActivities(data.activities || [])
    } catch {
      setActivities([])
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    queueMicrotask(() => {
      fetchActivities()
    })
  }, [])

  const getIcon = (type: string) => {
    switch (type) {
      case "login":
        return <LogIn className="h-4 w-4 text-blue-500" />
      case "password_change":
        return <KeyRound className="h-4 w-4 text-amber-500" />
      case "2fa_enable":
      case "2fa_disable":
        return <Shield className="h-4 w-4 text-purple-500" />
      case "identity_upload":
        return <FileCheck2 className="h-4 w-4 text-emerald-500" />
      case "profile_update":
        return <UserCheck className="h-4 w-4 text-indigo-500" />
      default:
        return <Clock className="text-muted-foreground h-4 w-4" />
    }
  }

  const formatTimestamp = (ts: number) => {
    try {
      const date = new Date(ts)
      return {
        dateStr: date.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        timeStr: date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      }
    } catch {
      return { dateStr: "", timeStr: "" }
    }
  }

  return (
    <PageTransition className="mx-auto max-w-3xl space-y-4">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="text-primary h-5 w-5" />
              Histórico de Atividades e Segurança
            </CardTitle>
            <CardDescription>
              Registro de acessos, alterações de credenciais e ações importantes da conta.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchActivities}
            disabled={loading}
            title="Atualizar"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-4 py-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          ) : activities.length === 0 ? (
            <EmptyState
              icon={History}
              title="Nenhuma atividade registrada"
              description="Suas ações recentes de segurança aparecerão aqui nos próximos acessos."
            />
          ) : (
            <div className="before:bg-border/60 relative space-y-6 pl-6 before:absolute before:top-3 before:bottom-3 before:left-2 before:w-[2px]">
              {activities.map((item) => {
                const { dateStr, timeStr } = formatTimestamp(item.timestamp)
                return (
                  <div key={item.id} className="group relative flex items-start gap-3.5">
                    {/* Bullet marker */}
                    <div className="bg-background border-primary/50 absolute top-1 -left-6 flex h-4 w-4 items-center justify-center rounded-full border-2 shadow-sm">
                      <div className="bg-primary h-1.5 w-1.5 rounded-full" />
                    </div>

                    {/* Content item */}
                    <div className="border-border/40 bg-muted/20 hover:bg-muted/40 flex flex-1 items-center justify-between gap-4 rounded-xl border p-3 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="bg-background border-border/40 rounded-lg border p-2 shadow-xs">
                          {getIcon(item.type)}
                        </div>
                        <div>
                          <p className="text-foreground text-sm font-medium">{item.title}</p>
                          {item.description && (
                            <p className="text-muted-foreground text-xs">{item.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <span className="text-foreground block text-xs font-medium">{timeStr}</span>
                        <span className="text-muted-foreground block text-[11px]">{dateStr}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </PageTransition>
  )
}

export default ActivityLog
