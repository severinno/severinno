"use client"

import { lazy, Suspense, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { Loader2 } from "lucide-react"

// Lazy-load role-specific panels — only the matching role's code is fetched,
// reducing the initial dashboard bundle by ~60% (2 of 3 panels skipped).
const ClientPanel = lazy(() =>
  import("@/components/client/client-panel").then((m) => ({ default: m.ClientPanel })),
)
const ProviderPanel = lazy(() =>
  import("@/components/provider/provider-panel").then((m) => ({ default: m.ProviderPanel })),
)
const AdminPanel = lazy(() =>
  import("@/components/admin/admin-panel").then((m) => ({ default: m.AdminPanel })),
)

export function DashboardPageClient() {
  const status = useAuthStore((s) => s.status)
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const navigate = useViewStore((s) => s.navigate)
  const router = useRouter()

  // Initial auth check — important: the persisted status may be stale
  // ("unauthenticated") from a previous visit; only trust it after fetchMe.
  useEffect(() => {
    void fetchMe()
  }, [fetchMe])

  useEffect(() => {
    if (!initialized) return
    if (status === "unauthenticated") {
      router.replace("/?login")
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
  }, [initialized, status, user, navigate, router])

  if (!initialized || status === "loading" || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    )
  }

  const Panel =
    user.role === "ADMIN" ? AdminPanel : user.role === "PROVIDER" ? ProviderPanel : ClientPanel

  return (
    <Suspense
      fallback={
        <div className="justify-content-center flex min-h-screen items-center">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      }
    >
      <Panel />
    </Suspense>
  )
}
