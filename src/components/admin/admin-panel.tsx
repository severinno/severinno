"use client"

/**
 * AdminPanel — orchestrator for the admin dashboard.
 *
 * Reads `useViewStore.view` and renders the appropriate admin sub-view inside
 * the shared <DashboardShell>. The admin is ROOT with full CRUD.
 *
 * Views:
 *   admin.dashboard  → AdminDashboard
 *   admin.taxonomy   → AdminTaxonomy
 *   admin.users      → AdminUsers
 *   admin.providers  → AdminProviders
 *   admin.services   → AdminServices
 *   admin.bookings   → AdminBookings
 *   admin.settings   → AdminSettings
 *
 * If the current user isn't an ADMIN, a guard card is rendered instead.
 */

import * as React from "react"
import dynamic from "next/dynamic"
import {
  Activity,
  AlertTriangle,
  Banknote,
  BarChart3,
  Bell,
  CreditCard,
  Database,
  Globe,
  Layers,
  LayoutDashboard,
  Map,
  Network,
  Users,
  HardHat,
  Wrench,
  CalendarCheck,
  Handshake,
  Settings as SettingsIcon,
  Heart,
  Target,
  List,
  ClipboardCheck,
  CalendarClock,
  Webhook,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Flame,
  TrendingUp,
} from "lucide-react"

import { DashboardShell, type NavItem, type Breadcrumb } from "@/components/shared/dashboard-shell"
import { useAuthStore, useViewStore } from "@/store"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

