"use client"

/**
 * Topbar — sticky header of the vitrine.
 *
 * Sections:
 *   - Logo (emerald MapPin + "Severinno")
 *   - Search with autocomplete (popover + command) — desktop only inline
 *   - Location chip (city or "Definir localização" + LocateFixed)
 *   - Auth area (Entrar/Cadastrar or avatar dropdown by role)
 *   - Mobile: hamburger → sheet with search + categories
 *   - Below (desktop): horizontal category nav chips
 */

import * as React from "react"
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
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useAuthStore, useGeoStore, useUIStore, useViewStore } from "@/store"
import { ROLE_LABELS, type UserRole } from "@/lib/constants"
import type { Category } from "@/lib/api"
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

  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [locating, setLocating] = React.useState(false)

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
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/65">
      {/* Main bar */}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <button
          type="button"
          onClick={() => onSelectCategory(null)}
          className="flex shrink-0 items-center gap-2 rounded-md px-1 py-1 outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Severinno — página inicial"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <MapPin className="size-5" />
          </span>
          <span className="text-lg font-bold tracking-tight text-primary">
            Severinno
          </span>
        </button>

        {/* Desktop search — inline input with autocomplete popover */}
        <div className="hidden flex-1 items-center justify-center md:flex">
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverAnchor asChild>
              <div className="relative w-full max-w-xl">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground transition-colors focus-within:text-primary" />
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
                  className="h-10 w-full rounded-full border bg-muted/60 pl-10 pr-9 text-sm shadow-none transition hover:border-primary/30 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
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
                    className="absolute top-1/2 right-3 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="center"
              className="w-[min(90vw,36rem)] p-0"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <Command shouldFilter={false} className="rounded-lg">
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
                    Digite e pressione Enter para buscar.
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
                      >
                        <Search className="size-4 opacity-50" />
                        <span>{c.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandGroup heading="Sugestões">
                    <CommandItem
                      value="__search__"
                      onSelect={() => triggerSearch()}
                    >
                      <Search className="size-4 opacity-50" />
                      <span>Buscar por “{query || "todos"}”</span>
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Location chip */}
        <div className="hidden items-center md:flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleLocate}
            disabled={locating || geoStatus === "locating"}
            className="h-9 max-w-[14rem] gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
            title="Usar minha localização"
            aria-label="Usar minha localização"
          >
            {locating || geoStatus === "locating" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LocateFixed className="size-4" />
            )}
            <span className="truncate text-sm font-medium">
              {city || "Definir localização"}
            </span>
          </Button>
        </div>

        {/* Auth area (desktop) */}
        <div className="hidden items-center gap-1 md:flex">
          {isAuth ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("client.favorites")}
                className="h-9 w-9 rounded-full p-0"
                aria-label="Favoritos"
                title="Favoritos"
              >
                <Heart className="size-5" />
              </Button>
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full border bg-background py-1 pr-3 pl-1.5 text-sm outline-none transition hover:border-primary/30 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Menu da conta"
                >
                  <Avatar className="size-7">
                    {user?.avatarUrl ? (
                      <AvatarImage src={user.avatarUrl} alt={user.name} />
                    ) : null}
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[10rem] truncate font-medium lg:inline">
                    {user?.name?.split(" ")[0]}
                  </span>
                  <ChevronDown className="size-4 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="flex flex-col gap-1">
                  <span className="truncate">{user?.name}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {user?.email}
                  </span>
                  <Badge
                    variant="secondary"
                    className="mt-1 w-fit text-[10px]"
                  >
                    {user ? ROLE_LABELS[user.role] : ""}
                  </Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => user && navigate(DASHBOARD_VIEW[user.role])}
                >
                  <LayoutDashboard className="size-4" />
                  Meu painel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("client.favorites")}>
                  <Heart className="size-4" />
                  Favoritos
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
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openAuth("login")}
                className="h-9 rounded-full px-4"
              >
                Entrar
              </Button>
              <Button
                size="sm"
                onClick={() => openAuth("register", "CLIENT")}
                className="h-9 rounded-full px-4 shadow-sm"
              >
                Cadastrar
              </Button>
            </>
          )}
        </div>

        {/* Mobile: hamburger */}
        <div className="ml-auto flex items-center gap-1 md:hidden">
          {/* Mobile location shortcut (compact) */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleLocate}
            disabled={locating || geoStatus === "locating"}
            className="size-9 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
            title="Definir localização"
            aria-label="Definir localização"
          >
            {locating || geoStatus === "locating" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LocateFixed className="size-4" />
            )}
          </Button>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Abrir menu"
                className="size-10"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[88vw] sm:max-w-sm">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
                {/* Mobile search */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    triggerSearch()
                  }}
                  className="relative"
                >
                  <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="Buscar serviço…"
                    className="h-11 pl-9"
                    aria-label="Buscar serviço"
                  />
                </form>

                {/* Mobile location */}
                <Button
                  variant="outline"
                  onClick={handleLocate}
                  disabled={locating}
                  className="h-11 justify-start rounded-xl border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                >
                  {locating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LocateFixed className="size-4" />
                  )}
                  {city || "Definir localização"}
                </Button>

                {/* Mobile categories */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Categorias
                  </p>
                  <ScrollArea className="max-h-72 pr-2">
                    <div className="flex flex-col gap-1">
                      <CategoryChipButton
                        label="Todas"
                        active={!activeCategoryId}
                        onClick={() => onSelectCategory(null)}
                      />
                      {categories.map((c) => (
                        <CategoryChipButton
                          key={c.id}
                          label={c.name}
                          active={activeCategoryId === c.id}
                          onClick={() => onSelectCategory(c.id)}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* Mobile auth */}
                <div className="mt-auto flex flex-col gap-2 border-t pt-4">
                  {isAuth ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Avatar className="size-9">
                          {user?.avatarUrl ? (
                            <AvatarImage src={user.avatarUrl} alt={user.name} />
                          ) : null}
                          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {user?.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {user ? ROLE_LABELS[user.role] : ""}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setMobileOpen(false)
                          if (user) navigate(DASHBOARD_VIEW[user.role])
                        }}
                      >
                        <LayoutDashboard className="size-4" />
                        Meu painel
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setMobileOpen(false)
                          logout()
                        }}
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
                        className="h-11"
                      >
                        Entrar
                      </Button>
                      <Button
                        onClick={() => {
                          setMobileOpen(false)
                          openAuth("register", "CLIENT")
                        }}
                        className="h-11"
                      >
                        Cadastrar
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Desktop: category nav (horizontal scroll) */}
      <nav
        aria-label="Categorias"
        className="relative hidden border-t bg-background/60 md:block"
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
          className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-background to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent"
        />
      </nav>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Small internal components
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
        "h-8 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-muted/60 text-foreground hover:bg-muted hover:text-primary",
      )}
    >
      {label}
    </button>
  )
}

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
        "flex h-10 w-full items-center rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary text-primary-foreground"
          : "hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {label}
    </button>
  )
}
