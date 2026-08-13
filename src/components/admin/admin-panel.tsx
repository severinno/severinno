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
} from "lucide-react"

import { DashboardShell, type NavItem, type Breadcrumb } from "@/components/shared/dashboard-shell"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

import dynamic from "next/dynamic"

// ---------------------------------------------------------------------------
// Lazy-loaded Admin Sub-Views (Code-Split per Tab)
// ---------------------------------------------------------------------------

const AdminDashboard = dynamic(() => import("./admin-dashboard").then((m) => m.AdminDashboard))
const AdminTaxonomy = dynamic(() => import("./admin-taxonomy").then((m) => m.AdminTaxonomy))
const AdminUsers = dynamic(() => import("./admin-users").then((m) => m.AdminUsers))
const AdminProviders = dynamic(() => import("./admin-providers").then((m) => m.AdminProviders))
const AdminServices = dynamic(() => import("./admin-services").then((m) => m.AdminServices))
const AdminBookings = dynamic(() => import("./admin-bookings").then((m) => m.AdminBookings))
const AdminFinanceDashboard = dynamic(() =>
  import("./admin-finance").then((m) => m.AdminFinanceDashboard),
)
const AdminSettlements = dynamic(() =>
  import("./admin-settlements").then((m) => m.AdminSettlements),
)
const AdminSettings = dynamic(() => import("./admin-settings").then((m) => m.AdminSettings))
const AdminErrorTrends = dynamic(() => import("./admin-errors").then((m) => m.AdminErrorTrends))
const AdminHealthDashboard = dynamic(() =>
  import("./admin-health").then((m) => m.AdminHealthDashboard),
)
const AdminPerformanceDashboard = dynamic(() =>
  import("./admin-performance").then((m) => m.AdminPerformanceDashboard),
)
const AdminPushNotifications = dynamic(() =>
  import("./admin-push").then((m) => m.AdminPushNotifications),
)
const AdminPushRecurring = dynamic(() =>
  import("./admin-push-recurring").then((m) => m.AdminPushRecurring),
)
const AdminPushHistory = dynamic(() =>
  import("./admin-push-history").then((m) => m.AdminPushHistory),
)
const AdminPushMetrics = dynamic(() =>
  import("./admin-push-metrics").then((m) => m.AdminPushMetrics),
)
const AdminProjectStatus = dynamic(() =>
  import("./admin-project-status").then((m) => m.AdminProjectStatus),
)
const AdminPushAudit = dynamic(() => import("./admin-push-audit").then((m) => m.AdminPushAudit))
const AdminWebhookAudit = dynamic(() =>
  import("./admin-webhook-audit").then((m) => m.AdminWebhookAudit),
)
const AdminGatewayDashboard = dynamic(() =>
  import("./admin-gateway-dashboard").then((m) => m.AdminGatewayDashboard),
)
const AdminPgBouncer = dynamic(() => import("./admin-pgbouncer").then((m) => m.AdminPgBouncer))
const AdminGeoMetricsDashboard = dynamic(() =>
  import("./admin-geo-metrics-dashboard").then((m) => m.AdminGeoMetricsDashboard),
)
const AdminCoverageMap = dynamic(() =>
  import("./admin-coverage-map").then((m) => m.AdminCoverageMap),
)
const AdminBenchmarkDashboard = dynamic(() =>
  import("./admin-benchmark-dashboard").then((m) => m.AdminBenchmarkDashboard),
)
const AdminBenchmarkEvolution = dynamic(() =>
  import("./admin-benchmark-evolution").then((m) => m.AdminBenchmarkEvolution),
)
const AdminGeoCacheDashboard = dynamic(() =>
  import("./admin-geo-cache-dashboard").then((m) => m.AdminGeoCacheDashboard),
)
const AdminRedisDiagnosticsDashboard = dynamic(() =>
  import("./admin-redis-diagnostics").then((m) => m.AdminRedisDiagnosticsDashboard),
)
const AdminGeoRateLimitStatus = dynamic(() =>
  import("./admin-geo-rate-limit-status").then((m) => m.AdminGeoRateLimitStatus),
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
