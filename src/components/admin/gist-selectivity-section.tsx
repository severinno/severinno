/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"

/**
 * GiSTSelectivitySection — Curva de Seletividade GiST vs Haversine
 *
 * Gráfico interativo de seletividade do índice GiST do PostGIS com:
 *   - Sliders de raio, densidade e total de providers
 *   - Curvas PostGIS filtrado + Haversine + PostGIS medido + P95 real
 *   - Tabela de custo no raio selecionado
 *   - Pontos de crossover e análise de regime
 *   - Export / Import / Copy de simulações
 *
 * Extraído do AdminGeoMetricsDashboard para reduzir o tamanho do arquivo
 * principal e permitir reuso independente.
 *
 * Data source: benchmark e history de GET /api/admin/geo-metrics
 */

import * as React from "react"
import {
  Database,
  MapPin,
  LineChart as LineChartIcon,
  FileJson,
  Copy,
  Upload,
  Timer,
  GitCompareArrows,
  BarChart3,
  Microscope,
} from "lucide-react"
import { toast } from "sonner"
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Customized,
} from "recharts"

import { cn } from "@/lib/utils"
import type { GeoMetricsResponse } from "@/app/api/admin/geo-metrics/route"
import {
  POSTGIS_FIXED_US,
  POSTGIS_PER_ROW_US,
  computeProviderCounts,
  computeSelectivityPoints,
  computeCrossovers,
  computeMeasuredFull,
  computeP95Stats,
  computeCostAtSelectivity,
  computeCostInjection,
  computeGiSTDegradation,
  radiusToSelectivity,
  modelPostGISFullMs,
  modelDelta,
} from "@/lib/geo-benchmark-model"
import { GistDegradationPanel } from "@/components/admin/gist-degradation-panel"
import { RadiusDensitySelector } from "@/components/admin/radius-density-selector"
import { MetricCard } from "@/components/admin/admin-metric-card"
import { TOOLTIP_STYLE } from "./admin-chart-theme"

// ── Chart tooltip style (shared) ──────────────────────────────────────────

// ── GiST degradation history buffer — last N polls, majority vote
//     Prevents alert flickering when P95 oscillates near the threshold.
const GIST_DEGRADATION_HISTORY_SIZE = 5
const GIST_DEGRADATION_MAJORITY = 3

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GiSTSelectivitySectionProps {
  benchmark: NonNullable<GeoMetricsResponse["benchmark"]>
  history: NonNullable<GeoMetricsResponse["history"]> | null
  baselines: Record<string, number>
  onReindexSuccess?: () => void
  isRefetching?: boolean
}

// ---------------------------------------------------------------------------
// GiST Selectivity vs Cost Section
// ---------------------------------------------------------------------------

