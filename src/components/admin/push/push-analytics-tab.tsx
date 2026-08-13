"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BarChart3,
  RotateCw,
  TrendingUp,
  TrendingDown,
  MousePointerClick,
  XCircle,
  Smartphone,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
} from "lucide-react"

import { apiGet } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

function RateCard({
  label,
  value,
  subtitle,
  trend,
  icon: Icon,
  inverse,
}: {
  label: string
  value: string
  subtitle: string
  trend: "up" | "down" | "neutral"
  icon: React.ComponentType<{ className?: string }>
  inverse?: boolean
}) {
  const isGood = inverse ? trend === "down" : trend === "up"
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium">{label}</CardTitle>
        <Icon
          className={cn(
            "size-4",
            isGood
              ? "text-emerald-500"
              : trend === "neutral"
                ? "text-muted-foreground"
                : "text-destructive",
          )}
        />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1.5">
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          {trend !== "neutral" &&
            (isGood ? (
              <ArrowUp className="size-3.5 text-emerald-500" />
            ) : (
              <ArrowDown className="text-destructive size-3.5" />
            ))}
        </div>
        <p className="text-muted-foreground text-[10px]">{subtitle}</p>
      </CardContent>
    </Card>
  )
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium">{label}</CardTitle>
        {Icon && <Icon className="text-muted-foreground size-3.5" />}
      </CardHeader>
      <CardContent>
        <p className="text-xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

