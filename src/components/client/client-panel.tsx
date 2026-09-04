"use client"

/**
 * ClientPanel — orchestrator for the Client Panel.
 *
 * Reads `useViewStore.view` (e.g. 'client.dashboard', 'client.bookings',
 * 'client.messages', etc.) and renders the matching view inside
 * `<DashboardShell>`.
 *
 * Nav items: Visão geral, Agendamentos, Orçamentos, Serviços, Financeiro,
 * Mensagens, Avaliações, Favoritos, Perfil.
 *
 * If the user is not authenticated (or not a CLIENT), shows a fallback
 * CTA to log in / register.
 */

import * as React from "react"
import dynamic from "next/dynamic"
import {
  Calendar,
  FileText,
  Heart,
  LayoutDashboard,
  type LucideIcon,
  MapPin,
  MessageSquare,
  Shield,
  Star,
  User as UserIcon,
  Wallet,
  Wrench,
} from "lucide-react"

import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DashboardShell, type NavItem } from "@/components/shared/dashboard-shell"

// Lazy-loaded client sub-views — code-split per route for smaller bundles
const ClientDashboard = dynamic(
  () =>
    import("@/components/client/client-dashboard").then((m) => ({ default: m.ClientDashboard })),
  { ssr: false },
)
const ClientBookings = dynamic(
  () => import("@/components/client/client-bookings").then((m) => ({ default: m.ClientBookings })),
  { ssr: false },
)
const ClientQuotes = dynamic(
  () => import("@/components/client/client-quotes").then((m) => ({ default: m.ClientQuotes })),
  { ssr: false },
)
const ClientServices = dynamic(
  () => import("@/components/client/client-services").then((m) => ({ default: m.ClientServices })),
  { ssr: false },
)
const ClientFinance = dynamic(
  () => import("@/components/client/client-finance").then((m) => ({ default: m.ClientFinance })),
  { ssr: false },
)
const ClientReviews = dynamic(
  () => import("@/components/client/client-reviews").then((m) => ({ default: m.ClientReviews })),
  { ssr: false },
)
const ClientFavorites = dynamic(
  () =>
    import("@/components/client/client-favorites").then((m) => ({ default: m.ClientFavorites })),
  { ssr: false },
)
const ClientMessages = dynamic(
  () => import("@/components/client/client-messages").then((m) => ({ default: m.ClientMessages })),
  { ssr: false },
)
const ClientProfile = dynamic(
  () => import("@/components/client/client-profile").then((m) => ({ default: m.ClientProfile })),
  { ssr: false },
)
const ClientSecurity = dynamic(
  () => import("@/components/client/client-security").then((m) => ({ default: m.ClientSecurity })),
  { ssr: false },
)

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

const NAV_ITEMS: NavItem[] = [
  { label: "Visão geral", icon: LayoutDashboard, view: "client.dashboard" },
  { label: "Agendamentos", icon: Calendar, view: "client.bookings" },
  { label: "Orçamentos", icon: FileText, view: "client.quotes" },
  { label: "Serviços", icon: Wrench, view: "client.services" },
  { label: "Financeiro", icon: Wallet, view: "client.finance" },
  { label: "Mensagens", icon: MessageSquare, view: "client.messages" },
  { label: "Avaliações", icon: Star, view: "client.reviews" },
  { label: "Favoritos", icon: Heart, view: "client.favorites" },
  { label: "Segurança", icon: Shield, view: "client.security" },
  { label: "Perfil", icon: UserIcon, view: "client.profile" },
]

// ---------------------------------------------------------------------------
// View metadata
// ---------------------------------------------------------------------------

type ViewMeta = {
  title: string
  subtitle?: string
}

const VIEW_META: Record<string, ViewMeta> = {
  "client.dashboard": {
    title: "Painel do Cliente",
    subtitle: "Visão geral da sua conta",
  },
  "client.bookings": {
    title: "Agendamentos",
    subtitle: "Gerencie seus serviços agendados",
  },
  "client.quotes": {
    title: "Orçamentos",
    subtitle: "Acompanhe suas solicitações de orçamento",
  },
  "client.services": {
    title: "Serviços contratados",
    subtitle: "Histórico de serviços finalizados",
  },
  "client.finance": {
    title: "Financeiro",
    subtitle: "Pagamentos e gastos",
  },
  "client.messages": {
    title: "Mensagens",
    subtitle: "Converse com prestadores",
  },
  "client.reviews": {
    title: "Avaliações",
    subtitle: "Avaliações que você enviou",
  },
  "client.favorites": {
    title: "Favoritos",
    subtitle: "Prestadores salvos",
  },
  "client.security": {
    title: "Segurança",
    subtitle: "Senha e autenticação de dois fatores",
  },
  "client.profile": {
    title: "Meu perfil",
    subtitle: "Dados da conta",
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientPanel() {
  const view = useViewStore((s) => s.view)
  const navigate = useViewStore((s) => s.navigate)
  const { user, status, initialized } = useAuthStore()

  // Guard: not authenticated or wrong role
  if (initialized && (!user || user.role !== "CLIENT")) {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center p-6">
        <Card className="max-w-md text-center">
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full">
              <MapPin className="size-7" />
            </div>
            <h2 className="text-lg font-semibold">Acesso restrito</h2>
            <p className="text-muted-foreground text-sm">
              Esta área é exclusiva para clientes autenticados. Entre ou cadastre-se para acessar
              seu painel.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate("vitrine")}>
                Voltar à vitrine
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Loading state while auth initializes
  if (!initialized || status === "idle") {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center p-6">
        <div className="text-muted-foreground text-sm">Carregando…</div>
      </div>
    )
  }

  // Resolve which view to render (fallback to dashboard)
  const effectiveView = view.startsWith("client.") ? view : "client.dashboard"
  const meta = VIEW_META[effectiveView] ?? VIEW_META["client.dashboard"]!

  return (
    <DashboardShell
      navItems={NAV_ITEMS}
      currentView={effectiveView}
      title={meta.title}
      subtitle={meta.subtitle}
      panelLabel="Painel do Cliente"
      panelIcon={MapPin}
      user={user}
      onNavigate={(v) => navigate(v)}
    >
      {renderView(effectiveView)}
    </DashboardShell>
  )
}

function renderView(view: string): React.ReactNode {
  switch (view) {
    case "client.dashboard":
      return <ClientDashboard />
    case "client.bookings":
      return <ClientBookings />
    case "client.quotes":
      return <ClientQuotes />
    case "client.services":
      return <ClientServices />
    case "client.finance":
      return <ClientFinance />
    case "client.messages":
      return <ClientMessages />
    case "client.reviews":
      return <ClientReviews />
    case "client.favorites":
      return <ClientFavorites />
    case "client.security":
      return <ClientSecurity />
    case "client.profile":
      return <ClientProfile />
    default:
      return <ClientDashboard />
  }
}

// ---------------------------------------------------------------------------
// Re-export the icon type for convenience (used by other panels that build
// their own nav lists)
// ---------------------------------------------------------------------------

export type { LucideIcon }
