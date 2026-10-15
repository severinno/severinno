/**
 * subscriptions.ts — Recurring Services & Subscriptions Engine (Severinno Club).
 *
 * Manages recurring intervals (weekly, biweekly, monthly), loyalty discounts,
 * and automated scheduling of future bookings.
 */

import { addWeeks, addMonths, startOfDay, isBefore } from "date-fns"

export type SubscriptionFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY"

export type SubscriptionPlan = {
  frequency: SubscriptionFrequency
  label: string
  discountPercent: number
  description: string
  recommendedFor: string
  visitsPerYear: number
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionFrequency, SubscriptionPlan> = {
  WEEKLY: {
    frequency: "WEEKLY",
    label: "Semanal (4x / mês)",
    discountPercent: 15,
    description: "Visitas toda semana no mesmo dia e horário com 15% OFF",
    recommendedFor: "Faxinas frequentes, manutenção de piscina, pet care",
    visitsPerYear: 52,
  },
  BIWEEKLY: {
    frequency: "BIWEEKLY",
    label: "Quinzenal (2x / mês)",
    discountPercent: 10,
    description: "Visitas a cada 15 dias com 10% OFF garantido",
    recommendedFor: "Diaristas, jardinagem, limpeza residencial periódica",
    visitsPerYear: 26,
  },
  MONTHLY: {
    frequency: "MONTHLY",
    label: "Mensal (1x / mês)",
    discountPercent: 7,
    description: "Manutenção periódica mensal com 7% OFF",
    recommendedFor: "Corte de grama, revisão elétrica/hidráulica, filtro de água",
    visitsPerYear: 12,
  },
  QUARTERLY: {
    frequency: "QUARTERLY",
    label: "Trimestral (4x / ano)",
    discountPercent: 5,
    description: "Revisão preventiva trimestral com 5% OFF",
    recommendedFor: "Ar-condicionado, dedetização, limpeza de calhas",
    visitsPerYear: 4,
  },
}

/**
 * Calculate discounted price and projected annual savings for a recurring subscription
 */
export function calculateSubscriptionPrice(
  basePrice: number,
  frequency: SubscriptionFrequency,
): {
  originalPrice: number
  discountedPrice: number
  discountPercent: number
  savings: number
  annualSavings: number
  monthlyEstimate: number
} {
  const plan = SUBSCRIPTION_PLANS[frequency]
  const discountPercent = plan.discountPercent
  const savings = Math.round(basePrice * (discountPercent / 100) * 100) / 100
  const discountedPrice = Math.round((basePrice - savings) * 100) / 100
  const annualSavings = Math.round(savings * plan.visitsPerYear * 100) / 100

  // Estimated monthly cost
  const monthlyVisits = plan.visitsPerYear / 12
  const monthlyEstimate = Math.round(discountedPrice * monthlyVisits * 100) / 100

  return {
    originalPrice: basePrice,
    discountedPrice,
    discountPercent,
    savings,
    annualSavings,
    monthlyEstimate,
  }
}

/**
 * Compute the next occurrence date based on current date and frequency
 */
export function getNextOccurrenceDate(fromDate: Date, frequency: SubscriptionFrequency): Date {
  const base = startOfDay(fromDate)
  switch (frequency) {
    case "WEEKLY":
      return addWeeks(base, 1)
    case "BIWEEKLY":
      return addWeeks(base, 2)
    case "MONTHLY":
      return addMonths(base, 1)
    case "QUARTERLY":
      return addMonths(base, 3)
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

export type CarePlanMeta = {
  subscriptionId: string
  frequency: SubscriptionFrequency
  discountPercent: number
  savingsPerVisit: number
  annualSavings: number
  planLabel: string
}

const CARE_PLAN_TAG_START = "[PLANO_CUIDADO:"
const CARE_PLAN_TAG_END = ":PLANO_CUIDADO]"

/**
 * Format notes with embedded care plan metadata
 */
export function formatCarePlanNotes(meta: CarePlanMeta, userNotes?: string): string {
  const serialized = `${CARE_PLAN_TAG_START}${JSON.stringify(meta)}${CARE_PLAN_TAG_END}`
  return userNotes ? `${serialized} ${userNotes}` : serialized
}

/**
 * Extract care plan metadata from booking notes
 */
export function parseCarePlanNotes(notes?: string | null): CarePlanMeta | null {
  if (!notes || !notes.includes(CARE_PLAN_TAG_START)) return null
  try {
    const startIndex = notes.indexOf(CARE_PLAN_TAG_START) + CARE_PLAN_TAG_START.length
    let endIndex = notes.indexOf(CARE_PLAN_TAG_END, startIndex)
    if (endIndex === -1) {
      endIndex = notes.indexOf("]", startIndex)
    }
    if (endIndex === -1) return null
    const jsonStr = notes.substring(startIndex, endIndex)
    return JSON.parse(jsonStr) as CarePlanMeta
  } catch {
    return null
  }
}
