"use client"

/**
 * EmptyState — reusable empty/zero-data component with inline SVG illustrations.
 *
 * Pre-defined variants cover the most common marketplace scenarios.
 * Supports custom icon, title, description and CTA for extensibility.
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { FileText, Wrench, MessageCircle, CalendarCheck, Star, type LucideIcon } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type EmptyStateVariant =
  "no-quotes" | "no-services" | "no-messages" | "no-bookings" | "no-reviews" | "generic"

type EmptyStateProps = {
  variant?: EmptyStateVariant
  icon?: LucideIcon
  title?: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  actionHref?: string
  className?: string
  children?: React.ReactNode
}

// ---------------------------------------------------------------------------
// Variant config
// ---------------------------------------------------------------------------
const VARIANTS: Record<
  EmptyStateVariant,
  { icon: LucideIcon; title: string; description: string; actionLabel?: string }
> = {
  "no-quotes": {
    icon: FileText,
    title: "Nenhum orçamento ainda",
    description:
      "Quando você solicitar orçamentos, eles aparecerão aqui. Encontre o profissional ideal para o que precisa!",
    actionLabel: "Solicitar agora",
  },
  "no-services": {
    icon: Wrench,
    title: "Você ainda não cadastrou serviços",
    description:
      "Adicione seu primeiro serviço para que clientes possam encontrá-lo na vitrine e solicitar orçamentos.",
    actionLabel: "Adicionar serviço",
  },
  "no-messages": {
    icon: MessageCircle,
    title: "Sem mensagens",
    description:
      "Suas conversas com clientes e prestadores aparecerão aqui. Comece enviando uma mensagem!",
  },
  "no-bookings": {
    icon: CalendarCheck,
    title: "Nenhum agendamento",
    description:
      "Quando serviços forem agendados, eles aparecerão nesta seção. Comece buscando profissionais na vitrine.",
    actionLabel: "Buscar profissionais",
  },
  "no-reviews": {
    icon: Star,
    title: "Sem avaliações ainda",
    description:
      "As avaliações de clientes aparecerão aqui. Complete serviços com qualidade para receber boas avaliações!",
  },
  generic: {
    icon: FileText,
    title: "Nenhum item encontrado",
    description: "Não há dados para exibir no momento.",
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EmptyState({
  variant = "generic",
  icon: IconOverride,
  title: titleOverride,
  description: descOverride,
  actionLabel: actionLabelOverride,
  onAction,
  actionHref,
  className,
  children,
}: EmptyStateProps) {
  const config = VARIANTS[variant]
  const Icon = IconOverride ?? config.icon
  const title = titleOverride ?? config.title
  const description = descOverride ?? config.description
  const actionLabel = actionLabelOverride ?? config.actionLabel

  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}
    >
      {/* Decorative ring around icon */}
      <div className="relative mb-6">
        <div className="bg-primary/5 absolute -inset-3 rounded-full" />
        <div className="bg-primary/10 relative flex size-16 items-center justify-center rounded-full">
          <Icon className="text-primary size-7" />
        </div>
      </div>

      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">{description}</p>

      {actionLabel && (onAction || actionHref) && (
        <div className="mt-6">
          {actionHref ? (
            <Button asChild>
              <a href={actionHref}>{actionLabel}</a>
            </Button>
          ) : (
            <Button onClick={onAction}>{actionLabel}</Button>
          )}
        </div>
      )}

      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}

export default EmptyState
