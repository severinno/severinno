"use client"

import * as React from "react"
import { ArrowRight, Star } from "lucide-react"

import { formatBRL } from "@/lib/format"
import type { BookingStatus } from "@/lib/constants"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useUIStore } from "@/store/ui"
import { BookingStatusBadge, initials } from "./_shared"
import type { AdminStats } from "./admin-dashboard-types"

// ---------------------------------------------------------------------------
// Recent Bookings Table
// ---------------------------------------------------------------------------

export function RecentBookingsTable({
  bookings,
  onNavigate,
}: {
  bookings: AdminStats["recentBookings"]
  onNavigate: (view: string) => void
}) {
  const rows = bookings.slice(0, 5)
  const openProvider = useUIStore((s) => s.openProvider)

  return (
    <div className="border-border/50 bg-card overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="text-foreground text-sm font-semibold">Agendamentos recentes</h2>
        <button
          type="button"
          onClick={() => onNavigate("admin.bookings")}
          className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Ver todos
          <ArrowRight className="size-3" />
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-muted-foreground px-5 py-12 text-center text-sm">
          Nenhum agendamento encontrado.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground h-10 border-b text-xs font-medium">
                <th className="px-4 font-medium">Cliente</th>
                <th className="px-4 font-medium">Prestador</th>
                <th className="px-4 font-medium">Serviço</th>
                <th className="px-4 text-right font-medium">Valor</th>
                <th className="px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((b) => {
                const status = b.status as BookingStatus
                return (
                  <tr key={b.id} className="hover:bg-muted/20 h-12 transition-colors">
                    {/* Client */}
                    <td className="px-4">
                      <div className="flex items-center gap-2">
                        <Avatar className="size-6 shrink-0">
                          {b.client?.avatarUrl ? (
                            <AvatarImage src={b.client.avatarUrl} alt={b.client.name ?? ""} />
                          ) : null}
                          <AvatarFallback className="bg-primary/8 text-primary text-[10px] font-semibold">
                            {initials(b.client?.name ?? "?")}
                          </AvatarFallback>
                        </Avatar>
                        <span className="max-w-[120px] truncate text-xs">
                          {b.client?.name ?? "—"}
                        </span>
                      </div>
                    </td>
                    {/* Provider */}
                    <td className="px-4">
                      {b.provider?.id ? (
                        <button
                          type="button"
                          onClick={() => openProvider(b.provider!.id)}
                          className="group flex items-center gap-2 text-left transition-colors focus-visible:outline-hidden"
                          aria-label={`Ver perfil de ${b.provider.name ?? "prestador"}`}
                        >
                          <Avatar className="size-6 shrink-0 transition-transform group-hover:scale-105">
                            {b.provider.avatarUrl ? (
                              <AvatarImage src={b.provider.avatarUrl} alt={b.provider.name ?? ""} />
                            ) : null}
                            <AvatarFallback className="bg-primary/8 text-primary text-[10px] font-semibold">
                              {initials(b.provider.name ?? "?")}
                            </AvatarFallback>
                          </Avatar>
                          <span className="group-hover:text-primary max-w-[120px] truncate text-xs transition-colors">
                            {b.provider.name ?? "—"}
                          </span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Avatar className="size-6 shrink-0">
                            {b.provider?.avatarUrl ? (
                              <AvatarImage src={b.provider.avatarUrl} alt={b.provider.name ?? ""} />
                            ) : null}
                            <AvatarFallback className="bg-primary/8 text-primary text-[10px] font-semibold">
                              {initials(b.provider?.name ?? "?")}
                            </AvatarFallback>
                          </Avatar>
                          <span className="max-w-[120px] truncate text-xs">
                            {b.provider?.name ?? "—"}
                          </span>
                        </div>
                      )}
                    </td>
                    {/* Service */}
                    <td className="px-4">
                      <span className="text-muted-foreground block max-w-[140px] truncate text-xs">
                        {b.service?.title ?? "—"}
                      </span>
                    </td>
                    {/* Amount */}
                    <td className="px-4 text-right">
                      <span className="text-xs font-medium tabular-nums">
                        {formatBRL(b.amount)}
                      </span>
                    </td>
                    {/* Status */}
                    <td className="px-4">
                      <BookingStatusBadge status={status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top Providers List
// ---------------------------------------------------------------------------

export function TopProvidersList({
  providers,
  onNavigate,
}: {
  providers: AdminStats["topProviders"]
  onNavigate: (view: string) => void
}) {
  const items = providers.slice(0, 5)
  const openProvider = useUIStore((s) => s.openProvider)

  return (
    <div className="border-border/50 bg-card overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="text-foreground text-sm font-semibold">Prestadores em destaque</h2>
        <button
          type="button"
          onClick={() => onNavigate("admin.providers")}
          className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Ver todos
          <ArrowRight className="size-3" />
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-muted-foreground px-5 py-12 text-center text-sm">
          Nenhum prestador encontrado.
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((p) => (
            <li key={p.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => openProvider(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    openProvider(p.id)
                  }
                }}
                className="hover:bg-muted/30 group flex cursor-pointer items-center gap-3 px-5 py-3 outline-hidden transition-colors"
                aria-label={`Ver perfil de ${p.name}`}
              >
                <Avatar className="size-9 shrink-0 transition-transform group-hover:scale-105">
                  {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                  <AvatarFallback className="bg-primary/8 text-primary text-[11px] font-semibold">
                    {initials(p.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground group-hover:text-primary truncate text-sm font-medium transition-colors">
                    {p.name}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    <span className="text-foreground text-xs font-medium tabular-nums">
                      {p.rating.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground text-xs">({p.reviewCount})</span>
                  </div>
                </div>
                {p.city ? (
                  <span className="text-muted-foreground shrink-0 text-xs">{p.city}</span>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground h-7 px-2 text-xs opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    openProvider(p.id)
                  }}
                >
                  Ver perfil
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
