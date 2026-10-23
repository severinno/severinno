/**
 * Regional Intelligence Types for Brazil's Continental Marketplace.
 *
 * Captures:
 * 1. Brazilian Macro-Regions (Sudeste, Nordeste, Sul, Centro-Oeste, Norte)
 * 2. Climatic & Weather Conditions (Heatwave, Rainstorm, Coldfront, Dryspell)
 * 3. Local Timezones (UTC-2, UTC-3, UTC-4, UTC-5)
 * 4. Regional Tone of Voice & Cultural Micro-copy
 * 5. Hub City Profiles with Real Neighborhoods
 * 6. Platform Real-time Metrics & Events
 */

import type { BrazilianTimezone } from "@/lib/geo-timezone"

export type MacroRegion = "sudeste" | "nordeste" | "sul" | "centro-oeste" | "norte"

export type WeatherCondition = "heatwave" | "rainstorm" | "coldfront" | "dryspell" | "temperate"

export type SolarPeriod = "morning" | "afternoon" | "night_emergency" | "weekend"

export type RegionalTone = {
  region: MacroRegion
  greetingPrefix: string
  headlineSuffix: string
  trustStatement: string
  emergencyBadge: string
  colloquialTerms: string[]
}

export type CityHubProfile = {
  id: string
  name: string
  state: string
  macroRegion: MacroRegion
  timezone: BrazilianTimezone
  defaultNeighborhoods: string[]
  climateTendency: WeatherCondition
  typicalEmergencyServices: string[]
}

export type WeatherTriggerConfig = {
  condition: WeatherCondition
  badge: string
  headlinePrefix: string
  highlightText: string
  subtext: string
  priorityServices: Array<{
    id: string
    title: string
    categorySlug: string
    avgPrice: number
    unit: string
    badge: string
  }>
}

export type PlatformCityEventMetrics = {
  activeProvidersNearby: number
  bookingsLast24h: number
  topTrendingServiceName: string
  demandSpike: boolean
  recentSocialProofNotice?: string
}

export type RegionalContext = {
  city: string
  state: string
  macroRegion: MacroRegion
  timezone: BrazilianTimezone
  solarPeriod: SolarPeriod
  localTimeString: string
  weather: WeatherCondition
  weatherBadge: string
  heroHeadline: string
  heroHighlight: string
  heroSubtext: string
  neighborhoods: string[]
  tone: RegionalTone
  priorityServiceChips: Array<{
    id: string
    title: string
    categorySlug: string
    badge?: string
  }>
  platformEvents: PlatformCityEventMetrics
}
