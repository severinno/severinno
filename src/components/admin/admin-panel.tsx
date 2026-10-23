"use client"

/**
 * AdminPanel — orchestrator for the admin dashboard.
 *
 * Reads `useViewStore.view` and renders the appropriate admin sub-view inside
 * the shared <DashboardShell>. The admin is ROOT with full CRUD.
 *
 * Decomposed into:
 *   - admin-nav-config.ts (Navigation architecture, items and view metadata)
 *   - admin-view-router.tsx (Dynamic imports, lazy loading and view dispatching)
 *   - admin-panel.tsx (Shell orchestrator, real-time badges and investor demo trigger)
 */

import * as React from "react"
import { ShieldAlert, Sparkles, Loader2 } from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { DashboardShell } from "@/components/shared/dashboard-shell"
import { useAuthStore, useViewStore } from "@/store"
import { apiGet, apiPost } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

import {
  NAV_GROUPS,
  NAV_ITEMS,
  VIEW_META,
  type NavItem,
  type NavGroup,
  type Breadcrumb,
} from "./admin-nav-config"
import { AdminSkeleton, AdminView } from "./admin-view-router"

// Re-export navigation config for backward compatibility
export { NAV_GROUPS, NAV_ITEMS, VIEW_META }
export type { NavItem, NavGroup, Breadcrumb }

type AdminBadgesResponse = {
  activeBookings: number
  pendingKyc: number
  openDisputes: number
  services: number
  taxonomy: number
  verifiedProviders: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AdminPanel() {
  const view = useViewStore((s) => s.view)
  const navigate = useViewStore((s) => s.navigate)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const queryClient = useQueryClient()

  // Badges dinâmicos em tempo real para o menu lateral (H1 Visibilidade)
  const { data: badges } = useQuery<AdminBadgesResponse>({
    queryKey: ["admin", "badges"],
    queryFn: () => apiGet<AdminBadgesResponse>("/api/admin/badges"),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  // Sincronização do Cenário Investidor (1-Clique — H3, H7)
  const demoSeedMutation = useMutation({
    mutationFn: () =>
      apiPost<{
        ok: boolean
        message: string
        city: string
        bookingsSummary: {
          inProgress: number
          confirmedToday: number
          readyEscrowRelease: number
          settled: number
        }
      }>("/api/admin/demo/seed", {}),
    onSuccess: (data) => {
      toast.success("Cenário de Demonstração Ativado!", {
        description: `${data.message} (${data.bookingsSummary.inProgress} em rota na Torre de Controle, 1 pronto para liberação de custódia).`,
      })
      queryClient.invalidateQueries()
    },
    onError: () => {
      toast.error("Não foi possível carregar o cenário de demonstração.")
    },
  })

  // Mapeia badges dinâmicos para cada item de navegação
  const dynamicNavGroups = React.useMemo(() => {
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.map((item) => {
        let badge: string | number | undefined = undefined
        if (item.view === "admin.taxonomy") badge = badges?.taxonomy ?? 129
        if (item.view === "admin.services" && typeof badges?.services === "number")
          badge = badges.services
        if (
          item.view === "admin.verifications" &&
          typeof badges?.pendingKyc === "number" &&
          badges.pendingKyc > 0
        )
          badge = badges.pendingKyc
        if (
          item.view === "admin.bookings" &&
          typeof badges?.activeBookings === "number" &&
          badges.activeBookings > 0
        )
          badge = badges.activeBookings
        if (
          item.view === "admin.disputes" &&
          typeof badges?.openDisputes === "number" &&
          badges.openDisputes > 0
        )
          badge = badges.openDisputes
        if (
          item.view === "admin.operations" &&
          typeof badges?.activeBookings === "number" &&
          badges.activeBookings > 0
        )
          badge = badges.activeBookings
        if (item.view === "admin.providers" && typeof badges?.verifiedProviders === "number")
          badge = badges.verifiedProviders
        return { ...item, badge }
      }),
    }))
  }, [badges])

  const headerActions = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => demoSeedMutation.mutate()}
      disabled={demoSeedMutation.isPending}
      className="h-8 gap-1.5 rounded-xl border-amber-500/40 bg-amber-500/10 text-xs font-medium text-amber-700 shadow-xs transition-all hover:bg-amber-500/20 dark:text-amber-300"
      title="Injeta dados reais de simulação em Governador Valadares para apresentação a investidores"
    >
      {demoSeedMutation.isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Sparkles className="size-3.5 text-amber-600 dark:text-amber-400" />
      )}
      <span className="hidden sm:inline">Modo Investidor (Piloto GV)</span>
      <span className="sm:hidden">Demo GV</span>
    </Button>
  )

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
      navGroups={dynamicNavGroups}
      navItems={NAV_ITEMS}
      currentView={view}
      title={meta.title}
      subtitle={meta.subtitle}
      breadcrumbs={meta.breadcrumbs}
      panelLabel="Painel do Administrador"
      panelIcon={ShieldAlert}
      headerActions={headerActions}
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

export default AdminPanel