// Lazy-loaded admin sub-views — each is a separate chunk that loads on demand.
// This cuts the initial bundle from ~1MB to ~200KB by deferring recharts, maplibre, etc.
const AdminDashboard = dynamic(
  () => import("./admin-dashboard").then((m) => ({ default: m.AdminDashboard })),
  { ssr: false },
)
const AdminTaxonomy = dynamic(
  () => import("./admin-taxonomy").then((m) => ({ default: m.AdminTaxonomy })),
  { ssr: false },
)
const AdminUsers = dynamic(() => import("./admin-users").then((m) => ({ default: m.AdminUsers })), {
  ssr: false,
})
const AdminProviders = dynamic(
  () => import("./admin-providers").then((m) => ({ default: m.AdminProviders })),
  { ssr: false },
)
const AdminServices = dynamic(
  () => import("./admin-services").then((m) => ({ default: m.AdminServices })),
  { ssr: false },
)
const AdminBookings = dynamic(
  () => import("./admin-bookings").then((m) => ({ default: m.AdminBookings })),
  { ssr: false },
)
const AdminFinanceDashboard = dynamic(
  () => import("./admin-finance").then((m) => ({ default: m.AdminFinanceDashboard })),
  { ssr: false },
)
const AdminSettlements = dynamic(
  () => import("./admin-settlements").then((m) => ({ default: m.AdminSettlements })),
  { ssr: false },
)
const AdminSettings = dynamic(
  () => import("./admin-settings").then((m) => ({ default: m.AdminSettings })),
  { ssr: false },
)
const AdminErrorTrends = dynamic(
  () => import("./admin-errors").then((m) => ({ default: m.AdminErrorTrends })),
  { ssr: false },
)
const AdminHealthDashboard = dynamic(
  () => import("./admin-health").then((m) => ({ default: m.AdminHealthDashboard })),
  { ssr: false },
)
const AdminPerformanceDashboard = dynamic(
  () => import("./admin-performance").then((m) => ({ default: m.AdminPerformanceDashboard })),
  { ssr: false },
)
const AdminPushNotifications = dynamic(
  () => import("./admin-push").then((m) => ({ default: m.AdminPushNotifications })),
  { ssr: false },
)
const AdminPushRecurring = dynamic(
  () => import("./admin-push-recurring").then((m) => ({ default: m.AdminPushRecurring })),
  { ssr: false },
)
const AdminPushHistory = dynamic(
  () => import("./admin-push-history").then((m) => ({ default: m.AdminPushHistory })),
  { ssr: false },
)
const AdminPushMetrics = dynamic(
  () => import("./admin-push-metrics").then((m) => ({ default: m.AdminPushMetrics })),
  { ssr: false },
)
const AdminProjectStatus = dynamic(
  () => import("./admin-project-status").then((m) => ({ default: m.AdminProjectStatus })),
  { ssr: false },
)
const AdminPushAudit = dynamic(
  () => import("./admin-push-audit").then((m) => ({ default: m.AdminPushAudit })),
  { ssr: false },
)
const AdminWebhookAudit = dynamic(
  () => import("./admin-webhook-audit").then((m) => ({ default: m.AdminWebhookAudit })),
  { ssr: false },
)
const AdminGatewayDashboard = dynamic(
  () => import("./admin-gateway-dashboard").then((m) => ({ default: m.AdminGatewayDashboard })),
  { ssr: false },
)
const AdminPgBouncer = dynamic(
  () => import("./admin-pgbouncer").then((m) => ({ default: m.AdminPgBouncer })),
  { ssr: false },
)
const AdminGeoMetricsDashboard = dynamic(
  () =>
    import("./admin-geo-metrics-dashboard").then((m) => ({ default: m.AdminGeoMetricsDashboard })),
  { ssr: false },
)
const AdminCoverageMap = dynamic(
  () => import("./admin-coverage-map").then((m) => ({ default: m.AdminCoverageMap })),
  { ssr: false },
)
const AdminBenchmarkDashboard = dynamic(
  () => import("./admin-benchmark-dashboard").then((m) => ({ default: m.AdminBenchmarkDashboard })),
  { ssr: false },
)
const AdminBenchmarkEvolution = dynamic(
  () => import("./admin-benchmark-evolution").then((m) => ({ default: m.AdminBenchmarkEvolution })),
  { ssr: false },
)
const AdminGeoCacheDashboard = dynamic(
  () => import("./admin-geo-cache-dashboard").then((m) => ({ default: m.AdminGeoCacheDashboard })),
  { ssr: false },
)
const AdminRedisDiagnosticsDashboard = dynamic(
  () =>
    import("./admin-redis-diagnostics").then((m) => ({
      default: m.AdminRedisDiagnosticsDashboard,
    })),
  { ssr: false },
)
const AdminGeoRateLimitStatus = dynamic(
  () =>
    import("./admin-geo-rate-limit-status").then((m) => ({ default: m.AdminGeoRateLimitStatus })),
  { ssr: false },
)
const GeoDebugDashboard = dynamic(
  () => import("./geo-debug-dashboard").then((m) => ({ default: m.GeoDebugDashboard })),
  { ssr: false },
)
const AdminAnalyticsDashboard = dynamic(
  () =>
    import("./admin-analytics-dashboard").then((m) => ({
      default: m.AdminAnalyticsDashboard,
    })),
  { ssr: false },
)
const AdminDemandHeatmap = dynamic(
  () => import("./admin-demand-heatmap").then((m) => ({ default: m.AdminDemandHeatmap })),
  { ssr: false },
)
const AdminIdentityReview = dynamic(
  () => import("./admin-identity-review").then((m) => ({ default: m.AdminIdentityReview })),
  { ssr: false },
)

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------
const NAV_ITEMS: NavItem[] = [
  {
    view: "admin.dashboard",
    label: "Visão geral",
    icon: LayoutDashboard,
  },
  {
    view: "admin.project-status",
    label: "Status do Projeto",
    icon: Target,
  },
  {
    view: "admin.taxonomy",
    label: "Taxonomia",
    icon: Network,
  },
  {
    view: "admin.users",
    label: "Usuários",
    icon: Users,
  },
  {
    view: "admin.providers",
    label: "Prestadores",
    icon: HardHat,
  },
  {
    view: "admin.verifications",
    label: "Verificações KYC",
    icon: ShieldCheck,
  },
  {
    view: "admin.analytics",
    label: "Funil & Analytics",
    icon: TrendingUp,
  },
  {
    view: "admin.demand",
    label: "Mapa de Demanda",
    icon: Flame,
  },
  {
    view: "admin.services",
    label: "Serviços",
    icon: Wrench,
  },
  {
    view: "admin.finance",
    label: "Financeiro",
    icon: Banknote,
  },
  {
    view: "admin.settlements",
    label: "Repasses",
    icon: Handshake,
  },
  {
    view: "admin.bookings",
    label: "Agendamentos",
    icon: CalendarCheck,
  },
  {
    view: "admin.push",
    label: "Enviar Push",
    icon: Bell,
  },
  {
    view: "admin.push-recurring",
    label: "Push Recorrente",
    icon: CalendarClock,
  },
  {
    view: "admin.push-metrics",
    label: "Push Metrics",
    icon: BarChart3,
  },
  {
    view: "admin.push-history",
    label: "Push Log",
    icon: List,
  },
  {
    view: "admin.push-audit",
    label: "Auditoria",
    icon: ClipboardCheck,
  },
  {
    view: "admin.webhook-audit",
    label: "Webhooks",
    icon: Webhook,
  },
  {
    view: "admin.gateway",
    label: "Gateway",
    icon: CreditCard,
  },
  {
    view: "admin.coverage",
    label: "Cobertura",
    icon: Map,
  },
  {
    view: "admin.redis-diagnostics",
    label: "Redis",
    icon: Database,
  },
  {
    view: "admin.geo-rate-limit-status",
    label: "Rate Limit Geo",
    icon: Shield,
  },
  {
    view: "admin.geo-cache",
    label: "Cache Geo",
    icon: Layers,
  },
  {
    view: "admin.geo-metrics",
    label: "Geo Metrics",
    icon: Globe,
  },
  {
    view: "admin.geo-debug",
    label: "Geo Debug",
    icon: Activity,
  },
  {
    view: "admin.benchmarks",
    label: "Benchmarks",
    icon: BarChart3,
  },
  {
    view: "admin.benchmark-evolution",
    label: "Evolução Geo",
    icon: Activity,
  },
  {
    view: "admin.performance",
    label: "Performance",
    icon: Activity,
  },
  {
    view: "admin.pgbouncer",
    label: "PgBouncer",
    icon: Database,
  },
  {
    view: "admin.errors",
    label: "Erros",
    icon: AlertTriangle,
  },
  {
    view: "admin.health",
    label: "Saúde",
    icon: Heart,
  },
  {
    view: "admin.settings",
    label: "Configurações",
    icon: SettingsIcon,
  },
]

