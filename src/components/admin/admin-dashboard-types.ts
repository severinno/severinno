import type { BookingStatus, PaymentStatus } from "@/lib/constants"

// ---------------------------------------------------------------------------
// Types — mirrors /api/admin/stats response
// ---------------------------------------------------------------------------

export type AdminStats = {
  usersByRole: Record<string, number>
  providers: number
  services: number
  bookingsByStatus: Record<string, number>
  quotesByStatus: Record<string, number>
  revenue: { total: number; paymentsPaid: number }
  recentBookings: Array<{
    id: string
    status: string
    paymentStatus: string
    amount: number
    scheduledAt: string
    createdAt: string
    service?: { id: string; title: string } | null
    client?: { id: string; name: string; avatarUrl?: string | null } | null
    provider?: { id: string; name: string; avatarUrl?: string | null } | null
  }>
  topProviders: Array<{
    id: string
    name: string
    avatarUrl?: string | null
    city?: string | null
    verified: boolean
    rating: number
    reviewCount: number
  }>
}

export type DateRange = "today" | "7d" | "30d" | "all"

export const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "Tudo" },
]

export const BOOKING_STATUS_ORDER: BookingStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]

export const PAYMENT_STATUS_ORDER: PaymentStatus[] = [
  "PAID",
  "PENDING",
  "HELD",
  "AUTHORIZED",
  "REFUNDED",
  "FAILED",
]

// ---------------------------------------------------------------------------
// Chart colors — cohesive palette
// ---------------------------------------------------------------------------

export const PIE_COLORS: Record<PaymentStatus, string> = {
  PAID: "hsl(160, 84%, 39%)", // emerald-500
  PENDING: "hsl(38, 92%, 50%)", // amber-500
  HELD: "hsl(238, 84%, 60%)", // indigo-500
  AUTHORIZED: "hsl(199, 89%, 48%)", // sky-500
  REFUNDED: "hsl(240, 6%, 50%)", // zinc-500
  FAILED: "hsl(0, 84%, 60%)", // red-500
}
