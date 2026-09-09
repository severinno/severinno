import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  formatBRL,
  formatDate,
  formatDateTime,
  formatTime,
  formatRelative,
  formatHHmm,
} from "../format"

describe("formatBRL", () => {
  it("formats integer as BRL", () => {
    expect(formatBRL(1000)).toBe("R$ 1.000,00")
  })

  it("formats decimal as BRL", () => {
    expect(formatBRL(1234.56)).toBe("R$ 1.234,56")
  })

  it("formats zero as BRL", () => {
    expect(formatBRL(0)).toBe("R$ 0,00")
  })

  it("handles negative values", () => {
    expect(formatBRL(-50)).toBe("-R$ 50,00")
  })

  it("handles NaN", () => {
    expect(formatBRL(NaN)).toBe("R$ 0,00")
  })
})

describe("formatDate", () => {
  it("formats Date object", () => {
    const d = new Date(2025, 2, 12) // March 12, 2025
    expect(formatDate(d)).toBe("12/03/2025")
  })

  it("formats ISO string", () => {
    expect(formatDate("2025-03-12T10:30:00Z")).toBe("12/03/2025")
  })

  it("formats timestamp", () => {
    expect(formatDate(1741768200000)).toBe("12/03/2025")
  })

  it("returns em-dash for invalid date", () => {
    expect(formatDate("not-a-date")).toBe("—")
    expect(formatDate(NaN)).toBe("—")
  })
})

describe("formatDateTime", () => {
  it("formats date and time", () => {
    const d = new Date(2025, 2, 12, 14, 30)
    expect(formatDateTime(d)).toBe("12/03/2025 14:30")
  })
})

describe("formatTime", () => {
  it("extracts HH:mm from Date", () => {
    const d = new Date(2025, 2, 12, 9, 5)
    expect(formatTime(d)).toBe("09:05")
  })
})

describe("formatRelative", () => {
  // O isYesterday/isToday do date-fns compara o DIA DO CALENDÁRIO LOCAL: num
  // dia de transição de DST (spring-forward com 23h), `Date.now() - 86400000`
  // (24h exatas) cai no ANTEONTEM → "há 2 dias" em vez de "ontem" (falha
  // próximo à madrugada do dia da virada, em fusos com DST). Congela SÓ Date
  // (toFake: ["Date"]) num horário neutro — timers reais intactos, data
  // determinística em qualquer fuso/horário.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-01-05T15:00:00.000Z")) // 12:00 BRT (fora de pico)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "hoje" for today', () => {
    const today = new Date()
    const result = formatRelative(today)
    expect(result).toContain("hoje")
  })

  it('returns "ontem" for yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000)
    const result = formatRelative(yesterday)
    expect(result).toContain("ontem")
  })

  it('returns "há X dias" for older dates', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000)
    const result = formatRelative(threeDaysAgo)
    expect(result).toContain("há")
  })

  it("returns em-dash for invalid date", () => {
    expect(formatRelative(NaN)).toBe("—")
  })
})

describe("formatHHmm", () => {
  it('converts "14:30" to "14h30"', () => {
    expect(formatHHmm("14:30")).toBe("14h30")
  })

  it('converts "09:05" to "09h05"', () => {
    expect(formatHHmm("09:05")).toBe("09h05")
  })

  it("returns original for invalid format", () => {
    expect(formatHHmm("invalid")).toBe("invalid")
  })

  it("returns em-dash for null/undefined", () => {
    expect(formatHHmm(null as unknown as string)).toBe("—")
    expect(formatHHmm(undefined as unknown as string)).toBe("—")
  })
})
