import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  calculateSubscriptionPrice,
  getNextOccurrenceDate,
  generateUpcomingDates,
} from "@/lib/subscriptions"

describe("Subscriptions & Recurring Services Tests (@/lib/subscriptions)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should calculate correct loyalty discount for weekly subscriptions (10% OFF)", () => {
    const basePrice = 200.0 // R$ 200,00
    const result = calculateSubscriptionPrice(basePrice, "WEEKLY")

    expect(result.discountPercent).toBe(10)
    expect(result.savings).toBe(20.0)
    expect(result.discountedPrice).toBe(180.0)
  })

  it("should calculate correct loyalty discount for biweekly subscriptions (5% OFF)", () => {
    const basePrice = 150.0 // R$ 150,00
    const result = calculateSubscriptionPrice(basePrice, "BIWEEKLY")

    expect(result.discountPercent).toBe(5)
    expect(result.savings).toBe(7.5)
    expect(result.discountedPrice).toBe(142.5)
  })

  it("should calculate next occurrence dates accurately for each frequency", () => {
    const fromDate = new Date("2026-09-01T10:00:00Z")

    const weeklyNext = getNextOccurrenceDate(fromDate, "WEEKLY")
    expect(weeklyNext.getDate()).toBe(8) // 7 days later

    const biweeklyNext = getNextOccurrenceDate(fromDate, "BIWEEKLY")
    expect(biweeklyNext.getDate()).toBe(15) // 14 days later

    const monthlyNext = getNextOccurrenceDate(fromDate, "MONTHLY")
    expect(monthlyNext.getMonth()).toBe(9) // next month (October)
  })

  it("should generate a series of upcoming booking dates", () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const dates = generateUpcomingDates(futureDate, "WEEKLY", 4)

    expect(dates).toHaveLength(4)
    expect(dates[1].getTime()).toBeGreaterThan(dates[0].getTime())
  })
})
