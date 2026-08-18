import type { LucideIcon } from "lucide-react"

export type NavItem = {
  label: string
  icon: LucideIcon
  view: string
  badge?: number | string
}

export type Breadcrumb = { label: string; onClick?: () => void }

export type ShellUser = {
  id?: string
  name?: string | null
  email?: string | null
  role?: "CLIENT" | "PROVIDER" | "ADMIN"
  avatarUrl?: string | null
}

export type DashboardShellProps = {
  navItems: NavItem[]
  currentView: string
  title: string
  subtitle?: string
  breadcrumbs?: Breadcrumb[]
  panelLabel: string
  panelIcon: LucideIcon
  user?: ShellUser | null
  onNavigate: (view: string) => void
  children: React.ReactNode
  className?: string
}

export type NotificationItem = {
  id: string
  type: string
  title: string
  body?: string | null
  read: boolean
  createdAt: string
}

export type NotificationsResponse = {
  items: NotificationItem[]
  total: number
  page: number
  limit: number
  unreadCount: number
}

export const NOTIFICATION_ROUTES: Record<string, string> = {
  BOOKING_CONFIRMED: "client.bookings",
  BOOKING_CANCELLED: "client.bookings",
  BOOKING_COMPLETED: "client.bookings",
  QUOTE_RECEIVED: "client.quotes",
  QUOTE_APPROVED: "client.quotes",
  MESSAGE: "client.messages",
  REVIEW_RECEIVED: "client.reviews",
  WELCOME: "client.dashboard",
  BOOKING_CREATED: "provider.agenda",
  PAYMENT_CONFIRMED: "client.payments",
  ADMIN_MANUAL: "client.dashboard",
  PROMOTION: "vitrine",
  REMINDER: "client.bookings",
  UPDATE: "client.dashboard",
}

export const DASHBOARD_VIEW: Record<string, string> = {
  CLIENT: "client.dashboard",
  PROVIDER: "provider.dashboard",
  ADMIN: "admin.dashboard",
}
