/**
 * subscriptions.ts — Recurring Services & Subscriptions Engine (Severinno Club).
 *
 * Manages recurring intervals (weekly, biweekly, monthly), loyalty discounts,
 * and automated scheduling of future bookings.
 */

import { addWeeks, addMonths, startOfDay, isBefore } from "date-fns"

export type SubscriptionFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY"

export type SubscriptionPlan = {
  frequency: SubscriptionFrequency
  label: string
  discountPercent: number
  description: string
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionFrequency, SubscriptionPlan> = {
  WEEKLY: {
    frequency: "WEEKLY",
    label: "Semanal (4x / mês)",
    discountPercent: 10,
    description: "Visitas toda semana no mesmo dia e horário com 10% OFF",
  },
  BIWEEKLY: {
    frequency: "BIWEEKLY",
    label: "Quinzenal (2x / mês)",
    discountPercent: 5,
    description: "Visitas a cada 15 dias com 5% OFF",
  },
  MONTHLY: {
    frequency: "MONTHLY",
    label: "Mensal (1x / mês)",
    discountPercent: 0,
    description: "Manutenção periódica mensal garantida na sua agenda",
  },
}

/**
 * Calculate discounted price for a recurring subscription
 */
export function calculateSubscriptionPrice(
  basePrice: number,
  frequency: SubscriptionFrequency,
): { originalPrice: number; discountedPrice: number; discountPercent: number; savings: number } {
  const plan = SUBSCRIPTION_PLANS[frequency]
  const discountPercent = plan.discountPercent
  const savings = Math.round((basePrice * (discountPercent / 100)) * 100) / 100
  const discountedPrice = Math.round((basePrice - savings) * 100) / 100

  return {
    originalPrice: basePrice,
    discountedPrice,
    discountPercent,
    savings,
  }
}

/**
 * Compute the next occurrence date based on current date and frequency
 */
export function getNextOccurrenceDate(
  fromDate: Date,
  frequency: SubscriptionFrequency,
): Date {
  const base = startOfDay(fromDate)
  switch (frequency) {
    case "WEEKLY":
      return addWeeks(base, 1)
    case "BIWEEKLY":
      return addWeeks(base, 2)
    case "MONTHLY":
      return addMonths(base, 1)
  }
}

/**
 * Generate a list of the next N dates for a subscription schedule
 */
export function generateUpcomingDates(
  startDate: Date,
  frequency: SubscriptionFrequency,
  count: number = 4,
): Date[] {
  const dates: Date[] = []
  let current = new Date(startDate)
  const now = new Date()

  // Ensure start date is in the future
  if (isBefore(current, now)) {
    current = getNextOccurrenceDate(now, frequency)
  }

  for (let i = 0; i < count; i++) {
    dates.push(new Date(current))
    current = getNextOccurrenceDate(current, frequency)
  }

  return dates
}
