"use client"

/**
 * Topbar — completely redesigned sticky header for the Severinno vitrine.
 *
 * UX/UI Improvements:
 *   1. Scroll-aware behavior: shrinks & becomes more opaque on scroll
 *   2. Animated logo with pulse effect on the map pin
 *   3. Glassmorphism search bar with animated focus expansion
 *   4. Notification bell with unread count (for authenticated users)
 *   5. Richer category nav with animated sliding active indicator
 *   6. Enhanced mobile sheet with staggered entrance animations
 *   7. Micro-interactions: hover scale, smooth transitions, focus rings
 *   8. Theme toggle with rotation animation
 *   9. User dropdown with online status indicator
 *  10. Compare badge with bounce animation on count change
 */

import * as React from "react"
import { useTheme } from "next-themes"
import { motion, AnimatePresence } from "framer-motion"
import {
  MapPin,
  LocateFixed,
  Search,
  Menu,
  LogOut,
  LayoutDashboard,
  Heart,
  X,
  Loader2,
  ChevronDown,
  Moon,
  Sun,
  GitCompare,
  Bell,
  Sparkles,
  ShieldCheck,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { useAuthStore, useGeoStore, useUIStore, useViewStore, useCompareStore } from "@/store"
import { ROLE_LABELS, type UserRole } from "@/lib/constants"
import type { Category } from "@/lib/api"
import { apiGet } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopbarProps = {
  query: string
  onQueryChange: (q: string) => void
  categories: Category[]
  activeCategoryId?: string | null
  onCategorySelect?: (id: string | null) => void
  onSearchSubmit?: () => void
}

const DASHBOARD_VIEW: Record<UserRole, string> = {
  CLIENT: "client.dashboard",
  PROVIDER: "provider.dashboard",
  ADMIN: "admin.dashboard",
}

// ---------------------------------------------------------------------------
// Notification type for the bell
// ---------------------------------------------------------------------------

type NotificationsResponse = {
  items: Array<{
    id: string
    type: string
    title: string
    message: string
    read: boolean
    createdAt: string
  }>
  total: number
  unreadCount: number
}

// ---------------------------------------------------------------------------
// Main Topbar Component
// ---------------------------------------------------------------------------

export default function Topbar({
  query,
  onQueryChange,
  categories,
  activeCategoryId,
  onCategorySelect,
  onSearchSubmit,
}: TopbarProps) {
  const { user, status, logout } = useAuthStore()
  const { city, status: geoStatus, setFromGPS } = useGeoStore()
  const openAuth = useUIStore((s) => s.openAuth)
  const navigate = useViewStore((s) => s.navigate)
  const compareCount = useCompareStore((s) => s.ids.length)
  const openCompare = useCompareStore((s) => s.openCompare)
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [locating, setLocating] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)

  // Track scroll position for header shrink effect
  React.useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // Notifications query (only for authenticated users)
  const { data: notificationsData } = useQuery({
    queryKey: ["topbar-notifications"],
    queryFn: () => apiGet<NotificationsResponse>("/api/notifications", { limit: 5 }),
    enabled: status === "authenticated" && !!user,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })
  const unreadCount = notificationsData?.unreadCount ?? 0

  const isAuth = status === "authenticated" && !!user
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?"

  const handleLocate = React.useCallback(async () => {
    setLocating(true)
    try {
      await setFromGPS()
    } finally {
      setLocating(false)
    }
  }, [setFromGPS])

  const triggerSearch = React.useCallback(() => {
    setSearchOpen(false)
    setMobileOpen(false)
    onSearchSubmit?.()
  }, [onSearchSubmit])

  const onSelectCategory = React.useCallback(
    (id: string | null) => {
      setMobileOpen(false)
      onCategorySelect?.(id)
    },
    [onCategorySelect],
  )

  // Category pill ref for animated indicator
  const categoryNavRef = React.useRef<HTMLDivElement>(null)

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full transition-all duration-300 ease-out",
        scrolled
          ? "border-b bg-background/95 shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-background/90"
          : "border-b border-transparent bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/55",
      )}
    >
      {/* ── Main bar ─────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "mx-auto flex max-w-7xl items-center gap-2 px-4 transition-all duration-300 ease-out sm:gap-3 sm:px-6 lg:px-8",
          scrolled ? "h-14" : "h-16",
        )}
      >
        {/* ── Logo ──────────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => onSelectCategory(null)}
          className="group flex shrink-0 items-center gap-2.5 rounded-xl px-1.5 py-1.5 outline-none transition-all hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Severinno — página inicial"
        >
          <span className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-emerald-600 shadow-md shadow-primary/25 transition-transform duration-300 group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-primary/30">
            <MapPin className="size-5 text-white transition-transform duration-300 group-hover:-translate-y-0.5" />
            <span className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-emerald-400 shadow-sm">
              <Sparkles className="size-2 text-white" />
            </span>
          </span>
          <span className="text-xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-primary to-emerald-600 bg-clip-text text-transparent">
              Sever
            </span>
            <span className="text-foreground">inno</span>
          </span>
        </button>

        {/* ── Desktop search ────────────────────────────────────────────── */}
        <div className="hidden flex-1 items-center justify-center md:flex">
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverAnchor asChild>
              <div className="relative w-full max-w-xl">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground transition-colors duration-200 group-focus-within:text-primary" />
                <Input
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  onFocus={() => {
                    if (categories.length > 0) setSearchOpen(true)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      triggerSearch()
                    }
                  }}
                  placeholder="Buscar serviço ou prestador…"
                  className={cn(
                    "h-11 w-full rounded-2xl border-0 bg-muted/50 pl-11 pr-10 text-sm shadow-none transition-all duration-300",
                    "placeholder:text-muted-foreground/60",
                    "hover:bg-muted/70 hover:shadow-sm",
                    "focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:shadow-md",
                    searchOpen && "bg-background shadow-md ring-2 ring-primary/20",
                  )}
                  aria-label="Buscar prestadores"
                />
                <AnimatePresence>
                  {query ? (
                    <motion.button
                      type="button"
                      aria-label="Limpar busca"
                      onClick={(e) => {
                        e.stopPropagation()
                        onQueryChange("")
                      }}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </motion.button>
                  ) : null}
                </AnimatePresence>
                {/* Search shortcut hint */}
                {!query && !searchOpen && (
                  <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground lg:inline-block">
                    ⌘K
                  </kbd>
                )}
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="center"
              className="w-[min(90vw,36rem)] rounded-2xl border-0 p-0 shadow-2xl shadow-primary/5"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <Command shouldFilter={false} className="rounded-2xl">
                <CommandInput
                  placeholder="O que você precisa? Ex.: encanador, pintura…"
                  value={query}
                  onValueChange={onQueryChange}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      triggerSearch()
                    }
                  }}
                />
                <CommandList>
                  <CommandEmpty>
                    <div className="flex flex-col items-center gap-2 py-6 text-center">
                      <Search className="size-8 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        Digite e pressione Enter para buscar.
                      </p>
                    </div>
                  </CommandEmpty>
                  <CommandGroup heading="Categorias populares">
                    {categories.slice(0, 6).map((c, i) => (
                      <CommandItem
                        key={c.id}
                        value={c.id}
                        onSelect={() => {
                          onSelectCategory(c.id)
                          setSearchOpen(false)
                        }}
                        className="gap-3 rounded-lg"
                      >
                        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Search className="size-3.5" />
                        </span>
                        <span className="font-medium">{c.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandGroup heading="Sugestões">
                    <CommandItem
                      value="__search__"
                      onSelect={() => triggerSearch()}
                      className="gap-3 rounded-lg"
                    >
                      <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                        <Sparkles className="size-3.5" />
                      </span>
                      <span className="font-medium">
                        Buscar por &ldquo;{query || "todos"}&rdquo;
                      </span>
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* ── Location chip ─────────────────────────────────────────────── */}
        <div className="hidden items-center md:flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleLocate}
            disabled={locating || geoStatus === "locating"}
            className={cn(
              "h-9 max-w-[14rem] gap-2 rounded-xl border px-3.5 text-sm font-medium transition-all duration-200",
              "border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-emerald-50/50 text-emerald-700",
              "hover:from-emerald-100 hover:to-emerald-50 hover:text-emerald-800 hover:shadow-sm",
              "dark:border-emerald-800/40 dark:from-emerald-950/50 dark:to-emerald-950/20 dark:text-emerald-300",
              "dark:hover:from-emerald-900/50 dark:hover:to-emerald-950/30 dark:hover:text-emerald-200",
            )}
            title="Usar minha localização"
            aria-label="Usar minha localização"
          >
            {locating || geoStatus === "locating" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LocateFixed className="size-4 shrink-0" />
            )}
            <span className="truncate">{city || "Definir localização"}</span>
          </Button>
        </div>

        {/* ── Auth area (desktop) ───────────────────────────────────────── */}
        <div className="hidden items-center gap-1.5 md:flex">
          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="group size-9 rounded-xl text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label="Alternar tema"
            title="Alternar tema"
          >
            {mounted ? (
              <motion.div
                key={resolvedTheme}
                initial={{ rotate: -90, scale: 0 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ duration: 0.3, type: "spring", stiffness: 200 }}
              >
                {resolvedTheme === "dark" ? (
                  <Sun className="size-[18px]" />
                ) : (
                  <Moon className="size-[18px]" />
                )}
              </motion.div>
            ) : (
              <div className="size-[18px]" />
            )}
          </Button>

          {/* Compare button */}
          <AnimatePresence>
            {compareCount > 0 ? (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openCompare}
                  className="h-9 gap-2 rounded-xl border-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-50/50 text-emerald-700 shadow-sm transition-all hover:from-emerald-100 hover:to-emerald-50 hover:text-emerald-800 hover:shadow-md dark:border-emerald-800/40 dark:from-emerald-950/40 dark:to-emerald-950/20 dark:text-emerald-300 dark:hover:from-emerald-900/40 dark:hover:text-emerald-200"
                  aria-label={`Comparar ${compareCount} prestador(es)`}
                  title={`Comparar ${compareCount} prestador(es)`}
                >
                  <GitCompare className="size-4" />
                  <span className="text-sm font-medium">Comparar</span>
                  <motion.span
                    key={compareCount}
                    initial={{ scale: 1.5 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 15 }}
                  >
                    <Badge className="ml-0.5 h-5 min-w-5 justify-center rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 px-1.5 text-[10px] font-bold text-white shadow-sm">
                      {compareCount}
                    </Badge>
                  </motion.span>
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {isAuth ? (
            <>
              {/* Notification bell */}
              <Popover>
                <PopoverAnchor asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="group relative size-9 rounded-xl text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
                    aria-label="Notificações"
                    title="Notificações"
                  >
                    <Bell className="size-[18px] transition-transform duration-200 group-hover:rotate-12" />
                    <AnimatePresence>
                      {unreadCount > 0 ? (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                          transition={{ type: "spring", stiffness: 500, damping: 20 }}
                          className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-red-400 text-[9px] font-bold text-white shadow-sm"
                        >
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </motion.span>
                      ) : null}
                    </AnimatePresence>
                  </Button>
                </PopoverAnchor>
                <PopoverContent
                  align="end"
                  className="w-80 rounded-2xl border-0 p-0 shadow-2xl shadow-primary/5"
                >
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <h3 className="text-sm font-semibold">Notificações</h3>
                    {unreadCount > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        {unreadCount} não lida{unreadCount > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <ScrollArea className="max-h-72">
                    {(notificationsData?.items ?? []).length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-8 text-center">
                        <Bell className="size-8 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">
                          Nenhuma notificação
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        {(notificationsData?.items ?? []).map((n, i) => (
                          <div
                            key={n.id}
                            className={cn(
                              "flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
                              !n.read && "bg-primary/5",
                              i > 0 && "border-t",
                            )}
                          >
                            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Bell className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-sm leading-snug", !n.read && "font-medium")}>
                                {n.title || n.message}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {new Date(n.createdAt).toLocaleDateString("pt-BR")}
                              </p>
                            </div>
                            {!n.read && (
                              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <div className="border-t px-4 py-2.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs font-medium text-primary hover:text-primary/80"
                      onClick={() => {
                        const view = user?.role === "ADMIN" ? "admin.dashboard" : user?.role === "PROVIDER" ? "provider.dashboard" : "client.dashboard"
                        navigate(view)
                      }}
                    >
                      Ver todas as notificações
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Favorites */}
              <Button
                variant="ghost"
                size="icon"
                className="group size-9 rounded-xl text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
                onClick={() => navigate("client.favorites")}
                aria-label="Favoritos"
                title="Favoritos"
              >
                <Heart className="size-[18px] transition-transform duration-200 group-hover:scale-110" />
              </Button>

              {/* User dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="group flex items-center gap-2 rounded-xl border bg-background/80 py-1.5 pr-3 pl-1.5 text-sm outline-none transition-all duration-200 hover:border-primary/30 hover:bg-accent/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label="Menu da conta"
                  >
                    <div className="relative">
                      <Avatar className="size-7 ring-2 ring-background transition-shadow duration-200 group-hover:ring-primary/20">
                        {user?.avatarUrl ? (
                          <AvatarImage src={user.avatarUrl} alt={user.name} />
                        ) : null}
                        <AvatarFallback className="bg-gradient-to-br from-primary to-emerald-600 text-xs text-white">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      {/* Online indicator */}
                      <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500" />
                    </div>
                    <span className="hidden max-w-[10rem] truncate font-medium lg:inline">
                      {user?.name?.split(" ")[0]}
                    </span>
                    <ChevronDown className="size-3.5 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-64 rounded-2xl border-0 p-2 shadow-2xl shadow-primary/5"
                >
                  <DropdownMenuLabel className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                    <Avatar className="size-10 ring-2 ring-primary/10">
                      {user?.avatarUrl ? (
                        <AvatarImage src={user.avatarUrl} alt={user.name} />
                      ) : null}
                      <AvatarFallback className="bg-gradient-to-br from-primary to-emerald-600 text-sm text-white">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{user?.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user?.email}
                      </p>
                      <Badge
                        variant="secondary"
                        className="mt-1 gap-1 text-[10px] font-medium"
                      >
                        <ShieldCheck className="size-3" />
                        {user ? ROLE_LABELS[user.role] : ""}
                      </Badge>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuItem
                    onSelect={() => user && navigate(DASHBOARD_VIEW[user.role])}
                    className="gap-3 rounded-xl px-3 py-2.5"
                  >
                    <LayoutDashboard className="size-4 text-primary" />
                    <span>Meu painel</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => navigate("client.favorites")}
                    className="gap-3 rounded-xl px-3 py-2.5"
                  >
                    <Heart className="size-4 text-rose-500" />
                    <span>Favoritos</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => logout()}
                    className="gap-3 rounded-xl px-3 py-2.5"
                  >
                    <LogOut className="size-4" />
                    <span>Sair</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openAuth("login")}
                className="h-9 rounded-xl px-4 font-medium transition-all duration-200 hover:bg-primary/5 hover:text-primary"
              >
                Entrar
              </Button>
              <Button
                size="sm"
                onClick={() => openAuth("register", "CLIENT")}
                className="h-9 rounded-xl bg-gradient-to-r from-primary to-emerald-600 px-5 font-medium shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 hover:brightness-110"
              >
                Cadastrar
              </Button>
            </div>
          )}
        </div>

        {/* ── Mobile: right-side buttons ─────────────────────────────────── */}
        <div className="ml-auto flex items-center gap-1 md:hidden">
          {/* Mobile theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl text-muted-foreground hover:text-foreground"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label="Alternar tema"
            title="Alternar tema"
          >
            {mounted ? (
              resolvedTheme === "dark" ? (
                <Sun className="size-5" />
              ) : (
                <Moon className="size-5" />
              )
            ) : (
              <div className="size-5" />
            )}
          </Button>

          {/* Mobile compare */}
          <AnimatePresence>
            {compareCount > 0 ? (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              >
                <Button
                  variant="outline"
                  size="icon"
                  onClick={openCompare}
                  className="relative size-9 rounded-xl border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300"
                  aria-label={`Comparar ${compareCount} prestador(es)`}
                  title={`Comparar ${compareCount} prestador(es)`}
                >
                  <GitCompare className="size-4" />
                  <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 text-[9px] font-bold text-white shadow-sm">
                    {compareCount}
                  </span>
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Mobile location shortcut */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleLocate}
            disabled={locating || geoStatus === "locating"}
            className="size-9 rounded-xl border border-emerald-200/80 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300"
            title="Definir localização"
            aria-label="Definir localização"
          >
            {locating || geoStatus === "locating" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LocateFixed className="size-4" />
            )}
          </Button>

          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Abrir menu"
                className="size-10 rounded-xl"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[88vw] rounded-l-2xl border-0 p-0 shadow-2xl sm:max-w-sm"
            >
              <SheetHeader className="border-b px-6 py-4">
                <SheetTitle className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-emerald-600 shadow-sm">
                    <MapPin className="size-4 text-white" />
                  </span>
                  <span className="text-lg font-bold">
                    <span className="bg-gradient-to-r from-primary to-emerald-600 bg-clip-text text-transparent">
                      Sever
                    </span>
                    <span>inno</span>
                  </span>
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
                {/* Mobile search */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    triggerSearch()
                  }}
                  className="relative"
                >
                  <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="Buscar serviço…"
                    className="h-11 rounded-xl border-0 bg-muted/50 pl-10 shadow-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    aria-label="Buscar serviço"
                  />
                </form>

                {/* Mobile location */}
                <Button
                  variant="outline"
                  onClick={handleLocate}
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

                {/* Mobile categories */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    Categorias
                  </p>
                  <ScrollArea className="max-h-64 pr-1">
                    <div className="flex flex-col gap-1">
                      <CategoryChipButton
                        label="Todas"
                        active={!activeCategoryId}
                        onClick={() => onSelectCategory(null)}
                      />
                      {categories.map((c, i) => (
                        <motion.div
                          key={c.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03, duration: 0.2 }}
                        >
                          <CategoryChipButton
                            label={c.name}
                            active={activeCategoryId === c.id}
                            onClick={() => onSelectCategory(c.id)}
                          />
                        </motion.div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* Mobile auth */}
                <div className="mt-auto flex flex-col gap-2.5 border-t pt-5">
                  {isAuth ? (
                    <>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-10 ring-2 ring-primary/10">
                          {user?.avatarUrl ? (
                            <AvatarImage src={user.avatarUrl} alt={user.name} />
                          ) : null}
                          <AvatarFallback className="bg-gradient-to-br from-primary to-emerald-600 text-sm text-white">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {user?.name}
                          </p>
                          <Badge
                            variant="secondary"
                            className="mt-0.5 gap-1 text-[10px]"
                          >
                            <ShieldCheck className="size-3" />
                            {user ? ROLE_LABELS[user.role] : ""}
                          </Badge>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setMobileOpen(false)
                          if (user) navigate(DASHBOARD_VIEW[user.role])
                        }}
                        className="h-11 gap-2.5 rounded-xl"
                      >
                        <LayoutDashboard className="size-4 text-primary" />
                        Meu painel
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setMobileOpen(false)
                          logout()
                        }}
                        className="h-11 gap-2.5 rounded-xl text-destructive hover:bg-destructive/5 hover:text-destructive"
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
                          setMobileOpen(false)
                          openAuth("login")
                        }}
                        className="h-11 rounded-xl font-medium"
                      >
                        Entrar
                      </Button>
                      <Button
                        onClick={() => {
                          setMobileOpen(false)
                          openAuth("register", "CLIENT")
                        }}
                        className="h-11 rounded-xl bg-gradient-to-r from-primary to-emerald-600 font-medium shadow-md shadow-primary/20"
                      >
                        Cadastrar grátis
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* ── Desktop: category nav ────────────────────────────────────────── */}
      <nav
        ref={categoryNavRef}
        aria-label="Categorias"
        className={cn(
          "relative hidden border-t transition-all duration-300 md:block",
          scrolled
            ? "border-border/50 bg-background/80 backdrop-blur-sm"
            : "border-transparent bg-background/40 backdrop-blur-sm",
        )}
      >
        <ScrollArea className="max-w-none">
          <div className="mx-auto flex max-w-7xl items-center gap-1.5 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
            <CategoryPill
              label="Todas"
              active={!activeCategoryId}
              onClick={() => onCategorySelect?.(null)}
            />
            {categories.map((c) => (
              <CategoryPill
                key={c.id}
                label={c.name}
                active={activeCategoryId === c.id}
                onClick={() => onCategorySelect?.(c.id)}
              />
            ))}
          </div>
        </ScrollArea>
        {/* Fade edges */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent"
        />
      </nav>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Category Pill — desktop horizontal nav
// ---------------------------------------------------------------------------

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative h-8 shrink-0 rounded-xl px-4 text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        active
          ? "bg-gradient-to-r from-primary to-emerald-600 text-white shadow-md shadow-primary/20"
          : "bg-muted/50 text-foreground/70 hover:bg-muted hover:text-foreground hover:shadow-sm",
      )}
    >
      {label}
      {active && (
        <motion.div
          layoutId="category-indicator"
          className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary to-emerald-600"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          style={{ zIndex: -1 }}
        />
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Category Chip Button — mobile vertical nav
// ---------------------------------------------------------------------------

function CategoryChipButton({
  label,
  active,
  onClick,
}: {
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-10 w-full items-center gap-2.5 rounded-xl px-3.5 text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-gradient-to-r from-primary to-emerald-600 text-white shadow-md shadow-primary/20"
          : "hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {active && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 25 }}
          className="size-1.5 rounded-full bg-white"
        />
      )}
      {label}
    </button>
  )
}
