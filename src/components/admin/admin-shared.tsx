"use client"

/**
 * admin-shared — design system compartilhado de TODOS os painéis admin.
 *
 * Fundamentado nas 10 heurísticas de Jakob Nielsen:
 *   H1  Visibilidade do status do sistema   → LoadingSkeleton, ErrorState, SavingPill, freshness
 *   H2  Correspondência com o mundo real    → labels pt-BR, linguagem do domínio
 *   H3  Controle e liberdade do usuário     → ConfirmDialog (undo), Descartar
 *   H4  Consistência e padrões              → UMA source of truth p/ badges/tons
 *   H5  Prevenção de erros                  → ConfirmToggleDialog antes de ações destrutivas
 *   H6  Reconhecimento > memorização        → ícones em todos os badges, tooltips em icon-buttons
 *   H7  Flexibilidade e eficiência          → atalhos kbd, bulk-ready, keyboard-friendly
 *   H8  Estética e design minimalista       → respiro, hierarquia clara, sem poluição
 *   H9  Recuperar erros                     → ErrorState com retry actionável
 *   H10 Ajuda e documentação                → captions, help tooltips em campos técnicos
 *
 * Este módulo substitui ~400 linhas duplicadas e CORRIGE a divergência de
 * cores de status (admin-bookings usava teal/emerald; constants usa sky/zinc).
 * Agora há UMA única source of truth.
 */

import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  ShieldX,
  Trash2,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  type BookingStatus,
  type PaymentStatus,
  type QuoteStatus,
  type UserRole,
  ROLE_LABELS,
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/constants"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

// ===========================================================================
// Helpers (pure functions — substituem 5-6 cópias)
// ===========================================================================

export function initials(name?: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

export function errMsg(e: unknown, fallback = "Ocorreu um erro inesperado."): string {
  if (e instanceof Error) return e.message || fallback
  if (typeof e === "string") return e
  return fallback
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

// ===========================================================================
// Tons de status — UMA source of truth (H4 consistência)
// ===========================================================================

export type StatusTone =
  | "emerald"
  | "amber"
  | "rose"
  | "teal"
  | "zinc"
  | "sky"

const TONE_CLASS: Record<StatusTone, string> = {
  emerald:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  amber:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
}

export function StatusBadge({
  tone,
  icon: Icon,
  children,
  className,
  spin,
}: {
  tone: StatusTone
  icon?: LucideIcon
  children: React.ReactNode
  className?: string
  spin?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-inset ring-current/10",
        TONE_CLASS[tone],
        className,
      )}
    >
      {Icon ? (
        <Icon className={cn("size-[13px] shrink-0", spin && "animate-spin")} />
      ) : null}
      {children}
    </span>
  )
}

// ---- Status tone/icon centralizado (H4) ----------------------------------

export function bookingTone(status: BookingStatus): StatusTone {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
      return "emerald"
    case "PENDING":
      return "amber"
    case "IN_PROGRESS":
      return "teal"
    case "CANCELLED":
      return "rose"
    default:
      return "zinc"
  }
}

export function bookingIcon(status: BookingStatus): LucideIcon {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
      return CheckCircle2
    case "PENDING":
      return Clock
    case "IN_PROGRESS":
      return Loader2
    case "CANCELLED":
      return XCircle
    default:
      return XCircle
  }
}

export function quoteTone(status: QuoteStatus): StatusTone {
  switch (status) {
    case "APPROVED":
    case "RESPONDED":
      return "emerald"
    case "PENDING":
      return "amber"
    case "REJECTED":
    case "EXPIRED":
      return "rose"
    default:
      return "zinc"
  }
}

export function paymentTone(status: PaymentStatus): StatusTone {
  switch (status) {
    case "PAID":
      return "emerald"
    case "PENDING":
      return "amber"
    case "REFUNDED":
      return "rose"
    default:
      return "zinc"
  }
}

export function paymentIcon(status: PaymentStatus): LucideIcon {
  switch (status) {
    case "PAID":
      return CheckCircle2
    case "PENDING":
      return Clock
    case "REFUNDED":
      return RotateCcw
    default:
      return XCircle
  }
}

