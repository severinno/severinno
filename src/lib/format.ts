import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Format a number as BRL currency.
 */
export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * "12/03/2025"
 */
export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "dd/MM/yyyy", { locale: ptBR });
}

/**
 * "12/03/2025 14:30"
 */
export function formatDateTime(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

/**
 * "14:30"
 */
export function formatTime(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "HH:mm", { locale: ptBR });
}

/**
 * Friendly relative time: "há 5 minutos", "em 2 horas", "hoje", "ontem".
 */
export function formatRelative(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  if (isToday(d)) {
    return `hoje, ${format(d, "HH:mm", { locale: ptBR })}`;
  }
  if (isYesterday(d)) {
    return `ontem, ${format(d, "HH:mm", { locale: ptBR })}`;
  }
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
}

/**
 * Format a "HH:mm" string (24h) → "14h30" (compact pt-BR).
 */
export function formatHHmm(hhmm: string): string {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return hhmm ?? "—";
  return hhmm.replace(":", "h");
}
