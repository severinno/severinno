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
  LayoutDashboard,
  Network,
  Users,
  HardHat,
  Wrench,
  CalendarCheck,
  Settings as SettingsIcon,
  ShieldAlert,
} from "lucide-react"

import {
  DashboardShell,
  type NavItem,
  type Breadcrumb,
} from "@/components/shared/dashboard-shell"
import { useAuthStore, useViewStore } from "@/store"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"

import { AdminDashboard } from "./admin-dashboard"
import { AdminTaxonomy } from "./admin-taxonomy"
import { AdminUsers } from "./admin-users"
import { AdminProviders } from "./admin-providers"
import { AdminServices } from "./admin-services"
import { AdminBookings } from "./admin-bookings"
import { AdminSettings } from "./admin-settings"

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
    view: "admin.bookings",
    label: "Agendamentos",
    icon: CalendarCheck,
  },
  {
    view: "admin.settings",
    label: "Configurações",
    icon: SettingsIcon,
  },
]

const VIEW_META: Record<
  string,
  { title: string; subtitle?: string; breadcrumbs: Breadcrumb[] }
> = {
  "admin.dashboard": {
    title: "Visão geral",
    subtitle: "Indicadores principais e atividade recente do marketplace.",
    breadcrumbs: [{ label: "Painel do Administrador" }, { label: "Visão geral" }],
  },
  "admin.taxonomy": {
    title: "Taxonomia de categorias",
    subtitle:
      "Gerencie a árvore de categorias em 3 níveis (pai → filha → subcategoria).",
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
  "admin.bookings": {
    title: "Agendamentos",
    subtitle: "Supervisão de todos os agendamentos (somente leitura).",
    breadcrumbs: [
      { label: "Painel do Administrador" },
      { label: "Agendamentos" },
    ],
  },
  "admin.settings": {
    title: "Configurações",
    subtitle:
      "Editor dinâmico de configurações (chave/valor). Equivalente runtime de um .env.",
    breadcrumbs: [
      { label: "Painel do Administrador" },
      { label: "Configurações" },
    ],
  },
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
            <p className="text-sm text-muted-foreground">
              Esta área é exclusiva de administradores. Faça login com uma
              conta ADMIN para continuar.
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
      <AdminView view={view} onNavigate={navigate} />
    </DashboardShell>
  )
}

function AdminView({
  view,
  onNavigate,
}: {
  view: string
  onNavigate: (view: string) => void
}) {
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
    case "admin.bookings":
      return <AdminBookings />
    case "admin.settings":
      return <AdminSettings />
    default:
      return <AdminDashboard onNavigate={onNavigate} />
  }
}

export default AdminPanel
