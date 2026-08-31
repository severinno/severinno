"use client"

/**
 * AppShell — the full client-side SPA shell.
 *
 * Renders the active surface on both server and client:
 *   - Server: streams real vitrine HTML (SEO + LCP) for the default
 *     view, then the interactive bundle hydrates.
 *   - Client: view routing (vitrine / client / provider / admin),
 *     auth check and guards, realtime connection, modal mounting.
 */

import { useEffect, useCallback } from "react"
import dynamic from "next/dynamic"
import * as Sentry from "@sentry/nextjs"

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

export default function AppShell() {
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
    if (!initialized) return
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
  }, [view, user, initialized, reset, openAuth])

  // Realtime connection
  useEffect(() => {
    if (!user) return
    join({ userId: user.id, role: user.role })
  }, [user, join])

  // Send errors to GlitchTip/Sentry
  const handleBoundaryError = useCallback((error: Error, errorInfo: React.ErrorInfo) => {
    Sentry.withScope((scope) => {
      scope.setExtras({ componentStack: errorInfo.componentStack, view })
      scope.setTag("surface", view.split(".")[0] ?? "unknown")
      scope.setTag("environment", process.env.NODE_ENV ?? "development")
      Sentry.captureException(error)
    })
  }, [view])

  // Route to the active surface with ErrorBoundary
  let content: React.ReactNode
  if (view.startsWith("client.")) {
    content = (
      <ErrorBoundary label="Painel do Cliente" onError={handleBoundaryError}>
        <ClientPanel />
      </ErrorBoundary>
    )
  } else if (view.startsWith("provider.")) {
    content = (
      <ErrorBoundary label="Painel do Prestador" onError={handleBoundaryError}>
        <ProviderPanel />
      </ErrorBoundary>
    )
  } else if (view.startsWith("admin.")) {
    content = (
      <ErrorBoundary label="Painel Administrativo" onError={handleBoundaryError}>
        <AdminPanel />
      </ErrorBoundary>
    )
  } else {
    content = (
      <ErrorBoundary label="Vitrine" onError={handleBoundaryError}>
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
