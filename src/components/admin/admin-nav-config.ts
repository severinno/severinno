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
  Navigation,
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
  ShieldCheck,
  Flame,
  TrendingUp,
  MessageSquare,
  Scale,
  Coins,
  UserPlus,
} from "lucide-react"

import type { NavItem, NavGroup, Breadcrumb } from "@/components/shared/dashboard-shell"

export type { NavItem, NavGroup, Breadcrumb }

// ---------------------------------------------------------------------------
// Nav config — Arquitetura da Informação em 6 Domínios Estratégicos
// ---------------------------------------------------------------------------
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Visão Executiva & Operações",
    items: [
      {
        view: "admin.dashboard",
        label: "Visão geral",
        icon: LayoutDashboard,
      },
      {
        view: "admin.operations",
        label: "Torre de Controle GV",
        icon: Navigation,
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
        view: "admin.project-status",
        label: "Status do Projeto",
        icon: Target,
      },
    ],
  },
  {
    label: "Marketplace & Catálogo",
    items: [
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
        view: "admin.services",
        label: "Serviços",
        icon: Wrench,
      },
      {
        view: "admin.taxonomy",
        label: "Taxonomia",
        icon: Network,
      },
      {
        view: "admin.bookings",
        label: "Agendamentos",
        icon: CalendarCheck,
      },
      {
        view: "admin.gtm-leads",
        label: "Prospecção GTM",
        icon: UserPlus,
      },
    ],
  },
  {
    label: "Financeiro, Repasses & Custódia",
    items: [
      {
        view: "admin.finance",
        label: "Financeiro",
        icon: Banknote,
      },
      {
        view: "admin.commissions",
        label: "Comissões & Take-Rate",
        icon: Coins,
      },
      {
        view: "admin.disputes",
        label: "Disputas & Escrow",
        icon: Scale,
      },
      {
        view: "admin.settlements",
        label: "Repasses",
        icon: Handshake,
      },
      {
        view: "admin.gateway",
        label: "Gateway & Faturas",
        icon: CreditCard,
      },
    ],
  },
  {
    label: "Comunicação & Notificações",
    items: [
      {
        view: "admin.whatsapp",
        label: "WhatsApp",
        icon: MessageSquare,
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
    ],
  },
  {
    label: "Inteligência Geo & Mapas",
    items: [
      {
        view: "admin.coverage",
        label: "Mapa de Cobertura",
        icon: Map,
      },
      {
        view: "admin.geo-metrics",
        label: "Geo Metrics",
        icon: Globe,
      },
      {
        view: "admin.geo-cache",
        label: "Cache Geo",
        icon: Layers,
      },
      {
        view: "admin.geo-rate-limit-status",
        label: "Rate Limit Geo",
        icon: Shield,
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
    ],
  },
  {
    label: "DevOps & Confiabilidade",
    items: [
      {
        view: "admin.health",
        label: "Saúde",
        icon: Heart,
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
        view: "admin.redis-diagnostics",
        label: "Redis",
        icon: Database,
      },
      {
        view: "admin.errors",
        label: "Erros",
        icon: AlertTriangle,
      },
      {
        view: "admin.webhook-audit",
        label: "Webhooks",
        icon: Webhook,
      },
      {
        view: "admin.push-audit",
        label: "Auditoria",
        icon: ClipboardCheck,
      },
      {
        view: "admin.settings",
        label: "Configurações",
        icon: SettingsIcon,
      },
      {
        view: "admin.maintenance",
        label: "Manutenção",
        icon: HardHat,
      },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

export const VIEW_META: Record<
  string,
  { title: string; subtitle?: string; breadcrumbs: Breadcrumb[] }
> = {
  "admin.dashboard": {
    title: "Visão geral",
    subtitle: "Indicadores principais e atividade recente do marketplace.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Visão geral" }],
  },
  "admin.operations": {
    title: "Torre de Controle Operacional — GV",
    subtitle:
      "Monitoramento tático em tempo real de Governador Valadares, prestadores em campo e custódia.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Operações GV" }],
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
  "admin.commissions": {
    title: "Comissões & Modelo de Negócio",
    subtitle:
      "Receita bruta da plataforma, taxa de comissão (Take-Rate de 15%), repasse líquido e ranking de prestadores.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Comissões" }],
  },
  "admin.settlements": {
    title: "Repasses",
    subtitle: "Períodos de repasse automáticos — gere, finalize e marque como pago.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Repasses" }],
  },
  "admin.disputes": {
    title: "Mediação & Disputas de Escrow",
    subtitle: "Arbitragem de conflitos, retenção de custódia e resolução assistida por IA.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Disputas" }],
  },
  "admin.bookings": {
    title: "Agendamentos",
    subtitle: "Supervisão de todos os agendamentos (somente leitura).",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Agendamentos" }],
  },
  "admin.gtm-leads": {
    title: "Prospecção & Funil de Aquisição GTM",
    subtitle:
      "Captação ativa de profissionais, status de contato, métricas de funil e integração de WhatsApp.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Prospecção GTM" }],
  },
  "admin.maintenance": {
    title: "Modo de manutenção",
    subtitle:
      "A chave que torna o site INACESSÍVEL ao público em um clique — e o reabre no clique seguinte.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Manutenção" }],
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
  "admin.whatsapp": {
    title: "WhatsApp & Evolution API",
    subtitle: "Status da conexão, leitura de QR Code em tempo real e disparos transacionais.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "WhatsApp" }],
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
