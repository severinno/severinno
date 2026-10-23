/**
 * Multi-City Support — city registry, configuration, and scaling.
 *
 * Severinno started in Governador Valadares, MG. This module enables
 * expanding to new cities with:
 *   - City registry (name, state, coordinates, timezone)
 *   - Per-city configuration (pricing, radius, categories)
 *   - Data isolation (providers/clients scoped to city)
 *   - City selector for landing page
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type CityConfig = {
  id: string
  name: string
  state: string
  lat: number
  lng: number
  timezone: string
  active: boolean
  /** Default service radius in km */
  defaultRadiusKm: number
  /** Minimum booking amount in BRL */
  minBookingAmount: number
  /** Platform fee percentage (0.1 = 10%) */
  feeRate: number
  /** Categories available in this city */
  categories: string[]
  /** Código oficial IBGE da cidade (7 dígitos) */
  ibgeCode?: string
  /** Limites geográficos (bounding box) da malha urbana */
  boundingBox?: {
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
  }
  /** Launch date */
  launchedAt: string
}

// ── City Registry ─────────────────────────────────────────────────────────

const CITIES: CityConfig[] = [
  {
    id: "governador-valadares",
    name: "Governador Valadares",
    state: "MG",
    lat: -18.8566,
    lng: -41.9455,
    timezone: "America/Sao_Paulo",
    active: true,
    ibgeCode: "3127701",
    boundingBox: {
      minLat: -18.92,
      maxLat: -18.79,
      minLng: -42.02,
      maxLng: -41.87,
    },
    defaultRadiusKm: 15,
    minBookingAmount: 50,
    feeRate: 0.15,
    categories: [
      "Limpeza",
      "Manutenção",
      "Reforma",
      "Jardim",
      "Serviços",
      "Transporte",
      "Cuidados",
      "Saúde",
    ],
    launchedAt: "2026-08-30",
  },
  {
    id: "ipatinga",
    name: "Ipatinga",
    state: "MG",
    lat: -19.4683,
    lng: -42.5369,
    timezone: "America/Sao_Paulo",
    active: true,
    ibgeCode: "3131307",
    boundingBox: {
      minLat: -19.53,
      maxLat: -19.41,
      minLng: -42.61,
      maxLng: -42.47,
    },
    defaultRadiusKm: 15,
    minBookingAmount: 50,
    feeRate: 0.15,
    categories: ["Limpeza", "Manutenção", "Reforma", "Jardim", "Serviços", "Transporte"],
    launchedAt: "2026-10-15",
  },
  {
    id: "coronel-fabriciano",
    name: "Coronel Fabriciano",
    state: "MG",
    lat: -19.5214,
    lng: -42.6322,
    timezone: "America/Sao_Paulo",
    active: true,
    ibgeCode: "3119401",
    boundingBox: {
      minLat: -19.58,
      maxLat: -19.47,
      minLng: -42.69,
      maxLng: -42.58,
    },
    defaultRadiusKm: 12,
    minBookingAmount: 50,
    feeRate: 0.15,
    categories: ["Limpeza", "Manutenção", "Reforma", "Jardim", "Serviços"],
    launchedAt: "2026-10-15",
  },
  {
    id: "teofilo-otoni",
    name: "Teófilo Otoni",
    state: "MG",
    lat: -17.8575,
    lng: -41.5056,
    timezone: "America/Sao_Paulo",
    active: true,
    ibgeCode: "3168606",
    boundingBox: {
      minLat: -17.92,
      maxLat: -17.8,
      minLng: -41.57,
      maxLng: -41.44,
    },
    defaultRadiusKm: 15,
    minBookingAmount: 50,
    feeRate: 0.15,
    categories: ["Limpeza", "Manutenção", "Reforma", "Jardim", "Serviços"],
    launchedAt: "2026-10-15",
  },
  {
    id: "belo-horizonte",
    name: "Belo Horizonte",
    state: "MG",
    lat: -19.9167,
    lng: -43.9345,
    timezone: "America/Sao_Paulo",
    active: false,
    ibgeCode: "3106200",
    boundingBox: {
      minLat: -20.06,
      maxLat: -19.78,
      minLng: -44.06,
      maxLng: -43.85,
    },
    defaultRadiusKm: 25,
    minBookingAmount: 60,
    feeRate: 0.15,
    categories: [
      "Limpeza",
      "Manutenção",
      "Reforma",
      "Jardim",
      "Serviços",
      "Transporte",
      "Cuidados",
      "Saúde",
    ],
    launchedAt: "TBD",
  },
]

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Get all active cities.
 */
