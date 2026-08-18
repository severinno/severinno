"use client"

import * as React from "react"
import { LogOut, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { APP_NAME, ROLE_LABELS } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { WalletBalancePill } from "@/components/shared/wallet-balance-pill"
import { type NavItem, type ShellUser } from "./types"

const NAV_ITEM_ACTIVE =
  "!bg-primary/5 !text-foreground font-medium hover:!bg-primary/8"
const NAV_ITEM_INACTIVE =
  "!text-muted-foreground hover:!bg-accent/60 hover:!text-foreground"
const NAV_ICON_ACTIVE = "!text-primary"
const NAV_ICON_INACTIVE = "!text-muted-foreground"

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

export function ShellSidebar({
  navItems,
  currentView,
  panelLabel,
  panelIcon: PanelIcon,
  user,
  onNavigate,
  onLogout,
}: {
  navItems: NavItem[]
  currentView: string
  panelLabel: string
  panelIcon: LucideIcon
  user?: ShellUser | null
  onNavigate: (view: string) => void
  onLogout: () => void
}) {
  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      {/* Sidebar Header */}
      <SidebarHeader className="pb-0">
        <div className="flex items-center gap-3 px-3 pt-3 pb-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <PanelIcon className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-foreground">
              {APP_NAME}
            </p>
            <p className="truncate text-[11px] font-medium text-muted-foreground/70">
              {panelLabel}
            </p>
          </div>
        </div>
        <SidebarSeparator className="mx-3 w-auto" />
      </SidebarHeader>

      {/* Sidebar Nav */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground/70 px-3 h-7">
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
                      onClick={() => onNavigate(item.view)}
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
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
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
      </SidebarContent>

      {/* Sidebar Footer */}
      <SidebarFooter className="mt-auto">
        <SidebarSeparator className="mx-3 w-auto" />
        <div className="flex items-center gap-3 rounded-lg border border-border/50 p-2.5">
          <Avatar className="size-8 shrink-0">
            {user?.avatarUrl ? (
              <AvatarImage src={user.avatarUrl} alt={user.name ?? ""} />
            ) : null}
            <AvatarFallback className="bg-primary text-[11px] font-semibold text-primary-foreground">
              {initials(user?.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-tight text-foreground">
              {user?.name ?? "Visitante"}
            </p>
            {user?.role ? (
              <Badge
                variant="secondary"
                className="mt-1 h-4 px-1.5 text-[10px] font-medium"
              >
                {ROLE_LABELS[user.role]}
              </Badge>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            onClick={onLogout}
            aria-label="Sair"
            title="Sair"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

export function ShellMobileSheet({
  open,
  onOpenChange,
  navItems,
  currentView,
  panelLabel,
  panelIcon: PanelIcon,
  user,
  onNavigate,
  onLogout,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  navItems: NavItem[]
  currentView: string
  panelLabel: string
  panelIcon: LucideIcon
  user?: ShellUser | null
  onNavigate: (view: string) => void
  onLogout: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[80vw] border-r border-border/50 p-0 sm:max-w-sm"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{panelLabel}</SheetTitle>
        </SheetHeader>
        <div className="flex h-full flex-col">
          {/* Mobile header */}
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <PanelIcon className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight text-foreground">
                {APP_NAME}
              </p>
              <p className="truncate text-[11px] font-medium text-muted-foreground/70">
                {panelLabel}
              </p>
            </div>
          </div>

          {/* Mobile nav */}
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-px p-3">
              <p className="mb-2 px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground/70">
                Navegação
              </p>
              {navItems.map((item) => {
                const Icon = item.icon
                const active = currentView === item.view
                return (
                  <button
                    key={item.view}
                    type="button"
                    onClick={() => {
                      onOpenChange(false)
                      onNavigate(item.view)
                    }}
                    className={cn(
                      "flex h-10 w-full min-w-0 items-center gap-3 rounded-lg px-3 text-sm font-normal outline-none transition-colors duration-150",
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
                      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </ScrollArea>

          {/* Mobile wallet balance — provider only */}
          {user?.role === "PROVIDER" ? (
            <div className="border-t px-3 py-3">
              <WalletBalancePill />
            </div>
          ) : null}

          {/* Mobile footer */}
          <div className="border-t p-3">
            <div className="flex items-center gap-3 rounded-lg border border-border/50 p-2.5">
              <Avatar className="size-8 shrink-0">
                {user?.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt={user.name ?? ""} />
                ) : null}
                <AvatarFallback className="bg-primary text-[11px] font-semibold text-primary-foreground">
                  {initials(user?.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium leading-tight text-foreground">
                  {user?.name ?? "Visitante"}
                </p>
                {user?.role ? (
                  <Badge
                    variant="secondary"
                    className="mt-1 h-4 px-1.5 text-[10px] font-medium"
                  >
                    {ROLE_LABELS[user.role]}
                  </Badge>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                onClick={() => {
                  onOpenChange(false)
                  onLogout()
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
  )
}
