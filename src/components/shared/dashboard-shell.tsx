"use client"

/**
 * DashboardShell — reusable sidebar + topbar layout for all panels
 * (client / provider / admin).
 *
 * Props:
 *  - navItems:        primary navigation (label, icon, view, optional badge)
 *  - currentView:     dotted view id (e.g. "client.dashboard")
 *  - title:           page title shown in the topbar
 *  - subtitle?:       smaller subtitle under the title
 *  - breadcrumbs?:    optional list of { label, onClick? } shown above title
 *  - panelLabel:      short label shown in the sidebar header (e.g. "Painel do Cliente")
 *  - panelIcon:       Lucide icon for the sidebar header
 *  - user:            { name, email, role, avatarUrl? } for avatar dropdown + sidebar footer
 *  - onNavigate(view): called when a nav item is clicked
 *  - children:        main content
 *
 * The shell DOES NOT include the marketing footer — instead it renders a
 * thin copyright bar at the bottom of the main content area.
 */

import * as React from "react"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import {
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  Menu,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { APP_NAME, ROLE_LABELS, NOTIFICATION_TYPE_LABELS } from "@/lib/constants"
import { formatRelative } from "@/lib/format"
import { apiGet, apiPatch } from "@/lib/api"
import { useTransactionNotificationSound, useWelcomeSound } from "@/lib/use-coin-sound"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { MuteIndicator } from "@/components/shared/mute-indicator"
import { VibrationIndicator } from "@/components/shared/vibration-indicator"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NavItem = {
  label: string
  icon: LucideIcon
  view: string
  badge?: number | string
}

export type Breadcrumb = { label: string; onClick?: () => void }

type ShellUser = {
  id?: string
  name?: string | null
  email?: string | null
  role?: "CLIENT" | "PROVIDER" | "ADMIN"
  avatarUrl?: string | null
}

export type DashboardShellProps = {
  navItems: NavItem[]
  currentView: string
  title: string
  subtitle?: string
  breadcrumbs?: Breadcrumb[]
  panelLabel: string
  panelIcon: LucideIcon
  user?: ShellUser | null
  onNavigate: (view: string) => void
  children: React.ReactNode
  className?: string
}

// ---------------------------------------------------------------------------
// Notification type (matches /api/notifications response)
// ---------------------------------------------------------------------------

type NotificationItem = {
  id: string
  type: string
  title: string
  body?: string | null
  read: boolean
  createdAt: string
}

type NotificationsResponse = {
  items: NotificationItem[]
  total: number
  page: number
  limit: number
  unreadCount: number
}

// ---------------------------------------------------------------------------
// Notification route map — mapeia tipo da notificação pra view do app
// ---------------------------------------------------------------------------

const NOTIFICATION_ROUTES: Record<string, string> = {
  BOOKING_CONFIRMED: "client.bookings",
  BOOKING_CANCELLED: "client.bookings",
  BOOKING_COMPLETED: "client.bookings",
  QUOTE_RECEIVED: "client.quotes",
  QUOTE_APPROVED: "client.quotes",
  MESSAGE: "client.messages",
  REVIEW_RECEIVED: "client.reviews",
  WELCOME: "client.dashboard",
  BOOKING_CREATED: "provider.agenda",
  PAYMENT_CONFIRMED: "client.payments",
  ADMIN_MANUAL: "client.dashboard",
  PROMOTION: "vitrine",
  REMINDER: "client.bookings",
  UPDATE: "client.dashboard",
}

/** Agrupa notificações por período: Hoje, Ontem, Esta semana, Este mês, Anterior */
function groupNotificationsByDate(
  items: NotificationItem[],
): Array<{ label: string; items: NotificationItem[] }> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const thisWeekStart = new Date(today)
  thisWeekStart.setDate(thisWeekStart.getDate() - today.getDay()) // domingo
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const groups: Record<string, NotificationItem[]> = {
    today: [],
    yesterday: [],
    week: [],
    month: [],
    older: [],
  }

  for (const item of items) {
    const d = new Date(item.createdAt)
    if (d >= today) {
      groups.today.push(item)
    } else if (d >= yesterday) {
      groups.yesterday.push(item)
    } else if (d >= thisWeekStart) {
      groups.week.push(item)
    } else if (d >= thisMonthStart) {
      groups.month.push(item)
    } else {
      groups.older.push(item)
    }
  }

  const labels: Record<string, string> = {
    today: "Hoje",
    yesterday: "Ontem",
    week: "Esta semana",
    month: "Este mês",
    older: "Anterior",
  }

  return Object.entries(groups)
    .filter(([, groupItems]) => groupItems.length > 0)
    .map(([key, groupItems]) => ({ label: labels[key], items: groupItems }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name?: string | null): string {
  if (!name) return "?"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

const DASHBOARD_VIEW: Record<string, string> = {
  CLIENT: "client.dashboard",
  PROVIDER: "provider.dashboard",
  ADMIN: "admin.dashboard",
}

// Reusable motion presets for staggered card mount.
const cardMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
} as const

// ---------------------------------------------------------------------------
// Shared nav item styles — used by both desktop SidebarMenuButton and mobile Sheet
// ---------------------------------------------------------------------------

const NAV_ITEM_ACTIVE = "!bg-primary/5 !text-foreground font-medium hover:!bg-primary/8"

const NAV_ITEM_INACTIVE = "!text-muted-foreground hover:!bg-accent/60 hover:!text-foreground"

const NAV_ICON_ACTIVE = "!text-primary"

const NAV_ICON_INACTIVE = "!text-muted-foreground"

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardShell({
  navItems,
  currentView,
  title,
  subtitle,
  breadcrumbs,
  panelLabel,
  panelIcon: PanelIcon,
  user,
  onNavigate,
  children,
  className,
}: DashboardShellProps) {
  const qc = useQueryClient()
  const logout = useAuthStore((s) => s.logout)
  const navigate = useViewStore((s) => s.navigate)
  const { resolvedTheme, setTheme } = useTheme()
  const [mobileOpen, setMobileOpen] = React.useState(false)

  // ---- Notifications query (auto-refresh 30s) -------------------------------
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
      await Promise.all(ids.map((id) => apiPatch(`/api/notifications/${id}/read`)))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] })
    },
  })

  const unreadCount = notificationsQuery.data?.unreadCount ?? 0
  const notifItems = notificationsQuery.data?.items ?? []

  // ---- Favicon badge — mostra contador de não lidas na aba do navegador --
  useFaviconBadge(unreadCount)

  // ---- Coin sound on new transaction notifications (auto-detected) ----------
  useTransactionNotificationSound(notifItems, user?.role)

  // ---- Welcome sound on first panel entry (once per browser) ---------------
  useWelcomeSound()

  const handleNav = (view: string) => {
    setMobileOpen(false)
    onNavigate(view)
  }

  // ---- Sidebar header -------------------------------------------------------
  const sidebarHeader = (
    <SidebarHeader className="pb-0">
      <div className="flex items-center gap-3 px-3 pt-3 pb-4">
        <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-xl">
          <PanelIcon className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="text-foreground truncate text-sm font-bold tracking-tight">{APP_NAME}</p>
          <p className="text-muted-foreground/70 truncate text-[11px] font-medium">{panelLabel}</p>
        </div>
      </div>
      <SidebarSeparator className="mx-3 w-auto" />
    </SidebarHeader>
  )

  // ---- Sidebar nav (desktop) -----------------------------------------------
  const navList = (
    <SidebarGroup>
      <SidebarGroupLabel className="text-muted-foreground/70 h-7 px-3 text-[11px] font-medium tracking-wider uppercase">
        Navegação
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-px px-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = currentView === item.view
            return (
              <SidebarMenuItem key={item.view}>
                <SidebarMenuButton
                  isActive={active}
                  onClick={() => handleNav(item.view)}
                  tooltip={item.label}
                  size="lg"
                  className={cn(
                    "relative h-10 rounded-lg text-sm font-normal transition-colors duration-150",
                    active ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE,
                  )}
                >
                  <Icon
                    className={cn(
                      "!size-[18px] shrink-0 transition-colors duration-150",
                      active ? NAV_ICON_ACTIVE : NAV_ICON_INACTIVE,
                    )}
                  />
                  <span className="truncate text-[14px]">{item.label}</span>
                  {item.badge != null && item.badge !== 0 ? (
                    <span className="bg-primary text-primary-foreground ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold">
                      {item.badge}
                    </span>
                  ) : null}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )

  // ---- Sidebar footer -------------------------------------------------------
  const sidebarFooter = (
    <SidebarFooter className="mt-auto">
      <SidebarSeparator className="mx-3 w-auto" />
      <div className="border-border/50 flex items-center gap-3 rounded-lg border p-2.5">
        <Avatar className="size-8 shrink-0">
          {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name ?? ""} /> : null}
          <AvatarFallback className="bg-primary text-primary-foreground text-[11px] font-semibold">
            {initials(user?.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-[13px] leading-tight font-medium">
            {user?.name ?? "Visitante"}
          </p>
          {user?.role ? (
            <Badge variant="secondary" className="mt-1 h-4 px-1.5 text-[10px] font-medium">
              {ROLE_LABELS[user.role]}
            </Badge>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-8 shrink-0 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30"
          onClick={() => logout()}
          aria-label="Sair"
          title="Sair"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </SidebarFooter>
  )

  // ---- Mobile nav items (shared styling) ------------------------------------
  const mobileNavItems = navItems.map((item) => {
    const Icon = item.icon
    const active = currentView === item.view
    return (
      <button
        key={item.view}
        type="button"
        onClick={() => handleNav(item.view)}
        className={cn(
          "flex h-10 w-full min-w-0 items-center gap-3 rounded-lg px-3 text-sm font-normal transition-colors duration-150 outline-none",
          active
            ? "bg-primary/5 text-foreground font-medium"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <Icon
          className={cn(
            "!size-[18px] shrink-0 transition-colors duration-150",
            active ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="truncate text-[14px]">{item.label}</span>
        {item.badge != null && item.badge !== 0 ? (
          <span className="bg-primary text-primary-foreground ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold">
            {item.badge}
          </span>
        ) : null}
      </button>
    )
  })

  // ---- Mobile sidebar user footer -------------------------------------------
  const mobileFooter = (
    <div className="border-t">
      <div className="border-border/50 flex items-center gap-3 rounded-lg border p-2.5">
        <Avatar className="size-8 shrink-0">
          {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name ?? ""} /> : null}
          <AvatarFallback className="bg-primary text-primary-foreground text-[11px] font-semibold">
            {initials(user?.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-[13px] leading-tight font-medium">
            {user?.name ?? "Visitante"}
          </p>
          {user?.role ? (
            <Badge variant="secondary" className="mt-1 h-4 px-1.5 text-[10px] font-medium">
              {ROLE_LABELS[user.role]}
            </Badge>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-8 shrink-0 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30"
          onClick={() => {
            setMobileOpen(false)
            logout()
          }}
          aria-label="Sair"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </div>
  )

  return (
    <SidebarProvider style={{ "--sidebar-width": "16.25rem" } as React.CSSProperties}>
      <div className={cn("bg-background flex min-h-svh w-full flex-col", className)}>
        <div className="flex flex-1">
          {/* Desktop sidebar */}
          <Sidebar collapsible="icon" className="border-border/50 border-r">
            {sidebarHeader}
            <SidebarContent>{navList}</SidebarContent>
            {sidebarFooter}
          </Sidebar>

          {/* Mobile sidebar (Sheet) */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent
              side="left"
              className="border-border/50 w-[80vw] border-r p-0 sm:max-w-sm"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>{panelLabel}</SheetTitle>
              </SheetHeader>
              <div className="flex h-full flex-col">
                {/* Mobile header — same design as desktop */}
                <div className="border-border/50 flex items-center gap-3 border-b px-4 py-4">
                  <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-xl">
                    <PanelIcon className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-bold tracking-tight">
                      {APP_NAME}
                    </p>
                    <p className="text-muted-foreground/70 truncate text-[11px] font-medium">
                      {panelLabel}
                    </p>
                  </div>
                </div>
                {/* Mobile nav */}
                <ScrollArea className="flex-1">
                  <div className="flex flex-col gap-px p-3">
                    <p className="text-muted-foreground/70 mb-2 px-3 text-[11px] font-medium tracking-wider uppercase">
                      Navegação
                    </p>
                    {mobileNavItems}
                  </div>
                </ScrollArea>
                {/* Mobile wallet balance — provider only */}
                {user?.role === "PROVIDER" ? (
                  <div className="border-t px-3 py-3">
                    <WalletBalancePill />
                  </div>
                ) : null}
                {/* Mobile footer */}
                <div className="p-3">{mobileFooter}</div>
              </div>
            </SheetContent>
          </Sheet>

          {/* Main inset */}
          <SidebarInset>
            {/* Topbar */}
            <header className="border-border/50 bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 flex h-14 items-center border-b px-4 backdrop-blur-md lg:px-6">
              {/* Left section */}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {/* Mobile menu button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground size-9 lg:hidden"
                  onClick={() => setMobileOpen(true)}
                  aria-label="Abrir menu"
                >
                  <Menu className="size-5" />
                </Button>

                {/* Desktop sidebar trigger */}
                <SidebarTrigger className="text-muted-foreground hover:text-foreground hidden size-9 lg:flex" />

                {/* Title block */}
                <div className="min-w-0">
                  {breadcrumbs && breadcrumbs.length > 0 ? (
                    <nav
                      aria-label="Trilha de navegação"
                      className="text-muted-foreground flex items-center gap-1 text-xs"
                    >
                      {breadcrumbs.map((b, i) => (
                        <React.Fragment key={i}>
                          {b.onClick ? (
                            <button
                              type="button"
                              onClick={b.onClick}
                              className="hover:text-foreground transition-colors outline-none focus-visible:underline"
                            >
                              {b.label}
                            </button>
                          ) : (
                            <span>{b.label}</span>
                          )}
                          {i < breadcrumbs.length - 1 ? (
                            <ChevronRight className="text-muted-foreground/50 size-3" />
                          ) : null}
                        </React.Fragment>
                      ))}
                    </nav>
                  ) : null}
                  <h1 className="text-foreground truncate text-lg font-semibold tracking-tight">
                    {title}
                  </h1>
                  {subtitle ? (
                    <p className="text-muted-foreground hidden truncate text-sm md:block">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Right section */}
              <div className="flex items-center gap-0.5">
                {/* Wallet balance — provider only */}
                {user?.role === "PROVIDER" ? <WalletBalancePill /> : null}

                {/* Sound indicator */}
                <MuteIndicator />

                {/* Vibration indicator */}
                <VibrationIndicator />

                {/* Theme toggle */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground size-9"
                  onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  aria-label="Alternar tema"
                  title="Alternar tema"
                >
                  <Sun className="size-[18px] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
                  <Moon className="absolute size-[18px] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
                </Button>

                {/* Notifications */}
                <NotificationsBell
                  items={notifItems}
                  unreadCount={unreadCount}
                  isLoading={notificationsQuery.isLoading}
                  onMarkRead={(id) => markReadMutation.mutate(id)}
                  onMarkAllRead={(ids) => markAllReadMutation.mutate(ids)}
                  markingAll={markAllReadMutation.isPending}
                  onNavigate={navigate}
                />

                {/* Divider before user avatar */}
                <Separator orientation="vertical" className="bg-border/50 mx-1.5 h-5" />

                {/* User dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="hover:bg-accent focus-visible:ring-ring flex items-center gap-1.5 rounded-full p-0.5 transition outline-none focus-visible:ring-2"
                      aria-label="Menu da conta"
                    >
                      <Avatar className="size-8">
                        {user?.avatarUrl ? (
                          <AvatarImage src={user.avatarUrl} alt={user.name ?? ""} />
                        ) : null}
                        <AvatarFallback className="bg-primary text-primary-foreground text-[11px] font-semibold">
                          {initials(user?.name)}
                        </AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel className="flex flex-col gap-1">
                      <span className="truncate">{user?.name}</span>
                      <span className="text-muted-foreground truncate text-xs font-normal">
                        {user?.email}
                      </span>
                      {user?.role ? (
                        <Badge variant="secondary" className="mt-1 w-fit text-[10px]">
                          {ROLE_LABELS[user.role]}
                        </Badge>
                      ) : null}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        if (user?.role) navigate(DASHBOARD_VIEW[user.role])
                      }}
                    >
                      <LayoutDashboard className="size-4" />
                      Meu painel
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        navigate("vitrine")
                      }}
                    >
                      <MapPin className="size-4" />
                      Voltar à vitrine
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => logout()}>
                      <LogOut className="size-4" />
                      Sair
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            {/* Main scroll area */}
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-7xl p-6 lg:p-8">{children}</div>

              {/* Thin copyright bar */}
              <footer className="border-border/50 mt-auto border-t">
                <div className="text-muted-foreground mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-1 px-6 py-3 text-xs sm:flex-row">
                  <p>
                    © {new Date().getFullYear()} {APP_NAME}. Todos os direitos reservados.
                  </p>
                  <p className="flex items-center gap-1.5">
                    <MapPin className="text-primary size-3" />
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

import { WalletBalancePill } from "@/components/shared/wallet-balance-pill"
import { useFaviconBadge } from "@/hooks/use-favicon-badge"
// ---------------------------------------------------------------------------
// NotificationsBell — dropdown list of recent notifications
// ---------------------------------------------------------------------------

function NotificationsBell({
  items,
  unreadCount,
  isLoading,
  onMarkRead,
  onMarkAllRead,
  markingAll,
  onNavigate,
}: {
  items: NotificationItem[]
  unreadCount: number
  isLoading: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: (ids: string[]) => void
  markingAll: boolean
  onNavigate: (view: string) => void
}) {
  const unreadIds = React.useMemo(() => items.filter((n) => !n.read).map((n) => n.id), [items])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground relative size-9"
          aria-label={`Notificações${unreadCount > 0 ? ` (${unreadCount} não lidas)` : ""}`}
        >
          <Bell className="size-[18px]" />
          {unreadCount > 0 ? (
            <span
              className="bg-primary text-primary-foreground ring-background absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ring-2"
              aria-hidden
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Notificações</p>
            {unreadCount > 0 ? (
              <Badge
                variant="secondary"
                className="bg-primary/10 text-primary h-5 px-1.5 text-[10px] font-semibold"
              >
                {unreadCount} nova{unreadCount > 1 ? "s" : ""}
              </Badge>
            ) : null}
          </div>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => onMarkAllRead(unreadIds)}
              disabled={markingAll}
              className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              {markingAll ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <CheckCheck className="size-3.5" />
              )}
              Marcar todas
            </button>
          ) : null}
        </div>

        <ScrollArea className="max-h-80">
          {isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
                <Bell className="size-5" />
              </span>
              <p className="text-muted-foreground text-sm">Você não tem notificações.</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {groupNotificationsByDate(items).map((group) => (
                <div key={group.label}>
                  <div className="bg-popover text-muted-foreground sticky top-0 z-10 px-3 py-1.5 text-[10px] font-medium tracking-wider uppercase">
                    {group.label}
                  </div>
                  <ul className="divide-y">
                    {group.items.map((n) => {
                      const typeLabel = NOTIFICATION_TYPE_LABELS[n.type]
                      const targetRoute = NOTIFICATION_ROUTES[n.type]
                      return (
                        <li
                          key={n.id}
                          className={cn(
                            "relative flex gap-3 px-3 py-2.5 transition-colors",
                            !n.read && "bg-primary/5",
                            targetRoute && "hover:bg-accent/50 cursor-pointer",
                          )}
                          onClick={() => {
                            if (targetRoute) {
                              onNavigate(targetRoute)
                            }
                          }}
                          onKeyDown={(e) => {
                            if ((e.key === "Enter" || e.key === " ") && targetRoute) {
                              e.preventDefault()
                              onNavigate(targetRoute)
                            }
                          }}
                          role={targetRoute ? "button" : undefined}
                          tabIndex={targetRoute ? 0 : undefined}
                          title={targetRoute ? `Ir para ${typeLabel ?? targetRoute}` : undefined}
                        >
                          <span
                            className={cn(
                              "mt-1.5 size-2 shrink-0 rounded-full",
                              n.read ? "ring-border bg-transparent ring-1" : "bg-primary",
                            )}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="text-sm leading-tight font-medium">{n.title}</p>
                              <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                                {formatRelative(n.createdAt)}
                              </span>
                            </div>
                            {n.body ? (
                              <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                                {n.body}
                              </p>
                            ) : null}
                            <div className="mt-1 flex items-center gap-2">
                              {typeLabel ? (
                                <Badge
                                  variant="outline"
                                  className="text-muted-foreground h-4 px-1.5 text-[10px] font-medium"
                                >
                                  {typeLabel}
                                </Badge>
                              ) : null}
                              {!n.read ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onMarkRead(n.id)
                                  }}
                                  className="text-primary inline-flex items-center gap-1 text-[10px] font-medium hover:underline"
                                >
                                  <Check className="size-3" />
                                  Marcar como lida
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// Shared small UI helpers used by the panel views
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("bg-muted/30 border-dashed py-10 text-center", className)}>
      <CardContent className="flex flex-col items-center gap-3">
        <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full">
          <Icon className="size-7" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold">{title}</p>
          {description ? (
            <p className="text-muted-foreground mx-auto max-w-md text-sm">{description}</p>
          ) : null}
        </div>
        {action}
      </CardContent>
    </Card>
  )
}

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "primary",
  index = 0,
  trend,
}: {
  icon: LucideIcon
  label: string
  value: React.ReactNode
  hint?: string
  tone?: "primary" | "amber" | "sky" | "rose" | "zinc"
  /** Index for staggered mount animation (0-based). */
  index?: number
  /** Optional trend indicator shown next to the value. */
  trend?: { direction: "up" | "down"; label: string }
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    sky: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200",
  }[tone]
  return (
    <motion.div
      initial={cardMotion.initial}
      animate={cardMotion.animate}
      transition={{ delay: index * 0.05, duration: 0.25, ease: "easeOut" }}
    >
      <Card className="bg-card rounded-xl shadow-sm transition-shadow hover:shadow-md">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <span className={cn("flex size-10 items-center justify-center rounded-lg", toneClass)}>
              <Icon className="size-5" />
            </span>
            {trend ? (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  trend.direction === "up"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                    : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
                )}
              >
                {trend.direction === "up" ? "↑" : "↓"} {trend.label}
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
          <p className="text-muted-foreground mt-1 text-xs font-medium tracking-wide uppercase">
            {label}
          </p>
          {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-foreground text-base font-semibold tracking-tight md:text-lg">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground truncate text-xs">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export { Separator }
