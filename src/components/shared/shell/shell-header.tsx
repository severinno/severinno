"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { ChevronRight, LayoutDashboard, LogOut, MapPin, Menu, Moon, Sun } from "lucide-react"

import { ROLE_LABELS } from "@/lib/constants"
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
import { SidebarTrigger } from "@/components/ui/sidebar"
import { MuteIndicator } from "@/components/shared/mute-indicator"
import { VibrationIndicator } from "@/components/shared/vibration-indicator"
import { WalletBalancePill } from "@/components/shared/wallet-balance-pill"
import { NotificationsBell } from "./shell-notifications"
import { type Breadcrumb, type ShellUser, type NotificationItem, DASHBOARD_VIEW } from "./types"

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

export function ShellHeader({
  title,
  subtitle,
  breadcrumbs,
  user,
  onOpenMobile,
  notifications,
  unreadCount,
  notificationsLoading,
  onMarkRead,
  onMarkAllRead,
  markingAll,
  onNavigate,
  onLogout,
}: {
  title: string
  subtitle?: string
  breadcrumbs?: Breadcrumb[]
  user?: ShellUser | null
  onOpenMobile: () => void
  notifications: NotificationItem[]
  unreadCount: number
  notificationsLoading: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: (ids: string[]) => void
  markingAll: boolean
  onNavigate: (view: string) => void
  onLogout: () => void
}) {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <header className="border-border/50 bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 flex h-14 items-center border-b px-4 backdrop-blur-md lg:px-6">
      {/* Left section */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-9 lg:hidden"
          onClick={onOpenMobile}
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
          <h1 className="text-foreground truncate text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="text-muted-foreground hidden truncate text-sm md:block">{subtitle}</p>
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
          items={notifications}
          unreadCount={unreadCount}
          isLoading={notificationsLoading}
          onMarkRead={onMarkRead}
          onMarkAllRead={onMarkAllRead}
          markingAll={markingAll}
          onNavigate={onNavigate}
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
                if (user?.role) onNavigate(DASHBOARD_VIEW[user.role])
              }}
            >
              <LayoutDashboard className="size-4" />
              Meu painel
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onNavigate("vitrine")
              }}
            >
              <MapPin className="size-4" />
              Voltar à vitrine
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onLogout}>
              <LogOut className="size-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
