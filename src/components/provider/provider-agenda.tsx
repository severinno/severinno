"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Calendar as CalendarIcon,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  ExternalLink,
  MapPin,
  Navigation,
  Sparkles,
  TrendingUp,
} from "lucide-react"
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import { ptBR } from "date-fns/locale"

import { apiGet } from "@/lib/api"
import { type BookingStatus } from "@/lib/constants"
import { formatBRL, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { triggerHaptic } from "@/lib/haptics"
import { useViewStore } from "@/store/view"
import { ProviderTransitHud } from "@/components/provider/provider-transit-hud"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BookingStatusBadge } from "@/components/admin/admin-shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Booking = {
  id: string
  scheduledAt: string
  status: BookingStatus
  address: string
  amount: number
  lat?: number | null
  lng?: number | null
  clientPhone?: string | null
  service: { id: string; title: string }
  client: {
    id: string
    name: string
    avatarUrl?: string | null
  }
}

type Range = "today" | "week" | "month"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name?: string) {
  if (!name) return "?"
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
}

const DOT_STYLES: Record<BookingStatus, string> = {
  PENDING: "bg-amber-500",
  CONFIRMED: "bg-emerald-500",
  IN_PROGRESS: "bg-teal-500",
  COMPLETED: "bg-emerald-600",
  CANCELLED: "bg-rose-500",
}

// ---------------------------------------------------------------------------
// Calendar grid
// ---------------------------------------------------------------------------

