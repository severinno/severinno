"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { ClientPanel } from "@/components/client/client-panel"
import { ProviderPanel } from "@/components/provider/provider-panel"
import { AdminPanel } from "@/components/admin/admin-panel"
import { Loader2 } from "lucide-react"

export function DashboardPageClient({
  // Countdown inicial vindo do SSR (getSessionExpiresAt no page.tsx): o auth
  // store é semeado com o expiresAt do cookie ANTES do fetchMe resolver, então
  // o banner/pill de sessão renderiza no primeiro paint sem flash de loading.
  initialSessionExpiresAt = null,
}: {
  initialSessionExpiresAt?: number | null
}) {
  const router = useRouter()
  const status = useAuthStore((s) => s.status)
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const seedSessionExpiry = useAuthStore((s) => s.seedSessionExpiry)
  const navigate = useViewStore((s) => s.navigate)

  // Semeia o countdown do SSR logo no mount (antes/em paralelo ao fetchMe).
  // seedSessionExpiry só preenche se o store ainda estiver null — um valor
  // já resolvido (ex.: fetchMe mais rápido) nunca é sobrescrito.
  useEffect(() => {
    if (initialSessionExpiresAt != null) {
      seedSessionExpiry(initialSessionExpiresAt)
    }
  }, [initialSessionExpiresAt, seedSessionExpiry])

  // Initial auth check — important: the persisted status may be stale
  // ("unauthenticated") from a previous visit; only trust it after fetchMe.
  useEffect(() => {
    void fetchMe()
  }, [fetchMe])

  useEffect(() => {
    if (!initialized) return
    if (status === "unauthenticated") {
      router.push("/?login")
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

  return <Panel />
}
