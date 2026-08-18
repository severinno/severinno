import type { Category } from "@/lib/api"
import type { UserRole } from "@/lib/constants"

export type TopbarProps = {
  query: string
  onQueryChange: (q: string) => void
  categories: Category[]
  activeCategoryId?: string | null
  onCategorySelect?: (id: string | null) => void
  onSearchSubmit?: () => void
  /** Current sort mode — used to show a persistent indicator in the header. */
  sort?: "rating" | "distance"
  /** Whether the user has shared their location. */
  hasGeo?: boolean
}

export type NotificationsResponse = {
  items: Array<{
    id: string
    userId: string
    type: string
    title: string
    body: string | null
    read: boolean
    createdAt: string
  }>
  total: number
  unreadCount: number
}

export const DASHBOARD_VIEW: Record<UserRole, string> = {
  CLIENT: "client.dashboard",
  PROVIDER: "provider.dashboard",
  ADMIN: "admin.dashboard",
}

export const NOTIFICATION_ROUTES: Record<string, string> = {
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
