"use client"

import * as React from "react"
import {
  Calendar,
  CalendarCheck,
  CalendarDays,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Search,
  User,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

export type MobileBottomNavItem = {
  view: string
  label: string
  icon: LucideIcon
  badge?: number | string
}

export type MobileBottomNavProps = {
  role?: "CLIENT" | "PROVIDER" | "ADMIN"
  currentView: string
  onNavigate: (view: string) => void
  unreadCount?: number
  className?: string
}

export const CLIENT_BOTTOM_ITEMS: MobileBottomNavItem[] = [
  { view: "client.dashboard", label: "Início", icon: LayoutDashboard },
  { view: "client.providers", label: "Buscar", icon: Search },
  { view: "client.bookings", label: "Reservas", icon: Calendar },
  { view: "client.messages", label: "Mensagens", icon: MessageSquare },
  { view: "client.profile", label: "Perfil", icon: User },
]

export const PROVIDER_BOTTOM_ITEMS: MobileBottomNavItem[] = [
  { view: "provider.dashboard", label: "Painel", icon: LayoutDashboard },
  { view: "provider.agenda", label: "Agenda", icon: CalendarDays },
  { view: "provider.bookings", label: "Chamados", icon: CalendarCheck },
  { view: "provider.messages", label: "Mensagens", icon: MessageSquare },
  { view: "provider.finance", label: "Carteira", icon: Wallet },
]

export const ADMIN_BOTTOM_ITEMS: MobileBottomNavItem[] = [
  { view: "admin.dashboard", label: "Painel", icon: LayoutDashboard },
  { view: "admin.users", label: "Usuários", icon: Users },
  { view: "admin.operations", label: "Operações", icon: Radio },
  { view: "admin.services", label: "Serviços", icon: Wrench },
  { view: "admin.financial", label: "Finanças", icon: Wallet },
]

export function MobileBottomNav({
  role = "CLIENT",
  currentView,
  onNavigate,
  unreadCount = 0,
  className,
}: MobileBottomNavProps) {
  const items = React.useMemo(() => {
    switch (role) {
      case "PROVIDER":
        return PROVIDER_BOTTOM_ITEMS
      case "ADMIN":
        return ADMIN_BOTTOM_ITEMS
      case "CLIENT":
      default:
        return CLIENT_BOTTOM_ITEMS
    }
  }, [role])

  return (
    <nav
      role="navigation"
      aria-label="Navegação inferior mobile"
      data-testid="mobile-bottom-nav"
      className={cn(
        "border-border/60 bg-background/95 fixed right-0 bottom-0 left-0 z-40 border-t backdrop-blur-md [contain:layout_style] lg:hidden",
        "pb-[max(env(safe-area-inset-bottom,0px),8px)] shadow-[0_-4px_16px_rgba(0,0,0,0.04)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.2)]",
        className,
      )}
    >
      <div className="mx-auto flex h-14 max-w-lg items-stretch justify-around px-1">
        {items.map((item) => {
          const Icon = item.icon
          const active = currentView === item.view || currentView.startsWith(`${item.view}.`)
          const showBadge =
            (item.view.includes("messages") || item.view.includes("notifications")) &&
            unreadCount > 0

          return (
            <button
              key={item.view}
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onNavigate(item.view)
              }}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={cn(
                "group relative flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl transition-all duration-150 outline-none active:scale-95",
                active
                  ? "text-primary font-semibold"
                  : "text-muted-foreground/75 hover:text-foreground",
              )}
            >
              <div className="relative flex items-center justify-center">
                <Icon
                  className={cn(
                    "size-5 transition-transform duration-150",
                    active
                      ? "text-primary scale-110"
                      : "text-muted-foreground/80 group-hover:text-foreground",
                  )}
                />
                {showBadge && (
                  <span
                    data-testid="bottom-nav-badge"
                    className="bg-primary text-primary-foreground absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold shadow-xs"
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-[11px] tracking-tight transition-colors duration-150",
                  active ? "text-primary font-bold" : "text-muted-foreground/80 font-medium",
                )}
              >
                {item.label}
              </span>
              {active && (
                <span
                  data-testid="bottom-nav-active-dot"
                  className="bg-primary absolute -bottom-1 h-0.5 w-4 rounded-full"
                />
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
