"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  XCircle,
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
import { BOOKING_STATUS_LABELS, type BookingStatus } from "@/lib/constants"
import { formatBRL, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"

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

  const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

  return (
    <div>
      <div className="text-muted-foreground grid grid-cols-7 gap-1 text-center text-[10px] font-semibold tracking-wider uppercase">
        {weekDays.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
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
              onClick={() => onSelectDay(day)}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-colors sm:aspect-[4/3]",
                inMonth ? "bg-card" : "bg-muted/30 text-muted-foreground",
                isSelected ? "border-primary ring-primary/30 ring-2" : "hover:border-primary/40",
                isToday && !isSelected && "border-primary",
              )}
            >
              <span className={cn("text-xs font-medium", isToday && "text-primary")}>
                {format(day, "d")}
              </span>
              {dayBookings.length > 0 && (
                <span className="absolute bottom-1 flex gap-0.5">
                  {dayBookings.slice(0, 3).map((b, i) => (
                    <span key={i} className={cn("size-1.5 rounded-full", DOT_STYLES[b.status])} />
                  ))}
                  {dayBookings.length > 3 && (
                    <span className="text-muted-foreground text-[8px] leading-none">+</span>
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-emerald-500" /> Confirmado
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-amber-500" /> Pendente
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-teal-500" /> Em andamento
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-rose-500" /> Cancelado
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Day list
// ---------------------------------------------------------------------------

function DayList({ bookings }: { bookings: Booking[] }) {
  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
        <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
          <CalendarDays className="size-5" />
        </div>
        <p className="text-muted-foreground text-sm">Nenhum agendamento neste dia.</p>
      </div>
    )
  }
  const sorted = [...bookings].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  )
  return (
    <ul className="grid gap-2">
      {sorted.map((b) => (
        <li
          key={b.id}
          className="bg-card hover:bg-accent/40 flex items-center gap-3 rounded-xl border p-3 transition-colors"
        >
          <div className="bg-primary/10 text-primary flex w-12 shrink-0 flex-col items-center justify-center rounded-md py-1">
            <span className="text-sm leading-none font-bold tabular-nums">
              {formatTime(b.scheduledAt).slice(0, 2)}h
            </span>
            <span className="text-[10px] leading-none tabular-nums opacity-80">
              {formatTime(b.scheduledAt).slice(3, 5)}
            </span>
          </div>
          <Avatar className="size-9 border">
            {b.client.avatarUrl ? (
              <AvatarImage src={b.client.avatarUrl} alt={b.client.name} />
            ) : null}
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {initials(b.client.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm leading-tight font-medium">{b.client.name}</p>
              <BookingStatusBadge status={b.status} />
            </div>
            <p className="text-muted-foreground truncate text-xs">{b.service.title}</p>
            <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <span className="flex items-center gap-1">
                <MapPin className="size-3" />
                <span className="truncate">{b.address}</span>
              </span>
            </div>
          </div>
          <p className="text-primary shrink-0 text-sm font-semibold tabular-nums">
            {formatBRL(b.amount)}
          </p>
        </li>
      ))}
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

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList>
            <TabsTrigger value="today">Hoje</TabsTrigger>
            <TabsTrigger value="week">Semana</TabsTrigger>
            <TabsTrigger value="month">Mês</TabsTrigger>
          </TabsList>
        </Tabs>
        {range === "month" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                const prev = subMonths(cursor, 1)
                setCursor(prev)
                setSelectedDay(prev)
              }}
              aria-label="Mês anterior"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-32 text-center text-sm font-medium capitalize">
              {format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                const next = addMonths(cursor, 1)
                setCursor(next)
                setSelectedDay(next)
              }}
              aria-label="Próximo mês"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="py-0">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm">Calendário</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <CalendarGrid
              cursor={cursor}
              bookings={bookings}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm capitalize">
              {format(selectedDay, "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <DayList bookings={dayBookings} />
          </CardContent>
        </Card>
      </div>

      {range !== "month" && (
        <Card className="py-0">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm">
              {range === "today" ? "Agendamentos de hoje" : "Agendamentos da semana"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <DayList bookings={visibleBookings} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default ProviderAgenda
