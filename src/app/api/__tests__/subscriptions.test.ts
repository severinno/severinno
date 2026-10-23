import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  calculateSubscriptionPrice,
  getNextOccurrenceDate,
  generateUpcomingDates,
  formatCarePlanNotes,
  parseCarePlanNotes,
} from "@/lib/subscriptions"

describe("Subscriptions & Recurring Services Tests (@/lib/subscriptions)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should calculate correct loyalty discount for weekly subscriptions (15% OFF)", () => {
    const basePrice = 200.0 // R$ 200,00
    const result = calculateSubscriptionPrice(basePrice, "WEEKLY")

    expect(result.discountPercent).toBe(15)
    expect(result.savings).toBe(30.0)
    expect(result.discountedPrice).toBe(170.0)
    expect(result.annualSavings).toBe(1560.0) // 30 * 52
  })

  it("should calculate correct loyalty discount for biweekly subscriptions (10% OFF)", () => {
    const basePrice = 150.0 // R$ 150,00
    const result = calculateSubscriptionPrice(basePrice, "BIWEEKLY")

    expect(result.discountPercent).toBe(10)
    expect(result.savings).toBe(15.0)
    expect(result.discountedPrice).toBe(135.0)
    expect(result.annualSavings).toBe(390.0) // 15 * 26
  })

  it("should calculate correct loyalty discount for monthly subscriptions (7% OFF)", () => {
    const basePrice = 100.0 // R$ 100,00
    const result = calculateSubscriptionPrice(basePrice, "MONTHLY")

    expect(result.discountPercent).toBe(7)
    expect(result.savings).toBe(7.0)
    expect(result.discountedPrice).toBe(93.0)
    expect(result.annualSavings).toBe(84.0) // 7 * 12
  })

  it("should calculate correct loyalty discount for quarterly subscriptions (5% OFF)", () => {
    const basePrice = 300.0 // R$ 300,00
    const result = calculateSubscriptionPrice(basePrice, "QUARTERLY")

    expect(result.discountPercent).toBe(5)
    expect(result.savings).toBe(15.0)
    expect(result.discountedPrice).toBe(285.0)
    expect(result.annualSavings).toBe(60.0) // 15 * 4
  })

  it("should calculate next occurrence dates accurately for each frequency", () => {
    const fromDate = new Date("2026-09-01T10:00:00Z")

    const weeklyNext = getNextOccurrenceDate(fromDate, "WEEKLY")
    expect(weeklyNext.getDate()).toBe(8) // 7 days later

    const biweeklyNext = getNextOccurrenceDate(fromDate, "BIWEEKLY")
    expect(biweeklyNext.getDate()).toBe(15) // 14 days later

    const monthlyNext = getNextOccurrenceDate(fromDate, "MONTHLY")
    expect(monthlyNext.getMonth()).toBe(9) // next month (October)

    const quarterlyNext = getNextOccurrenceDate(fromDate, "QUARTERLY")
    expect(quarterlyNext.getMonth()).toBe(11) // 3 months later (December)
  })

  it("should generate a series of upcoming booking dates", () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const dates = generateUpcomingDates(futureDate, "WEEKLY", 4)

    expect(dates).toHaveLength(4)
    expect(dates[1].getTime()).toBeGreaterThan(dates[0].getTime())
  })

  it("should serialize and deserialize care plan metadata correctly in booking notes", () => {
    const meta = {
      subscriptionId: "sub_12345",
      frequency: "WEEKLY" as const,
      discountPercent: 15,
      savingsPerVisit: 30,
      annualSavings: 1560,
      planLabel: "Semanal (4x / mês)",
    }

    const note = formatCarePlanNotes(meta, "Cliente tem cachorro dócil no quintal")
    expect(note).toContain("[PLANO_CUIDADO:")
    expect(note).toContain("Cliente tem cachorro dócil")

    const parsed = parseCarePlanNotes(note)
    expect(parsed).toEqual(meta)

    // Fallback for notes without care plan
    expect(parseCarePlanNotes("Nota normal sem plano")).toBeNull()
    expect(parseCarePlanNotes(null)).toBeNull()
  })
})
