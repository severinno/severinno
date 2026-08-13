"use client"

import { useEffect } from "react"
import dynamic from "next/dynamic"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { Loader2 } from "lucide-react"
import { ErrorBoundary } from "@/components/shared/error-boundary"

// The three role panels pull recharts (~122 KB gzip) + dashboard-shell
// into the initial JS of /dashboard when statically imported (measured
// real transfer 623.8 KB). Each panel is only
// needed AFTER the user's role is known, so lazy-load them with ssr:false -
// the prerendered shell shows the spinner and the heavy chunks become
// on-demand fetches. Same pattern as ProvidersMap / TrackingMap.
const ClientPanel = dynamic(
  () => import("@/components/client/client-panel").then((m) => m.ClientPanel),
  { ssr: false, loading: PanelLoader },
)
const ProviderPanel = dynamic(
  () => import("@/components/provider/provider-panel").then((m) => m.ProviderPanel),
  { ssr: false, loading: PanelLoader },
)
const AdminPanel = dynamic(
  () => import("@/components/admin/admin-panel").then((m) => m.AdminPanel),
  { ssr: false, loading: PanelLoader },
)

function PanelLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  )
}

export function DashboardPageClient() {
  const status = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const navigate = useViewStore((s) => s.navigate)

  useEffect(() => {
    if (status === "unauthenticated") {
      window.location.href = "/?login"
      return
    }
    if (user && status === "authenticated") {
      const view =
        user.role === "ADMIN" ? "admin.dashboard" :
        user.role === "PROVIDER" ? "provider.dashboard" :
        "client.dashboard"
      navigate(view)
    }
  }, [status, user, navigate])

  if (status === "loading" || !user) {
    return <PanelLoader />
  }

  const Panel =
    user.role === "ADMIN" ? AdminPanel :
    user.role === "PROVIDER" ? ProviderPanel :
    ClientPanel
  const boundaryLabel =
    user.role === "ADMIN" ? "Painel Administrativo" :
    user.role === "PROVIDER" ? "Painel do Prestador" :
    "Painel do Cliente"

  return (
    <ErrorBoundary label={boundaryLabel}>
      <Panel />
    </ErrorBoundary>
  )
}
