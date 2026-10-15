/**
 * geo-timezone-pure.ts — Pure, zero-dependency Brazilian Timezone Detector by Coordinates.
 *
 * Safe for both Client Components (browser) and Server Components / Node.js runtimes.
 * Does not import any logger, metrics, or Node.js native modules.
 */

export type BrazilianTimezone =
  | "America/Noronha"
  | "America/Sao_Paulo"
  | "America/Manaus"
  | "America/Cuiaba"
  | "America/Rio_Branco"

export interface TimezoneInfo {
  timezone: BrazilianTimezone
  utcOffsetHours: number
  label: string
}

export const TZ_INFO_MAP: Record<BrazilianTimezone, { utcOffsetHours: number; label: string }> = {
  "America/Noronha": { utcOffsetHours: -2, label: "Fuso de Fernando de Noronha (UTC-2)" },
  "America/Sao_Paulo": { utcOffsetHours: -3, label: "Horário de Brasília (UTC-3)" },
  "America/Manaus": { utcOffsetHours: -4, label: "Fuso do Amazonas (UTC-4)" },
  "America/Cuiaba": { utcOffsetHours: -4, label: "Fuso do Pantanal / MT / MS (UTC-4)" },
  "America/Rio_Branco": { utcOffsetHours: -5, label: "Fuso do Acre (UTC-5)" },
}

export interface DetectionResult {
  timezone: BrazilianTimezone
  isFallback: boolean
}

/**
 * Pure function to map coordinates to official Brazilian timezone (IANA).
 */
export function detectBrazilianTimezone(lat: number, lng: number): DetectionResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { timezone: "America/Sao_Paulo", isFallback: true }
  }

  let tz: BrazilianTimezone

  // 1. Fernando de Noronha e Ilhas Oceânicas (UTC-2)
  if (lng > -34.5 && lat > -5.0 && lat < -3.0) {
    tz = "America/Noronha"
  }
  // 2. Acre e extremo sudoeste do Amazonas (UTC-5)
  else if (
    (lng <= -66.5 && lat <= -7.0 && lat >= -11.5) ||
    (lng <= -70.0 && lat < 0 && lat >= -10.0)
  ) {
    tz = "America/Rio_Branco"
  }
  // 3. Mato Grosso e Mato Grosso do Sul (UTC-4)
  else if (
    lng >= -61.5 &&
    lng <= -50.5 &&
    lat <= -7.5 &&
    lat >= -24.5 &&
    !(lat < -22.5 && lng > -53.0)
  ) {
    tz = "America/Cuiaba"
  }
  // 4. Roraima, Rondônia e Amazonas (Centro/Leste) (UTC-4)
  else if (
    (lat >= -1.5 && lat <= 5.5 && lng <= -58.5 && lng >= -65.0) ||
    (lat <= -8.0 && lat >= -14.0 && lng <= -60.0 && lng >= -67.0) ||
    (lat <= 2.5 && lat >= -9.5 && lng <= -56.5 && lng >= -70.0)
  ) {
    tz = "America/Manaus"
  }
  // 5. Padrão: Horário de Brasília (UTC-3)
  else {
    tz = "America/Sao_Paulo"
  }

  return { timezone: tz, isFallback: false }
}
