"use client"

/**
 * AdminUnitEconomicsCard — Painel de Unit Economics & Simulador de Expansão Territorial
 *
 * Módulo de alto impacto para apresentação a investidores (Investor Pitch Mode):
 * - KPIs reais de tração: GMV transacionado, Take-rate 12%, Ticket Médio, CAC vs LTV.
 * - Simulador dinâmico de expansão para cidades do Vale do Aço & Leste de MG.
 * - Heurísticas de Nielsen aplicadas: H1 (visibilidade imediata), H7 (flexibilidade de projeção).
 */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Sparkles, Printer, Compass, ShieldCheck, Clock, Award } from "lucide-react"

import { apiGet } from "@/lib/api"
import { formatBRL } from "@/lib/format"
import { FEE_RATE } from "@/lib/constants"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"

type UnitEconomicsData = {
  gmv: {
    total: number
    today: number
    last30Days: number
    paidBookingsCount: number
    totalBookingsCount: number
  }
  takeRate: {
    rate: number
    percentage: number
    totalRevenue: number
    projectedAnnualRevenue: number
  }
  unitEconomics: {
    ticketMedio: number
    cacProjetado: number
    ltvProjetado: number
    ltvCacRatio: number
    tempoMedioMatchMinutos: number
    satisfacaoNps: number
  }
  pilotoGV: {
    cidade: string
    estado: string
    populacao: number
    bairrosAtivos: string[]
    prestadoresAtivos: number
    clientesAtivos: number
    servicosAtivos: number
  }
  expansionCities: Array<{
    cidade: string
    estado: string
    populacao: number
    status: string
    prestadoresAlvo: number
    potencialGmvMensal: number
  }>
}

