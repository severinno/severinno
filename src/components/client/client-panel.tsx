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
import {
  Calendar,
  FileText,
  Heart,
  LayoutDashboard,
  type LucideIcon,
  MapPin,
  MessageSquare,
  Star,
  User as UserIcon,
  Wallet,
  Wrench,
} from "lucide-react"

import { useAuthStore, useViewStore } from "@/store"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DashboardShell,
  type NavItem,
} from "@/components/shared/dashboard-shell"

import { ClientDashboard } from "@/components/client/client-dashboard"
import { ClientBookings } from "@/components/client/client-bookings"
import { ClientQuotes } from "@/components/client/client-quotes"
import { ClientServices } from "@/components/client/client-services"
import { ClientFinance } from "@/components/client/client-finance"
import { ClientReviews } from "@/components/client/client-reviews"
import { ClientFavorites } from "@/components/client/client-favorites"
import { ClientMessages } from "@/components/client/client-messages"
import { ClientProfile } from "@/components/client/client-profile"

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
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <Card className="max-w-md text-center">
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MapPin className="size-7" />
            </div>
            <h2 className="text-lg font-semibold">Acesso restrito</h2>
            <p className="text-sm text-muted-foreground">
              Esta área é exclusiva para clientes autenticados. Entre ou
              cadastre-se para acessar seu painel.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => navigate("vitrine")}
              >
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
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    )
  }

  // Resolve which view to render (fallback to dashboard)
  const effectiveView = view.startsWith("client.")
    ? view
    : "client.dashboard"
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
