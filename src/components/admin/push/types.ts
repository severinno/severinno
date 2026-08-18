export type PushUser = {
  id: string
  name: string
  email: string
  role: string
  avatarUrl: string | null
  city: string | null
  state: string | null
  subscriptionsCount: number
}

export type UsersResponse = {
  items: PushUser[]
  total: number
  page: number
  limit: number
  totalSubscriptions: number
}

export type ScheduledItem = {
  id: string
  scheduledAt: string
  status: "PENDING" | "SENT" | "CANCELLED" | "FAILED"
  title: string
  body: string | null
  pushUrl: string
  type: string
  sentCount: number
  errorCount: number
  sentAt: string | null
  createdAt: string
  userIdsCount: number
}

export type ScheduleResponse = {
  ok: boolean
  items: ScheduledItem[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export type EventWebhookItem = {
  id: string
  event: string
  title: string
  body: string | null
  pushUrl: string
  targetRoles: string[]
  active: boolean
  createdAt: string
  updatedAt: string
}

export const EVENTS_LIST = [
  {
    value: "booking.created",
    label: "Agendamento criado",
    vars: "clientName, serviceName, providerName, date",
  },
  {
    value: "booking.confirmed",
    label: "Agendamento confirmado",
    vars: "clientName, serviceName, providerName, date",
  },
  {
    value: "booking.cancelled",
    label: "Agendamento cancelado",
    vars: "clientName, serviceName, providerName, date",
  },
  {
    value: "booking.completed",
    label: "Agendamento concluído",
    vars: "clientName, serviceName, providerName, date",
  },
  {
    value: "review.created",
    label: "Nova avaliação",
    vars: "clientName, providerName, serviceName, rating, comment",
  },
  {
    value: "quote.received",
    label: "Orçamento recebido",
    vars: "clientName, providerName, serviceName, itemsCount",
  },
  {
    value: "quote.responded",
    label: "Orçamento respondido",
    vars: "providerName, clientName, serviceName, amount",
  },
  {
    value: "payment.confirmed",
    label: "Pagamento confirmado",
    vars: "clientName, providerName, amount",
  },
  { value: "message.sent", label: "Nova mensagem", vars: "fromName, toName, content" },
  {
    value: "provider.registered",
    label: "Prestador cadastrado",
    vars: "providerName, city, state",
  },
]

export const ROLE_OPTIONS = [
  { value: "ALL", label: "Todas as roles" },
  { value: "CLIENT", label: "Clientes" },
  { value: "PROVIDER", label: "Prestadores" },
  { value: "ADMIN", label: "Administradores" },
]

export const NOTIFICATION_TYPES = [
  { value: "ADMIN_MANUAL", label: "Mensagem administrativa" },
  { value: "PROMOTION", label: "Promoção" },
  { value: "REMINDER", label: "Lembrete" },
  { value: "UPDATE", label: "Atualização" },
]

export const TARGET_ROLE_OPTIONS = [
  { value: "CLIENT", label: "Clientes" },
  { value: "PROVIDER", label: "Prestadores" },
  { value: "ADMIN", label: "Administradores" },
]

export const EVENT_VARIABLES: Record<string, string[]> = {
  "booking.created": ["clientName", "serviceName", "providerName", "date"],
  "booking.confirmed": ["clientName", "serviceName", "providerName", "date"],
  "booking.cancelled": ["clientName", "serviceName", "providerName", "date"],
  "booking.completed": ["clientName", "serviceName", "providerName", "date"],
  "review.created": ["clientName", "serviceName", "providerName", "rating", "comment"],
  "quote.received": ["clientName", "serviceName", "providerName", "itemsCount"],
  "quote.responded": ["clientName", "serviceName", "providerName", "amount"],
  "payment.confirmed": ["clientName", "serviceName", "providerName", "amount"],
  "message.sent": ["fromName", "toName", "content"],
  "provider.registered": ["providerName", "city", "state"],
}

export const WEBHOOK_TEMPLATES: Record<
  string,
  {
    title: string
    body: string
    pushUrl: string
    targetRoles: string[]
  }
> = {
  "booking.created": {
    title: "📅 Novo agendamento: {{serviceName}}",
    body: "{{clientName}} agendou {{serviceName}} com {{providerName}} para {{date}}",
    pushUrl: "/admin/bookings",
    targetRoles: ["ADMIN", "PROVIDER"],
  },
  "booking.confirmed": {
    title: "✅ Agendamento confirmado: {{serviceName}}",
    body: "{{clientName}} confirmou {{serviceName}} com {{providerName}} para {{date}}",
    pushUrl: "/admin/bookings",
    targetRoles: ["ADMIN", "PROVIDER"],
  },
  "booking.cancelled": {
    title: "❌ Agendamento cancelado: {{serviceName}}",
    body: "{{clientName}} cancelou {{serviceName}} com {{providerName}} em {{date}}",
    pushUrl: "/admin/bookings",
    targetRoles: ["ADMIN", "PROVIDER"],
  },
  "booking.completed": {
    title: "🎉 Serviço concluído: {{serviceName}}",
    body: "{{serviceName}} de {{clientName}} com {{providerName}} foi concluído em {{date}}",
    pushUrl: "/admin/bookings",
    targetRoles: ["CLIENT", "PROVIDER"],
  },
  "review.created": {
    title: "⭐ {{rating}} estrelas — Nova avaliação",
    body: '{{clientName}} avaliou {{serviceName}}: "{{comment}}"',
    pushUrl: "/admin/reviews",
    targetRoles: ["ADMIN", "PROVIDER"],
  },
  "quote.received": {
    title: "📋 Orçamento recebido: {{serviceName}}",
    body: "{{clientName}} solicitou orçamento de {{serviceName}} — {{itemsCount}} itens",
    pushUrl: "/admin/quotes",
    targetRoles: ["PROVIDER"],
  },
  "quote.responded": {
    title: "💰 Orçamento respondido: {{serviceName}}",
    body: "{{providerName}} respondeu ao orçamento de {{serviceName}} — R$ {{amount}}",
    pushUrl: "/admin/quotes",
    targetRoles: ["CLIENT", "ADMIN"],
  },
  "payment.confirmed": {
    title: "💳 Pagamento confirmado — R$ {{amount}}",
    body: "{{clientName}} pagou {{providerName}} — {{serviceName}} — R$ {{amount}}",
    pushUrl: "/admin/finances",
    targetRoles: ["ADMIN", "PROVIDER"],
  },
  "message.sent": {
    title: "💬 Nova mensagem de {{fromName}}",
    body: '{{fromName}} enviou: "{{content}}"',
    pushUrl: "/messages",
    targetRoles: ["CLIENT", "PROVIDER"],
  },
  "provider.registered": {
    title: "👷 Novo prestador cadastrado",
    body: "{{providerName}} se cadastrou na plataforma — {{city}}/{{state}}",
    pushUrl: "/admin/providers",
    targetRoles: ["ADMIN"],
  },
}
