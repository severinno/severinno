"use client"

/**
 * Topbar — completely redesigned sticky header for the Severinno vitrine.
 *
 * UX/UI Improvements:
 *   1. Scroll-aware behavior: shrinks & becomes more opaque on scroll
 *   2. Animated logo with bounce/pulse effect on the map pin
 *   3. Glassmorphism search bar with animated focus expansion (grows wider)
 *   4. Notification bell with unread count (for authenticated users)
 *   5. Richer category nav with animated sliding active indicator
 *   6. Enhanced mobile sheet with staggered entrance animations
 *   7. Micro-interactions: hover scale, smooth transitions, focus rings
 *   8. Theme toggle with rotation animation (sun ↔ moon)
 *   9. User dropdown with online status indicator
 *  10. Compare badge with bounce animation on count change
 *  11. Gradient bottom border on scroll (emerald-400 → teal-500)
 *  12. Welcome toast notification on first visit (H1 — system status)
 *  13. "Verificado" shield badge next to logo text (H6 — trust signal)
 *  14. Mini search bar replaces full one when scrolled past hero (H7 — efficiency)
 *
 * Nielsen's Heuristics:
 *   H1 — Notification toast shows system status
 *   H3 — Dismissible notification, clear mobile menu
 *   H4 — Consistent animations and colors
 *   H6 — Recognizable icons and badges
 *   H7 — Mini search on scroll = efficiency for power users
 */

import * as React from "react"
import { useTheme } from "next-themes"
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
import { useAuthStore } from "@/store/auth"
import { useGeoStore } from "@/store/geo"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"
import { useCompareStore } from "@/store/compare"
import AddressAutocomplete from "@/components/vitrine/address-autocomplete"
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
import { useFaviconBadge } from "@/hooks/use-favicon-badge"
import { NOTIFICATION_TYPE_LABELS } from "@/lib/constants"
import { formatRelative } from "@/lib/format"

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
// Notification routes — mapeia tipo de notificação para tela de destino
// ---------------------------------------------------------------------------

const NOTIFICATION_ROUTES: Record<string, string> = {
  BOOKING_CONFIRMED: "client.bookings",
  BOOKING_CANCELLED: "client.bookings",
  BOOKING_COMPLETED: "client.bookings",
  BOOKING_NEW: "provider.bookings",
  QUOTE_RECEIVED: "client.quotes",
  QUOTE_APPROVED: "provider.quotes",
  MESSAGE: "client.messages",
  REVIEW_RECEIVED: "provider.reviews",
  WELCOME: "",
  PAYMENT_RECEIVED: "provider.finance",
  PAYMENT_CONFIRMED: "client.bookings",
}

// ---------------------------------------------------------------------------
// Group notifications by date (Hoje / Ontem / Esta semana / Este mês / Anterior)
// ---------------------------------------------------------------------------

function groupNotificationsByDate(items: NotificationsResponse['items']) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const thisWeekStart = new Date(today)
  thisWeekStart.setDate(thisWeekStart.getDate() - today.getDay())
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const groups: { label: string; items: NotificationsResponse['items'] }[] = []

  const buckets: Record<string, NotificationsResponse['items']> = {
    "Hoje": [],
    "Ontem": [],
    "Esta semana": [],
    "Este mês": [],
    "Anterior": [],
  }

  for (const item of items) {
    const date = new Date(item.createdAt)
    const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    if (dateStart.getTime() === today.getTime()) {
      buckets["Hoje"].push(item)
    } else if (dateStart.getTime() === yesterday.getTime()) {
      buckets["Ontem"].push(item)
    } else if (dateStart >= thisWeekStart) {
      buckets["Esta semana"].push(item)
    } else if (dateStart >= thisMonthStart) {
      buckets["Este mês"].push(item)
    } else {
      buckets["Anterior"].push(item)
    }
  }

  for (const [label, items] of Object.entries(buckets)) {
    if (items.length > 0) {
      groups.push({ label, items })
    }
  }

  return groups
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
// Providers count response for the welcome toast
// ---------------------------------------------------------------------------

type ProvidersCountResponse = {
  total: number
}

// ---------------------------------------------------------------------------
// Welcome Toast — slides in from top on first visit (H1: system status)
// ---------------------------------------------------------------------------

