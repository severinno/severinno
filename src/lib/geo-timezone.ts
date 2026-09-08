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
    return "America/Sao_Paulo"
  }

  // 1. Fernando de Noronha e Ilhas Oceânicas (UTC-2)
  // Arquipélago de Noronha fica em lat ~ -3.85, lng ~ -32.42
  // Atol das Rocas em lat ~ -3.86, lng ~ -33.80
  if (lng > -34.5 && lat > -5.0 && lat < -3.0) {
    return "America/Noronha"
  }

  // 2. Acre e extremo sudoeste do Amazonas (UTC-5)
  // Estado do Acre: Lat entre -11.3 e -7.0, Lng entre -74.0 e -66.5
  // Municípios do extremo oeste do AM (Guajará, Eirunepé, Atalaia do Norte): Lng <= -70.0
  if (
    (lng <= -66.5 && lat <= -7.0 && lat >= -11.5) || // Acre
    (lng <= -70.0 && lat < 0 && lat >= -10.0) // Extremo oeste AM
  ) {
    return "America/Rio_Branco"
  }

  // 3. Mato Grosso e Mato Grosso do Sul (UTC-4)
  // MT: lat entre -18.0 e -7.5, lng entre -61.5 e -50.0
  // MS: lat entre -24.0 e -17.5, lng entre -58.2 e -50.8
  if (
    lng >= -61.5 &&
    lng <= -50.5 &&
    lat <= -7.5 &&
    lat >= -24.5 &&
    !(lat < -22.5 && lng > -53.0) // Exclui noroeste do Paraná (PR é UTC-3)
  ) {
    return "America/Cuiaba"
  }

  // 4. Roraima, Rondônia e Amazonas (Centro/Leste) (UTC-4)
  // Roraima (RR): lat entre 5.3 e -1.5, lng entre -64.8 e -58.8
  // Rondônia (RO): lat entre -8.0 e -13.7, lng entre -66.6 e -60.0
  // Amazonas (AM): lat entre 2.2 e -9.8, lng entre -70.0 e -56.0
  if (
    (lat >= -1.5 && lat <= 5.5 && lng <= -58.5 && lng >= -65.0) || // Roraima
    (lat <= -8.0 && lat >= -14.0 && lng <= -60.0 && lng >= -67.0) || // Rondônia
    (lat <= 2.5 && lat >= -9.5 && lng <= -56.5 && lng >= -70.0) // Amazonas Centro/Leste
  ) {
    return "America/Manaus"
  }

  // 5. Padrão: Horário de Brasília (UTC-3)
  // Sul, Sudeste, Nordeste, GO, DF, TO, PA, AP
  return "America/Sao_Paulo"
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
