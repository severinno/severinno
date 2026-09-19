"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  CalendarCheck,
  CalendarDays,
  Clock,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Shield,
  Star,
  User,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { apiGet } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { DashboardShell, type NavItem } from "@/components/shared/dashboard-shell"

import dynamic from "next/dynamic"

// Lazy-loaded sub-views (code-split per route for smaller bundles)
const ProviderDashboard = dynamic(
  () => import("./provider-dashboard").then((m) => ({ default: m.ProviderDashboard })),
  { ssr: false },
)
const ProviderExpediente = dynamic(
  () => import("./provider-expediente").then((m) => ({ default: m.ProviderExpediente })),
  { ssr: false },
)
const ProviderAgenda = dynamic(
  () => import("./provider-agenda").then((m) => ({ default: m.ProviderAgenda })),
  { ssr: false },
)
const ProviderBookings = dynamic(
  () => import("./provider-bookings").then((m) => ({ default: m.ProviderBookings })),
  { ssr: false },
)
const ProviderQuotes = dynamic(
  () => import("./provider-quotes").then((m) => ({ default: m.ProviderQuotes })),
  { ssr: false },
)
const ProviderServices = dynamic(
  () => import("./provider-services").then((m) => ({ default: m.ProviderServices })),
  { ssr: false },
)
const ProviderFinance = dynamic(
  () => import("./provider-finance").then((m) => ({ default: m.ProviderFinance })),
  { ssr: false },
)
const ProviderMessages = dynamic(
  () => import("./provider-messages").then((m) => ({ default: m.ProviderMessages })),
  { ssr: false },
)
const ProviderReviews = dynamic(
  () => import("./provider-reviews").then((m) => ({ default: m.ProviderReviews })),
  { ssr: false },
)
const ProviderProfile = dynamic(
  () => import("./provider-profile").then((m) => ({ default: m.ProviderProfile })),
  { ssr: false },
)
const ProviderOnboarding = dynamic(
  () => import("./provider-onboarding").then((m) => ({ default: m.ProviderOnboarding })),
  { ssr: false },
)
const ClientSecurity = dynamic(
  () => import("@/components/client/client-security").then((m) => ({ default: m.ClientSecurity })),
  { ssr: false },
)

// ---------------------------------------------------------------------------
// View metadata
// ---------------------------------------------------------------------------

type ViewMeta = {
  view: string
  label: string
  icon: LucideIcon
  title: string
  subtitle: string
}

const VIEWS: ViewMeta[] = [
  {
    view: "provider.dashboard",
    label: "Visão geral",
    icon: LayoutDashboard,
    title: "Visão geral",
    subtitle: "Resumo dos seus agendamentos, orçamentos e avaliações.",
  },
  {
    view: "provider.expediente",
    label: "Expediente",
    icon: Clock,
    title: "Expediente",
    subtitle: "Configure os horários em que você atende.",
  },
  {
    view: "provider.agenda",
    label: "Agenda",
    icon: CalendarDays,
    title: "Agenda",
    subtitle: "Calendário de agendamentos por dia, semana e mês.",
  },
  {
    view: "provider.bookings",
    label: "Agendamentos",
    icon: CalendarCheck,
    title: "Agendamentos",
    subtitle: "Gerencie seus agendamentos por status.",
  },
  {
    view: "provider.quotes",
    label: "Orçamentos",
    icon: FileText,
    title: "Orçamentos",
    subtitle: "Responda às solicitações de orçamento dos clientes.",
  },
  {
    view: "provider.services",
    label: "Serviços",
    icon: Wrench,
    title: "Serviços",
    subtitle: "Cadastre e gerencie os serviços que você oferece.",
  },
  {
    view: "provider.finance",
    label: "Financeiro",
    icon: Wallet,
    title: "Financeiro",
    subtitle: "Acompanhe sua receita e transações.",
  },
  {
    view: "provider.messages",
    label: "Mensagens",
    icon: MessageSquare,
    title: "Mensagens",
    subtitle: "Converse com seus clientes em tempo real.",
  },
  {
    view: "provider.reviews",
    label: "Avaliações",
    icon: Star,
    title: "Avaliações",
    subtitle: "Veja o que seus clientes estão dizendo sobre você.",
  },
  {
    view: "provider.security",
    label: "Segurança",
    icon: Shield,
    title: "Segurança",
    subtitle: "Senha e autenticação de dois fatores.",
  },
  {
    view: "provider.profile",
    label: "Perfil",
    icon: User,
    title: "Meu perfil",
    subtitle: "Edite suas informações de prestador.",
  },
]

