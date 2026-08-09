"use client"

/**
 * AdminProjectStatus — Project Health Dashboard
 *
 * Dashboard visual com status geral do projeto baseado na análise
 * de 7 camadas: Infraestrutura, Backend, Frontend, Database,
 * Testes, Segurança, Documentação.
 *
 * Data source: Análise estática (notas calculadas manualmente)
 * Integrado ao admin panel como "Status do Projeto"
 */

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Code2,
  Database,
  LayoutDashboard,
  Lock,
  Server,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

// ── Layer configuration — baseada na análise das 7 camadas ─────────────────

interface LayerInfo {
  id: string
  label: string
  icon: LucideIcon
  grade: number
  maxGrade: number
  status: "completed" | "partial" | "critical"
  color: string
  lightBg: string
  darkBg: string
  lightBorder: string
  darkBorder: string
  description: string
  findings: { status: "ok" | "warn" | "error"; text: string }[]
  todo: string[]
}

const LAYERS: LayerInfo[] = [
  {
    id: "infra",
    label: "🖥️ Infraestrutura",
    icon: Server,
    grade: 10,
    maxGrade: 10,
    status: "completed",
    color: "emerald",
    lightBg: "bg-emerald-50",
    darkBg: "dark:bg-emerald-950/20",
    lightBorder: "border-emerald-200",
    darkBorder: "dark:border-emerald-800/30",
    description: "Docker Compose, Caddy + SSL, PgBouncer, RabbitMQ, workers, healthchecks, Docker secrets, fail2ban",
    findings: [
      { status: "ok", text: "Docker Compose produção com 16 serviços" },
      { status: "ok", text: "Caddy + SSL automático (Let's Encrypt/ZeroSSL)" },
      { status: "ok", text: "PgBouncer com pool tuning (pool_mode=transaction)" },
      { status: "ok", text: "RabbitMQ + 3 workers (email, notificação, search)" },
      { status: "ok", text: "Docker secrets + hardening (no-new-privileges)" },
      { status: "ok", text: "Logs persistidos + fail2ban configurado" },
    ],
    todo: [],
  },
  {
    id: "backend",
    label: "🔧 Backend (API + Services)",
    icon: Code2,
    grade: 10,
    maxGrade: 10,
    status: "completed",
    color: "emerald",
    lightBg: "bg-emerald-50",
    darkBg: "dark:bg-emerald-950/20",
    lightBorder: "border-emerald-200",
    darkBorder: "dark:border-emerald-800/30",
    description: "Next.js App Router, Prisma ORM, Zod validation, auth HMAC, webhooks, push notifications, cache 3 camadas, metrics Prometheus, gateway dashboard",
    findings: [
      { status: "ok", text: "50+ rotas de API REST com Zod validation" },
      { status: "ok", text: "Auth HMAC-SHA256 + session rotation" },
      { status: "ok", text: "Push notifications com signal-only pattern" },
      { status: "ok", text: "Cache 3 camadas (Redis + Memória + HTTP)" },
      { status: "ok", text: "Webhooks com HMAC + retry exponential backoff" },
      { status: "ok", text: "0 type errors de produção (todos corrigidos)" },
    ],
    todo: [],
  },
  {
    id: "frontend",
    label: "🎨 Frontend",
    icon: LayoutDashboard,
    grade: 10,
    maxGrade: 10,
    status: "completed",
    color: "emerald",
    lightBg: "bg-emerald-50",
    darkBg: "dark:bg-emerald-950/20",
    lightBorder: "border-emerald-200",
    darkBorder: "dark:border-emerald-800/30",
    description: "React 19 + shadcn/ui, dashboard admin completo, PWA com service worker, mapa MapLibre, notificações push",
    findings: [
      { status: "ok", text: "Dashboard admin com 20+ seções" },
      { status: "ok", text: "Service worker (sw.ts) com push + cache" },
      { status: "ok", text: "Mapa MapLibre com clustering GeoJSON" },
      { status: "ok", text: "PWA com manifest + ícones" },
      { status: "ok", text: "Notificações em tempo real (WebSocket + push)" },
      { status: "ok", text: "Topbar com notificações agrupadas por data" },
    ],
    todo: [],
  },
  {
    id: "database",
    label: "🗄️ Database",
    icon: Database,
    grade: 10,
    maxGrade: 10,
    status: "completed",
    color: "emerald",
    lightBg: "bg-emerald-50",
    darkBg: "dark:bg-emerald-950/20",
    lightBorder: "border-emerald-200",
    darkBorder: "dark:border-emerald-800/30",
    description: "PostgreSQL + PostGIS, Prisma ORM, 30+ modelos, índices, migrations, PgBouncer pool, Replicação",
    findings: [
      { status: "ok", text: "30+ modelos com relações e índices" },
      { status: "ok", text: "PostGIS para geolocalização espacial" },
      { status: "ok", text: "Migrations com rollback documentado" },
      { status: "ok", text: "Índices compostos para queries geo + status" },
      { status: "ok", text: "PgBouncer em transaction mode" },
      { status: "ok", text: "Enum types + validação em nível de banco" },
    ],
    todo: [],
  },
  {
    id: "tests",
    label: "🧪 Testes e Qualidade",
    icon: Target,
    grade: 8.5,
    maxGrade: 10,
    status: "partial",
    color: "amber",
    lightBg: "bg-amber-50",
    darkBg: "dark:bg-amber-950/20",
    lightBorder: "border-amber-200",
    darkBorder: "dark:border-amber-800/30",
    description: "Vitest, testes unitários, testes de API, Playwright E2E, code review automatizado, testes de gateway",
    findings: [
      { status: "ok", text: "1.703 testes totais — 95.6% passando" },
      { status: "ok", text: "4 arquivos com falha corrigidos (~50 testes recuperados)" },
      { status: "ok", text: "32 testes E2E push (subscribe, SW, API, cron, admin send)" },
      { status: "ok", text: "19 novos testes: gateway dashboard + rota stats" },
      { status: "ok", text: "Testes de performance, push-store, health API" },
      { status: "warn", text: "~74 falhas restantes em 15 arquivos" },
    ],
    todo: [
      "Corrigir ~74 falhas em 15 arquivos",
      "Adicionar teste para default period na rota gateway stats",
    ],
  },
  {
    id: "security",
    label: "🔒 Segurança",
    icon: Lock,
    grade: 10,
    maxGrade: 10,
    status: "completed",
    color: "emerald",
    lightBg: "bg-emerald-50",
    darkBg: "dark:bg-emerald-950/20",
    lightBorder: "border-emerald-200",
    darkBorder: "dark:border-emerald-800/30",
    description: "HSTS, CSP restritivo, Scrypt password hashing, HMAC sessions, Docker secrets, rate limiting financeiro",
    findings: [
      { status: "ok", text: "HSTS + CSP + Security headers (defense-in-depth)" },
      { status: "ok", text: "Scrypt (N=16384) + timingSafeEqual" },
      { status: "ok", text: "Rate limits financeiros (wallet 3/10min, payments 10/min)" },
      { status: "ok", text: "Docker secrets + hardening (cap_drop ALL)" },
      { status: "ok", text: "Webhook Lytex com HMAC-SHA256" },
      { status: "ok", text: "CORS whitelist + CSRF (SameSite=Lax)" },
    ],
    todo: [],
  },
  {
    id: "docs",
    label: "📚 Documentação",
    icon: BookOpen,
    grade: 10,
    maxGrade: 10,
    status: "completed",
    color: "emerald",
    lightBg: "bg-emerald-50",
    darkBg: "dark:bg-emerald-950/20",
    lightBorder: "border-emerald-200",
    darkBorder: "dark:border-emerald-800/30",
    description: "README, CHANGELOG, API.md, PUSH_NOTIFICATIONS.md, SECURITY.md, DEPLOYMENT.md, docs de cache e testes",
    findings: [
      { status: "ok", text: "9 documentos de documentação ativos" },
      { status: "ok", text: "API.md com 50+ endpoints documentados" },
      { status: "ok", text: "SECURITY.md com 12 áreas de segurança" },
      { status: "ok", text: "DEPLOYMENT.md guia passo-a-passo" },
      { status: "ok", text: "PUSH_NOTIFICATIONS.md arquitetura completa" },
      { status: "ok", text: "CHANGELOG.md com histórico de releases" },
    ],
    todo: [],
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function calcOverallGrade(layers: LayerInfo[]): number {
  const total = layers.reduce((sum, l) => sum + l.grade, 0)
  return Math.round((total / layers.length) * 10) / 10
}

function calcOverallMax(layers: LayerInfo[]): number {
  return layers.reduce((sum, l) => sum + l.maxGrade, 0) / layers.length
}

function getGradeColor(grade: number): string {
  if (grade >= 9) return "text-emerald-500"
  if (grade >= 7) return "text-amber-500"
  return "text-red-500"
}

function getGradeBg(grade: number): string {
  if (grade >= 9) return "bg-emerald-50 dark:bg-emerald-950/20"
  if (grade >= 7) return "bg-amber-50 dark:bg-amber-950/20"
  return "bg-red-50 dark:bg-red-950/20"
}

function getGradeBorder(grade: number): string {
  if (grade >= 9) return "border-emerald-200 dark:border-emerald-800/30"
  if (grade >= 7) return "border-amber-200 dark:border-amber-800/30"
  return "border-red-200 dark:border-red-800/30"
}

function getCompletionPercentage(layers: LayerInfo[]): number {
  const completed = layers.filter((l) => l.status === "completed").length
  return Math.round((completed / layers.length) * 100)
}

function getActionsRemaining(layers: LayerInfo[]): number {
  return layers.reduce((sum, l) => sum + l.todo.length, 0)
}

// ── Main Component ─────────────────────────────────────────────────────────

export function AdminProjectStatus() {
  const overallGrade = calcOverallGrade(LAYERS)
  const completionPct = getCompletionPercentage(LAYERS)
  const actionsRemaining = getActionsRemaining(LAYERS)
  const layersCompleted = LAYERS.filter((l) => l.status === "completed").length
  const layersPartial = LAYERS.filter((l) => l.status === "partial").length

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Status do Projeto
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Análise completa de 7 camadas — notas, descobertas e ações pendentes para produção
          </p>
        </div>
      </div>

      {/* ── Overall Score Hero ───────────────────────────────────────── */}
      <section aria-label="Nota geral do projeto">
        <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/60 via-background to-background p-6 dark:border-emerald-900/30 dark:from-emerald-950/10">
          {/* Background decoration */}
          <div className="pointer-events-none absolute -top-20 -right-20 size-48 rounded-full bg-emerald-500/5 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 size-48 rounded-full bg-primary/5 blur-3xl" />

          <div className="relative flex flex-col items-center gap-6 sm:flex-row">
            {/* Big grade circle */}
            <div className="relative flex size-28 shrink-0 items-center justify-center">
              {/* Ring background */}
              <svg className="absolute inset-0 size-28 -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60" cy="60" r="52"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-muted/30"
                />
                <circle
                  cx="60" cy="60" r="52"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeDasharray={`${(overallGrade / 10) * 327} 327`}
                  strokeLinecap="round"
                  className="text-emerald-500 transition-all duration-1000"
                />
              </svg>
              <div className="flex flex-col items-center">
                <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
                  {overallGrade.toFixed(1)}
                </span>
                <span className="text-[10px] font-medium text-muted-foreground">
                  / 10
                </span>
              </div>
            </div>

            <div className="min-w-0 flex-1 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h2 className="text-lg font-bold text-foreground">
                  Projeto Severinno
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  <Sparkles className="size-2.5" />
                  {overallStatusLabel(overallGrade)}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {layersCompleted} de 7 camadas completas ({completionPct}%) ·{" "}
                {layersPartial} parcial · {actionsRemaining} ações pendentes
                {overallGrade >= 9.5
                  ? " · Quase pronto para produção! 🚀"
                  : overallGrade >= 8
                    ? " · Bom progresso, continue assim! 💪"
                    : " · Priorizar melhorias críticas ⚠️"}
              </p>

              {/* Progress bar */}
              <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
                {LAYERS.map((layer) => (
                  <div
                    key={layer.id}
                    className={cn(
                      "h-full transition-all duration-500",
                      layer.grade >= 9
                        ? "bg-emerald-500"
                        : layer.grade >= 7
                          ? "bg-amber-500"
                          : "bg-red-500",
                    )}
                    style={{ width: `${(1 / 7) * 100}%` }}
                    title={`${layer.label}: ${layer.grade}/${layer.maxGrade}`}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
                {LAYERS.map((layer) => (
                  <span key={layer.id} className="truncate px-0.5" style={{ width: `${(1 / 7) * 100}%` }}>
                    {layer.grade.toFixed(1)}
                  </span>
                ))}
              </div>
            </div>

            {/* Status sparkline */}
            <div className="hidden shrink-0 text-right lg:block">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Completas
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-emerald-500">
                    {layersCompleted}
                  </p>
                  <p className="text-[10px] text-muted-foreground">/ 7</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Pendentes
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-amber-500">
                    {actionsRemaining}
                  </p>
                  <p className="text-[10px] text-muted-foreground">ações</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <section aria-label="Indicadores do projeto" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={TrendingUp}
          label="Nota Geral"
          value={`${overallGrade.toFixed(1)}/10`}
          subtitle={`Média de ${LAYERS.length} camadas`}
          trend={overallGrade >= 9 ? "up" : overallGrade >= 7 ? "warn" : "down"}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Camadas Completas"
          value={`${layersCompleted}/7`}
          subtitle={`${completionPct}% concluído`}
          trend={layersCompleted >= 5 ? "up" : layersCompleted >= 3 ? "warn" : "down"}
        />
        <KpiCard
          icon={Target}
          label="Ações Pendentes"
          value={String(actionsRemaining)}
          subtitle="Itens para atingir 10/10"
          trend={actionsRemaining === 0 ? "up" : actionsRemaining <= 5 ? "warn" : "down"}
        />
        <KpiCard
          icon={BarChart3}
          label="Camadas Parciais"
          value={String(layersPartial)}
          subtitle="Precisam de atenção"
          trend={layersPartial === 0 ? "up" : layersPartial <= 2 ? "warn" : "down"}
        />
      </section>

      {/* ── Layers Grid ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">
            Análise por Camada
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LAYERS.map((layer) => (
            <LayerCard key={layer.id} layer={layer} />
          ))}
        </div>
      </section>

      {/* ── Actions Needed ──────────────────────────────────────────── */}
      {actionsRemaining > 0 && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Target className="size-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-foreground">
              Ações Recomendadas
            </h2>
          </div>
          <div className="grid gap-3">
            {LAYERS.filter((l) => l.todo.length > 0).map((layer) => (
              <div
                key={layer.id}
                className={cn(
                  "rounded-xl border p-4",
                  layer.lightBorder,
                  layer.darkBorder,
                  layer.lightBg,
                  layer.darkBg,
                )}
              >
                <div className="flex items-center gap-2">
                  <layer.icon className="size-4 shrink-0 text-foreground" />
                  <h3 className="font-semibold text-sm text-foreground">{layer.label}</h3>
                  <span className={cn(
                    "ml-auto text-xs font-medium",
                    getGradeColor(layer.grade),
                  )}>
                    {layer.grade}/{layer.maxGrade}
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {layer.todo.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-amber-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Legend / Footer ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3 text-[10px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-emerald-500" /> Completo (10/10)
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-500" /> Parcial (7-9.9)
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-red-500" /> Crítico (&lt;7)
          </span>
          <span className="ml-auto">
            Análise estática · Última atualização: Julho 2026
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function overallStatusLabel(grade: number): string {
  if (grade >= 9.5) return "Excelente"
  if (grade >= 8.5) return "Muito Bom"
  if (grade >= 7) return "Bom"
  if (grade >= 5) return "Regular"
  return "Crítico"
}

function KpiCard({
  icon: Icon,
  label,
  value,
  subtitle,
  trend,
}: {
  icon: LucideIcon
  label: string
  value: string
  subtitle?: string
  trend?: "up" | "warn" | "down"
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 transition-colors hover:border-primary/20">
      <div className="flex items-start justify-between">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary/8 text-primary">
          <Icon className="size-5" />
        </span>
        {trend ? (
          trend === "up" ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : trend === "warn" ? (
            <AlertTriangle className="size-4 text-amber-500" />
          ) : (
            <AlertTriangle className="size-4 text-red-500" />
          )
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {subtitle ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  )
}

function LayerCard({ layer }: { layer: LayerInfo }) {
  const Icon = layer.icon
  const pct = (layer.grade / layer.maxGrade) * 100
  const hasActions = layer.todo.length > 0

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-5 transition-all hover:shadow-sm",
        layer.lightBorder,
        layer.darkBorder,
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            layer.lightBg,
            layer.darkBg,
          )}>
            <Icon className={cn("size-5", getGradeColor(layer.grade))} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground leading-tight">
              {layer.label}
            </h3>
            <p className="text-[10px] text-muted-foreground">{layer.description}</p>
          </div>
        </div>
      </div>

      {/* Grade + Progress */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-1">
          {/* Grade icon inlined (no component created during render —
              react-hooks/static-components gate). */}
          {layer.grade >= 9 ? (
            <CheckCircle2 className={cn("size-4", getGradeColor(layer.grade))} />
          ) : (
            <AlertTriangle className={cn("size-4", getGradeColor(layer.grade))} />
          )}
          <span className={cn(
            "text-lg font-bold tabular-nums",
            getGradeColor(layer.grade),
          )}>
            {layer.grade}
          </span>
          <span className="text-[10px] text-muted-foreground">/{layer.maxGrade}</span>
        </div>
        {hasActions && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            <Wrench className="size-2.5" />
            {layer.todo.length} ação(ões)
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700",
            pct >= 100 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Findings */}
      <div className="mt-3 space-y-1">
        {layer.findings.slice(0, 4).map((finding, idx) => (
          <div key={idx} className="flex items-start gap-1.5">
            {finding.status === "ok" ? (
              <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" />
            ) : finding.status === "warn" ? (
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-500" />
            ) : (
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-red-500" />
            )}
            <span className="text-[10px] leading-relaxed text-muted-foreground">
              {finding.text}
            </span>
          </div>
        ))}
        {layer.findings.length > 4 && (
          <p className="text-[9px] text-muted-foreground/60 pl-5">
            +{layer.findings.length - 4} mais
          </p>
        )}
      </div>
    </div>
  )
}

export default AdminProjectStatus