// ---- Badges específicos ---------------------------------------------------

export function RoleBadge({ role }: { role: UserRole }) {
  const tone: Record<UserRole, StatusTone> = {
    ADMIN: "emerald",
    PROVIDER: "teal",
    CLIENT: "zinc",
  }
  const Icon: Record<UserRole, LucideIcon> = {
    ADMIN: ShieldCheck,
    PROVIDER: ShieldCheck,
    CLIENT: ShieldCheck,
  }
  return (
    <StatusBadge tone={tone[role]} icon={Icon[role]}>
      {ROLE_LABELS[role]}
    </StatusBadge>
  )
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <StatusBadge tone={active ? "emerald" : "zinc"}>
      {active ? "Ativo" : "Inativo"}
    </StatusBadge>
  )
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <StatusBadge tone="emerald" icon={ShieldCheck}>
        Verificado
      </StatusBadge>
    )
  }
  return (
    <StatusBadge tone="amber" icon={ShieldX}>
      Não verificado
    </StatusBadge>
  )
}

export function BookingStatusBadge({
  status,
  spin,
}: {
  status: BookingStatus
  spin?: boolean
}) {
  const tone = bookingTone(status)
  const Icon = bookingIcon(status)
  const isInProgress = status === "IN_PROGRESS"
  return (
    <StatusBadge tone={tone} icon={Icon} spin={spin ?? isInProgress}>
      {BOOKING_STATUS_LABELS[status]}
    </StatusBadge>
  )
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <StatusBadge tone={paymentTone(status)} icon={paymentIcon(status)}>
      {PAYMENT_STATUS_LABELS[status]}
    </StatusBadge>
  )
}

// ===========================================================================
// PageSectionHeader — H8 minimalismo: hierarquia clara, 1 ação primária
// ===========================================================================

export function PageSectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}

// ===========================================================================
// FilterBar — H4 consistência: mesmo chrome em todas as tabelas
// ===========================================================================

export function FilterBar({
  children,
  onClear,
  activeCount,
  resultCount,
  resultLabel = "resultados",
  className,
}: {
  children: React.ReactNode
  onClear?: () => void
  activeCount?: number
  resultCount?: number
  resultLabel?: string
  className?: string
}) {
  return (
    <div className={cn("mb-4", className)}>
      <div className="flex flex-col gap-3 rounded-xl border bg-card/50 p-3 shadow-none sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {children}
        </div>
        {onClear && activeCount != null && activeCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
            Limpar filtros
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
              {activeCount}
            </span>
          </Button>
        ) : null}
      </div>
      {resultCount != null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">
            {resultCount}
          </span>{" "}
          {resultLabel}
        </p>
      ) : null}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar…",
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-input/60 bg-background pl-8 pr-3 text-sm outline-none transition-all placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </div>
  )
}

// ===========================================================================
// Estado: Loading / Empty / Error — H1, H8, H9
// ===========================================================================

export function TableSkeleton({
  rows = 6,
  cols = 5,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border/50", className)}>
      <div className="border-b border-border/50 bg-muted/30 px-4 py-2.5">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-20" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-border/50">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="px-4 py-3">
            <div className="grid items-center gap-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {Array.from({ length: cols }).map((_, c) => (
                <Skeleton key={c} className={cn("h-4", c === 0 ? "w-32" : c === cols - 1 ? "w-12" : "w-20")} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function EmptyState({
  icon: Icon = Search,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 px-6 py-16 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/5 ring-1 ring-primary/10 text-primary/60">
        <Icon className="size-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold tracking-tight">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  title = "Algo deu errado",
  description = "Não foi possível carregar os dados. Verifique sua conexão e tente novamente.",
  onRetry,
  className,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-rose-200/60 bg-rose-50/50 px-6 py-16 text-center dark:border-rose-900/30 dark:bg-rose-950/20",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-rose-100/80 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
        <AlertTriangle className="size-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-5 gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
        >
          <RotateCcw className="size-3.5" />
          Tentar novamente
        </Button>
      ) : null}
    </div>
  )
}

// ===========================================================================
// Pagination — H7 eficiência + H4 consistência
// ===========================================================================