export function AdminUnitEconomicsCard() {
  const { data, isLoading, isError } = useQuery<UnitEconomicsData>({
    queryKey: ["admin", "metrics", "unit-economics"],
    queryFn: () => apiGet<UnitEconomicsData>("/api/admin/metrics/unit-economics"),
    staleTime: 30_000,
  })

  // Estado do Simulador de Expansão
  const [selectedCitiesCount, setSelectedCitiesCount] = React.useState<number>(3)
  const [providersPerCity, setProvidersPerCity] = React.useState<number>(45)
  const [bookingsPerProvider, setBookingsPerProvider] = React.useState<number>(14)
  const [ticketMedioSimulado, setTicketMedioSimulado] = React.useState<number>(180)

  // Cálculos dinâmicos da projeção
  const totalActiveProvidersSimulated = selectedCitiesCount * providersPerCity
  const totalMonthlyBookingsSimulated = totalActiveProvidersSimulated * bookingsPerProvider
  const projectedMonthlyGmv = totalMonthlyBookingsSimulated * ticketMedioSimulado
  const projectedMonthlyRevenue = projectedMonthlyGmv * FEE_RATE
  const projectedAnnualRunRate = projectedMonthlyRevenue * 12

  const handlePrintDeck = () => {
    window.print()
  }

  if (isLoading) {
    return (
      <Card className="border-border/60 bg-card/60 backdrop-blur-xs">
        <CardContent className="p-6">
          <Skeleton className="mb-4 h-6 w-64" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isError || !data) {
    return null
  }

  return (
    <Card className="border-primary/20 bg-card/70 relative overflow-hidden rounded-2xl border shadow-sm backdrop-blur-xs">
      {/* Glow de destaque sutil */}
      <div className="from-primary/10 via-primary/5 pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-gradient-to-br to-transparent blur-3xl" />

      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/10 text-primary hover:bg-primary/15 border-primary/20 gap-1 rounded-full font-semibold">
              <Sparkles className="size-3.5" />
              Unit Economics & Tração (Pitch Deck)
            </Badge>
            <Badge
              variant="outline"
              className="gap-1 rounded-full border-emerald-500/30 text-xs text-emerald-600 dark:text-emerald-400"
            >
              <ShieldCheck className="size-3" />
              Piloto GV Validado
            </Badge>
          </div>
          <CardTitle className="text-foreground mt-2 text-xl font-bold tracking-tight">
            Métricas de Crescimento & Modelo de Negócio
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs">
            Consolidação em tempo real de Gross Merchandise Volume (GMV), Take-Rate e projeção
            escalável.
          </CardDescription>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handlePrintDeck}
          className="gap-1.5 rounded-lg border-dashed text-xs print:hidden"
        >
          <Printer className="size-3.5" />
          Exportar Sumário Executivo
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 pt-6">
        {/* Grid de Métricas Principais de Unit Economics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <div className="border-border/60 bg-muted/30 flex flex-col justify-between rounded-xl border p-3.5">
            <span className="text-muted-foreground text-xs font-medium">GMV Total</span>
            <div className="mt-1">
              <span className="text-foreground text-lg font-bold tracking-tight">
                {formatBRL(data.gmv.total)}
              </span>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                {data.gmv.paidBookingsCount} contratações
              </p>
            </div>
          </div>

          <div className="border-border/60 bg-muted/30 flex flex-col justify-between rounded-xl border p-3.5">
            <span className="text-muted-foreground text-xs font-medium">Take-Rate Líquido</span>
            <div className="mt-1">
              <div className="flex items-center gap-1.5">
                <span className="text-foreground text-lg font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                  {data.takeRate.percentage}%
                </span>
                <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                  Sem spread
                </Badge>
              </div>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                {formatBRL(data.takeRate.totalRevenue)} receita retida
              </p>
            </div>
          </div>

          <div className="border-border/60 bg-muted/30 flex flex-col justify-between rounded-xl border p-3.5">
            <span className="text-muted-foreground text-xs font-medium">Ticket Médio</span>
            <div className="mt-1">
              <span className="text-foreground text-lg font-bold tracking-tight">
                {formatBRL(data.unitEconomics.ticketMedio)}
              </span>
              <p className="text-muted-foreground mt-0.5 text-[10px]">por atendimento</p>
            </div>
          </div>

          <div className="border-border/60 bg-muted/30 flex flex-col justify-between rounded-xl border p-3.5">
            <span className="text-muted-foreground text-xs font-medium">LTV / CAC Ratio</span>
            <div className="mt-1">
              <div className="flex items-center gap-1.5">
                <span className="text-primary text-lg font-bold tracking-tight">
                  {data.unitEconomics.ltvCacRatio}x
                </span>
                <span className="text-muted-foreground text-[10px]">
                  (LTV {formatBRL(data.unitEconomics.ltvProjetado)})
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                CAC: {formatBRL(data.unitEconomics.cacProjetado)}
              </p>
            </div>
          </div>

          <div className="border-border/60 bg-muted/30 flex flex-col justify-between rounded-xl border p-3.5">
            <span className="text-muted-foreground text-xs font-medium">Match Médio</span>
            <div className="mt-1">
              <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Clock className="size-3.5" />
                <span className="text-lg font-bold tracking-tight">
                  {data.unitEconomics.tempoMedioMatchMinutos} min
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-[10px]">tempo até aceite</p>
            </div>
          </div>

          <div className="border-border/60 bg-muted/30 flex flex-col justify-between rounded-xl border p-3.5">
            <span className="text-muted-foreground text-xs font-medium">Satisfação NPS</span>
            <div className="mt-1">
              <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Award className="size-3.5" />
                <span className="text-lg font-bold tracking-tight">
                  {data.unitEconomics.satisfacaoNps}/100
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-[10px]">zona de excelência</p>
            </div>
          </div>
        </div>

        {/* Simulador Interativo de Expansão Territorial */}
        <div className="border-primary/20 bg-primary/5 rounded-xl border p-4.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div className="flex items-center gap-2">
              <Compass className="text-primary size-4" />
              <h4 className="text-foreground text-sm font-bold">
                Simulador de Expansão Territorial: Vale do Aço & Leste de Minas
              </h4>
            </div>
            <span className="text-muted-foreground text-xs font-medium">
              Projeção calculada com base no piloto de {data.pilotoGV.cidade}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Controles de Parâmetros */}
            <div className="flex flex-col gap-4 md:col-span-2">
              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-muted-foreground">Cidades Ativadas em Simultâneo</span>
                  <span className="text-foreground font-semibold">
                    {selectedCitiesCount} cidades (ex: GV, Ipatinga, Fabriciano)
                  </span>
                </div>
                <Slider
                  min={1}
                  max={6}
                  step={1}
                  value={[selectedCitiesCount]}
                  onValueChange={([val]) => setSelectedCitiesCount(val ?? 1)}
                  className="py-1"
                />
              </div>

              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-muted-foreground">Prestadores Verificados por Cidade</span>
                  <span className="text-foreground font-semibold">
                    {providersPerCity} profissionais
                  </span>
                </div>
                <Slider
                  min={15}
                  max={100}
                  step={5}
                  value={[providersPerCity]}
                  onValueChange={([val]) => setProvidersPerCity(val ?? 15)}
                  className="py-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1.5 flex justify-between text-xs">
                    <span className="text-muted-foreground">Chamados/Mês por Prestador</span>
                    <span className="text-foreground font-semibold">{bookingsPerProvider}</span>
                  </div>
                  <Slider
                    min={6}
                    max={30}
                    step={1}
                    value={[bookingsPerProvider]}
                    onValueChange={([val]) => setBookingsPerProvider(val ?? 6)}
                    className="py-1"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex justify-between text-xs">
                    <span className="text-muted-foreground">Ticket Médio por Chamado</span>
                    <span className="text-foreground font-semibold">
                      {formatBRL(ticketMedioSimulado)}
                    </span>
                  </div>
                  <Slider
                    min={120}
                    max={280}
                    step={10}
                    value={[ticketMedioSimulado]}
                    onValueChange={([val]) => setTicketMedioSimulado(val ?? 120)}
                    className="py-1"
                  />
                </div>
              </div>
            </div>

            {/* Painel de Resultados Projetados */}
            <div className="border-border/60 bg-card/80 flex flex-col justify-between rounded-xl border p-4 shadow-xs">
              <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Projeção de Escala Regional
              </span>

              <div className="my-3 space-y-2.5">
                <div>
                  <span className="text-muted-foreground block text-[11px]">
                    GMV Mensal Estimado
                  </span>
                  <span className="text-foreground text-xl font-extrabold tracking-tight">
                    {formatBRL(projectedMonthlyGmv)}
                  </span>
                </div>

                <div className="border-t pt-2">
                  <span className="text-muted-foreground block text-[11px]">
                    Receita Líquida Mensal (Take-rate {Math.round(FEE_RATE * 100)}%)
                  </span>
                  <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {formatBRL(projectedMonthlyRevenue)}
                  </span>
                </div>

                <div className="border-t pt-2">
                  <span className="text-muted-foreground block text-[11px]">
                    ARR Projetado (Anual)
                  </span>
                  <span className="text-primary text-base font-semibold">
                    {formatBRL(projectedAnnualRunRate)}
                  </span>
                </div>
              </div>

              <div className="bg-muted/50 text-muted-foreground rounded-lg p-2 text-center text-[10px]">
                Base: {totalActiveProvidersSimulated} prestadores gerando{" "}
                {totalMonthlyBookingsSimulated} atendimentos/mês
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