const VIEW_MAP: Record<string, ViewMeta> = Object.fromEntries(VIEWS.map((v) => [v.view, v]))

// ---------------------------------------------------------------------------
// Pending counts (for nav badges)
// ---------------------------------------------------------------------------

function useBadges() {
  const user = useAuthStore((s) => s.user)

  const quotesQuery = useQuery<{ items: Array<{ items: Array<{ status: string }> }> }>({
    queryKey: ["provider", "panel", "quotes-badges"],
    queryFn: async () =>
      apiGet("/api/quotes", { role: "PROVIDER", status: "PENDING", page: 1, limit: 50 }),
    enabled: !!user,
    refetchInterval: 60_000,
  })

  const bookingsQuery = useQuery<{ items: Array<{ status: string }> }>({
    queryKey: ["provider", "panel", "bookings-badges"],
    queryFn: async () =>
      apiGet("/api/bookings", { role: "PROVIDER", status: "PENDING", page: 1, limit: 50 }),
    enabled: !!user,
    refetchInterval: 60_000,
  })

  // Unread WALLET_CREDITED notifications → badge na aba Financeiro
  const walletNotifQuery = useQuery<{ unreadCount: number }>({
    queryKey: ["provider", "panel", "wallet-badges"],
    queryFn: () =>
      apiGet("/api/notifications", {
        unread: "1",
        type: "WALLET_CREDITED",
        page: 1,
        limit: 1,
      }),
    enabled: !!user,
    refetchInterval: 30_000,
  })

  const pendingQuotes = React.useMemo(() => {
    const items = quotesQuery.data?.items ?? []
    return items.reduce(
      (acc, q) => acc + (q.items ?? []).filter((i) => i.status === "PENDING").length,
      0,
    )
  }, [quotesQuery.data])

  const pendingBookings = bookingsQuery.data?.items?.length ?? 0
  const walletBadge = walletNotifQuery.data?.unreadCount ?? 0

  return { pendingQuotes, pendingBookings, walletBadge }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ProviderPanel() {
  const navigate = useViewStore((s) => s.navigate)
  const view = useViewStore((s) => s.view)
  const user = useAuthStore((s) => s.user)
  const { pendingQuotes, pendingBookings, walletBadge } = useBadges()

  // ── Onboarding check ───────────────────────────────────────────────
  const onboardingQuery = useQuery<{ step: number; done: boolean }>({
    queryKey: ["onboarding-progress", user?.id],
    queryFn: () => apiGet("/api/provider/onboarding"),
    enabled: !!user,
    staleTime: 30_000,
  })

  const onboardingDone = onboardingQuery.data?.done ?? false

  // Show onboarding only after query resolved successfully
  if (onboardingQuery.isSuccess && !onboardingDone && user?.role === "PROVIDER") {
    return (
      <ProviderOnboarding
        onComplete={() => {
          navigate("provider.dashboard")
        }}
      />
    )
  }

  const meta = VIEW_MAP[view] ?? VIEWS[0]

  const navItems: NavItem[] = VIEWS.map((v) => ({
    view: v.view,
    label: v.label,
    icon: v.icon,
    badge:
      v.view === "provider.quotes"
        ? pendingQuotes
        : v.view === "provider.bookings"
          ? pendingBookings
          : v.view === "provider.finance"
            ? walletBadge
            : undefined,
  }))

  const breadcrumbs = [{ label: "Painel do Prestador" }, { label: meta.label }]

  return (
    <DashboardShell
      navItems={navItems}
      currentView={view}
      title={meta.title}
      subtitle={meta.subtitle}
      breadcrumbs={breadcrumbs}
      panelLabel="Painel do Prestador"
      panelIcon={Wrench}
      user={user}
      onNavigate={(v) => navigate(v)}
    >
      {view === "provider.dashboard" && <ProviderDashboard />}
      {view === "provider.expediente" && <ProviderExpediente />}
      {view === "provider.agenda" && <ProviderAgenda />}
      {view === "provider.bookings" && <ProviderBookings />}
      {view === "provider.quotes" && <ProviderQuotes />}
      {view === "provider.services" && <ProviderServices />}
      {view === "provider.finance" && <ProviderFinance />}
      {view === "provider.messages" && <ProviderMessages />}
      {view === "provider.reviews" && <ProviderReviews />}
      {view === "provider.security" && <ClientSecurity />}
      {view === "provider.profile" && <ProviderProfile />}
    </DashboardShell>
  )
}

export default ProviderPanel
