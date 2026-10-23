"use client"

import * as React from "react"
import Image from "next/image"
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { WalletBalancePill } from "@/components/shared/wallet-balance-pill"
import { type NavItem, type ShellUser } from "./types"

const NAV_ITEM_ACTIVE = "!bg-primary/5 !text-foreground font-medium hover:!bg-primary/8"
const NAV_ITEM_INACTIVE = "!text-muted-foreground hover:!bg-accent/60 hover:!text-foreground"
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
  panelIcon: _PanelIcon,
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
    <Sidebar collapsible="icon" className="border-border/50 border-r">
      {/* Sidebar Header */}
      <SidebarHeader className="pb-0">
        <div className="flex items-center gap-2.5 px-3 pt-3 pb-4">
          <div className="ring-border/50 relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-2xs ring-1">
            <Image
              src="/brand-icon.png"
              alt="Severinno"
              width={36}
              height={36}
              className="size-9 object-contain"
              priority
            />
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="flex items-center">
              <Image
                src="/brand-wordmark-black.png"
                alt={APP_NAME}
                width={88}
                height={14}
                className="h-3.5 w-auto object-contain dark:hidden"
                priority
              />
              <Image
                src="/brand-wordmark-white.png"
                alt={APP_NAME}
                width={88}
                height={14}
                className="hidden h-3.5 w-auto object-contain dark:block"
                priority
              />
              <span className="sr-only">{APP_NAME}</span>
            </div>
            <p className="text-muted-foreground/75 mt-0.5 truncate text-[11px] font-medium tracking-tight">
              {panelLabel}
            </p>
          </div>
        </div>
        <SidebarSeparator className="mx-3 w-auto" />
      </SidebarHeader>

      {/* Sidebar Nav */}
      <SidebarContent>
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
      </SidebarContent>

      {/* Sidebar Footer */}
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
  panelIcon: _PanelIcon,
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
      <SheetContent side="left" className="border-border/50 w-[80vw] border-r p-0 sm:max-w-sm">
        <SheetHeader className="sr-only">
          <SheetTitle>{panelLabel}</SheetTitle>
        </SheetHeader>
        <div className="flex h-full flex-col">
          {/* Mobile header */}
          <div className="border-border/50 flex items-center gap-2.5 border-b px-4 py-4">
            <div className="ring-border/50 relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-2xs ring-1">
              <Image
                src="/brand-icon.png"
                alt="Severinno"
                width={36}
                height={36}
                className="size-9 object-contain"
                priority
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center">
                <Image
                  src="/brand-wordmark-black.png"
                  alt={APP_NAME}
                  width={88}
                  height={14}
                  className="h-3.5 w-auto object-contain dark:hidden"
                  priority
                />
                <Image
                  src="/brand-wordmark-white.png"
                  alt={APP_NAME}
                  width={88}
                  height={14}
                  className="hidden h-3.5 w-auto object-contain dark:block"
                  priority
                />
                <span className="sr-only">{APP_NAME}</span>
              </div>
              <p className="text-muted-foreground/75 mt-0.5 truncate text-[11px] font-medium tracking-tight">
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
            <div className="border-border/50 flex items-center gap-3 rounded-lg border p-2.5">
              <Avatar className="size-8 shrink-0">
                {user?.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt={user.name ?? ""} />
                ) : null}
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
