"use client"

/**
 * DashboardShell — reusable sidebar + topbar layout for all panels
 * (client / provider / admin).
 *
 * Modular Architecture:
 *   - ShellSidebar       → Sidebar desktop com navegação, branding e footer
 *   - ShellMobileSheet   → Gaveta mobile com navegação e saldo de carteira
 *   - ShellHeader        → Barra superior com breadcrumbs, indicadores e ações
 *   - NotificationsBell  → Dropdown de notificações com agrupamento por período
 *   - EmptyState/StatCard → Helpers de UI para cards e estados vazios
 */

import * as React from "react"
import { MapPin } from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { APP_NAME } from "@/lib/constants"
import { apiGet, apiPatch } from "@/lib/api"
import {
  useTransactionNotificationSound,
  useWelcomeSound,
} from "@/lib/use-coin-sound"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { useFaviconBadge } from "@/hooks/use-favicon-badge"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

import {
  type DashboardShellProps,
  type NotificationsResponse,
  type NavItem,
  type Breadcrumb,
  ShellSidebar,
  ShellMobileSheet,
  ShellHeader,
  EmptyState,
  StatCard,
  SectionTitle,
} from "./shell/index"

export type { NavItem, Breadcrumb, DashboardShellProps }
export { EmptyState, StatCard, SectionTitle, Separator }

export function DashboardShell({
  navItems,
  currentView,
  title,
  subtitle,
  breadcrumbs,
  panelLabel,
  panelIcon,
  user,
  onNavigate,
  children,
  className,
}: DashboardShellProps) {
  const qc = useQueryClient()
  const logout = useAuthStore((s) => s.logout)
  const navigate = useViewStore((s) => s.navigate)
  const [mobileOpen, setMobileOpen] = React.useState(false)

  // Notifications query (auto-refresh 30s)
  const notificationsQuery = useQuery<NotificationsResponse>({
    queryKey: ["notifications", "topbar"],
    queryFn: () => apiGet<NotificationsResponse>("/api/notifications"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiPatch(`/api/notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] })
    },
  })

  const markAllReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) => apiPatch(`/api/notifications/${id}/read`)),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] })
    },
  })

  const unreadCount = notificationsQuery.data?.unreadCount ?? 0
  const notifItems = notificationsQuery.data?.items ?? []

  useFaviconBadge(unreadCount)
  useTransactionNotificationSound(notifItems, user?.role)
  useWelcomeSound()

  const handleNav = (view: string) => {
    setMobileOpen(false)
    onNavigate(view)
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": "16.25rem" } as React.CSSProperties}
    >
      <div
        className={cn(
          "flex min-h-svh w-full flex-col bg-background",
          className,
        )}
      >
        <div className="flex flex-1">
          {/* Desktop sidebar */}
          <ShellSidebar
            navItems={navItems}
            currentView={currentView}
            panelLabel={panelLabel}
            panelIcon={panelIcon}
            user={user}
            onNavigate={handleNav}
            onLogout={logout}
          />

          {/* Mobile sidebar (Sheet) */}
          <ShellMobileSheet
            open={mobileOpen}
            onOpenChange={setMobileOpen}
            navItems={navItems}
            currentView={currentView}
            panelLabel={panelLabel}
            panelIcon={panelIcon}
            user={user}
            onNavigate={handleNav}
            onLogout={logout}
          />

          {/* Main inset */}
          <SidebarInset>
            {/* Topbar Header */}
            <ShellHeader
              title={title}
              subtitle={subtitle}
              breadcrumbs={breadcrumbs}
              user={user}
              onOpenMobile={() => setMobileOpen(true)}
              notifications={notifItems}
              unreadCount={unreadCount}
              notificationsLoading={notificationsQuery.isLoading}
              onMarkRead={(id) => markReadMutation.mutate(id)}
              onMarkAllRead={(ids) => markAllReadMutation.mutate(ids)}
              markingAll={markAllReadMutation.isPending}
              onNavigate={navigate}
              onLogout={logout}
            />

            {/* Main scroll area */}
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-7xl p-6 lg:p-8">
                {children}
              </div>

              {/* Thin copyright bar */}
              <footer className="mt-auto border-t border-border/50">
                <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-1 px-6 py-3 text-xs text-muted-foreground sm:flex-row">
                  <p>
                    © {new Date().getFullYear()} {APP_NAME}. Todos os direitos
                    reservados.
                  </p>
                  <p className="flex items-center gap-1.5">
                    <MapPin className="size-3 text-primary" />
                    Marketplace de serviços com geolocalização
                  </p>
                </div>
              </footer>
            </main>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  )
}