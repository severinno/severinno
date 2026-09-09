/**
 * geo-timezone.ts — Zero-dependency Brazilian Timezone Detector by Coordinates.
 *
 * Mapeia latitude e longitude geográficas para os fusos horários oficiais do Brasil (IANA):
 *   1. America/Noronha (UTC-2): Ilhas oceânicas (Fernando de Noronha, Trindade, etc.)
 *   2. America/Sao_Paulo (UTC-3): Horário Oficial de Brasília (Sul, Sudeste, Nordeste, GO, DF, TO, PA, AP)
 *   3. America/Manaus (UTC-4): Amazonas (leste), Roraima, Rondônia
 *   4. America/Cuiaba (UTC-4): Mato Grosso e Mato Grosso do Sul
 *   5. America/Rio_Branco (UTC-5): Acre e extremo oeste do Amazonas (Atalaia do Norte, Benjamin Constant, etc.)
 *
 * Execução em memória: O(1) síncrono (<0.01ms).
 */

import { recordTimezoneLookup } from "@/lib/geo-observability"

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

const TZ_INFO_MAP: Record<BrazilianTimezone, { utcOffsetHours: number; label: string }> = {
  "America/Noronha": { utcOffsetHours: -2, label: "Fuso de Fernando de Noronha (UTC-2)" },
  "America/Sao_Paulo": { utcOffsetHours: -3, label: "Horário de Brasília (UTC-3)" },
  "America/Manaus": { utcOffsetHours: -4, label: "Fuso do Amazonas (UTC-4)" },
  "America/Cuiaba": { utcOffsetHours: -4, label: "Fuso do Pantanal / MT / MS (UTC-4)" },
  "America/Rio_Branco": { utcOffsetHours: -5, label: "Fuso do Acre (UTC-5)" },
}

/**
 * Retorna o identificador de fuso horário IANA correspondente às coordenadas (lat, lng).
 * Se as coordenadas estiverem fora do território brasileiro ou forem inválidas,
 * retorna por padrão o Horário de Brasília ("America/Sao_Paulo").
 */
export function getTimezoneFromCoords(lat: number, lng: number): BrazilianTimezone {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    recordTimezoneLookup("America/Sao_Paulo", true)
    return "America/Sao_Paulo"
  }

  let tz: BrazilianTimezone

  // 1. Fernando de Noronha e Ilhas Oceânicas (UTC-2)
  // Arquipélago de Noronha fica em lat ~ -3.85, lng ~ -32.42
  // Atol das Rocas em lat ~ -3.86, lng ~ -33.80
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

  recordTimezoneLookup(tz, tz === "America/Sao_Paulo")
  return tz
}

/**
 * Retorna metadados detalhados de fuso horário incluindo offset UTC e rótulo amigável.
 */
export function getTimezoneInfo(lat: number, lng: number): TimezoneInfo {
  const timezone = getTimezoneFromCoords(lat, lng)
  const meta = TZ_INFO_MAP[timezone]
  return {
    timezone,
    utcOffsetHours: meta.utcOffsetHours,
    label: meta.label,
  }
}