const VIEW_META: Record<string, { title: string; subtitle?: string; breadcrumbs: Breadcrumb[] }> = {
  "admin.dashboard": {
    title: "Visão geral",
    subtitle: "Indicadores principais e atividade recente do marketplace.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Visão geral" }],
  },
  "admin.taxonomy": {
    title: "Taxonomia de categorias",
    subtitle: "Gerencie a árvore de categorias em 3 níveis (pai → filha → subcategoria).",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Taxonomia" }],
  },
  "admin.users": {
    title: "Usuários",
    subtitle: "Gerencie clientes, prestadores e administradores.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Usuários" }],
  },
  "admin.providers": {
    title: "Prestadores",
    subtitle: "Verificação, ativação e perfil dos prestadores de serviço.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Prestadores" }],
  },
  "admin.verifications": {
    title: "Verificações de Identidade (KYC)",
    subtitle: "Análise e aprovação de documentos e selfies com suporte de OCR por IA.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Verificações KYC" }],
  },
  "admin.analytics": {
    title: "Analytics & Funil de Conversão",
    subtitle: "Métricas de negócio, taxas de conversão entre etapas do funil e volume diário.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Analytics" }],
  },
  "admin.demand": {
    title: "Mapa de Demanda Geográfica",
    subtitle: "Distribuição espacial de pedidos e oportunidades de expansão de cobertura.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Mapa de Demanda" }],
  },
  "admin.services": {
    title: "Serviços",
    subtitle: "Catálogo global de serviços. Ative/desative ou exclua.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Serviços" }],
  },
  "admin.finance": {
    title: "Financeiro",
    subtitle: "Resumo de transações, faturamento mensal e extrato por período.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Financeiro" }],
  },
  "admin.settlements": {
    title: "Repasses",
    subtitle: "Períodos de repasse automáticos — gere, finalize e marque como pago.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Repasses" }],
  },
  "admin.bookings": {
    title: "Agendamentos",
    subtitle: "Supervisão de todos os agendamentos (somente leitura).",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Agendamentos" }],
  },
  "admin.settings": {
    title: "Configurações",
    subtitle: "Editor dinâmico de configurações (chave/valor). Equivalente runtime de um .env.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Configurações" }],
  },
  "admin.push-recurring": {
    title: "Push Recorrente",
    subtitle:
      "Agende notificações push automáticas que disparam todo dia, semana ou mês — ideais para campanhas periódicas.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Push Recorrente" }],
  },
  "admin.push-metrics": {
    title: "Métricas de Push",
    subtitle:
      "Delivery rate, click rate, bounce rate, ações, timeline e indicadores de saúde do sistema de push notifications.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Push Metrics" }],
  },
  "admin.push-history": {
    title: "Histórico de Push",
    subtitle:
      "Todas as notificações push enviadas com status de entrega, destinatário e deep link.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Push Log" }],
  },
  "admin.push-audit": {
    title: "Auditoria — Push",
    subtitle:
      "Log completo de auditoria: quem enviou/agendou, quando, para quantos destinatários e resultado final da operação.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Auditoria" }],
  },
  "admin.webhook-audit": {
    title: "Log de Webhooks",
    subtitle:
      "Histórico de execuções de regras de webhook de eventos: quando cada regra foi executada, quantos usuários notificou e quais erros ocorreram.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Webhooks" }],
  },
  "admin.push": {
    title: "Notificações Push",
    subtitle: "Envie notificações push manualmente para usuários específicos com push ativo.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Notificações Push" }],
  },
  "admin.project-status": {
    title: "Status do Projeto",
    subtitle:
      "Análise completa de 7 camadas — notas, descobertas e ações pendentes para lançamento em produção.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Status do Projeto" }],
  },
  "admin.gateway": {
    title: "Gateway de Pagamento",
    subtitle: "Métricas agregadas do Lytex — receita, volume de transações e taxa de conversão.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Gateway" }],
  },
  "admin.coverage": {
    title: "Mapa de Cobertura",
    subtitle:
      "Grelha de calor mostrando a sobreposição dos raios de atendimento de todos os prestadores.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Cobertura" }],
  },
  "admin.geo-cache": {
    title: "Diagnóstico do Cache Geo",
    subtitle:
      "Hit/miss ratio do Redis, top queries mais frequentes, heatmap de uso por endpoint e TTL das chaves de cache.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Cache Geo" }],
  },
  "admin.redis-diagnostics": {
    title: "Diagnóstico do Redis",
    subtitle:
      "Hit/miss ratio, nós do cluster, distribuição de slots, chaves por nó e cache em memória.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Redis" }],
  },
  "admin.geo-rate-limit-status": {
    title: "Status do Rate Limiter Geo",
    subtitle:
      "IPs mais ativos, hits/misses, capacidade restante e estado Redis vs in-memory para os endpoints de geolocalização.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Rate Limit Geo" }],
  },
  "admin.geo-metrics": {
    title: "Métricas de Geolocalização",
    subtitle: "Latência P50/P95/P99 dos serviços de geocoding (Nominatim, ViaCEP) e PostGIS.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Geo Metrics" }],
  },
  "admin.benchmarks": {
    title: "Monitoramento de Benchmarks",
    subtitle:
      "Comparação contínua de desempenho dos benchmarks de geolocalização com detecção automática de regressões.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Benchmarks" }],
  },
  "admin.benchmark-evolution": {
    title: "Evolução dos Benchmarks Geo",
    subtitle:
      "Visualização temporal dos 6 benchmarks de geolocalização ao longo de todas as execuções.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Evolução Geo" }],
  },
  "admin.performance": {
    title: "Performance",
    subtitle:
      "Métricas de tempo de resposta, banco de dados, chamadas externas e saúde do sistema.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Performance" }],
  },
  "admin.pgbouncer": {
    title: "PgBouncer — Pool de Conexões",
    subtitle:
      "Monitoramento em tempo real do pooler de conexões PostgreSQL: estado do pool, métricas de queries e configuração.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "PgBouncer" }],
  },
  "admin.errors": {
    title: "Monitoramento de Erros",
    subtitle: "Tendências de erro por endpoint, usuário e versão. Top erros e timeline.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Erros" }],
  },
  "admin.health": {
    title: "Saúde do Sistema",
    subtitle:
      "Monitoramento em tempo real de todos os serviços: banco, Redis, RabbitMQ, workers, cache e métricas do processo.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Saúde" }],
  },
}