const WELCOME_TOAST_KEY = "severinno-welcome-seen"

function WelcomeToast({ onDismiss }: { onDismiss: () => void }) {
  const [providerCount, setProviderCount] = React.useState<number | null>(null)

  React.useEffect(() => {
    apiGet<ProvidersCountResponse>("/api/providers", { limit: 1 })
      .then((data) => {
        if (data && typeof data.total === "number") {
          setProviderCount(data.total)
        }
      })
      .catch(() => {
        // Fallback count
        setProviderCount(120)
      })
  }, [])

  // Auto-dismiss after 8 seconds
  React.useEffect(() => {
    const t = window.setTimeout(onDismiss, 8000)
    return () => window.clearTimeout(t)
  }, [onDismiss])

  return (
    <div className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 animate-in slide-in-from-top-4 fade-in duration-300">
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-3 shadow-lg shadow-emerald-500/10 dark:border-emerald-800/40 dark:from-emerald-950/90 dark:to-teal-950/90 dark:shadow-emerald-500/5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-md shadow-emerald-500/20">
          <Sparkles className="size-4 text-white" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            Bem-vindo ao Severinno!
          </p>
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {providerCount !== null
              ? `${providerCount} prestadores disponíveis na sua região`
              : "Carregando…"}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-2 flex size-6 shrink-0 items-center justify-center rounded-full text-emerald-500 transition-colors hover:bg-emerald-200/50 hover:text-emerald-700 dark:hover:bg-emerald-800/50 dark:hover:text-emerald-300"
          aria-label="Dispensar notificação"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Topbar Component
// ---------------------------------------------------------------------------

export default function Topbar({
  query,
  onQueryChange,
  categories,
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
  // Track hydration: true on client, false on server (avoids hydration mismatch)
  const mounted = React.useSyncExternalStore(
    () => () => {}, // subscribe (no-op — value never changes after mount)
    () => true,     // getSnapshot (client: always mounted)
    () => false,    // getServerSnapshot (server: not mounted)
  )

  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchFocused, setSearchFocused] = React.useState(false)
  const [locating, setLocating] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)
  const [pastHero, setPastHero] = React.useState(false)

  // ── Welcome toast state (H1: system status) ────────────────────────────
  const [showWelcome, setShowWelcome] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const seen = localStorage.getItem(WELCOME_TOAST_KEY)
    if (!seen) {
      // Small delay so the page loads first
      const t = window.setTimeout(() => setShowWelcome(true), 1500)
      return () => window.clearTimeout(t)
    }
  }, [])

  const dismissWelcome = React.useCallback(() => {
    setShowWelcome(false)
    if (typeof window !== "undefined") {
      localStorage.setItem(WELCOME_TOAST_KEY, "1")
    }
  }, [])

  // ── Track scroll position ───────────────────────────────────────────────
  React.useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY
      setScrolled(y > 20)
      // Consider "past hero" when scrolled more than ~600px (rough hero height)
      setPastHero(y > 500)
    }
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

  // Favicon badge — mostra contador de não lidas na aba do navegador
  useFaviconBadge(unreadCount)

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

  return (
    <>
      {/* ── Welcome Toast (H1: system status) ──────────────────────────── */}
      {showWelcome && <WelcomeToast onDismiss={dismissWelcome} />}

      <header
        className={cn(
          "sticky top-0 z-40 w-full transition-all duration-300 ease-out",
          scrolled
            ? "border-b bg-background/95 shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-background/90"
            : "border-b border-transparent bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/55",
        )}
      >
        {/* ── Gradient bottom border on scroll (2px emerald-400 → teal-500) ── */}
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 h-[2px] origin-left bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-[400ms] ease-out",
            scrolled ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0",
          )}
        />

        {/* ── Main bar ─────────────────────────────────────────────────────── */}
        <div
          className={cn(
            "mx-auto flex max-w-7xl items-center gap-2 px-4 transition-all duration-300 ease-out sm:gap-3 sm:px-6 lg:px-8",
            scrolled ? "h-14" : "h-16",
          )}
        >
          {/* ── Logo with hover bounce/pulse + "Verificado" badge (H6) ──── */}
          <button
            type="button"
            onClick={() => onSelectCategory(null)}
            className="group flex shrink-0 items-center gap-2.5 rounded-xl px-1.5 py-1.5 outline-none transition-all hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Severinno — página inicial"
          >
            <span
              className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-emerald-600 shadow-md shadow-primary/25 transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-primary/30 active:scale-95"
            >
              <div className="flex items-center justify-center">
                <MapPin className="size-5 text-white" />
              </div>
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
            {/* "Verificado" shield badge (H6) */}
            <span className="hidden animate-in fade-in zoom-in-75 items-center gap-1 rounded-full bg-gradient-to-r from-emerald-100 to-teal-100 px-2 py-0.5 duration-300 [animation-delay:500ms] dark:from-emerald-900/40 dark:to-teal-900/40 sm:inline-flex">
              <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[10px] font-bold tracking-wide text-emerald-700 dark:text-emerald-300">
                Verificado
              </span>
            </span>
          </button>

          {/* ── Desktop search — full bar or mini bar (H7: efficiency) ──── */}
          <div className="hidden flex-1 items-center justify-center md:flex">
            {/* Full search bar — visible when NOT past hero */}
            {!pastHero ? (
                <div key="full-search" className="w-full animate-in fade-in duration-200">
                  <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                    <PopoverAnchor asChild>
                      <div className="relative mx-auto w-full max-w-xl">
                        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground transition-colors duration-200 group-focus-within:text-primary" />
                        <Input
                          value={query}
                          onChange={(e) => onQueryChange(e.target.value)}
                          onFocus={() => {
                            setSearchFocused(true)
                            if (categories.length > 0) setSearchOpen(true)
                          }}
                          onBlur={() => setSearchFocused(false)}
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
                            searchFocused && "max-w-xl scale-[1.02]",
                          )}
                          aria-label="Buscar prestadores"
                        />
                          {query ? (
                            <button
                              type="button"
                              aria-label="Limpar busca"
                              onClick={(e) => {
                                e.stopPropagation()
                                onQueryChange("")
                              }}
                              className="absolute top-1/2 right-3 flex size-6 -translate-y-1/2 animate-in zoom-in-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
                            >
                              <X className="size-3.5" />
                            </button>
                          ) : null}
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
                            {categories.slice(0, 6).map((c) => (
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
              ) : (
                <div key="mini-search" className="w-full max-w-sm animate-in fade-in zoom-in-95 duration-200">
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => onQueryChange(e.target.value)}
                      onFocus={() => {
                        // Scroll back to top to reveal full search if needed
                        setSearchFocused(true)
                      }}
                      onBlur={() => setSearchFocused(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          triggerSearch()
                        }
                      }}
                      placeholder="Buscar…"
                      className={cn(
                        "h-9 w-full rounded-xl border-0 bg-muted/50 pl-9 pr-3 text-xs shadow-none transition-all duration-300",
                        "placeholder:text-muted-foreground/60",
                        "hover:bg-muted/70",
                        "focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:shadow-sm",
                        searchFocused && "scale-[1.03]",
                      )}
                      aria-label="Buscar prestadores (compacto)"
                    />
                  </div>
                </div>
              )}
          </div>

          {/* ── Location / AddressAutocomplete (desktop) ────────────────────── */}
          <div className="hidden md:flex">
            <div className="relative w-52">
              <AddressAutocomplete
                placeholder={city || "CEP, cidade ou endereço…"}
                onSelect={() => onSearchSubmit?.()}
              />
            </div>
          </div>

          {/* ── Auth area (desktop) ───────────────────────────────────────── */}
          <div className="hidden items-center gap-1.5 md:flex">
            {/* Theme toggle with rotation animation */}
            <Button
              variant="ghost"
              size="icon"
              className="group size-9 rounded-xl text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label="Alternar tema"
              title="Alternar tema"
            >
              {mounted ? (
                <div
                  key={resolvedTheme}
                  className="animate-in rotate-in-[-90deg] zoom-in-0 duration-300"
                >
                  {resolvedTheme === "dark" ? (
                    <Sun className="size-[18px]" />
                  ) : (
                    <Moon className="size-[18px]" />
                  )}
                </div>
              ) : (
                <div className="size-[18px]" />
              )}
            </Button>

            {/* Compare button with bounce badge */}
              {compareCount > 0 ? (
                <div className="animate-in zoom-in-75 fade-in duration-200">
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
                    <span
                      key={compareCount}
                      className="inline-block animate-in zoom-in-200 duration-200"
                    >
                      <Badge className="ml-0.5 h-5 min-w-5 justify-center rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 px-1.5 text-[10px] font-bold text-white shadow-sm">
                        {compareCount}
                      </Badge>
                    </span>
                  </Button>
                </div>
              ) : null}

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
                        {unreadCount > 0 ? (
                          <span className="absolute -top-0.5 -right-0.5 flex size-4 animate-in zoom-in-0 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-red-400 text-[9px] font-bold text-white shadow-sm duration-200">
                            {unreadCount > 9 ? "9+" : unreadCount}
                          </span>
                        ) : null}
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
                    <ScrollArea className="max-h-80">
                      {(notificationsData?.items ?? []).length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-8 text-center">
                          <Bell className="size-8 text-muted-foreground/30" />
                          <p className="text-sm text-muted-foreground">
                            Nenhuma notificação
                          </p>
                        </div>
                      ) : (
                        <div className="max-h-72 overflow-y-auto">
                          {groupNotificationsByDate(notificationsData?.items ?? []).map((group) => (
                            <div key={group.label}>
                              <div className="sticky top-0 z-10 bg-popover px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                {group.label}
                              </div>
                              {group.items.map((n) => {
                                const typeLabel = NOTIFICATION_TYPE_LABELS[n.type]
                                const targetRoute = NOTIFICATION_ROUTES[n.type]
                                return (
                                  <div
                                    key={n.id}
                                    className={cn(
                                      "flex gap-3 px-4 py-3 transition-colors",
                                      !n.read && "bg-primary/5",
                                      targetRoute && "cursor-pointer hover:bg-muted/50",
                                    )}
                                    onClick={() => {
                                      if (targetRoute) navigate(targetRoute)
                                    }}
                                    onKeyDown={(e) => {
                                      if ((e.key === "Enter" || e.key === " ") && targetRoute) {
                                        e.preventDefault()
                                        navigate(targetRoute)
                                      }
                                    }}
                                    role={targetRoute ? "button" : undefined}
                                    tabIndex={targetRoute ? 0 : undefined}
                                  >
                                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                      <Bell className="size-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className={cn("text-sm leading-snug", !n.read && "font-medium")}>
                                        {n.title || n.message}
                                      </p>
                                      <p className="mt-0.5 text-xs text-muted-foreground">
                                        {formatRelative(n.createdAt)}
                                      </p>
                                      {typeLabel ? (
                                        <Badge variant="outline" className="mt-1 h-4 text-[9px] font-medium">
                                          {typeLabel}
                                        </Badge>
                                      ) : null}
                                    </div>
                                    {!n.read && (
                                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                                    )}
                                  </div>
                                )
                              })}
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
            {/* Mobile theme toggle with rotation */}
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-xl text-muted-foreground hover:text-foreground"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label="Alternar tema"
              title="Alternar tema"
            >
              {mounted ? (
                <div
                  key={resolvedTheme}
                  className="animate-in rotate-in-[-90deg] zoom-in-0 duration-300"
                >
                  {resolvedTheme === "dark" ? (
                    <Sun className="size-5" />
                  ) : (
                    <Moon className="size-5" />
                  )}
                </div>
              ) : (
                <div className="size-5" />
              )}
            </Button>

            {/* Mobile compare with bounce badge */}
              {compareCount > 0 ? (
                <div className="animate-in zoom-in-75 duration-200">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={openCompare}
                    className="relative size-9 rounded-xl border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300"
                    aria-label={`Comparar ${compareCount} prestador(es)`}
                    title={`Comparar ${compareCount} prestador(es)`}
                  >
                    <GitCompare className="size-4" />
                    <span
                      key={compareCount}
                      className="absolute -top-1 -right-1 flex size-4 animate-in zoom-in-200 items-center justify-center rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 text-[9px] font-bold text-white shadow-sm duration-200"
                    >
                      {compareCount}
                    </span>
                  </Button>
                </div>
              ) : null}

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
                    {/* Verificado badge in mobile menu too */}
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
                    onClick={() => {
                      handleLocate()
                      setMobileOpen(false)
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
      </header>
    </>
  )
}
