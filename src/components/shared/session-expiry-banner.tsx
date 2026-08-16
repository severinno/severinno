"use client"

/**
 * SessionExpiryBanner + SessionExpiryInfo — expiração da sessão no dashboard.
 *
 * Lê o `sessionExpiresAt` do auth store (preenchido pelo /api/auth/me, que
 * expõe o expiry EFETIVO do cookie — o NOVO após rotação <15d).
 *
 * - SessionExpiryBanner: aviso URGENTE (≤ 7 dias) com botão "Renovar".
 * - SessionExpiryInfo: pill discreta SEMPRE visível no dropdown do usuário
 *   ("Sessão expira em N dias") — a rotação deslizante + polling mantém o
 *   expiry entre 15–30d para usuários ativos, então só o banner nunca
 *   mostraria o countdown em operação normal.
 *
 * Renovação: já é PROATIVA server-side — qualquer request passa pelo
 * getSession, que reemite o cookie na janela <15d. O botão "Renovar" apenas
 * re-dispara o fetchMe() (o servidor reemite e devolve o novo expiresAt).
 * No banner (≤7d < 15d) a renovação é garantida; na pill informativa (15–30d)
 * o servidor ainda não reemite — por isso a pill não oferece o botão.
 */

import * as React from "react"
import { CalendarClock, Loader2, RefreshCw, X } from "lucide-react"

import { useAuthStore } from "@/store/auth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** Janela de aviso: mostra o banner quando faltam ≤ 7 dias. */
export const SESSION_EXPIRY_WARN_DAYS = 7

/**
 * Dias restantes (ceil, mínimo 1): uma sessão fresca de 30d mostra "30
 * dias"; 6d23h → 7; 23h → 1 ("expira ainda hoje"); já expirado → 0. Ceil é
 * a semântica de countdown correta — floor derruba 1 dia por causa do delta
 * de ms entre o servidor (expiresAt em segundos) e o render (Date.now em
 * ms), subestimando o tempo restante (30d frescos virariam "29 dias").
 */
export function daysLeft(expiresAtSec: number, nowMs: number): number {
  const remainingMs = expiresAtSec * 1000 - nowMs
  if (remainingMs <= 0) return 0
  return Math.max(1, Math.ceil(remainingMs / 86_400_000))
}

function dayLabel(days: number): string {
  return days === 1 ? "1 dia" : `${days} dias`
}

export function SessionExpiryBanner() {
  const expiresAt = useAuthStore((s) => s.sessionExpiresAt)
  // renewSession (não-destrutiva) — NÃO fetchMe: em erro de rede, o fetchMe
  // marca unauthenticated e derruba o usuário para o login; renovar não pode
  // expulsar ninguém (ver store/auth.ts renewSession).
  const renewSession = useAuthStore((s) => s.renewSession)
  const [renewing, setRenewing] = React.useState(false)
  // Dismiss por montagem (sem localStorage/efeito): a pill do dropdown mostra
  // o countdown sempre, então dispensar o banner não perde a informação.
  const [dismissed, setDismissed] = React.useState(false)

  const days = expiresAt ? daysLeft(expiresAt, new Date().getTime()) : 0

  const show = expiresAt != null && days > 0 && days <= SESSION_EXPIRY_WARN_DAYS && !dismissed

  const handleRenew = async () => {
    setRenewing(true)
    try {
      // renewSession → /api/auth/me → getSession reemite o cookie (≤7d < 15d)
      // e devolve o novo expiresAt — o countdown zera e o banner some.
      await renewSession()
    } finally {
      setRenewing(false)
    }
  }

  if (!show) return null

  const tone =
    days <= 2
      ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"
      : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3.5 py-2.5 text-sm",
        tone,
      )}
    >
      <CalendarClock className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 font-medium">
        Sua sessão expira em <strong className="tabular-nums">{dayLabel(days)}</strong>. Renove para
        não precisar entrar novamente.
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="bg-background/60 hover:bg-background/90 h-8 gap-1.5 border-current text-current"
          onClick={handleRenew}
          disabled={renewing}
        >
          {renewing ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden />
          )}
          Renovar
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hover:bg-background/60 size-8 text-current opacity-70 hover:text-current hover:opacity-100"
          onClick={() => setDismissed(true)}
          aria-label="Dispensar aviso"
          title="Dispensar aviso"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

/**
 * Pill informativa do dropdown do usuário — countdown SEMPRE visível quando
 * há sessão (a rotação mantém 15–30d na operação normal; o banner ≤7d é o
 * caso raro). Retorna null sem sessão/expiry.
 */
export function SessionExpiryInfo() {
  const expiresAt = useAuthStore((s) => s.sessionExpiresAt)
  if (expiresAt == null) return null
  const days = daysLeft(expiresAt, new Date().getTime())
  if (days <= 0) return null
  return (
    <span
      data-testid="session-expiry-info"
      className="text-muted-foreground mt-1 inline-flex items-center gap-1.5 text-[11px] font-normal"
    >
      <CalendarClock className="size-3.5" aria-hidden />
      Sessão expira em <strong className="tabular-nums">{dayLabel(days)}</strong>
    </span>
  )
}
