/**
 * calendar-sync.ts — RFC 5545 iCalendar (.ics) feed generator and token helpers.
 *
 * Enables bidirectional sync with Google Calendar, Apple Calendar, and Outlook.
 */

import { format } from "date-fns"
import crypto from "crypto"

export type CalendarEvent = {
  id: string
  title: string
  description?: string
  location?: string
  start: Date
  end: Date
  status?: "CONFIRMED" | "CANCELLED" | "TENTATIVE"
  timezone?: string
}

/**
 * Format a Date object into UTC iCalendar timestamp: YYYYMMDDTHHMMSSZ
 */
export function formatIcsDate(date: Date): string {
  return format(date, "yyyyMMdd'T'HHmmss'Z'")
}

/**
 * Generate a cryptographically random token for secure calendar feed access
 */
export function generateCalendarToken(): string {
  return crypto.randomBytes(24).toString("hex")
}

/**
 * Generate RFC 5545 compliant VCALENDAR string from a list of events.
 */
export function generateIcsFeed(calendarName: string, events: CalendarEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Severinno Marketplace//Calendar Sync 1.0//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${calendarName}`,
    "X-WR-TIMEZONE:America/Sao_Paulo",
  ]

  for (const ev of events) {
    const dtStamp = formatIcsDate(new Date())
    const tz = ev.timezone
    const dtStart = formatIcsDate(ev.start)
    const dtEnd = formatIcsDate(ev.end)
    const cleanTitle = (ev.title || "Agendamento Severinno").replace(/\n/g, " ")
    const cleanDesc = (ev.description || "").replace(/\n/g, "\\n")
    const cleanLoc = (ev.location || "").replace(/\n/g, ", ")

    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.id}@severinno.app`,
      `DTSTAMP:${dtStamp}`,
      tz ? `DTSTART;TZID=${tz}:${dtStart}` : `DTSTART:${dtStart}`,
      tz ? `DTEND;TZID=${tz}:${dtEnd}` : `DTEND:${dtEnd}`,
      `SUMMARY:${cleanTitle}`,
      `DESCRIPTION:${cleanDesc}`,
      `LOCATION:${cleanLoc}`,
      `STATUS:${ev.status ?? "CONFIRMED"}`,
      "END:VEVENT",
    )
  }

  lines.push("END:VCALENDAR")

  return lines.join("\r\n")
}
