import { describe, it, expect, vi, beforeEach } from "vitest"
import { generateIcsFeed, formatIcsDate, type CalendarEvent } from "@/lib/calendar-sync"
import { calculateProviderTier } from "@/lib/gamification"

describe("Growth & Monetization Layer Tests (1, 2 & 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("1. Calendar Sync & RFC 5545 iCal Feed (@/lib/calendar-sync)", () => {
    it("should format timestamps into standard UTC iCal format", () => {
      const date = new Date("2026-08-15T14:30:00Z")
      const formatted = formatIcsDate(date)
      expect(formatted).toMatch(/^\d{8}T\d{6}Z$/)
    })

    it("should generate valid RFC 5545 VCALENDAR feed with VEVENTs", () => {
      const events: CalendarEvent[] = [
        {
          id: "booking-123",
          title: "Instalação Elétrica — Carlos",
          description: "Cliente: Carlos\\nTelefone: (11) 99999-9999",
          location: "Av Paulista, 1000",
          start: new Date("2026-08-20T10:00:00Z"),
          end: new Date("2026-08-20T12:00:00Z"),
          status: "CONFIRMED",
        },
      ]

      const feed = generateIcsFeed("Severinno — João Eletricista", events)

      expect(feed).toContain("BEGIN:VCALENDAR")
      expect(feed).toContain("VERSION:2.0")
      expect(feed).toContain("X-WR-CALNAME:Severinno — João Eletricista")
      expect(feed).toContain("BEGIN:VEVENT")
      expect(feed).toContain("UID:booking-123@severinno.app")
      expect(feed).toContain("SUMMARY:Instalação Elétrica — Carlos")
      expect(feed).toContain("LOCATION:Av Paulista, 1000")
      expect(feed).toContain("END:VEVENT")
      expect(feed).toContain("END:VCALENDAR")
    })
  })

  describe("2. Gamification & Pro Tiers Engine (@/lib/gamification)", () => {
    it("should assign BRONZE tier for beginner providers", () => {
      const profile = calculateProviderTier({
        avgRating: 0,
        reviewCount: 0,
        completedBookings: 0,
        verifiedIdentity: false,
      })

      expect(profile.tier).toBe("BRONZE")
      expect(profile.score).toBe(0)
      expect(profile.nextTier).toBe("SILVER")
      expect(profile.progressToNextTierPercent).toBe(0)
    })

    it("should award SILVER tier with KYC and a few jobs", () => {
      const profile = calculateProviderTier({
        avgRating: 4.5,
        reviewCount: 2,
        completedBookings: 5,
        verifiedIdentity: true,
      })

      // Rating (300) + Bookings (70) + KYC (150) = 520 pts -> GOLD
      expect(["SILVER", "GOLD"]).toContain(profile.tier)
      expect(profile.score).toBeGreaterThanOrEqual(250)
      expect(profile.badges.find((b) => b.id === "verified_pro")?.unlocked).toBe(true)
    })

    it("should promote high performers to DIAMOND tier with all badges", () => {
      const profile = calculateProviderTier({
        avgRating: 5.0,
        reviewCount: 30,
        completedBookings: 60,
        verifiedIdentity: true,
      })

      expect(profile.tier).toBe("DIAMOND")
      expect(profile.score).toBeGreaterThanOrEqual(800)
      expect(profile.nextTier).toBeNull()
      expect(profile.badges.every((b) => b.unlocked)).toBe(true)
    })
  })
})
