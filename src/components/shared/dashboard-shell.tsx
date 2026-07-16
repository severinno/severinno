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
import { useAuthStore, useGeoStore, useViewStore } from "@/store"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
  const { city, status: geoStatus, setFromGPS } = useGeoStore()
  const [locating, setLocating] = React.useState(false)
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

  const handleLocate = React.useCallback(async () => {
    setLocating(true)
    try {
      await setFromGPS()
    } finally {
      setLocating(false)
    }
  }, [setFromGPS])

  const handleNav = (view: string) => {
    setMobileOpen(false)
    onNavigate(view)
  }

  // ---- Sidebar nav (shared between desktop Sidebar and mobile Sheet) -------
  // Note: SidebarMenuButton's default active styles are overridden with `!` to
  // use the emerald-tinted active treatment spec'd for this dashboard.
  const navList = (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {panelLabel}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {navItems.map((item, index) => {
            const Icon = item.icon
            const active = currentView === item.view
            return (
              <SidebarMenuItem key={item.view}>
                <SidebarMenuButton
                  isActive={active}
                  onClick={() => handleNav(item.view)}
                  tooltip={{
                    children: (
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{item.label}</span>
                        <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-white/20 px-1 text-[10px] font-medium text-white/80">
                          {index + 1}
                        </kbd>
                      </span>
                    ),
                    className: "text-sm font-medium px-3.5 py-2 shadow-lg",
                    sideOffset: 8,
                  }}
                  size="lg"
                  className={cn(
                    "relative h-10 rounded-lg text-sm font-normal",
                    active
                      ? "!bg-primary/10 !text-primary font-medium hover:!bg-primary/15 hover:!text-primary"
                      : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.badge != null && item.badge !== 0 ? (
                    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      {item.badge}
                    </span>
                  ) : null}
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                    />
                  ) : null}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )

  const sidebarHeader = (
    <SidebarHeader>
      <div className="flex items-center gap-2.5 px-2 py-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <PanelIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {panelLabel}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {APP_NAME}
          </p>
        </div>
      </div>
    </SidebarHeader>
  )

  const sidebarFooter = (
    <SidebarFooter>
      <div className="flex items-center gap-2.5 rounded-lg border bg-muted/30 p-2">
        <Avatar className="size-9">
          {user?.avatarUrl ? (
            <AvatarImage src={user.avatarUrl} alt={user.name ?? ""} />
          ) : null}
          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
            {initials(user?.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">
            {user?.name ?? "Visitante"}
          </p>
          {user?.role ? (
            <Badge
              variant="secondary"
              className="mt-0.5 h-4 px-1.5 text-[10px] font-medium"
            >
              {ROLE_LABELS[user.role]}
            </Badge>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => logout()}
          aria-label="Sair"
          title="Sair"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </SidebarFooter>
  )

  return (
    <SidebarProvider>
      <div
        className={cn(
          "flex min-h-svh w-full flex-col bg-background",
          className,
        )}
      >
        <div className="flex flex-1">
          {/* Desktop sidebar */}
          <Sidebar collapsible="icon" className="border-r">
            {sidebarHeader}
            <SidebarContent>{navList}</SidebarContent>
            {sidebarFooter}
          </Sidebar>

          {/* Mobile sidebar (Sheet) */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="w-[80vw] border-r p-0 sm:max-w-sm">
              <SheetHeader className="sr-only">
                <SheetTitle>{panelLabel}</SheetTitle>
              </SheetHeader>
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-2.5 border-b p-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                    <PanelIcon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{panelLabel}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {APP_NAME}
                    </p>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <nav className="flex flex-col gap-1 p-2">
                    {navItems.map((item) => {
                      const Icon = item.icon
                      const active = currentView === item.view
                      return (
                        <button
                          key={item.view}
                          type="button"
                          onClick={() => handleNav(item.view)}
                          className={cn(
                            "relative flex h-10 min-w-0 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors",
                            active
                              ? "bg-primary/10 text-primary hover:bg-primary/15"
                              : "text-foreground hover:bg-accent hover:text-accent-foreground",
                          )}
                        >
                          {active ? (
                            <span
                              aria-hidden
                              className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                            />
                          ) : null}
                          <Icon className="size-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                          {item.badge != null && item.badge !== 0 ? (
                            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                              {item.badge}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </nav>
                </ScrollArea>
                <div className="border-t p-3">
                  <div className="flex items-center gap-2.5 rounded-lg border bg-muted/30 p-2">
                    <Avatar className="size-9">
                      {user?.avatarUrl ? (
                        <AvatarImage
                          src={user.avatarUrl}
                          alt={user.name ?? ""}
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                        {initials(user?.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">
                        {user?.name ?? "Visitante"}
                      </p>
                      {user?.role ? (
                        <Badge
                          variant="secondary"
                          className="mt-0.5 h-4 px-1.5 text-[10px] font-medium"
                        >
                          {ROLE_LABELS[user.role]}
                        </Badge>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
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
              </div>
            </SheetContent>
          </Sheet>

          {/* Main inset */}
          <SidebarInset>
            {/* Topbar */}
            <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/65 md:px-4">
              <Button
                variant="ghost"
                size="icon"
                className="size-9 md:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Abrir menu"
              >
                <Menu className="size-5" />
              </Button>
              <SidebarTrigger className="hidden size-9 md:flex" />

              <div className="min-w-0 flex-1">
                {breadcrumbs && breadcrumbs.length > 0 ? (
                  <nav
                    aria-label="Trilha de navegação"
                    className="flex items-center gap-1 text-xs text-muted-foreground"
                  >
                    {breadcrumbs.map((b, i) => (
                      <React.Fragment key={i}>
                        {b.onClick ? (
                          <button
                            type="button"
                            onClick={b.onClick}
                            className="outline-none hover:text-primary focus-visible:underline"
                          >
                            {b.label}
                          </button>
                        ) : (
                          <span>{b.label}</span>
                        )}
                        {i < breadcrumbs.length - 1 ? (
                          <ChevronRight className="size-3" />
                        ) : null}
                      </React.Fragment>
                    ))}
                  </nav>
                ) : null}
                <h1 className="truncate text-base font-semibold tracking-tight text-foreground md:text-lg">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="hidden truncate text-xs text-muted-foreground sm:block">
                    {subtitle}
                  </p>
                ) : null}
              </div>

              {/* Location chip */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLocate}
                disabled={locating || geoStatus === "locating"}
                className="hidden h-9 max-w-[14rem] gap-2 rounded-full border bg-card px-3 sm:flex"
                aria-label="Usar minha localização"
                title="Usar minha localização"
              >
                {locating || geoStatus === "locating" ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <MapPin className="size-4 text-primary" />
                )}
                <span className="truncate text-xs font-medium">
                  {city || "Definir localização"}
                </span>
              </Button>

              {/* Theme toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="size-9 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                aria-label="Alternar tema"
                title="Alternar tema"
              >
                <Sun className="size-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute size-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </Button>

              {/* Notifications */}
              <NotificationsBell
                items={notifItems}
                unreadCount={unreadCount}
                isLoading={notificationsQuery.isLoading}
                onMarkRead={(id) => markReadMutation.mutate(id)}
                onMarkAllRead={(ids) => markAllReadMutation.mutate(ids)}
                markingAll={markAllReadMutation.isPending}
              />

              {/* User dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-full p-0.5 outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Menu da conta"
                  >
                    <Avatar className="size-9">
                      {user?.avatarUrl ? (
                        <AvatarImage
                          src={user.avatarUrl}
                          alt={user.name ?? ""}
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                        {initials(user?.name)}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="flex flex-col gap-1">
                    <span className="truncate">{user?.name}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {user?.email}
                    </span>
                    {user?.role ? (
                      <Badge
                        variant="secondary"
                        className="mt-1 w-fit text-[10px]"
                      >
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
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => logout()}
                  >
                    <LogOut className="size-4" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </header>

            {/* Main scroll area */}
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
                {children}
              </div>

              {/* Thin copyright bar */}
              <footer className="mt-auto border-t bg-card/50">
                <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-1 px-4 py-3 text-xs text-muted-foreground sm:flex-row md:px-6">
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
}: {
  items: NotificationItem[]
  unreadCount: number
  isLoading: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: (ids: string[]) => void
  markingAll: boolean
}) {
  const unreadIds = React.useMemo(
    () => items.filter((n) => !n.read).map((n) => n.id),
    [items],
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9 text-muted-foreground hover:text-foreground"
          aria-label={`Notificações${
            unreadCount > 0 ? ` (${unreadCount} não lidas)` : ""
          }`}
        >
          <Bell className="size-5" />
          {unreadCount > 0 ? (
            <span
              className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-background"
              aria-hidden
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 gap-0 p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Notificações</p>
            {unreadCount > 0 ? (
              <Badge
                variant="secondary"
                className="h-5 bg-primary/10 px-1.5 text-[10px] font-semibold text-primary"
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
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary transition-colors hover:text-primary/80 disabled:opacity-50"
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
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Bell className="size-5" />
              </span>
              <p className="text-sm text-muted-foreground">
                Você não tem notificações.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const typeLabel = NOTIFICATION_TYPE_LABELS[n.type]
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "relative flex gap-3 px-3 py-2.5 transition-colors hover:bg-accent/50",
                      !n.read && "bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        n.read ? "bg-transparent ring-1 ring-border" : "bg-primary",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium leading-tight">
                          {n.title}
                        </p>
                        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                          {formatRelative(n.createdAt)}
                        </span>
                      </div>
                      {n.body ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {n.body}
                        </p>
                      ) : null}
                      <div className="mt-1 flex items-center gap-2">
                        {typeLabel ? (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[10px] font-medium text-muted-foreground"
                          >
                            {typeLabel}
                          </Badge>
                        ) : null}
                        {!n.read ? (
                          <button
                            type="button"
                            onClick={() => onMarkRead(n.id)}
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
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
    <Card
      className={cn(
        "border-dashed bg-muted/30 py-10 text-center",
        className,
      )}
    >
      <CardContent className="flex flex-col items-center gap-3">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-7" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold">{title}</p>
          {description ? (
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              {description}
            </p>
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
      <Card className="rounded-xl bg-card shadow-sm transition-shadow hover:shadow-md">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-lg",
                toneClass,
              )}
            >
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
          <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">
            {value}
          </p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {hint ? (
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          ) : null}
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
        <h2 className="text-base font-semibold tracking-tight text-foreground md:text-lg">
          {title}
        </h2>
        {description ? (
          <p className="truncate text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export { Separator }