export function GiSTSelectivitySection({
  benchmark,
  history,
  baselines,
  onReindexSuccess,
  isRefetching,
}: GiSTSelectivitySectionProps) {
  // Use benchmark's avgHaversinePerProvider (dynamic, changes per run)
  const haversinePerProviderUs =
    benchmark.analysis.avgHaversinePerProvider > 0
      ? benchmark.analysis.avgHaversinePerProvider
      : 0.1323 // fallback hardcoded

  // ── Degradation history buffer — prevents alert flickering when P95
  //     oscillates near the threshold. Only flags degraded when the
  //     majority of the last N polls agree.
  const degHistoryRef = React.useRef<boolean[]>([])

  // ── Radius + Density state ────────────────────────────────────────
  const [radiusKm, setRadiusKm] = React.useState(15)
  // ── Density determines providers per area — declared before scaledCounts ──
  const [density, setDensity] = React.useState(10) // providers/km²

  // ── Total provider count in database (simulates small vs large DB) ──
  const [totalProviders, setTotalProviders] = React.useState(10000)
  const providerCounts = computeProviderCounts(totalProviders)
  // Scale provider counts by density so a denser city produces more
  // providers within the same area, directly affecting model costs.
  const scaledCounts = providerCounts.map((n) => Math.max(1, Math.round((n * density) / 10)))
  const [useLogScale, setUseLogScale] = React.useState(() => {
    if (typeof window === "undefined") return true
    const stored = localStorage.getItem("geo-scale-gist")
    return stored !== null ? stored === "true" : true
  })

  // Estimated providers within the search area at current density
  const estimatedProviders = Math.round(density * Math.PI * radiusKm * radiusKm)

  // Density label for display
  const densityLabel =
    density <= 3
      ? `Interior (~${density}/km²)`
      : density <= 7
        ? `Sul/Sudeste (~${density}/km²)`
        : density <= 15
          ? `São Paulo (~${density}/km²)`
          : `Metrópole (~${density}/km²)`

  // Compute selectivity from selected radius
  const currentSelectivity = radiusToSelectivity(radiusKm)
  const selPct = Math.round(currentSelectivity * 100)

  // Generate selectivity curve data points via extracted pure function
  const selectivityPoints = computeSelectivityPoints(
    benchmark.comparisons,
    haversinePerProviderUs,
    scaledCounts,
  )

  // Compute crossover points via extracted pure function
  const crossovers = computeCrossovers(haversinePerProviderUs, scaledCounts)

  // Get measured full-scan latencies from benchmark
  const measuredFull = computeMeasuredFull(benchmark.comparisons)

  // ── Cost at selected radius ────────────────────────────────────────
  const costData = computeCostAtSelectivity(
    currentSelectivity,
    haversinePerProviderUs,
    scaledCounts,
  )

  // Regime indicators from cost data
  const pgFasterCount = costData.filter((c) => c.faster === "PostGIS").length
  const havFasterCount = costData.filter((c) => c.faster === "Haversine").length

  // Snap selectivity to nearest 5% for ReferenceLine (X axis uses category labels)
  const snapPct = Math.min(Math.round(currentSelectivity * 20) * 5, 100)
  const refLineLabel = `${snapPct}%`

  // ── Real P95 band from geo-metrics history (PostGIS) ────────────────
  const p95Stats = computeP95Stats(history)
  const hasP95Data = p95Stats.count > 0
  const p95Mean = p95Stats.mean
  const p95Min = p95Stats.min
  const p95Max = p95Stats.max
  const p95Stdev = p95Stats.stdev
  const postgisP95ValuesCount = p95Stats.count

  // ── GiST degradation check: real P95 exceeds ALL model curves ─────
  const currentSelLabel = `${snapPct}%`
  let gistDegraded = false
  let maxModelAtSelectivity = 0
  let exceedingCount = 0

  // Inject cost data into the selectivityPoints row at the reference line
  // so the chart tooltip can show cost-per-provider at the selected radius.
  // Inject cost-at-selectivity data into the reference line row for the
  // GiSTCostTooltip to consume when the cursor is at this selectivity.
  // refLineRow is also used below for intersection dots computation.
  const refLineRow = selectivityPoints.find(
    (r: Record<string, unknown>) => r.selectivity === refLineLabel,
  )
  computeCostInjection(selectivityPoints, costData, refLineLabel)

  // ── Intersection dots: interactive points at the reference line ──
  // Extrai os valores de cada curva (PostGIS/Haversine) no ponto exato
  // da ReferenceLine vertical para renderizar círculos clicáveis.
  const refLineIndex = selectivityPoints.findIndex(
    (r: Record<string, unknown>) => r.selectivity === refLineLabel,
  )
  const intersectionCurves: Array<{
    key: string
    value: number
    label: string
    isPostGIS: boolean
    color: string
    count: number
  }> = []
  if (refLineIndex >= 0 && refLineRow) {
    ;[
      ...scaledCounts.map((n, idx) => ({
        key: `pg_${n}`,
        count: n,
        isPostGIS: true,
        color: `hsl(${200 + idx * 30}, 70%, ${50 + idx * 5}%)`,
        label: `PostGIS ${n >= 1000 ? `${n / 1000}k` : n}`,
      })),
      ...scaledCounts.map((n, idx) => ({
        key: `hav_${n}`,
        count: n,
        isPostGIS: false,
        color: `hsl(${140 + idx * 10}, 50%, ${45 + idx * 5}%)`,
        label: `Haversine ${n >= 1000 ? `${n / 1000}k` : n}`,
      })),
    ].forEach((curve) => {
      const raw = (refLineRow as Record<string, unknown>)[curve.key]
      const value = typeof raw === "number" ? raw : Number(raw) || 0
      if (value > 0) {
        intersectionCurves.push({ ...curve, value })
      }
    })
  }

  // Use extracted pure function for GiST degradation check
  const degradation = computeGiSTDegradation(
    selectivityPoints,
    currentSelLabel,
    p95Mean,
    hasP95Data,
  )

  // ── Smooth degradation via history buffer — prevent flickering ────
  const degHistory = degHistoryRef.current
  degHistory.push(degradation.gistDegraded)
  if (degHistory.length > GIST_DEGRADATION_HISTORY_SIZE) {
    degHistory.shift()
  }
  const degradedCount = degHistory.filter(Boolean).length
  const smoothedDegraded =
    degHistory.length >= GIST_DEGRADATION_HISTORY_SIZE && degradedCount >= GIST_DEGRADATION_MAJORITY

  gistDegraded = smoothedDegraded
  maxModelAtSelectivity = degradation.maxModelAtSelectivity
  exceedingCount = degradation.exceedingCount

  // ── Sentry alert for sustained degradation ─────────────────────────
  // Sends a warning to Sentry when ALL 5 consecutive polls are degraded.
  // Uses a ref to debounce — fires only once per degradation episode.
  const sentryAlertedRef = React.useRef(false)

  // Reset debounce flag when the index recovers
  if (!gistDegraded && sentryAlertedRef.current) {
    sentryAlertedRef.current = false
  }

  // Fire when smoothed degraded AND all 5 history slots are degraded
  React.useEffect(() => {
    if (
      gistDegraded &&
      degradedCount === GIST_DEGRADATION_HISTORY_SIZE &&
      !sentryAlertedRef.current
    ) {
      sentryAlertedRef.current = true

      import("@sentry/nextjs")
        .then((Sentry) => {
          Sentry.captureMessage("🛑 Índice GiST degradado — 5 polls consecutivos", {
            level: "warning" as const,
            tags: { source: "gist-degradation-live" },
            extra: {
              p95MeanMs: Math.round(p95Mean),
              radiusKm,
              selectivityPct: snapPct,
              maxModelAtSelectivityMs: Math.round(maxModelAtSelectivity * 10) / 10,
              exceedingScales: exceedingCount,
              totalScales: scaledCounts.length,
              p95Ratio: Number((p95Mean / maxModelAtSelectivity).toFixed(1)),
              historyBufferSize: GIST_DEGRADATION_HISTORY_SIZE,
              degradedSlots: degradedCount,
            },
          })
        })
        .catch(() => {
          // @sentry/nextjs not available — dev without SDK
        })
    }
  }, [
    gistDegraded,
    degradedCount,
    p95Mean,
    radiusKm,
    snapPct,
    maxModelAtSelectivity,
    exceedingCount,
  ])

  /** Format provider count: 1000 → "1k", 10000 → "10k", etc. */
  const fmtCount = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`
    return String(n)
  }

  // ── Export simulation snapshot ─────────────────────────────────────
  const exportSimulation = React.useCallback(() => {
    const scalesSummary = scaledCounts.map(fmtCount).join(", ")
    const summary = `Raio ${radiusKm}km, densidade ${density}/km², total ${fmtCount(totalProviders)} providers → ${scaledCounts.length} escalas [${scalesSummary}]`

    const snapshot = {
      summary,
      exportedAt: new Date().toISOString(),
      benchmark: {
        platform: benchmark.meta.platform,
        nodeVersion: benchmark.meta.nodeVersion,
        center: benchmark.meta.centerLabel,
      },
      params: {
        radiusKm,
        density,
        totalProviders,
        selectivityPct: selPct,
        refLineLabel,
      },
      scales: {
        totalProviderCount: providerCounts,
        densityAdjusted: scaledCounts,
        count: scaledCounts.length,
      },
      crossovers: crossovers.map((c) => ({
        providers: c.n,
        selectivityPct: Math.round(c.selectivity * 100),
      })),
      costData,
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `gist-simulation-${radiusKm}km-${totalProviders}prov-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [
    radiusKm,
    density,
    totalProviders,
    selPct,
    refLineLabel,
    providerCounts,
    scaledCounts,
    crossovers,
    costData,
    benchmark,
  ])

  // ── Copy simulation JSON to clipboard ───────────────────────────────
  const copySimulation = React.useCallback(() => {
    const scalesSummary = scaledCounts.map(fmtCount).join(", ")
    const summary = `Raio ${radiusKm}km, densidade ${density}/km², total ${fmtCount(totalProviders)} providers → ${scaledCounts.length} escalas [${scalesSummary}]`

    const snapshot = {
      summary,
      exportedAt: new Date().toISOString(),
      benchmark: {
        platform: benchmark.meta.platform,
        nodeVersion: benchmark.meta.nodeVersion,
        center: benchmark.meta.centerLabel,
      },
      params: {
        radiusKm,
        density,
        totalProviders,
        selectivityPct: selPct,
        refLineLabel,
      },
      scales: {
        totalProviderCount: providerCounts,
        densityAdjusted: scaledCounts,
        count: scaledCounts.length,
      },
      crossovers: crossovers.map((c) => ({
        providers: c.n,
        selectivityPct: Math.round(c.selectivity * 100),
      })),
      costData,
    }
    const json = JSON.stringify(snapshot, null, 2)
    navigator.clipboard
      .writeText(json)
      .then(() => {
        toast.success("Simulação copiada para a área de transferência")
      })
      .catch(() => {
        toast.error("Não foi possível copiar — verifique as permissões da área de transferência")
      })
  }, [
    radiusKm,
    density,
    totalProviders,
    selPct,
    refLineLabel,
    providerCounts,
    scaledCounts,
    crossovers,
    costData,
    benchmark,
  ])

  // ── Import simulation from JSON file ────────────────────────────────
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const importSimulation = React.useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onerror = () => {
        toast.error("Erro ao ler o arquivo — tente novamente")
      }
      reader.onload = (evt) => {
        try {
          const data = JSON.parse(evt.target?.result as string) as {
            params?: { radiusKm?: number; density?: number; totalProviders?: number }
          }
          const p = data.params
          if (!p) {
            toast.error("JSON inválido — campo 'params' não encontrado")
            return
          }
          if (p.radiusKm != null) setRadiusKm(p.radiusKm)
          if (p.density != null) setDensity(p.density)
          if (p.totalProviders != null) setTotalProviders(p.totalProviders)
          toast.success("Simulação importada: parâmetros restaurados")
        } catch {
          toast.error("Erro ao ler o arquivo JSON")
        }
      }
      reader.readAsText(file)

      // Reset the input so the same file can be re-imported
      e.target.value = ""
    },
    [setRadiusKm, setDensity, setTotalProviders],
  )

  return (
    <section aria-label="Seletividade GiST vs Custo" className="space-y-6">
      <div className="flex items-center gap-2">
        <Database className="size-5 text-sky-500" />
        <h2 className="text-foreground text-lg font-semibold">
          Curva de Seletividade — GiST Index vs Haversine
        </h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileChange}
          aria-hidden="true"
        />
        {/* Import simulation */}
        <button
          type="button"
          onClick={importSimulation}
          className="bg-muted/50 text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-medium transition-colors"
          aria-label="Importar simulação de arquivo JSON"
        >
          <Upload className="size-3" />
          Importar
        </button>
        {/* Export simulation */}
        <button
          type="button"
          onClick={exportSimulation}
          className="bg-muted/50 text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-medium transition-colors"
          aria-label="Exportar simulação como JSON"
        >
          <FileJson className="size-3" />
          Exportar
        </button>
        <button
          type="button"
          onClick={copySimulation}
          className="bg-muted/50 text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-medium transition-colors"
          aria-label="Copiar simulação como JSON"
        >
          <Copy className="size-3" />
          Copiar
        </button>
      </div>

      {/* ── GiST Degradation Alert ──────────────────────────────────── */}
      <GistDegradationPanel
        gistDegraded={gistDegraded}
        p95Mean={p95Mean}
        radiusKm={radiusKm}
        snapPct={snapPct}
        maxModelAtSelectivity={maxModelAtSelectivity}
        exceedingCount={exceedingCount}
        onReindexSuccess={onReindexSuccess}
        isRefetching={isRefetching}
      />

      {/* ── Radius + Density + Selectivity Selector (extracted) ──── */}
      <MetricCard icon={MapPin} title="Selecionar Raio de Busca">
        <RadiusDensitySelector
          radiusKm={radiusKm}
          onRadiusKmChange={setRadiusKm}
          density={density}
          onDensityChange={setDensity}
          estimatedProviders={estimatedProviders}
          densityLabel={densityLabel}
          currentSelectivity={currentSelectivity}
          selPct={selPct}
        />

        {/* ── Total Providers slider — simula DB pequeno vs grande ── */}
        <div className="border-t pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted-foreground text-[10px] font-medium">Tamanho do banco</span>
            <span className="text-foreground text-xs font-semibold tabular-nums">
              {totalProviders.toLocaleString("pt-BR")} providers
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground w-8 text-right text-[10px] font-medium">
              100
            </span>
            <input
              type="range"
              min={100}
              max={100000}
              step={100}
              value={totalProviders}
              onChange={(e) => setTotalProviders(Number(e.target.value))}
              className="accent-primary h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-violet-300 via-sky-300 to-emerald-300"
              aria-label="Total de providers no banco"
            />
            <span className="text-muted-foreground w-10 text-left text-[10px] font-medium">
              100k
            </span>
          </div>
          <div className="mt-1.5 flex gap-2">
            {[
              { v: 200, label: "Pequeno" },
              { v: 1000, label: "Médio" },
              { v: 10000, label: "Grande" },
              { v: 100000, label: "Mega" },
            ].map((p) => (
              <button
                key={p.v}
                type="button"
                onClick={() => setTotalProviders(p.v)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all",
                  totalProviders === p.v
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground mt-2 text-[10px]">
            As curvas se ajustam automaticamente para <strong>{scaledCounts.length} escalas</strong>{" "}
            ({" "}
            {scaledCounts
              .map((n) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n)))
              .join(" → ")}{" "}
            )
          </p>
        </div>
      </MetricCard>

      {/* Main chart: selectivity vs latency */}
      <MetricCard icon={LineChartIcon} title="Custo por Seletividade (ms)">
        {/* Scale toggle */}
        <div className="flex items-center justify-end gap-2 px-1 pb-3">
          <span className="text-muted-foreground text-[10px]">
            Escala: {useLogScale ? "Log" : "Linear"}
          </span>
          <button
            type="button"
            onClick={() => {
              const next = !useLogScale
              localStorage.setItem("geo-scale-gist", String(next))
              if (!next) {
                toast.info(
                  "Escala linear — pontos próximos de zero podem ficar comprimidos devido à diferença de magnitude entre Haversine (µs) e PostGIS (ms).",
                  { duration: 5000 },
                )
              }
              setUseLogScale(next)
            }}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
              useLogScale ? "bg-primary border-primary" : "bg-muted border-border",
            )}
            role="switch"
            aria-checked={useLogScale}
            aria-label="Alternar escala Log/Linear"
          >
            <span
              className={cn(
                "inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                useLogScale ? "translate-x-[18px]" : "translate-x-[2px]",
              )}
            />
          </button>
        </div>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={selectivityPoints} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
              <XAxis
                dataKey="selectivity"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{
                  value: "Seletividade (% providers within radius)",
                  position: "bottom",
                  style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={50}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{
                  value: "Latência (ms)",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                }}
                scale={useLogScale ? "log" : "linear"}
                domain={useLogScale ? ["auto", "auto"] : [0, "auto"]}
              />
              <RTooltip
                content={
                  <GiSTCostTooltip
                    refLineLabel={refLineLabel}
                    radiusKm={radiusKm}
                    selPct={selPct}
                    hasP95Data={hasP95Data}
                    p95Mean={p95Mean}
                  />
                }
              />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} iconSize={8} />

              {/* PostGIS filtered lines (one per provider count) */}
              {scaledCounts.map((n, idx) => (
                <Line
                  key={`pg_${n}`}
                  type="monotone"
                  dataKey={`pg_${n}`}
                  name={`PostGIS filtrado (${n >= 1000 ? `${n / 1000}k` : n})`}
                  stroke={`hsl(${200 + idx * 30}, 70%, ${50 + idx * 5}%)`}
                  strokeWidth={2}
                  strokeDasharray={idx > 1 ? "4 2" : "none"}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}

              {/* Haversine lines (reference) */}
              {scaledCounts.map((n, idx) => (
                <Line
                  key={`hav_${n}`}
                  type="monotone"
                  dataKey={`hav_${n}`}
                  name={`Haversine (${n >= 1000 ? `${n / 1000}k` : n})`}
                  stroke={`hsl(${140 + idx * 10}, 50%, ${45 + idx * 5}%)`}
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              ))}

              {/* Measured PostGIS full-scan benchmark points */}
              {measuredFull.map((m) => (
                <Line
                  key={`bench_pg_${m.n}`}
                  type="monotone"
                  dataKey={`bench_pg_${m.n}`}
                  name={`PostGIS medido (${m.n >= 1000 ? `${m.n / 1000}k` : m.n})`}
                  stroke="hsl(0, 0%, 50%)"
                  strokeWidth={1}
                  dot={{ r: 5, fill: "hsl(0, 0%, 50%)" }}
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                />
              ))}

              {/* Real P95 band from geo-metrics history */}
              {hasP95Data && (
                <>
                  <ReferenceArea
                    y1={p95Min}
                    y2={p95Max}
                    fill="hsl(38, 92%, 50%)"
                    fillOpacity={0.12}
                    stroke="none"
                    label={{
                      value: `P95 real: ${p95Mean.toFixed(0)}ms · ${postgisP95ValuesCount} amostras`,
                      position: "right",
                      fill: "hsl(38, 92%, 50%)",
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  />
                  <ReferenceLine
                    y={p95Mean}
                    stroke="hsl(38, 92%, 50%)"
                    strokeWidth={2.5}
                    strokeDasharray="none"
                  />
                  {p95Stdev > 1 && (
                    <>
                      <ReferenceLine
                        y={p95Mean + p95Stdev}
                        stroke="hsl(38, 92%, 50%)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        strokeOpacity={0.5}
                      />
                      <ReferenceLine
                        y={Math.max(p95Mean - p95Stdev, 0.1)}
                        stroke="hsl(38, 92%, 50%)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        strokeOpacity={0.5}
                      />
                    </>
                  )}
                </>
              )}

              {/* 2× baseline reference line for PostGIS */}
              {baselines["postgis"] != null && (
                <ReferenceLine
                  y={Math.round(baselines["postgis"]! * 2)}
                  stroke="hsl(0, 72%, 51%)"
                  strokeDasharray="6 3"
                  strokeWidth={2}
                  label={{
                    value: `2× baseline PostGIS (${Math.round(baselines["postgis"]! * 2)}ms)`,
                    position: "right",
                    fill: "hsl(0, 72%, 51%)",
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                />
              )}

              {/* Reference line at selected radius selectivity */}
              {currentSelectivity > 0 && (
                <ReferenceLine
                  x={refLineLabel}
                  stroke="hsl(201, 90%, 48%)"
                  strokeWidth={2.5}
                  strokeDasharray="none"
                  label={{
                    value: `${radiusKm}km · ${selPct}%`,
                    position: "top",
                    fill: "hsl(201, 90%, 48%)",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                />
              )}

              {/* Interactive intersection dots */}
              {refLineIndex >= 0 && intersectionCurves.length > 0 && (
                <Customized
                  component={({ formattedGraphicalItems }: any) => {
                    if (!formattedGraphicalItems) return null
                    const dots = intersectionCurves
                      .map((curve) => {
                        const item = formattedGraphicalItems.find(
                          (fi: any) => fi.item?.props?.dataKey === curve.key,
                        )
                        if (!item?.points?.[refLineIndex]) return null
                        return {
                          ...curve,
                          cx: item.points[refLineIndex].x,
                          cy: item.points[refLineIndex].y,
                        }
                      })
                      .filter(Boolean)

                    if (dots.length === 0) return null

                    return (
                      <g className="intersection-dots">
                        {dots.map(
                          (d: any) =>
                            d && (
                              <g key={d.key}>
                                <circle
                                  cx={d.cx}
                                  cy={d.cy}
                                  r={7}
                                  fill="hsl(var(--background))"
                                  stroke={d.color}
                                  strokeWidth={2.5}
                                  style={{
                                    cursor: "pointer",
                                    transition: "r 150ms ease, stroke-width 150ms ease",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.r = "9px"
                                    e.currentTarget.style.strokeWidth = "3px"
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.r = "7px"
                                    e.currentTarget.style.strokeWidth = "2.5px"
                                  }}
                                />
                                <circle
                                  cx={d.cx}
                                  cy={d.cy}
                                  r={3}
                                  fill={d.color}
                                  className="pointer-events-none"
                                />
                              </g>
                            ),
                        )}
                      </g>
                    )
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </MetricCard>

      {/* ── Cost at Selected Radius ──────────────────────────────────── */}
      {costData.length > 0 && (
        <MetricCard
          icon={Timer}
          title={`Custo Estimado em ${radiusKm}km (seletividade ${selPct}%)`}
        >
          <div className="space-y-3">
            <div className="text-muted-foreground grid grid-cols-5 gap-2 text-[10px] font-medium">
              <div>Providers</div>
              <div className="text-right">PostGIS (ms)</div>
              <div className="text-right">Haversine (ms)</div>
              <div className="text-right">Razão</div>
              <div className="text-right">Regime</div>
            </div>
            {costData.map((c) => (
              <div
                key={c.n}
                className={cn(
                  "grid grid-cols-5 gap-2 rounded-md border px-3 py-2 text-xs",
                  c.faster === "PostGIS"
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-950/10"
                    : c.faster === "Haversine"
                      ? "border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-950/10"
                      : "border-border/50",
                )}
              >
                <span className="font-medium tabular-nums">
                  {c.n >= 1000 ? `${(c.n / 1000).toFixed(0)}k` : c.n}
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums">
                  {c.postgisMs.toFixed(c.postgisMs < 1 ? 2 : 1)}
                </span>
                <span className="text-right font-mono text-[11px] tabular-nums">
                  {c.haversineMs.toFixed(c.haversineMs < 1 ? 2 : 1)}
                </span>
                <span className="text-right font-medium tabular-nums">{c.ratio}:1</span>
                <span
                  className={cn(
                    "text-right text-[10px] font-medium",
                    c.faster === "PostGIS"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : c.faster === "Haversine"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                  )}
                >
                  {c.faster === "PostGIS"
                    ? "✓ GiST"
                    : c.faster === "Haversine"
                      ? "✓ Haversine"
                      : "—"}
                </span>
              </div>
            ))}
            <div className="text-muted-foreground flex items-center gap-3 border-t pt-2 text-[10px]">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  pgFasterCount >= havFasterCount
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground",
                )}
              >
                GiST vence em {pgFasterCount} de {costData.length} escalas
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  havFasterCount >= pgFasterCount
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                    : "bg-muted text-muted-foreground",
                )}
              >
                Haversine vence em {havFasterCount} de {costData.length} escalas
              </span>
            </div>
          </div>
        </MetricCard>
      )}

      {/* Crossovers + Analysis cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Crossover table */}
        <MetricCard icon={GitCompareArrows} title="Pontos de Crossover">
          <div className="space-y-3">
            {crossovers.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Nenhum crossover — Haversine é sempre mais rápido
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="pr-3 pb-2 font-medium">Providers</th>
                    <th className="pr-3 pb-2 font-medium">Raio equivalente*</th>
                    <th className="pr-3 pb-2 text-right font-medium">Seletividade</th>
                  </tr>
                </thead>
                <tbody>
                  {crossovers.map((c) => (
                    <tr key={c.n} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium tabular-nums">
                        {c.n.toLocaleString("pt-BR")}
                      </td>
                      <td className="text-muted-foreground py-2 pr-3">
                        {c.selectivity < 0.1
                          ? "< 5 km"
                          : c.selectivity < 0.3
                            ? "5–15 km"
                            : c.selectivity < 0.6
                              ? "15–30 km"
                              : "> 30 km"}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {(c.selectivity * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              * Raio estimado para densidade de <strong>{density} providers/km²</strong> · Área de
              cobertura: ~{Math.round(Math.PI * radiusKm * radiusKm).toLocaleString("pt-BR")} km²
            </p>
          </div>
        </MetricCard>

        {/* Measured vs Model */}
        <MetricCard icon={BarChart3} title="Modelo vs Medição (Full Scan)">
          <div className="space-y-3">
            {measuredFull.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Sem dados de medição disponíveis
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="pr-3 pb-2 font-medium">N</th>
                    <th className="pr-3 pb-2 text-right font-medium">Modelo (ms)</th>
                    <th className="pr-3 pb-2 text-right font-medium">Medido (ms)</th>
                    <th className="pb-2 text-right font-medium">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {measuredFull.map((m) => {
                    const model = modelPostGISFullMs(m.n)
                    const delta = modelDelta(m.ms, m.n)
                    return (
                      <tr key={m.n} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium tabular-nums">
                          {m.n.toLocaleString("pt-BR")}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{model.toFixed(1)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{m.ms.toFixed(1)}</td>
                        <td
                          className={cn(
                            "py-2 text-right font-medium tabular-nums",
                            delta > 1
                              ? "text-amber-500"
                              : delta < -1
                                ? "text-emerald-500"
                                : "text-muted-foreground",
                          )}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta.toFixed(1)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </MetricCard>

        {/* Analysis */}
        <MetricCard icon={Microscope} title="Interpretação">
          <div className="text-muted-foreground space-y-3 text-xs">
            <p>
              <span className="text-foreground font-medium">Regime GiST (verde):</span> Seletividade
              baixa (&lt;20%) — o índice filtra a maioria dos providers antes de computar distância.
              Ideal para buscas de vizinhança (5–15 km).
            </p>
            <p>
              <span className="text-foreground font-medium">
                Regime Haversine (linhas tracejadas):
              </span>
              Seletividade alta (&gt;60%) — o filtro GiST é pouco seletivo e o overhead fixo (~2ms)
              domina. Haversine puro é mais rápido.
            </p>
            <p>
              <span className="text-foreground font-medium">Crossover:</span> O ponto onde as linhas
              se cruzam indica a seletividade máxima para qual o GiST é vantajoso. Para 1k providers
              em SP, o GiST vence até ~15–30 km de raio.
            </p>
            <p className="border-t pt-2 text-[10px]">
              Modelo: T(N, s) = {POSTGIS_FIXED_US / 1000}ms +{" "}
              {(POSTGIS_PER_ROW_US / 1000).toFixed(3)}ms × N × s
            </p>
          </div>
        </MetricCard>
      </div>
    </section>
  )
}

// ── GiST Cost Tooltip ─────────────────────────────────────────────────────

/**
 * Custom Recharts Tooltip content for the GiST selectivity chart.
 */
function GiSTCostTooltip({
  active,
  payload,
  label,
  refLineLabel,
  radiusKm,
  selPct,
  hasP95Data,
  p95Mean,
}: {
  active?: boolean
  payload?: Array<{ name?: string; dataKey?: string; value?: number; color?: string }>
  label?: string
  refLineLabel: string
  radiusKm: number
  selPct: number
  hasP95Data: boolean
  p95Mean: number
}) {
  // ── Dark mode detection via prefers-color-scheme ────────────────────
  const [isDark, setIsDark] = React.useState(false)

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    setIsDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const tooltipStyle: React.CSSProperties = {
    ...TOOLTIP_STYLE,
    ...(isDark
      ? {
          background: "hsl(222.2, 84%, 4.9%)",
          borderColor: "hsl(217.2, 32.6%, 17.5%)",
          color: "hsl(210, 40%, 98%)",
          boxShadow: "0 4px 24px -4px rgba(0, 0, 0, 0.55), 0 2px 8px -2px rgba(0, 0, 0, 0.3)",
        }
      : {}),
  }

  if (!active || !payload || payload.length === 0) return null

  const isAtRefLine = label === refLineLabel

  const curves: Array<{
    key: string
    label: string
    value: number
    color?: string
    delta: number | null
    deltaIcon: string | null
    deltaColor: string | null
  }> = []
  const costs: Array<{
    label: string
    postgisMs: number
    haversineMs: number
    ratio: number
    faster: string
  }> = []

  for (const entry of payload) {
    const key = String(entry.dataKey ?? entry.name ?? "")
    const value = Number(entry.value ?? 0)

    if (key.startsWith("cost_pg_")) {
      const n = key.replace("cost_pg_", "")
      const havEntry = payload.find((p) => p.dataKey === `cost_hav_${n}`)
      const ratioEntry = payload.find((p) => p.dataKey === `cost_ratio_${n}`)
      const fasterEntry = payload.find((p) => p.dataKey === `cost_faster_${n}`)
      costs.push({
        label: n,
        postgisMs: value,
        haversineMs: Number(havEntry?.value ?? 0),
        ratio: Number(ratioEntry?.value ?? 0),
        faster: String(fasterEntry?.value ?? "Haversine"),
      })
      continue
    }
    if (
      key.startsWith("cost_hav_") ||
      key.startsWith("cost_ratio_") ||
      key.startsWith("cost_faster_") ||
      key.startsWith("cost_label_")
    ) {
      continue
    }

    const labelMap: Record<string, string> = {
      pg_100: "PostGIS 100",
      pg_500: "PostGIS 500",
      pg_1000: "PostGIS 1k",
      pg_5000: "PostGIS 5k",
      pg_10000: "PostGIS 10k",
      hav_100: "Haversine 100",
      hav_500: "Haversine 500",
      hav_1000: "Haversine 1k",
      hav_5000: "Haversine 5k",
      hav_10000: "Haversine 10k",
      bench_pg_100: "Medido 100",
      bench_pg_1000: "Medido 1k",
      bench_pg_10000: "Medido 10k",
    }
    const displayLabel = labelMap[key] ?? key

    let delta: number | null = null
    let deltaIcon: string | null = null
    let deltaColor: string | null = null
    if (key.startsWith("pg_") && hasP95Data && value > 0) {
      delta = p95Mean - value
      if (delta >= 5) {
        deltaIcon = "🔴"
        deltaColor = "text-red-500"
      } else if (delta <= -2) {
        deltaIcon = "🟢"
        deltaColor = "text-emerald-500"
      } else {
        deltaIcon = "⚪"
        deltaColor = "text-muted-foreground"
      }
    }

    curves.push({
      key,
      label: displayLabel,
      value,
      color: entry.color,
      delta,
      deltaIcon,
      deltaColor,
    })
  }

  return (
    <div style={tooltipStyle as React.CSSProperties}>
      {/* Context Summary */}
      {(() => {
        const pgValues = curves
          .filter((c) => c.key.startsWith("pg_") && c.value > 0)
          .map((c) => c.value)
        const avgModel =
          pgValues.length > 0 ? pgValues.reduce((a, b) => a + b, 0) / pgValues.length : null
        const hasRealP95 = hasP95Data && p95Mean > 0

        if (!avgModel && !hasRealP95) return null

        let summaryDelta: number | null = null
        let summaryIcon: string | null = null
        let summaryColor: string | null = null
        if (avgModel != null && hasRealP95) {
          summaryDelta = p95Mean - avgModel
          if (summaryDelta >= 5) {
            summaryIcon = "🔴"
            summaryColor = "text-red-500"
          } else if (summaryDelta <= -2) {
            summaryIcon = "🟢"
            summaryColor = "text-emerald-500"
          } else {
            summaryIcon = "⚪"
            summaryColor = "text-muted-foreground"
          }
        }

        return (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-blue-50/50 px-2.5 py-1.5 text-[10px] dark:bg-blue-950/10">
            <span className="text-foreground font-semibold">{label}</span>
            {avgModel != null && (
              <span className="text-muted-foreground">
                Modelo: <span className="tabular-nums">{avgModel.toFixed(1)}ms</span>
              </span>
            )}
            {hasRealP95 && (
              <span className="text-muted-foreground">
                P95 real: <span className="font-medium tabular-nums">{p95Mean.toFixed(1)}ms</span>
              </span>
            )}
            {summaryDelta != null && summaryIcon != null && (
              <span className={cn("font-medium tabular-nums", summaryColor)}>
                {summaryIcon} Δ {summaryDelta >= 0 ? "+" : ""}
                {summaryDelta.toFixed(1)}ms
              </span>
            )}
          </div>
        )
      })()}

      <p className="text-foreground mb-1.5 text-[11px] font-semibold">Curvas por Escala</p>

      <div className="space-y-0.5">
        {curves.map((c) => (
          <div key={c.key} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <span
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ backgroundColor: c.color ?? "var(--muted-foreground)" }}
              />
              {c.label}
            </span>
            <span className="text-foreground flex items-center gap-1.5 tabular-nums">
              {c.value.toFixed(c.value < 1 ? 2 : 1)}ms
              {c.delta != null && c.deltaIcon != null && (
                <span
                  className={cn("text-[10px]", c.deltaColor)}
                  title={`P95 Δ: ${c.delta >= 0 ? "+" : ""}${c.delta.toFixed(1)}ms`}
                >
                  {c.deltaIcon} {c.delta >= 0 ? "+" : ""}
                  {c.delta.toFixed(1)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {isAtRefLine && costs.length > 0 && (
        <>
          <div className="bg-border my-2 h-px" />
          <p className="text-foreground mb-1 text-[11px] font-semibold">
            📍 Custo neste raio ({radiusKm}km · {selPct}%)
          </p>
          <div className="text-[10px]">
            <div className="text-muted-foreground mb-0.5 flex items-center justify-between font-medium">
              <span>Prov</span>
              <span className="text-right">GiST · Hav · Razão</span>
            </div>
            {costs.map((c) => {
              const label = c.label
              return (
                <div
                  key={c.label}
                  className="flex items-center justify-between gap-2 rounded-sm py-0.5"
                >
                  <span className="tabular-nums">{label}</span>
                  <span className="tabular-nums">
                    <span
                      className={
                        c.faster === "PostGIS" ? "text-emerald-500" : "text-muted-foreground"
                      }
                    >
                      {c.postgisMs.toFixed(c.postgisMs < 1 ? 2 : 1)}
                    </span>
                    <span className="text-muted-foreground"> · </span>
                    <span
                      className={
                        c.faster === "Haversine" ? "text-amber-500" : "text-muted-foreground"
                      }
                    >
                      {c.haversineMs.toFixed(c.haversineMs < 1 ? 2 : 1)}
                    </span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-muted-foreground">{c.ratio}:1</span>
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
