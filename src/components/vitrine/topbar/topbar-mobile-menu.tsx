"use client"

import * as React from "react"
import {
  MapPin,
  Search,
  Menu,
  LogOut,
  LayoutDashboard,
  ShieldCheck,
  LocateFixed,
  Loader2,
} from "lucide-react"

import { ROLE_LABELS, type UserRole } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { DASHBOARD_VIEW } from "./types"

type TopbarUser = {
  id: string
  name: string
  email: string
  role: UserRole
  avatarUrl?: string | null
}

export function TopbarMobileMenu({
  open,
  onOpenChange,
  query,
  onQueryChange,
  onSearchSubmit,
  city,
  locating,
  onLocate,
  user,
  isAuth,
  onOpenAuth,
  onNavigate,
  onLogout,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onQueryChange: (q: string) => void
  onSearchSubmit: () => void
  city: string | null
  locating: boolean
  onLocate: () => void
  user?: TopbarUser | null
  isAuth: boolean
  onOpenAuth: (mode?: "login" | "register", role?: "CLIENT" | "PROVIDER") => void
  onNavigate: (view: string) => void
  onLogout: () => void
}) {
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Abrir menu" className="size-10 rounded-xl">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[88vw] rounded-l-2xl border-0 p-0 shadow-2xl sm:max-w-sm"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="flex items-center gap-2.5">
            <span className="from-primary flex size-8 items-center justify-center rounded-xl bg-gradient-to-br to-emerald-600 shadow-sm">
              <MapPin className="size-4 text-white" />
            </span>
            <span className="text-lg font-bold">
              <span className="from-primary bg-gradient-to-r to-emerald-600 bg-clip-text text-transparent">
                Sever
              </span>
              <span>inno</span>
            </span>
            <span className="flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-100 to-teal-100 px-2 py-0.5 dark:from-emerald-900/40 dark:to-teal-900/40">
              <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[10px] font-bold tracking-wide text-emerald-700 dark:text-emerald-300">
                Verificado
              </span>
            </span>
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
          {/* Mobile search */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSearchSubmit()
            }}
            className="relative"
          >
            <Search className="text-muted-foreground absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Buscar serviço…"
              className="bg-muted/50 focus-visible:ring-primary/30 h-11 rounded-xl border-0 pl-10 shadow-none focus-visible:ring-2"
              aria-label="Buscar serviço"
            />
          </form>

          {/* Mobile location */}
          <Button
            variant="outline"
            onClick={() => {
              onLocate()
              onOpenChange(false)
            }}
            disabled={locating}
            className="h-11 justify-start gap-2.5 rounded-xl border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-emerald-50/50 text-emerald-700 hover:from-emerald-100 hover:to-emerald-50 hover:text-emerald-800 dark:border-emerald-800/40 dark:from-emerald-950/40 dark:to-emerald-950/20 dark:text-emerald-300"
          >
            {locating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LocateFixed className="size-4 shrink-0" />
            )}
            {city || "Definir localização"}
          </Button>

          {/* Mobile auth */}
          <div className="mt-auto flex flex-col gap-2.5 border-t pt-5">
            {isAuth && user ? (
              <>
                <div className="flex items-center gap-3">
                  <Avatar className="ring-primary/10 size-10 ring-2">
                    {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
                    <AvatarFallback className="from-primary bg-gradient-to-br to-emerald-600 text-sm text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{user.name}</p>
                    <Badge variant="secondary" className="mt-0.5 gap-1 text-[10px]">
                      <ShieldCheck className="size-3" />
                      {ROLE_LABELS[user.role]}
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false)
                    onNavigate(DASHBOARD_VIEW[user.role])
                  }}
                  className="h-11 gap-2.5 rounded-xl"
                >
                  <LayoutDashboard className="text-primary size-4" />
                  Meu painel
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    onOpenChange(false)
                    onLogout()
                  }}
                  className="text-destructive hover:bg-destructive/5 hover:text-destructive h-11 gap-2.5 rounded-xl"
                >
                  <LogOut className="size-4" />
                  Sair
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false)
                    onOpenAuth("login")
                  }}
                  className="h-11 rounded-xl font-medium"
                >
                  Entrar
                </Button>
                <Button
                  onClick={() => {
                    onOpenChange(false)
                    onOpenAuth("register", "CLIENT")
                  }}
                  className="from-primary shadow-primary/20 h-11 rounded-xl bg-gradient-to-r to-emerald-600 font-medium shadow-md"
                >
                  Cadastrar grátis
                </Button>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