export function getActiveCities(): CityConfig[] {
  return CITIES.filter((c) => c.active)
}

/**
 * Get all cities (including inactive/coming soon).
 */
export function getAllCities(): CityConfig[] {
  return CITIES
}

/**
 * Get city config by ID.
 */
export function getCityConfig(cityId: string): CityConfig | undefined {
  return CITIES.find((c) => c.id === cityId)
}

/**
 * Detect city from coordinates (nearest active city within 50km).
 */
export async function detectCityFromCoords(lat: number, lng: number): Promise<CityConfig | null> {
  const { haversineKm } = await import("./geo-shared")

  let nearest: CityConfig | null = null
  let minDist = Infinity

  for (const city of getActiveCities()) {
    const dist = haversineKm(lat, lng, city.lat, city.lng)
    if (dist < minDist && dist < 50) {
      minDist = dist
      nearest = city
    }
  }

  return nearest
}

/**
 * Detect city from CEP prefix (first 3 digits).
 *
 * CEP ranges in Minas Gerais:
 *   35000-35999 → Governador Valadares region
 *   30000-30999 → Belo Horizonte region
 *   36000-36999 → Juiz de Fora region
 *
 * CEP ranges in Espírito Santo:
 *   29000-29999 → Vitória region
 */
export function detectCityFromCep(cep: string): CityConfig | null {
  const digits = cep.replace(/\D/g, "")
  if (digits.length < 5) return null

  const prefix5 = parseInt(digits.slice(0, 5), 10)
  const prefix3 = parseInt(digits.slice(0, 3), 10)

  // Ipatinga: 35160-000 a 35164-999
  if (prefix5 >= 35160 && prefix5 <= 35164) return getCityConfig("ipatinga") ?? null

  // Coronel Fabriciano: 35170-000 a 35171-999
  if (prefix5 >= 35170 && prefix5 <= 35171) return getCityConfig("coronel-fabriciano") ?? null

  // Teófilo Otoni: 39800-000 a 39804-999
  if (prefix5 >= 39800 && prefix5 <= 39804) return getCityConfig("teofilo-otoni") ?? null

  // Belo Horizonte: 30000-000 a 31999-999
  if (prefix3 >= 300 && prefix3 <= 319) return getCityConfig("belo-horizonte") ?? null

  // Governador Valadares e região polo: 35000 a 35109
  if (prefix3 >= 350 && prefix3 <= 359) return getCityConfig("governador-valadares") ?? null

  return null
}

/**
 * Get city-specific configuration for a feature.
 */
export function getCityFeatureConfig(cityId: string): {
  canBook: boolean
  canProvider: boolean
  maxRadiusKm: number
  supportedPaymentMethods: string[]
} {
  const city = getCityConfig(cityId)
  if (!city) {
    return {
      canBook: false,
      canProvider: false,
      maxRadiusKm: 15,
      supportedPaymentMethods: ["PIX"],
    }
  }

  return {
    canBook: city.active,
    canProvider: city.active,
    maxRadiusKm: city.defaultRadiusKm * 2, // Allow 2x default radius
    supportedPaymentMethods: ["PIX", "CARD"],
  }
}

/**
 * Get city stats for dashboard.
 */
export async function getCityStats(cityId: string): Promise<{
  providers: number
  clients: number
  bookings30d: number
  revenue30d: number
} | null> {
  const city = getCityConfig(cityId)
  if (!city) return null

  try {
    const { db } = await import("./db")
    const { toMoneyNumber } = await import("./money")
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const [providers, clients, bookings] = await Promise.all([
      db.user.count({ where: { role: "PROVIDER", city: city.name, active: true } }),
      db.user.count({ where: { role: "CLIENT", city: city.name } }),
      db.booking.findMany({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          client: { city: city.name },
        },
        select: { amount: true },
      }),
    ])

    return {
      providers,
      clients,
      bookings30d: bookings.length,
      revenue30d: bookings.reduce(
        (sum: number, b: { amount: unknown }) => sum + toMoneyNumber(b.amount as number),
        0,
      ),
    }
  } catch {
    return null
  }
}
