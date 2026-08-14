"use client"

import { useEffect } from "react"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { ClientPanel } from "@/components/client/client-panel"
import { ProviderPanel } from "@/components/provider/provider-panel"
import { AdminPanel } from "@/components/admin/admin-panel"
import { Loader2 } from "lucide-react"

export function DashboardPageClient() {
  const status = useAuthStore((s) => s.status)
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const navigate = useViewStore((s) => s.navigate)

  // Initial auth check — important: the persisted status may be stale
  // ("unauthenticated") from a previous visit; only trust it after fetchMe.
  useEffect(() => {
    void fetchMe()
  }, [fetchMe])

  useEffect(() => {
    if (!initialized) return
    if (status === "unauthenticated") {
      window.location.href = "/?login"
      return
    }
    if (user && status === "authenticated") {
      const view =
        user.role === "ADMIN"
          ? "admin.dashboard"
          : user.role === "PROVIDER"
            ? "provider.dashboard"
            : "client.dashboard"
      navigate(view)
    }
  }, [initialized, status, user, navigate])

  if (!initialized || status === "loading" || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    )
  }

  const Panel =
    user.role === "ADMIN" ? AdminPanel : user.role === "PROVIDER" ? ProviderPanel : ClientPanel

  return <Panel />
}
