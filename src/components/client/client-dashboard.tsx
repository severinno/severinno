"use client";

/**
 * ClientDashboard — overview dashboard for the logged-in client.
 *
 * Sections:
 *  - 4 stat cards: Próximos agendamentos, Orçamentos ativos, Serviços
 *    concluídos, Total investido (sum of paid bookings)
 *  - Charts: bookings per month (bar), spending per category (pie)
 *  - Recent activity (latest 5 bookings/quotes)
 *  - Quick actions: "Pedir orçamento" / "Buscar prestadores"
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  MapPin,
  Plus,
  Search,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { apiGet } from "@/lib/api";
import {
  BOOKING_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  type BookingStatus,
  type QuoteStatus,
  type ServiceUnit,
} from "@/lib/constants";
import { formatBRL, formatDateTime, formatRelative } from "@/lib/format";
import { useAuthStore, useUIStore, useViewStore } from "@/store";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState, SectionTitle, StatCard } from "@/components/shared/dashboard-shell";
import { OnboardingChecklist } from "@/components/client/onboarding-checklist";
import {
  PageHeader,
  StatusBadge,
  bookingIcon,
  bookingTone,
  quoteIcon,
  quoteTone,
} from "@/components/client/client-shared";

// Emerald family palette for the category donut.
const PIE_COLORS = [
  "var(--chart-1)", // emerald-600
  "oklch(0.7 0.16 162)", // emerald-400
  "oklch(0.62 0.12 184)", // teal-400
  "oklch(0.6 0.13 200)", // teal-500
  "oklch(0.78 0.18 130)", // lime-400
  "oklch(0.65 0.15 145)", // emerald-500
  "oklch(0.55 0.13 175)", // teal-600
  "oklch(0.72 0.14 150)", // emerald-300
] as const;

const CHART_TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.15)",
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Booking = {
  id: string;
  status: BookingStatus;
  scheduledAt: string;
  amount: number;
  paymentStatus: string;
  service: {
    id: string;
    title: string;
    basePrice: number;
    unit: ServiceUnit;
    category?: { id: string; name: string } | null;
  };
  provider: { id: string; name: string; avatarUrl?: string | null };
};

type Quote = {
  id: string;
  status: QuoteStatus;
  createdAt: string;
  expiresAt: string;
  provider: { id: string; name: string; avatarUrl?: string | null };
  items: Array<{ id: string; service: { id: string; title: string } }>;
};

type BookingsResponse = {
  items: Booking[];
  total: number;
  page: number;
  limit: number;
};
type QuotesResponse = {
  items: Quote[];
  total: number;
  page: number;
  limit: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientDashboard() {
  const navigate = useViewStore((s) => s.navigate);
  const openQuote = useUIStore((s) => s.openQuote);
  const user = useAuthStore((s) => s.user);

  const firstName = (user?.name ?? "").trim().split(/\s+/)[0];

  // Pull all bookings + quotes for stats. Server paginates at 50 max.
  const bookingsQuery = useQuery<BookingsResponse>({
    queryKey: ["bookings", "CLIENT", "dashboard"],
    queryFn: () =>
      apiGet<BookingsResponse>("/api/bookings", {
        role: "CLIENT",
        page: 1,
        limit: 50,
      }),
  });
  const quotesQuery = useQuery<QuotesResponse>({
    queryKey: ["quotes", "CLIENT", "dashboard"],
    queryFn: () =>
      apiGet<QuotesResponse>("/api/quotes", {
        role: "CLIENT",
        page: 1,
        limit: 50,
      }),
  });

  const bookings = bookingsQuery.data?.items ?? [];
  const quotes = quotesQuery.data?.items ?? [];

  // ---- Derived stats ---------------------------------------------------------
  const upcomingCount = bookings.filter((b) =>
    ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(b.status),
  ).length;

  const activeQuotesCount = quotes.filter((q) =>
    ["PENDING", "RESPONDED"].includes(q.status),
  ).length;

  const completedCount = bookings.filter((b) => b.status === "COMPLETED").length;

  const totalInvested = bookings
    .filter((b) => b.paymentStatus === "PAID")
    .reduce((acc, b) => acc + b.amount, 0);

  // ---- Monthly bookings chart (last 6 months) --------------------------------
  // Note: computed without useMemo so the React Compiler can manage memoization.
  const monthlyData = (() => {
    const now = new Date();
    const baseMonths: Array<{ key: string; label: string; total: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      baseMonths.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: MONTH_LABELS[d.getMonth()] ?? "",
        total: 0,
      });
    }
    const counts = bookings.reduce<Record<string, number>>((acc, b) => {
      const d = new Date(b.scheduledAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    return baseMonths.map((m) => ({ ...m, total: counts[m.key] ?? 0 }));
  })();

  // ---- Spending per category pie --------------------------------------------
  const spendingByCategory = (() => {
    const map = bookings
      .filter((b) => b.paymentStatus === "PAID")
      .reduce<Record<string, number>>((acc, b) => {
        const cat = b.service.category?.name ?? "Outros";
        acc[cat] = (acc[cat] ?? 0) + b.amount;
        return acc;
      }, {});
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  })();

  // ---- Recent activity (latest 5 bookings + 5 quotes, merged by date) --------
  const recentActivity = (() => {
    const fromBookings = bookings.slice(0, 8).map((b) => ({
      type: "booking" as const,
      id: b.id,
      at: b.scheduledAt,
      title: b.service.title,
      status: b.status,
      provider: b.provider,
      amount: b.amount,
    }));
    const fromQuotes = quotes.slice(0, 8).map((q) => ({
      type: "quote" as const,
      id: q.id,
      at: q.createdAt,
      title: q.items[0]?.service?.title ?? "Orçamento",
      status: q.status,
      provider: q.provider,
    }));
    return [...fromBookings, ...fromQuotes]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 5);
  })();

  const upcomingBookings = bookings
    .filter((b) => ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(b.status))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const activeQuotes = quotes
    .filter((q) => ["PENDING", "RESPONDED"].includes(q.status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const isLoading = bookingsQuery.isLoading || quotesQuery.isLoading;

  return (
    <div className="space-y-6">
      {/* Greeting + quick actions */}
      <PageHeader
        title={`Olá${firstName ? ", " : ""}${firstName} 👋`}
        subtitle="Acompanhe seus agendamentos, orçamentos e gastos em um só lugar."
        action={
          <>
            <Button variant="outline" onClick={() => navigate("vitrine")} className="h-10 gap-2">
              <Search className="size-4" />
              Buscar prestadores
            </Button>
            <Button onClick={() => openQuote()} className="h-10 gap-2">
              <Plus className="size-4" />
              Pedir orçamento
            </Button>
          </>
        }
      />

      {/* Onboarding checklist — only shows if profile is incomplete */}
      <OnboardingChecklist />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          index={0}
          icon={CalendarDays}
          label="Próximos agendamentos"
          value={upcomingCount}
          tone="primary"
          hint="Pendentes, confirmados e em andamento"
        />
        <StatCard
          index={1}
          icon={FileText}
          label="Orçamentos ativos"
          value={activeQuotesCount}
          tone="amber"
          hint="Aguardando resposta ou ação"
        />
        <StatCard
          index={2}
          icon={CheckCircle2}
          label="Serviços concluídos"
          value={completedCount}
          tone="sky"
          hint="Histórico de serviços"
        />
        <StatCard
          index={3}
          icon={Wallet}
          label="Total investido"
          value={formatBRL(totalInvested)}
          tone="primary"
          hint="Soma de pagamentos confirmados"
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Monthly bookings */}
        <Card className="rounded-xl shadow-sm lg:col-span-3">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <TrendingUp className="size-4" />
                </span>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Agendamentos por mês
                </p>
              </div>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-bookings" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(v: number) => [`${v} agendamento${v !== 1 ? "s" : ""}`, "Total"]}
                    cursor={{ stroke: "var(--primary)", strokeWidth: 1, strokeDasharray: "3 3" }}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    fill="url(#grad-bookings)"
                    activeDot={{ r: 4, fill: "var(--primary)" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Spending per category pie */}
        <Card className="rounded-xl shadow-sm lg:col-span-2">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Wallet className="size-4" />
                </span>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Gastos por categoria
                </p>
              </div>
            </div>
            {spendingByCategory.length === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Wallet className="size-5" />
                </span>
                <p className="text-sm text-muted-foreground">Sem gastos confirmados ainda.</p>
              </div>
            ) : (
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={spendingByCategory}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      stroke="var(--background)"
                      strokeWidth={2}
                    >
                      {spendingByCategory.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, n: string) => [formatBRL(v), n]}
                      contentStyle={CHART_TOOLTIP_STYLE}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {spendingByCategory.length > 0 ? (
              <ul className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {spendingByCategory.slice(0, 6).map((c, i) => (
                  <li key={c.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        background: PIE_COLORS[i % PIE_COLORS.length],
                      }}
                    />
                    <span className="truncate text-muted-foreground">{c.name}</span>
                    <span className="ml-auto shrink-0 font-medium tabular-nums">
                      {formatBRL(c.value)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <div className="space-y-3">
        <SectionTitle
          title="Atividade recente"
          description="Seus últimos agendamentos e orçamentos."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("client.bookings")}
              className="h-9 gap-1.5 text-primary hover:text-primary"
            >
              Ver tudo
              <ChevronRight className="size-4" />
            </Button>
          }
        />

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            Carregando atividade…
          </div>
        ) : recentActivity.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nenhuma atividade ainda"
            description="Quando você começar a agendar ou solicitar orçamentos, suas atividades recentes aparecerão aqui."
            action={
              <Button onClick={() => navigate("vitrine")} className="mt-2 gap-2">
                <MapPin className="size-4" />
                Buscar prestadores
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden rounded-xl shadow-sm">
            <CardContent className="divide-y p-0">
              {recentActivity.map((a) => {
                const provider = a.provider;
                const initials = (provider.name ?? "")
                  .split(" ")
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();
                const isBooking = a.type === "booking";
                const status = a.status as BookingStatus | QuoteStatus;
                const tone = isBooking
                  ? bookingTone(status as BookingStatus)
                  : quoteTone(status as QuoteStatus);
                const Icon = isBooking
                  ? bookingIcon(status as BookingStatus)
                  : quoteIcon(status as QuoteStatus);
                const label = isBooking
                  ? BOOKING_STATUS_LABELS[status as BookingStatus]
                  : QUOTE_STATUS_LABELS[status as QuoteStatus];
                return (
                  <button
                    key={`${a.type}-${a.id}`}
                    type="button"
                    onClick={() => navigate(isBooking ? "client.bookings" : "client.quotes")}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40"
                  >
                    <Avatar className="size-9 shrink-0">
                      {provider.avatarUrl ? (
                        <AvatarImage src={provider.avatarUrl} alt={provider.name} />
                      ) : null}
                      <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      <p className="truncate text-xs text-muted-foreground tabular-nums">
                        {isBooking ? "Agendamento" : "Orçamento"} · {provider.name} ·{" "}
                        {formatRelative(a.at)}
                      </p>
                    </div>
                    {isBooking && a.type === "booking" ? (
                      <span className="hidden text-sm font-semibold tabular-nums sm:block">
                        {formatBRL(a.amount)}
                      </span>
                    ) : null}
                    <StatusBadge tone={tone} icon={Icon}>
                      {label}
                    </StatusBadge>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Upcoming bookings + Active quotes side-by-side (mobile stacked) */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Upcoming bookings */}
        <div className="space-y-3">
          <SectionTitle
            title="Próximos agendamentos"
            description="Serviços agendados para os próximos dias."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("client.bookings")}
                className="h-9 gap-1.5 text-primary hover:text-primary"
              >
                Ver tudo
                <ChevronRight className="size-4" />
              </Button>
            }
          />
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Carregando agendamentos…
            </div>
          ) : upcomingBookings.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nenhum agendamento próximo"
              description="Que tal agendar seu primeiro serviço? Explore prestadores verificados perto de você."
              action={
                <Button onClick={() => navigate("vitrine")} className="mt-2 gap-2">
                  <MapPin className="size-4" />
                  Buscar prestadores
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {upcomingBookings.slice(0, 3).map((b) => {
                const initials = (b.provider.name ?? "")
                  .split(" ")
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => navigate("client.bookings")}
                    className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left outline-none transition-all hover:border-primary/30 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Avatar className="size-10 shrink-0">
                      {b.provider.avatarUrl ? (
                        <AvatarImage src={b.provider.avatarUrl} alt={b.provider.name} />
                      ) : null}
                      <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{b.service.title}</p>
                      <p className="truncate text-xs text-muted-foreground tabular-nums">
                        {formatDateTime(b.scheduledAt)} · {b.provider.name}
                      </p>
                    </div>
                    <StatusBadge
                      tone={bookingTone(b.status as BookingStatus)}
                      icon={bookingIcon(b.status as BookingStatus)}
                    >
                      {BOOKING_STATUS_LABELS[b.status as BookingStatus]}
                    </StatusBadge>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Active quotes */}
        <div className="space-y-3">
          <SectionTitle
            title="Orçamentos ativos"
            description="Aguardando resposta do prestador ou sua ação."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("client.quotes")}
                className="h-9 gap-1.5 text-primary hover:text-primary"
              >
                Ver tudo
                <ChevronRight className="size-4" />
              </Button>
            }
          />
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Carregando orçamentos…
            </div>
          ) : activeQuotes.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhum orçamento ativo"
              description="Solicite um orçamento e acompanhe a resposta dos prestadores aqui."
              action={
                <Button onClick={() => openQuote()} className="mt-2 gap-2">
                  <Plus className="size-4" />
                  Pedir orçamento
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {activeQuotes.slice(0, 3).map((q) => {
                const initials = (q.provider.name ?? "")
                  .split(" ")
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => navigate("client.quotes")}
                    className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left outline-none transition-all hover:border-primary/30 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Avatar className="size-10 shrink-0">
                      {q.provider.avatarUrl ? (
                        <AvatarImage src={q.provider.avatarUrl} alt={q.provider.name} />
                      ) : null}
                      <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                        {initials || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {q.items[0]?.service?.title ?? "Orçamento"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground tabular-nums">
                        {q.provider.name} · {formatRelative(q.createdAt)}
                      </p>
                    </div>
                    <StatusBadge
                      tone={quoteTone(q.status as QuoteStatus)}
                      icon={quoteIcon(q.status as QuoteStatus)}
                    >
                      {QUOTE_STATUS_LABELS[q.status as QuoteStatus]}
                    </StatusBadge>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