export function PushAnalyticsTab() {
  const [analyticsDays, setAnalyticsDays] = React.useState(30)

  const {
    data: analyticsData,
    isLoading: analyticsLoading,
    refetch: analyticsRefetch,
  } = useQuery({
    queryKey: ["admin", "push", "analytics", analyticsDays],
    queryFn: () => apiGet<any>(`/api/admin/push/analytics?days=${analyticsDays}`),
    staleTime: 60_000,
  })

  return (
    <section aria-label="Analytics de push">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            <BarChart3 className="mr-2 inline-block size-5 align-text-top" /> Analytics de Push
          </h3>
          <p className="text-muted-foreground text-sm">
            Métricas de entrega, taxa de clique e desempenho das notificações push.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(analyticsDays)} onValueChange={(v) => setAnalyticsDays(Number(v))}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void analyticsRefetch()}
            disabled={analyticsLoading}
          >
            <RotateCw className={cn("size-4", analyticsLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {analyticsLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!analyticsLoading && analyticsData && (
        <div className="flex flex-col gap-6">
          {/* Rate cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <RateCard
              label="Entrega"
              value={`${analyticsData.rates?.deliveryRate ?? 0}%`}
              subtitle={`${analyticsData.summary?.delivered ?? 0} entregues`}
              trend={analyticsData.rates?.deliveryRate >= 90 ? "up" : "down"}
              icon={TrendingUp}
            />
            <RateCard
              label="Clique (CTR)"
              value={`${analyticsData.rates?.clickRate ?? 0}%`}
              subtitle={`${analyticsData.summary?.clicked ?? 0} cliques`}
              trend={analyticsData.rates?.clickRate >= 10 ? "up" : "neutral"}
              icon={MousePointerClick}
            />
            <RateCard
              label="Rejeição"
              value={`${analyticsData.rates?.bounceRate ?? 0}%`}
              subtitle={`${analyticsData.summary?.bounced ?? 0} subs expiradas`}
              trend={analyticsData.rates?.bounceRate > 5 ? "down" : "up"}
              icon={TrendingDown}
              inverse
            />
            <RateCard
              label="Falha"
              value={`${analyticsData.rates?.failureRate ?? 0}%`}
              subtitle={`${analyticsData.summary?.failed ?? 0} falhas`}
              trend={analyticsData.rates?.failureRate > 2 ? "down" : "up"}
              icon={XCircle}
              inverse
            />
          </div>

          {/* Totals + subscriptions */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <MetricCard
              label="Total enviado"
              value={String(analyticsData.summary?.totalSent ?? 0)}
            />
            <MetricCard label="Entregues" value={String(analyticsData.summary?.delivered ?? 0)} />
            <MetricCard label="Cliques" value={String(analyticsData.summary?.clicked ?? 0)} />
            <MetricCard label="Rejeitados" value={String(analyticsData.summary?.bounced ?? 0)} />
            <MetricCard
              label="Subs. ativas"
              value={String(analyticsData.activeSubscriptions ?? 0)}
              icon={Smartphone}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* By source */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Por origem</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Origem</TableHead>
                      <TableHead className="text-right">Enviados</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(analyticsData.bySource ?? []).map((s: { source: string; count: number }) => (
                      <TableRow key={s.source}>
                        <TableCell className="font-medium capitalize">{s.source}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {analyticsData.summary?.totalSent > 0
                            ? `${Math.round((s.count / analyticsData.summary.totalSent) * 100)}%`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* By type */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Por tipo</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Enviados</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(analyticsData.byType ?? []).map((t: { type: string; count: number }) => (
                      <TableRow key={t.type}>
                        <TableCell className="text-xs font-medium">{t.type}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Daily trend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <BarChart3 className="size-4" />
                Tendência diária
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analyticsData.daily && analyticsData.daily.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b text-left">
                        <th className="pr-4 pb-2 font-normal">Data</th>
                        <th className="px-2 pb-2 text-right font-normal">Enviados</th>
                        <th className="px-2 pb-2 text-right font-normal">Cliques</th>
                        <th className="px-2 pb-2 text-right font-normal">Rejeit.</th>
                        <th className="px-2 pb-2 text-right font-normal">Falhas</th>
                        <th className="pb-2 pl-2 text-right font-normal">CTR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsData.daily.map(
                        (d: {
                          date: string
                          sent: number
                          clicked: number
                          bounced: number
                          failed: number
                        }) => {
                          const ctr = d.sent > 0 ? Math.round((d.clicked / d.sent) * 100) : 0
                          return (
                            <tr key={d.date} className="hover:bg-muted/30 border-b last:border-0">
                              <td className="py-2 pr-4 font-medium">
                                {new Date(d.date + "T00:00:00").toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                })}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">{d.sent}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{d.clicked}</td>
                              <td className="px-2 py-2 text-right text-amber-500 tabular-nums">
                                {d.bounced}
                              </td>
                              <td className="text-destructive px-2 py-2 text-right tabular-nums">
                                {d.failed}
                              </td>
                              <td className="py-2 pl-2 text-right tabular-nums">{ctr}%</td>
                            </tr>
                          )
                        },
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <BarChart3 className="text-muted-foreground size-6" />
                  <p className="text-muted-foreground text-xs">
                    Nenhum dado disponível para o período selecionado.
                  </p>
                  <p className="text-muted-foreground text-[10px]">
                    Os dados começam a aparecer após o primeiro envio de notificação.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top notifications */}
          {analyticsData.topNotifications && analyticsData.topNotifications.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Notificações mais enviadas</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Título</TableHead>
                      <TableHead className="text-right">Enviados</TableHead>
                      <TableHead className="text-right">Dispositivos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analyticsData.topNotifications.map(
                      (n: { title: string; sent: number; devices: number }, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="max-w-[300px]">
                            <p className="truncate text-sm">{n.title}</p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{n.sent}</TableCell>
                          <TableCell className="text-muted-foreground text-right tabular-nums">
                            {n.devices}
                          </TableCell>
                        </TableRow>
                      ),
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!analyticsLoading && !analyticsData && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <AlertTriangle className="size-8 text-amber-500" />
            <p className="text-muted-foreground text-sm">Erro ao carregar analytics.</p>
            <Button variant="outline" size="sm" onClick={() => void analyticsRefetch()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
