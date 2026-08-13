"use client"

import * as React from "react"
import { LayoutDashboard, Heart, LogOut, ChevronDown, ShieldCheck } from "lucide-react"

import { ROLE_LABELS, type UserRole } from "@/lib/constants"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DASHBOARD_VIEW } from "./types"

type TopbarUser = {
  id: string
  name: string
  email: string
  role: UserRole
  avatarUrl?: string | null
}

export function TopbarUserMenu({
  user,
  onNavigate,
  onLogout,
}: {
  user: TopbarUser
  onNavigate: (view: string) => void
  onLogout: () => void
}) {
  const initials = user.name
    ? user.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group bg-background/80 hover:border-primary/30 hover:bg-accent/50 focus-visible:ring-ring flex items-center gap-2 rounded-xl border py-1.5 pr-3 pl-1.5 text-sm transition-all duration-200 outline-none hover:shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2"
          aria-label="Menu da conta"
        >
          <div className="relative">
            <Avatar className="ring-background group-hover:ring-primary/20 size-7 ring-2 transition-shadow duration-200">
              {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
              <AvatarFallback className="from-primary bg-gradient-to-br to-emerald-600 text-xs text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="border-background absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 bg-emerald-500" />
          </div>
          <span className="hidden max-w-[10rem] truncate font-medium lg:inline">
            {user.name.split(" ")[0]}
          </span>
          <ChevronDown className="size-3.5 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="shadow-primary/5 w-64 rounded-2xl border-0 p-2 shadow-2xl"
      >
        <DropdownMenuLabel className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          <Avatar className="ring-primary/10 size-10 ring-2">
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
            <AvatarFallback className="from-primary bg-gradient-to-br to-emerald-600 text-sm text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="text-muted-foreground truncate text-xs">{user.email}</p>
            <Badge variant="secondary" className="mt-1 gap-1 text-[10px] font-medium">
              <ShieldCheck className="size-3" />
              {ROLE_LABELS[user.role]}
            </Badge>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuItem
          onSelect={() => onNavigate(DASHBOARD_VIEW[user.role])}
          className="gap-3 rounded-xl px-3 py-2.5"
        >
          <LayoutDashboard className="text-primary size-4" />
          <span>Meu painel</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onNavigate("client.favorites")}
          className="gap-3 rounded-xl px-3 py-2.5"
        >
          <Heart className="size-4 text-rose-500" />
          <span>Favoritos</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuItem
          variant="destructive"
          onSelect={onLogout}
          className="gap-3 rounded-xl px-3 py-2.5"
        >
          <LogOut className="size-4" />
          <span>Sair</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
