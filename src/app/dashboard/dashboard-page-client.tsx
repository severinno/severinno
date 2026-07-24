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
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const Panel =
    user.role === "ADMIN" ? AdminPanel :
    user.role === "PROVIDER" ? ProviderPanel :
    ClientPanel

  return <Panel />
}
