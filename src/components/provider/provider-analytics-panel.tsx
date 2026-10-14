"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from "recharts"
import { ShieldCheck, TrendingUp, Clock, Loader2, Sparkles, AlertCircle } from "lucide-react"
import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.15)",
} as const

export type ProviderAnalyticsData = {
  ok: boolean
  escrow: {
    retainedAmount: number
    heldBookingsCount: number
  }
  quotes: {
    total: number
    accepted: number
    rejected: number
    pending: number
    conversionRate: number
  }
  demand: {
    peakHours: string[]
    hourlyDistribution: Array<{
      hour: number
      label: string
      count: number
    }>
  }
  trends: Array<{
    month: string
    revenue: number
    completedJobs: number
    avgTicket: number
  }>
  engagement: {
    favoriteCount: number
    totalReviews: number
    avgRating: number
  }
}

export function ProviderAnalyticsPanel() {
  const { data, isLoading, error } = useQuery<ProviderAnalyticsData>({
    queryKey: ["provider", "analytics"],
    queryFn: () => apiGet<ProviderAnalyticsData>("/api/provider/analytics"),
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    )
  }

  if (error || !data || !data.ok) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="flex items-center gap-3 py-6 text-sm">
          <AlertCircle className="text-destructive size-5 shrink-0" />
          <span>Não foi possível carregar as métricas de analytics no momento.</span>
        </CardContent>
      </Card>
    )
  }

  const { escrow, quotes, demand, trends, engagement } = data

  return (
    <div className="space-y-6">
      {/* 4 Top KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Saldo em Escrow */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Custódia Escrow
            </CardTitle>
            <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatBRL(escrow.retainedAmount)}</div>
            <p className="text-muted-foreground mt-1 text-xs">
              {escrow.heldBookingsCount} serviço{escrow.heldBookingsCount === 1 ? "" : "s"} retido
              {escrow.heldBookingsCount === 1 ? "" : "s"} (liberação na conclusão)
            </p>
          </CardContent>
        </Card>

        {/* 2. Taxa de Aceite / Conversão */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Conversão de Propostas
            </CardTitle>
            <TrendingUp className="size-4 text-blue-600 dark:text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{quotes.conversionRate}%</div>
            <p className="text-muted-foreground mt-1 text-xs">
              {quotes.accepted} aceita{quotes.accepted === 1 ? "" : "s"} de {quotes.total} enviada
              {quotes.total === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>

        {/* 3. Horários de Pico */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Horários de Alta Procura
            </CardTitle>
            <Clock className="size-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{demand.peakHours.join(", ")}</div>
            <p className="text-muted-foreground mt-1 text-xs">
              Horários com mais pedidos de clientes na região
            </p>
          </CardContent>
        </Card>

        {/* 4. Engajamento */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Avaliações & Reputação
            </CardTitle>
            <Sparkles className="size-4 text-purple-600 dark:text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">★ {engagement.avgRating.toFixed(1)}</div>
            <p className="text-muted-foreground mt-1 text-xs">
              {engagement.totalReviews} avaliações · {engagement.favoriteCount} clientes favoritados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Dica de Otimização Operacional */}
      <div className="border-border/60 bg-primary/5 flex items-start gap-3 rounded-xl border p-4">
        <Sparkles className="text-primary mt-0.5 size-5 shrink-0" />
        <div className="text-xs">
          <span className="text-foreground font-semibold">Dica de Performance do Severinno:</span>{" "}
          <span className="text-muted-foreground">
            Os clientes na sua região concentram mais pedidos nos horários de pico (
            {demand.peakHours.join(", ")}). Manter notificações do navegador/PWA ativas e responder
            orçamentos em menos de 15 minutos aumenta sua probabilidade de fechamento em até 40%.
          </span>
        </div>
      </div>

      {/* 2 Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Distribuição Horária */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Distribuição Horária de Demanda
            </CardTitle>
            <CardDescription className="text-xs">
              Concentração de novas solicitações por hora do dia (0h às 23h)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={demand.hourlyDistribution}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    interval={2}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <RTooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(val: number) => [`${val} pedidos`, "Volume"]}
                  />
                  <Bar dataKey="count" fill="var(--color-primary, #10b981)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Faturamento Mensal Recente */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Evolução Mensal de Receita</CardTitle>
            <CardDescription className="text-xs">
              Faturamento de serviços concluídos nos últimos 6 meses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(val) => `R$${val}`}
                  />
                  <RTooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(val: number) => [formatBRL(val), "Receita"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#revenueGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
