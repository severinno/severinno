"use client"

/**
 * AppShell — the full client-side SPA shell.
 *
 * Extracted from page.tsx to enable the home page to be a Server Component
 * with SSR Streaming. This component handles all interactive concerns:
 *   - View routing (vitrine / client / provider / admin)
 *   - Auth check and guards
 *   - Realtime connection
 *   - Modal mounting
 */

import { useEffect, useSyncExternalStore } from "react"
import dynamic from "next/dynamic"

import { useAuthStore } from "@/store/auth"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"
import { useRealtime } from "@/hooks/use-realtime"

import { ErrorBoundary } from "@/components/shared/error-boundary"

// Lazy-loaded panels (code-split)
const Vitrine = dynamic(() => import("@/components/vitrine/vitrine"))
const ClientPanel = dynamic(() =>
  import("@/components/client/client-panel").then((m) => m.ClientPanel),
)
const ProviderPanel = dynamic(() =>
  import("@/components/provider/provider-panel").then((m) => m.ProviderPanel),
)
const AdminPanel = dynamic(() => import("@/components/admin/admin-panel").then((m) => m.AdminPanel))
const ModalsHost = dynamic(
  () => import("@/components/modals/modals-host").then((m) => m.ModalsHost),
  { ssr: false },
)

const useHydrated = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

export default function AppShell() {
  const mounted = useHydrated()

  const view = useViewStore((s) => s.view)
  const reset = useViewStore((s) => s.reset)
  const user = useAuthStore((s) => s.user)
  const initialized = useAuthStore((s) => s.initialized)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const openAuth = useUIStore((s) => s.openAuth)

  const { join } = useRealtime()

  // Initial auth check
  useEffect(() => {
    void fetchMe()
  }, [fetchMe])

  // Auth guard for panel views
  useEffect(() => {
    if (!mounted || !initialized) return
    if (view.startsWith("client.") && (!user || user.role !== "CLIENT")) {
      reset("vitrine")
      openAuth("login", "CLIENT")
      return
    }
    if (view.startsWith("provider.") && (!user || user.role !== "PROVIDER")) {
      reset("vitrine")
      openAuth("login", "PROVIDER")
      return
    }
    if (view.startsWith("admin.") && (!user || user.role !== "ADMIN")) {
      reset("vitrine")
      openAuth("login", "CLIENT")
      return
    }
  }, [mounted, view, user, initialized, reset, openAuth])

  // Realtime connection
  useEffect(() => {
    if (!user) return
    join({ userId: user.id, role: user.role })
  }, [user, join])

  // Pre-hydration loading shell (matches streaming SSR fallback)
  if (!mounted) {
    return null // page.tsx already renders LoadingShell during SSR
  }

  // Route to the active surface with ErrorBoundary
  let content: React.ReactNode
  if (view.startsWith("client.")) {
    content = (
      <ErrorBoundary label="Painel do Cliente">
        <ClientPanel />
      </ErrorBoundary>
    )
  } else if (view.startsWith("provider.")) {
    content = (
      <ErrorBoundary label="Painel do Prestador">
        <ProviderPanel />
      </ErrorBoundary>
    )
  } else if (view.startsWith("admin.")) {
    content = (
      <ErrorBoundary label="Painel Administrativo">
        <AdminPanel />
      </ErrorBoundary>
    )
  } else {
    content = (
      <ErrorBoundary label="Vitrine">
        <Vitrine />
      </ErrorBoundary>
    )
  }

  return (
    <div className="bg-background flex min-h-screen flex-col">
      {content}
      <ModalsHost />
    </div>
  )
}