// ---------------------------------------------------------------------------
// Admin Skeleton Loading — fallback para React.Suspense
// ---------------------------------------------------------------------------
function AdminSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {/* Stats cards skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="mb-2 h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="mt-2 h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart area skeleton */}
      <Card>
        <CardContent className="p-6">
          <Skeleton className="mb-4 h-5 w-40" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>

      {/* Table skeleton */}
      <Card>
        <CardContent className="p-6">
          <Skeleton className="mb-4 h-5 w-32" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AdminPanel() {
  const view = useViewStore((s) => s.view)
  const navigate = useViewStore((s) => s.navigate)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)

  // Guard: only ADMINs may render this panel
  if (initialized && user?.role !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <ShieldAlert className="size-10 text-amber-500" />
            <h2 className="text-lg font-semibold">Acesso restrito</h2>
            <p className="text-muted-foreground text-sm">
              Esta área é exclusiva de administradores. Faça login com uma conta ADMIN para
              continuar.
            </p>
            <Button onClick={() => navigate("vitrine")}>Voltar à vitrine</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const meta = VIEW_META[view] ?? VIEW_META["admin.dashboard"]

  return (
    <DashboardShell
      navItems={NAV_ITEMS}
      currentView={view}
      title={meta.title}
      subtitle={meta.subtitle}
      breadcrumbs={meta.breadcrumbs}
      panelLabel="Painel do Administrador"
      panelIcon={ShieldAlert}
      onNavigate={(v) => navigate(v)}
      user={
        user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              avatarUrl: user.avatarUrl ?? null,
            }
          : undefined
      }
    >
      <React.Suspense fallback={<AdminSkeleton />}>
        <AdminView view={view} onNavigate={navigate} />
      </React.Suspense>
    </DashboardShell>
  )
}

