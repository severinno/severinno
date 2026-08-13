"use client"

/**
 * Topbar — redesigned sticky header for the Severinno vitrine.
 *
 * Modular Architecture:
 *   - WelcomeToast        → Mensagem de boas-vindas com contagem de prestadores
 *   - TopbarNotifications → Popover de notificações agrupadas por data
 *   - TopbarUserMenu      → Menu da conta, status online e atalhos de dashboard
 *   - TopbarMobileMenu    → Gaveta mobile com busca e navegação
 */

import * as React from "react"
import { useTheme } from "next-themes"
import { motion, AnimatePresence } from "framer-motion"
import {
  MapPin,
  LocateFixed,
  Search,
  Heart,
  X,
  Moon,
  Sun,
  GitCompare,
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
import { apiGet, type Category } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useFaviconBadge } from "@/hooks/use-favicon-badge"

import {
  type TopbarProps,
  type NotificationsResponse,
  WelcomeToast,
  TopbarNotifications,
  TopbarUserMenu,
  TopbarMobileMenu,
} from "./topbar/index"

export type { TopbarProps }

const WELCOME_TOAST_KEY = "severinno-welcome-seen"

export default function Topbar({
  query,
  onQueryChange,
  categories,
  onCategorySelect,
  onSearchSubmit,
  sort,
  hasGeo,
}: TopbarProps) {
  const { user, status, logout } = useAuthStore()
  const { city, status: geoStatus, setFromGPS } = useGeoStore()
  const openAuth = useUIStore((s) => s.openAuth)
  const navigate = useViewStore((s) => s.navigate)
  const compareCount = useCompareStore((s) => s.ids.length)
  const openCompare = useCompareStore((s) => s.openCompare)
  const { resolvedTheme, setTheme } = useTheme()

  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchFocused, setSearchFocused] = React.useState(false)
  const [locating, setLocating] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)
  const [pastHero, setPastHero] = React.useState(false)
  const [showWelcome, setShowWelcome] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const seen = localStorage.getItem(WELCOME_TOAST_KEY)
    if (!seen) {
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

  React.useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY
      setScrolled(y > 20)
      setPastHero(y > 500)
    }
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const { data: notificationsData } = useQuery({
    queryKey: ["topbar-notifications"],
    queryFn: () => apiGet<NotificationsResponse>("/api/notifications", { limit: 5 }),
    enabled: status === "authenticated" && !!user,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })
  const unreadCount = notificationsData?.unreadCount ?? 0

  useFaviconBadge(unreadCount)

  const isAuth = status === "authenticated" && !!user

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
      <AnimatePresence>
        {showWelcome && <WelcomeToast onDismiss={dismissWelcome} />}
      </AnimatePresence>

      <header
        className={cn(
          "sticky top-0 z-40 w-full transition-all duration-300 ease-out",
          scrolled
            ? "bg-background/95 supports-[backdrop-filter]:bg-background/90 border-b shadow-sm backdrop-blur-xl"
            : "bg-background/70 supports-[backdrop-filter]:bg-background/55 border-b border-transparent backdrop-blur-md",
        )}
      >
        <motion.div
          className="absolute right-0 bottom-0 left-0 h-[2px] bg-gradient-to-r from-emerald-400 to-teal-500"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{
            scaleX: scrolled ? 1 : 0,
            opacity: scrolled ? 1 : 0,
          }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          style={{ transformOrigin: "left" }}
        />

        <div
          className={cn(
            "mx-auto flex max-w-7xl items-center gap-2 px-4 transition-all duration-300 ease-out sm:gap-3 sm:px-6 lg:px-8",
            scrolled ? "h-14" : "h-16",
          )}
        >
          {/* Logo */}
          <button
            type="button"
            onClick={() => onSelectCategory(null)}
            className="group hover:bg-primary/5 focus-visible:ring-ring flex shrink-0 items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            aria-label="Severinno — página inicial"
          >
            <motion.span
              className="from-primary shadow-primary/25 group-hover:shadow-primary/30 relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br to-emerald-600 shadow-md transition-shadow duration-300 group-hover:shadow-lg"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <div className="flex items-center justify-center">
                <MapPin className="size-5 text-white" />
              </div>
              <span className="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-emerald-400 shadow-sm">
                <Sparkles className="size-2 text-white" />
              </span>
            </motion.span>
            <span className="text-xl font-extrabold tracking-tight">
              <span className="from-primary bg-gradient-to-r to-emerald-600 bg-clip-text text-transparent">
                Sever
              </span>
              <span className="text-foreground">inno</span>
            </span>
            <span className="hidden items-center gap-1 rounded-full bg-gradient-to-r from-emerald-100 to-teal-100 px-2 py-0.5 sm:inline-flex dark:from-emerald-900/40 dark:to-teal-900/40">
              <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[10px] font-bold tracking-wide text-emerald-700 dark:text-emerald-300">
                Verificado
              </span>
            </span>
          </button>

          {/* Desktop Search */}
          <div className="hidden flex-1 items-center justify-center md:flex">
            <AnimatePresence mode="wait">
              {!pastHero ? (
                <motion.div
                  key="full-search"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.2 }}
                  className="w-full"
                >
                  <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                    <PopoverAnchor asChild>
                      <div className="relative mx-auto w-full max-w-xl">
                        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 transition-colors duration-200" />
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
                            "bg-muted/50 h-11 w-full rounded-2xl border-0 pr-10 pl-11 text-sm shadow-none transition-all duration-300",
                            "placeholder:text-muted-foreground/60",
                            "hover:bg-muted/70 hover:shadow-sm",
                            "focus-visible:bg-background focus-visible:ring-primary/30 focus-visible:shadow-md focus-visible:ring-2",
                            searchOpen && "bg-background ring-primary/20 shadow-md ring-2",
                            searchFocused && "max-w-xl scale-[1.02]",
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
                              className="bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive absolute top-1/2 right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-full transition-colors"
                            >
                              <X className="size-3.5" />
                            </motion.button>
                          ) : null}
                        </AnimatePresence>
                      </div>
                    </PopoverAnchor>
                    <PopoverContent
                      align="center"
                      className="shadow-primary/5 w-[min(90vw,36rem)] rounded-2xl border-0 p-0 shadow-2xl"
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
                              <Search className="text-muted-foreground/40 size-8" />
                              <p className="text-muted-foreground text-sm">
                                Digite e pressione Enter para buscar.
                              </p>
                            </div>
                          </CommandEmpty>
                          <CommandGroup heading="Categorias populares">
                            {categories.slice(0, 6).map((c: Category) => (
                              <CommandItem
                                key={c.id}
                                value={c.id}
                                onSelect={() => {
                                  onSelectCategory(c.id)
                                  setSearchOpen(false)
                                }}
                                className="gap-3 rounded-lg"
                              >
                                <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-lg">
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
                </motion.div>
              ) : (
                <motion.div
                  key="mini-search"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  className="w-full max-w-sm"
                >
                  <div className="relative">
                    <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
                    <Input
                      value={query}
                      onChange={(e) => onQueryChange(e.target.value)}
                      onFocus={() => setSearchFocused(true)}
                      onBlur={() => setSearchFocused(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          triggerSearch()
                        }
                      }}
                      placeholder="Buscar…"
                      className={cn(
                        "bg-muted/50 h-9 w-full rounded-xl border-0 pr-3 pl-9 text-xs shadow-none transition-all duration-300",
                        "placeholder:text-muted-foreground/60",
                        "hover:bg-muted/70",
                        "focus-visible:bg-background focus-visible:ring-primary/30 focus-visible:shadow-sm focus-visible:ring-2",
                        searchFocused && "scale-[1.03]",
                      )}
                      aria-label="Buscar prestadores (compacto)"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Location Desktop */}
          <div className="hidden md:flex">
            <div className="relative w-52">
              <AddressAutocomplete
                placeholder={city || "CEP, cidade ou endereço…"}
                onSelect={() => onSearchSubmit?.()}
              />
            </div>
          </div>

          {/* Sort indicator */}
          {sort === "distance" && hasGeo ? (
            <div className="hidden items-center gap-1.5 rounded-full border border-emerald-200/60 bg-gradient-to-r from-emerald-50 to-teal-50 px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-sm md:flex dark:border-emerald-800/40 dark:from-emerald-950/40 dark:to-teal-950/20 dark:text-emerald-300">
              <LocateFixed className="size-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
              <span className="whitespace-nowrap">Ordenando por distância</span>
            </div>
          ) : null}

          {/* Desktop Actions */}
          <div className="hidden items-center gap-1.5 md:flex">
            {/* Theme toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="group text-muted-foreground hover:bg-accent hover:text-foreground size-9 rounded-xl transition-all duration-200"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label="Alternar tema"
              title="Alternar tema"
            >
              {mounted ? (
                resolvedTheme === "dark" ? (
                  <Sun className="size-[18px]" />
                ) : (
                  <Moon className="size-[18px]" />
                )
              ) : (
                <div className="size-[18px]" />
              )}
            </Button>

            {/* Compare button */}
            <AnimatePresence>
              {compareCount > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openCompare}
                  className="h-9 gap-2 rounded-xl border-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-50/50 text-emerald-700 shadow-sm transition-all hover:from-emerald-100 hover:to-emerald-50 hover:text-emerald-800 hover:shadow-md dark:border-emerald-800/40 dark:from-emerald-950/40 dark:to-emerald-950/20 dark:text-emerald-300"
                  aria-label={`Comparar ${compareCount} prestador(es)`}
                >
                  <GitCompare className="size-4" />
                  <span className="text-sm font-medium">Comparar</span>
                  <Badge className="ml-0.5 h-5 min-w-5 justify-center rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 px-1.5 text-[10px] font-bold text-white shadow-sm">
                    {compareCount}
                  </Badge>
                </Button>
              ) : null}
            </AnimatePresence>

            {isAuth && user ? (
              <>
                <TopbarNotifications
                  notificationsData={notificationsData}
                  unreadCount={unreadCount}
                  onNavigateAll={() => {
                    const v =
                      user.role === "ADMIN"
                        ? "admin.dashboard"
                        : user.role === "PROVIDER"
                          ? "provider.dashboard"
                          : "client.dashboard"
                    navigate(v)
                  }}
                  onNavigateRoute={navigate}
                />

                <Button
                  variant="ghost"
                  size="icon"
                  className="group text-muted-foreground hover:bg-accent hover:text-foreground size-9 rounded-xl transition-all"
                  onClick={() => navigate("client.favorites")}
                  aria-label="Favoritos"
                  title="Favoritos"
                >
                  <Heart className="size-[18px] transition-transform duration-200 group-hover:scale-110" />
                </Button>

                <TopbarUserMenu user={user} onNavigate={navigate} onLogout={logout} />
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openAuth("login")}
                  className="hover:bg-primary/5 hover:text-primary h-9 rounded-xl px-4 font-medium transition-all duration-200"
                >
                  Entrar
                </Button>
                <Button
                  size="sm"
                  onClick={() => openAuth("register", "CLIENT")}
                  className="from-primary shadow-primary/20 hover:shadow-primary/30 h-9 rounded-xl bg-gradient-to-r to-emerald-600 px-5 font-medium shadow-md transition-all duration-200 hover:shadow-lg hover:brightness-110"
                >
                  Cadastrar
                </Button>
              </div>
            )}
          </div>

          {/* Mobile Right Buttons */}
          <div className="ml-auto flex items-center gap-1 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground size-9 rounded-xl"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label="Alternar tema"
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

            {compareCount > 0 ? (
              <Button
                variant="outline"
                size="icon"
                onClick={openCompare}
                className="relative size-9 rounded-xl border-emerald-200 bg-emerald-50 text-emerald-700"
                aria-label={`Comparar ${compareCount} prestador(es)`}
              >
                <GitCompare className="size-4" />
                <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 text-[9px] font-bold text-white shadow-sm">
                  {compareCount}
                </span>
              </Button>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleLocate}
              disabled={locating || geoStatus === "locating"}
              className="size-9 rounded-xl border border-emerald-200/80 bg-emerald-50 text-emerald-700"
              aria-label="Definir localização"
            >
              <LocateFixed className="size-4" />
            </Button>

            <TopbarMobileMenu
              open={mobileOpen}
              onOpenChange={setMobileOpen}
              query={query}
              onQueryChange={onQueryChange}
              onSearchSubmit={triggerSearch}
              city={city}
              locating={locating}
              onLocate={handleLocate}
              user={user}
              isAuth={isAuth}
              onOpenAuth={openAuth}
              onNavigate={navigate}
              onLogout={logout}
            />
          </div>
        </div>
      </header>
    </>
  )
}
