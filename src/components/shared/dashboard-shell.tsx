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
import {
  ChevronRight,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { APP_NAME, ROLE_LABELS, NOTIFICATION_TYPE_LABELS } from "@/lib/constants"
import { PwaInstallBanner } from "@/components/shared/pwa-install-banner"
import { PushPromptBanner } from "@/components/shared/push-prompt-banner"
import { MobileBottomNav } from "@/components/shared/mobile-bottom-nav"
import { apiGet, apiPatch } from "@/lib/api"
import { triggerHaptic } from "@/lib/haptics"
import { useRealtime } from "@/hooks/use-realtime"
import {
  useCoinSound,
  useTransactionNotificationSound,
  useWelcomeSound,
} from "@/lib/use-coin-sound"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"
import { MuteIndicator } from "@/components/shared/mute-indicator"
import { VibrationIndicator } from "@/components/shared/vibration-indicator"
import { WalletBalancePill } from "@/components/shared/wallet-balance-pill"
import { useFaviconBadge } from "@/hooks/use-favicon-badge"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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

import { NotificationsBell, PushNotificationButton } from "./shell"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NavItem = {
  label: string
  icon: LucideIcon
  view: string
  badge?: number | string
}

export type NavGroup = {
  label: string
  items: NavItem[]
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
  navItems?: NavItem[]
  navGroups?: NavGroup[]
  currentView: string
  title: string
  subtitle?: string
  breadcrumbs?: Breadcrumb[]
  panelLabel: string
  panelIcon: LucideIcon
  user?: ShellUser | null
  onNavigate: (view: string) => void
  headerActions?: React.ReactNode
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
  navItems = [],
  navGroups,
  currentView,
  title,
  subtitle,
  breadcrumbs,
  panelLabel,
  panelIcon: PanelIcon,
  user,
  onNavigate,
  headerActions,
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

  // ---- Realtime notifications, bookings, quotes & messages -----------------
  const { on: onRealtime } = useRealtime()
  const { playCoin } = useCoinSound()

  React.useEffect(() => {
    // 1. In-app new notification received
    const unbindNotif = onRealtime<{
      id: string
      type?: string
      title?: string
      content?: string
      body?: string
    }>("notification:new", (notif) => {
      qc.invalidateQueries({ queryKey: ["notifications"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
      qc.invalidateQueries({ queryKey: ["provider", "dashboard"] })
      triggerHaptic("medium")
      try {
        playCoin()
      } catch {}

      const routeKey = notif.type?.toUpperCase() ?? ""
      const targetView = NOTIFICATION_ROUTES[routeKey] || "client.dashboard"
      const label = notif.type ? NOTIFICATION_TYPE_LABELS[notif.type] : undefined

      toast(notif.title || label || "Nova notificação", {
        description: notif.content || notif.body || "Você tem uma nova notificação.",
        action: {
          label: "Ver",
          onClick: () => navigate(targetView),
        },
      })
    })

    // 2. Booking status updated
    const unbindBooking = onRealtime<{
      bookingId: string
      status: string
      clientId: string
      providerId: string
    }>("booking:updated", (evt) => {
      qc.invalidateQueries({ queryKey: ["bookings"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
      qc.invalidateQueries({ queryKey: ["provider", "agenda"] })
      triggerHaptic("success")
      const targetView = user?.role === "PROVIDER" ? "provider.agenda" : "client.bookings"

      toast.info("Atualização no agendamento", {
        description: `Status alterado para: ${evt.status}`,
        action: {
          label: "Ver Reserva",
          onClick: () => navigate(targetView),
        },
      })
    })

    // 3. Quote updated
    const unbindQuote = onRealtime<{
      quoteId: string
      status: string
      clientId: string
      providerId: string
    }>("quote:updated", (evt) => {
      qc.invalidateQueries({ queryKey: ["quotes"] })
      qc.invalidateQueries({ queryKey: ["client", "quotes"] })
      qc.invalidateQueries({ queryKey: ["provider", "quotes"] })
      triggerHaptic("medium")
      const targetView = user?.role === "PROVIDER" ? "provider.quotes" : "client.quotes"

      toast.info("Atualização no orçamento", {
        description: `Status atualizado para: ${evt.status}`,
        action: {
          label: "Ver Orçamento",
          onClick: () => navigate(targetView),
        },
      })
    })

    // 4. Message received
    const unbindMessage = onRealtime<{
      id: string
      fromId: string
      toId: string
      content: string
      bookingId?: string | null
    }>("message:new", (msg) => {
      if (user?.id && msg.fromId === user.id) return
      qc.invalidateQueries({ queryKey: ["messages"] })
      qc.invalidateQueries({ queryKey: ["conversations"] })
      triggerHaptic("selection")
      const targetView = user?.role === "PROVIDER" ? "provider.messages" : "client.messages"

      toast("Nova mensagem", {
        description: msg.content.length > 50 ? `${msg.content.slice(0, 50)}...` : msg.content,
        action: {
          label: "Responder",
          onClick: () => navigate(targetView),
        },
      })
    })

    // 5. Provider arrived at service location (client sees instant toast)
    const unbindArrived = onRealtime<{
      bookingId: string
      clientId: string
      providerId: string
      providerName: string
      serviceName: string
    }>("provider:arrived", (evt) => {
      qc.invalidateQueries({ queryKey: ["bookings"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
      triggerHaptic("success")
      try {
        playCoin()
      } catch {}

      toast.success("📍 Prestador chegou ao local!", {
        description: `${evt.providerName} está no local do atendimento para "${evt.serviceName}".`,
        action: {
          label: "Ver Agendamento",
          onClick: () => navigate("client.bookings"),
        },
      })
    })

    // 6. Payment confirmed in real-time (both client and provider)
    const unbindPayment = onRealtime<{
      bookingId: string
      clientId: string
      providerId?: string
      amount?: number
      paymentMethod?: string
    }>("payment:confirmed", (evt) => {
      qc.invalidateQueries({ queryKey: ["bookings"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
      qc.invalidateQueries({ queryKey: ["provider", "dashboard"] })
      qc.invalidateQueries({ queryKey: ["provider", "finance"] })
      triggerHaptic("success")
      try {
        playCoin()
      } catch {}

      const amountStr = evt.amount ? ` R$ ${evt.amount.toFixed(2)}` : ""
      const isProvider = user?.role === "PROVIDER"

      toast.success(isProvider ? "💰 Pagamento confirmado!" : "✅ Pagamento recebido!", {
        description: isProvider
          ? `Pagamento${amountStr} confirmado — valor disponível para saque.`
          : `Seu pagamento${amountStr} foi confirmado com sucesso.`,
        action: {
          label: isProvider ? "Ver Financeiro" : "Ver Agendamento",
          onClick: () => navigate(isProvider ? "provider.finance" : "client.bookings"),
        },
      })
    })

    return () => {
      unbindNotif()
      unbindBooking()
      unbindQuote()
      unbindMessage()
      unbindArrived()
      unbindPayment()
    }
  }, [onRealtime, qc, navigate, user?.id, user?.role, playCoin])

  const handleNav = (view: string) => {
    triggerHaptic("selection")
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
  const navList = navGroups ? (
    <div className="flex flex-col gap-1 py-1">
      {navGroups.map((group) => (
        <SidebarGroup key={group.label} className="py-1">
          <SidebarGroupLabel className="text-muted-foreground/70 h-7 px-3 text-[11px] font-semibold tracking-wider uppercase">
            {group.label}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 px-2">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = currentView === item.view
                return (
                  <SidebarMenuItem key={item.view}>
                    <SidebarMenuButton
                      isActive={active}
                      onClick={() => handleNav(item.view)}
                      tooltip={item.label}
                      size="default"
                      className={cn(
                        "relative h-9 rounded-lg text-sm font-normal transition-colors duration-150",
                        active ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE,
                      )}
                    >
                      <Icon
                        className={cn(
                          "!size-[16px] shrink-0 transition-colors duration-150",
                          active ? NAV_ICON_ACTIVE : NAV_ICON_INACTIVE,
                        )}
                      />
                      <span className="truncate text-[13px]">{item.label}</span>
                      {item.badge != null && item.badge !== 0 ? (
                        <span className="bg-primary text-primary-foreground ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold">
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
      ))}
    </div>
  ) : (
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
          className="text-muted-foreground size-8 shrink-0 transition-all hover:bg-rose-50 hover:text-rose-500 active:scale-95 dark:hover:bg-rose-950/30"
          onClick={() => {
            triggerHaptic("selection")
            logout()
          }}
          aria-label="Sair"
          title="Sair"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </SidebarFooter>
  )

  // ---- Mobile nav item renderer -------------------------------------------
  const renderMobileItem = (item: NavItem) => {
    const Icon = item.icon
    const active = currentView === item.view
    return (
      <button
        key={item.view}
        type="button"
        onClick={() => handleNav(item.view)}
        className={cn(
          "flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-sm font-normal transition-colors duration-150 outline-none",
          active
            ? "bg-primary/10 text-foreground font-medium"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <Icon
          className={cn(
            "!size-[16px] shrink-0 transition-colors duration-150",
            active ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="truncate text-[13px]">{item.label}</span>
        {item.badge != null && item.badge !== 0 ? (
          <span className="bg-primary text-primary-foreground ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold">
            {item.badge}
          </span>
        ) : null}
      </button>
    )
  }

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
          className="text-muted-foreground size-8 shrink-0 transition-all hover:bg-rose-50 hover:text-rose-500 active:scale-95 dark:hover:bg-rose-950/30"
          onClick={() => {
            triggerHaptic("selection")
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
                  {navGroups ? (
                    <div className="flex flex-col gap-3.5 p-3">
                      {navGroups.map((group) => (
                        <div key={group.label} className="flex flex-col gap-0.5">
                          <p className="text-muted-foreground/70 mb-1 px-2.5 text-[11px] font-semibold tracking-wider uppercase">
                            {group.label}
                          </p>
                          {group.items.map(renderMobileItem)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-px p-3">
                      <p className="text-muted-foreground/70 mb-2 px-3 text-[11px] font-medium tracking-wider uppercase">
                        Navegação
                      </p>
                      {navItems.map(renderMobileItem)}
                    </div>
                  )}
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
                  className="text-muted-foreground hover:text-foreground size-9 transition-all active:scale-95 lg:hidden"
                  onClick={() => {
                    triggerHaptic("selection")
                    setMobileOpen(true)
                  }}
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
              <div className="flex items-center gap-1.5">
                {headerActions}
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
                  className="text-muted-foreground hover:text-foreground size-9 transition-all active:scale-95"
                  onClick={() => {
                    triggerHaptic("selection")
                    setTheme(resolvedTheme === "dark" ? "light" : "dark")
                  }}
                  aria-label="Alternar tema"
                  title="Alternar tema"
                >
                  <Sun className="size-[18px] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
                  <Moon className="absolute size-[18px] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
                </Button>

                {/* Web Push notifications button */}
                <PushNotificationButton />

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
              <div className="mx-auto w-full max-w-7xl p-3.5 pb-24 sm:p-6 sm:pb-8 lg:p-8">
                {children}
              </div>

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
        <MobileBottomNav
          role={user?.role}
          currentView={currentView}
          onNavigate={navigate}
          unreadCount={unreadCount}
        />
        <PushPromptBanner />
        <PwaInstallBanner />
      </div>
    </SidebarProvider>
  )
}

// ---------------------------------------------------------------------------
// Re-exports for backwards compatibility
// ---------------------------------------------------------------------------

export { EmptyState, StatCard, SectionTitle } from "./shell/shell-cards"
export { Separator }