function AdminView({ view, onNavigate }: { view: string; onNavigate: (view: string) => void }) {
  switch (view) {
    case "admin.dashboard":
      return <AdminDashboard onNavigate={onNavigate} />
    case "admin.taxonomy":
      return <AdminTaxonomy />
    case "admin.users":
      return <AdminUsers />
    case "admin.providers":
      return <AdminProviders />
    case "admin.verifications":
      return <AdminIdentityReview />
    case "admin.analytics":
      return <AdminAnalyticsDashboard />
    case "admin.demand":
      return <AdminDemandHeatmap />
    case "admin.services":
      return <AdminServices />
    case "admin.finance":
      return <AdminFinanceDashboard />
    case "admin.settlements":
      return <AdminSettlements />
    case "admin.bookings":
      return <AdminBookings />
    case "admin.push":
      return <AdminPushNotifications />
    case "admin.push-recurring":
      return <AdminPushRecurring />
    case "admin.push-metrics":
      return <AdminPushMetrics />
    case "admin.push-history":
      return <AdminPushHistory />
    case "admin.push-audit":
      return <AdminPushAudit />
    case "admin.webhook-audit":
      return <AdminWebhookAudit />
    case "admin.project-status":
      return <AdminProjectStatus />
    case "admin.gateway":
      return <AdminGatewayDashboard />
    case "admin.coverage":
      return <AdminCoverageMap />
    case "admin.redis-diagnostics":
      return <AdminRedisDiagnosticsDashboard />
    case "admin.geo-rate-limit-status":
      return <AdminGeoRateLimitStatus />
    case "admin.geo-cache":
      return <AdminGeoCacheDashboard />
    case "admin.geo-metrics":
      return <AdminGeoMetricsDashboard />
    case "admin.geo-debug":
      return <GeoDebugDashboard />
    case "admin.benchmarks":
      return <AdminBenchmarkDashboard />
    case "admin.benchmark-evolution":
      return <AdminBenchmarkEvolution />
    case "admin.performance":
      return <AdminPerformanceDashboard />
    case "admin.pgbouncer":
      return <AdminPgBouncer />
    case "admin.errors":
      return <AdminErrorTrends />
    case "admin.health":
      return <AdminHealthDashboard />
    case "admin.settings":
      return <AdminSettings />
    default:
      return <AdminDashboard onNavigate={onNavigate} />
  }
}

export default AdminPanel