export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
}: {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}) {
  if (totalPages <= 1) return null
  return (
    <div className={cn("mt-4 flex items-center justify-center gap-3", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="h-8 gap-1.5"
      >
        Anterior
      </Button>
      <span className="text-sm tabular-nums text-muted-foreground">
        Página <span className="font-medium text-foreground">{page}</span> de{" "}
        <span className="font-medium text-foreground">{totalPages}</span>
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="h-8 gap-1.5"
      >
        Próxima
      </Button>
    </div>
  )
}

export function ResultCount({
  page,
  limit,
  total,
  label = "resultados",
}: {
  page: number
  limit: number
  total: number
  label?: string
}) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(total, page * limit)
  return (
    <p className="text-xs text-muted-foreground">
      Exibindo{" "}
      <span className="font-medium tabular-nums text-foreground">{from}</span>
      –<span className="font-medium tabular-nums text-foreground">{to}</span>{" "}
      de <span className="font-medium tabular-nums text-foreground">{total}</span>{" "}
      {label}
    </p>
  )
}

// ===========================================================================
// SavingPill — H1 visibilidade de status (contextual, não flutuante)
// ===========================================================================

export function SavingPill({
  saving,
  label = "Salvando…",
  className,
}: {
  saving: boolean
  label?: string
  className?: string
}) {
  if (!saving) return null
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200/80 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800/60",
        className,
      )}
    >
      <Loader2 className="size-3 animate-spin" />
      {label}
    </span>
  )
}

// ===========================================================================
// ConfirmDialog — H5 prevenção de erros + H3 controle (undo/confirm)
// ===========================================================================

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  variant = "default",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  variant?: "default" | "destructive"
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-3">
            {variant === "destructive" ? (
              <span className="flex size-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
                <Trash2 className="size-5" />
              </span>
            ) : null}
            {title}
          </AlertDialogTitle>
          {description ? (
            <AlertDialogDescription className="pt-1">{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 pt-2">
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(
              variant === "destructive" &&
                "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600",
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ===========================================================================
// ConfirmToggleDialog — H5: confirmação antes de toggle de verificado/ativo
// ===========================================================================

export function ConfirmToggleDialog({
  open,
  onOpenChange,
  targetLabel,
  field,
  currentValue,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetLabel: string
  field: "verified" | "active"
  currentValue: boolean
  onConfirm: () => void
}) {
  const action = currentValue ? "remover" : " conceder"
  const fieldLabel = field === "verified" ? "verificação" : "status ativo"
  const tone = field === "verified" ? "amber" : "zinc"
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-xl",
                tone === "amber"
                  ? "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
              )}
            >
              {field === "verified" ? (
                <ShieldX className="size-5" />
              ) : (
                <RotateCcw className="size-5" />
              )}
            </span>
            {currentValue ? "Remover" : "Conceder"} {fieldLabel}?
          </AlertDialogTitle>
          <AlertDialogDescription className="pt-1">
            Você está prestes a <strong>{action}</strong> de{" "}
            <strong>{fieldLabel}</strong> para{" "}
            <strong>{targetLabel}</strong>. Esta ação pode afetar a experiência
            do usuário na plataforma.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 pt-2">
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {currentValue ? "Remover" : "Conceder"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ===========================================================================
// Kbd — H7 eficiência: dica visual de atalho (mnemônico)
// ===========================================================================

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border/60 bg-muted/50 px-1 font-mono text-[10px] font-semibold text-muted-foreground">
      {children}
    </kbd>
  )
}

// ===========================================================================
// FreshnessLabel — H1: quando os dados foram atualizados pela última vez
// ===========================================================================

export function FreshnessLabel({
  updatedAt,
  className,
}: {
  updatedAt?: Date | null
  className?: string
}) {
  if (!updatedAt) return null
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground/70",
        className,
      )}
      title={`Atualizado em ${updatedAt.toLocaleString("pt-BR")}`}
    >
      <Clock className="size-3" />
      Atualizado {formatRelativeShort(updatedAt)}
    </span>
  )
}

function formatRelativeShort(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "agora"
  if (diffMin < 60) return `há ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `há ${diffD}d`
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}