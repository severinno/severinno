/**
 * geo-timezone.ts — Brazilian Timezone Detector with Observability Metrics.
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
import {
  detectBrazilianTimezone,
  TZ_INFO_MAP,
  type BrazilianTimezone,
  type TimezoneInfo,
} from "./geo-timezone-pure"

export type { BrazilianTimezone, TimezoneInfo }
export { detectBrazilianTimezone, TZ_INFO_MAP }

/**
 * Retorna o identificador de fuso horário IANA correspondente às coordenadas (lat, lng).
 * Se as coordenadas estiverem fora do território brasileiro ou forem inválidas,
 * retorna por padrão o Horário de Brasília ("America/Sao_Paulo").
 */
export function getTimezoneFromCoords(lat: number, lng: number): BrazilianTimezone {
  const { timezone, isFallback } = detectBrazilianTimezone(lat, lng)
  recordTimezoneLookup(timezone, isFallback)
  return timezone
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