function CalendarGrid({
  cursor,
  bookings,
  selectedDay,
  onSelectDay,
}: {
  cursor: Date
  bookings: Booking[]
  selectedDay: Date
  onSelectDay: (d: Date) => void
}) {
  const monthStart = startOfMonth(cursor)
  const monthEnd = endOfMonth(cursor)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })

  const days: Date[] = []
  let d = gridStart
  while (d <= gridEnd) {
    days.push(d)
    d = addDays(d, 1)
  }

  const bookingsByDay = React.useMemo(() => {
    const map = new Map<string, Booking[]>()
    for (const b of bookings) {
      const key = format(new Date(b.scheduledAt), "yyyy-MM-dd")
      const arr = map.get(key) ?? []
      arr.push(b)
      map.set(key, arr)
    }
    return map
  }, [bookings])

  // Nielsen #4 & #8: Padrão consistente com Expediente (3 letras maiúsculas)
  const weekDays = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"]

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground grid grid-cols-7 gap-1 text-center text-[11px] font-semibold tracking-wider uppercase">
        {weekDays.map((wd) => (
          <div key={wd} className="py-1.5">
            {wd}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd")
          const dayBookings = bookingsByDay.get(key) ?? []
          const inMonth = isSameMonth(day, cursor)
          const isSelected = isSameDay(day, selectedDay)
          const isToday = isSameDay(day, new Date())
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                onSelectDay(day)
              }}
              className={cn(
                "group focus-visible:ring-primary/40 relative flex aspect-square flex-col items-center justify-between rounded-xl border p-1.5 text-sm transition-all focus-visible:ring-2 focus-visible:outline-none active:scale-95 sm:aspect-[4/3] sm:p-2",
                inMonth
                  ? "bg-card hover:bg-muted/40"
                  : "bg-muted/20 text-muted-foreground/60 border-dashed",
                isSelected && "border-primary bg-primary/5 ring-primary/30 shadow-sm ring-2",
                isToday && !isSelected && "border-primary/60 text-primary font-semibold",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs transition-colors",
                  isToday && "bg-primary text-primary-foreground font-semibold",
                  !isToday && isSelected && "text-primary font-semibold",
                )}
              >
                {format(day, "d")}
              </span>
              {dayBookings.length > 0 && (
                <div className="flex w-full items-center justify-center gap-1">
                  <div className="flex gap-0.5">
                    {dayBookings.slice(0, 3).map((b, i) => (
                      <span
                        key={i}
                        className={cn(
                          "ring-background size-1.5 rounded-full ring-1",
                          DOT_STYLES[b.status],
                        )}
                      />
                    ))}
                  </div>
                  {dayBookings.length > 3 && (
                    <span className="text-muted-foreground text-[9px] font-medium">
                      +{dayBookings.length - 3}
                    </span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[11px]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" /> Confirmado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-500" /> Pendente
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-teal-500" /> Em andamento
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-rose-500" /> Cancelado
          </span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Day list
// ---------------------------------------------------------------------------

function DayList({
  bookings,
  onTransitHud,
}: {
  bookings: Booking[]
  onTransitHud?: (b: Booking) => void
}) {
  if (bookings.length === 0) {
    return (
      <div className="bg-muted/10 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center">
        <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl shadow-inner">
          <CalendarDays className="size-6 opacity-75" />
        </div>
        <div className="space-y-1">
          <p className="text-foreground text-sm font-medium">Dia livre de agendamentos</p>
          <p className="text-muted-foreground max-w-[280px] text-xs">
            Você não possui serviços marcados para este dia. Aproveite para descansar ou abrir
            horários extras.
          </p>
        </div>
      </div>
    )
  }

  const sorted = [...bookings].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  )

  return (
    <ul className="space-y-2.5">
      {sorted.map((b) => {
        const timeStr = formatTime(b.scheduledAt)
        const encodedAddress = encodeURIComponent(b.address)
        const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`
        const wazeUrl = `https://waze.com/ul?q=${encodedAddress}&navigate=yes`

        return (
          <li
            key={b.id}
            className="group bg-card hover:border-primary/40 relative flex flex-col justify-between gap-3 rounded-xl border p-3.5 shadow-sm transition-all hover:shadow-md sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 items-start gap-3 sm:items-center">
              {/* Horário em destaque */}
              <div className="bg-primary/10 text-primary border-primary/15 flex w-14 shrink-0 flex-col items-center justify-center rounded-xl border py-1.5">
                <span className="text-xs leading-none font-bold tabular-nums">{timeStr}</span>
                <span className="mt-0.5 text-[9px] font-semibold tracking-wider uppercase opacity-75">
                  Horário
                </span>
              </div>

              {/* Avatar do Cliente */}
              <Avatar className="size-10 border shadow-xs">
                {b.client.avatarUrl ? (
                  <AvatarImage src={b.client.avatarUrl} alt={b.client.name} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                  {initials(b.client.name)}
                </AvatarFallback>
              </Avatar>

              {/* Detalhes do serviço */}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-foreground truncate text-sm font-semibold">{b.client.name}</p>
                  <BookingStatusBadge status={b.status} />
                </div>
                <p className="text-muted-foreground truncate text-xs font-medium">
                  {b.service.title}
                </p>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                  <span className="flex max-w-[280px] items-center gap-1 truncate">
                    <MapPin className="text-muted-foreground/80 size-3 shrink-0" />
                    <span className="truncate">{b.address}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Ações e Valor */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 sm:justify-end sm:border-t-0 sm:pt-0">
              {/* Ações de rota rápidas */}
              <div className="flex flex-wrap items-center gap-1">
                {(b.status === "CONFIRMED" || b.status === "IN_PROGRESS") && onTransitHud && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onTransitHud(b)}
                    className="h-8 gap-1 border-sky-500/40 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/30"
                    title="Iniciar Modo Trânsito HUD com GPS e Check-in"
                    aria-label={`Iniciar Modo Trânsito para ${b.client.name}`}
                  >
                    <Navigation className="size-3 text-sky-500" />
                    <span>Trânsito HUD</span>
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="text-muted-foreground hover:text-foreground h-8 px-2 text-xs"
                >
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Abrir no Google Maps"
                    aria-label={`Abrir endereço no Google Maps para ${b.client.name}`}
                  >
                    <Navigation className="mr-1 size-3.5 text-blue-500" />
                    <span>Maps</span>
                  </a>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="text-muted-foreground hover:text-foreground h-8 px-2 text-xs"
                >
                  <a
                    href={wazeUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Navegar com Waze"
                    aria-label={`Navegar com Waze para ${b.client.name}`}
                  >
                    <ExternalLink className="mr-1 size-3.5 text-cyan-500" />
                    <span>Waze</span>
                  </a>
                </Button>
              </div>

              {/* Valor */}
              <div className="text-right">
                <span className="text-foreground text-sm font-bold tabular-nums">
                  {formatBRL(b.amount)}
                </span>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderAgenda() {
  const [range, setRange] = React.useState<Range>("month")
  const [cursor, setCursor] = React.useState<Date>(new Date())
  const [selectedDay, setSelectedDay] = React.useState<Date>(new Date())
  const [transitBooking, setTransitBooking] = React.useState<Booking | null>(null)

  const query = useQuery<{ items: Booking[]; total: number }>({
    queryKey: ["provider", "agenda", "all"],
    queryFn: async () =>
      apiGet("/api/bookings", {
        role: "PROVIDER",
        page: 1,
        limit: 200,
      }),
  })

  const bookings = React.useMemo(() => query.data?.items ?? [], [query.data?.items])

  // Filter bookings by range for the day-list
  const visibleBookings = React.useMemo(() => {
    const now = new Date()
    if (range === "today") {
      return bookings.filter((b) => isSameDay(new Date(b.scheduledAt), now))
    }
    if (range === "week") {
      const start = startOfWeek(now, { weekStartsOn: 0 })
      const end = endOfWeek(now, { weekStartsOn: 0 })
      return bookings.filter((b) => {
        const d = new Date(b.scheduledAt)
        return d >= start && d <= end
      })
    }
    return bookings
  }, [bookings, range])

  const dayBookings = React.useMemo(() => {
    return bookings.filter((b) => isSameDay(new Date(b.scheduledAt), selectedDay))
  }, [bookings, selectedDay])

  // Métricas do Mês selecionado
  const monthMetrics = React.useMemo(() => {
    const monthItems = bookings.filter((b) => isSameMonth(new Date(b.scheduledAt), cursor))
    const totalAmount = monthItems.reduce((acc, b) => acc + (b.amount ?? 0), 0)
    const confirmedCount = monthItems.filter(
      (b) => b.status === "CONFIRMED" || b.status === "COMPLETED",
    ).length
    return {
      count: monthItems.length,
      confirmedCount,
      totalAmount,
    }
  }, [bookings, cursor])

  const handleGoToToday = () => {
    triggerHaptic("light")
    const today = new Date()
    setCursor(today)
    setSelectedDay(today)
  }

  return (
    <div className="space-y-6">
      {/* Barra de Métricas Rápidas do Mês */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="bg-card flex items-center gap-3.5 rounded-xl border p-4 shadow-xs">
          <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
            <CalendarIcon className="size-5" />
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-medium">Agendamentos no Mês</p>
            <p className="text-foreground text-xl font-bold tracking-tight">{monthMetrics.count}</p>
          </div>
        </div>

        <div className="bg-card flex items-center gap-3.5 rounded-xl border p-4 shadow-xs">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="size-5" />
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-medium">Confirmados / Concluídos</p>
            <p className="text-xl font-bold tracking-tight text-emerald-600">
              {monthMetrics.confirmedCount}
            </p>
          </div>
        </div>

        <div className="bg-card flex items-center gap-3.5 rounded-xl border p-4 shadow-xs">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
            <TrendingUp className="size-5" />
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-medium">Previsão Financeira</p>
            <p className="text-foreground text-xl font-bold tracking-tight">
              {formatBRL(monthMetrics.totalAmount)}
            </p>
          </div>
        </div>
      </div>

      {/* Barra de Controles e Navegação */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
            <TabsList className="bg-muted/60 p-1">
              <TabsTrigger value="today" className="text-xs">
                Hoje
              </TabsTrigger>
              <TabsTrigger value="week" className="text-xs">
                Semana
              </TabsTrigger>
              <TabsTrigger value="month" className="text-xs">
                Mês
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            variant="outline"
            size="sm"
            onClick={() => useViewStore.getState().navigate("provider.routes")}
            className="h-8 gap-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            title="Otimizar sequência e rotas do dia com inteligência artificial"
          >
            <Compass className="size-3.5 text-emerald-600" />
            <span>Otimizar Rotas do Dia</span>
          </Button>
        </div>

        {range === "month" && (
          <div className="flex items-center gap-2">
            {/* Nielsen #7: Atalho 'Hoje' para retorno imediato */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleGoToToday}
              className="text-muted-foreground hover:text-foreground h-8 gap-1.5 text-xs font-medium"
            >
              <CalendarDays className="size-3.5" />
              <span>Hoje</span>
            </Button>

            <div className="bg-card flex items-center rounded-lg border shadow-xs">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => {
                  triggerHaptic("light")
                  const prev = subMonths(cursor, 1)
                  setCursor(prev)
                  setSelectedDay(prev)
                }}
                aria-label="Mês anterior"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-36 px-2 text-center text-xs font-semibold capitalize">
                {format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => {
                  triggerHaptic("light")
                  const next = addMonths(cursor, 1)
                  setCursor(next)
                  setSelectedDay(next)
                }}
                aria-label="Próximo mês"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Conteúdo Principal: Grade do Calendário + Agenda do Dia */}
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.3fr]">
        <Card className="overflow-hidden rounded-2xl border shadow-xs">
          <CardHeader className="bg-muted/20 border-b px-4 py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <CalendarIcon className="text-primary size-4" />
                <span>Calendário Mensal</span>
              </CardTitle>
              <Badge variant="outline" className="text-muted-foreground text-[11px] font-normal">
                {format(cursor, "MMMM yyyy", { locale: ptBR })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <CalendarGrid
              cursor={cursor}
              bookings={bookings}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border shadow-xs">
          <CardHeader className="bg-muted/20 border-b px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold capitalize">
                  <Clock className="text-primary size-4" />
                  <span>{format(selectedDay, "EEEE, dd 'de' MMMM", { locale: ptBR })}</span>
                </CardTitle>
              </div>
              <Badge
                variant={dayBookings.length > 0 ? "default" : "secondary"}
                className="text-[11px] font-semibold"
              >
                {dayBookings.length} {dayBookings.length === 1 ? "serviço" : "serviços"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <DayList bookings={dayBookings} onTransitHud={setTransitBooking} />
          </CardContent>
        </Card>
      </div>

      {/* Lista expandida quando o modo Hoje ou Semana estiver ativo */}
      {range !== "month" && (
        <Card className="overflow-hidden rounded-2xl border shadow-xs">
          <CardHeader className="bg-muted/20 border-b px-4 py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="text-primary size-4" />
                <span>
                  {range === "today"
                    ? "Todos os Agendamentos de Hoje"
                    : "Compromissos desta Semana"}
                </span>
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                {visibleBookings.length}{" "}
                {visibleBookings.length === 1 ? "agendamento" : "agendamentos"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <DayList bookings={visibleBookings} onTransitHud={setTransitBooking} />
          </CardContent>
        </Card>
      )}

      {transitBooking && (
        <ProviderTransitHud
          bookingId={transitBooking.id}
          clientName={transitBooking.client.name}
          clientPhone={transitBooking.clientPhone}
          clientAddress={transitBooking.address}
          destinationLat={transitBooking.lat ?? -18.8548}
          destinationLng={transitBooking.lng ?? -41.954}
          serviceTitle={transitBooking.service.title}
          onClose={() => setTransitBooking(null)}
          onCheckinSuccess={() => {
            query.refetch()
          }}
        />
      )}
    </div>
  )
}

export default ProviderAgenda
