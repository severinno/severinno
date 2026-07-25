"use client";

/**
 * client-shared — small presentation helpers shared by all client views.
 *
 * Follows the client-panel polish spec:
 *  - PageHeader: text-2xl font-bold tracking-tight title + text-sm muted
 *    subtitle + optional quick action on the right + mb-6 spacing.
 *  - StatusBadge: consistent emerald/amber/rose/teal tones with an icon
 *    (Nielsen H1 — visibility of system status).
 *
 * Kept here (inside src/components/client/) so individual views stay slim
 * and don't re-implement the same chrome.
 */

import * as React from "react";
import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

export type StatusTone = "emerald" | "amber" | "rose" | "teal" | "zinc" | "sky";

const TONE_CLASS: Record<StatusTone, string> = {
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
};

export function StatusBadge({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: StatusTone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3" /> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status tone helpers — centralise the tone/icon mapping so every view is
// consistent. Co-located with constants labels but kept here so we don't
// touch src/lib/constants.ts.
// ---------------------------------------------------------------------------

import { CheckCircle2, Clock, Loader2, XCircle, CircleSlash } from "lucide-react";

import { type BookingStatus, type PaymentStatus, type QuoteStatus } from "@/lib/constants";

export function bookingTone(status: BookingStatus): StatusTone {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
      return "emerald";
    case "PENDING":
      return "amber";
    case "IN_PROGRESS":
      return "teal";
    case "CANCELLED":
      return "rose";
    default:
      return "zinc";
  }
}

export function bookingIcon(status: BookingStatus): LucideIcon {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
      return CheckCircle2;
    case "PENDING":
      return Clock;
    case "IN_PROGRESS":
      return Loader2;
    case "CANCELLED":
      return XCircle;
    default:
      return CircleSlash;
  }
}

export function quoteTone(status: QuoteStatus): StatusTone {
  switch (status) {
    case "APPROVED":
    case "RESPONDED":
      return "emerald";
    case "PENDING":
      return "amber";
    case "REJECTED":
    case "EXPIRED":
      return "rose";
    default:
      return "zinc";
  }
}

export function quoteIcon(status: QuoteStatus): LucideIcon {
  switch (status) {
    case "APPROVED":
    case "RESPONDED":
      return CheckCircle2;
    case "PENDING":
      return Clock;
    case "REJECTED":
    case "EXPIRED":
      return XCircle;
    default:
      return CircleSlash;
  }
}

export function paymentTone(status: PaymentStatus): StatusTone {
  switch (status) {
    case "PAID":
      return "emerald";
    case "PENDING":
      return "amber";
    case "REFUNDED":
      return "rose";
    default:
      return "zinc";
  }
}

export function paymentIcon(status: PaymentStatus): LucideIcon {
  switch (status) {
    case "PAID":
      return CheckCircle2;
    case "PENDING":
      return Clock;
    case "REFUNDED":
      return XCircle;
    default:
      return CircleSlash;
  }
}
