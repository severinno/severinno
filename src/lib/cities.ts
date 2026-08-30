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
    defaultRadiusKm: 15,
    minBookingAmount: 50,
    feeRate: 0.10,
    categories: [
      "Limpeza", "Manutenção", "Reforma", "Jardim",
      "Serviços", "Transporte", "Cuidados", "Saúde",
    ],
    launchedAt: "2026-08-30",
  },
  // Future cities:
  // {
  //   id: "ipatinga",
  //   name: "Ipatinga",
  //   state: "MG",
  //   lat: -19.4683,
  //   lng: -42.5369,
  //   timezone: "America/Sao_Paulo",
  //   active: false,
  //   defaultRadiusKm: 10,
  //   minBookingAmount: 50,
  //   feeRate: 0.10,
  //   categories: ["Limpeza", "Manutenção", "Reforma", "Jardim"],
  //   launchedAt: "TBD",
  // },
  // {
  //   id: "vitoria",
  //   name: "Vitória",
  //   state: "ES",
  //   lat: -20.3155,
  //   lng: -40.3128,
  //   timezone: "America/Sao_Paulo",
  //   active: false,
  //   defaultRadiusKm: 20,
  //   minBookingAmount: 60,
  //   feeRate: 0.10,
  //   categories: ["Limpeza", "Manutenção", "Reforma", "Jardim", "Saúde"],
  //   launchedAt: "TBD",
  // },
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
  const prefix = parseInt(cep.replace(/\D/g, "").slice(0, 3), 10)

  if (prefix >= 350 && prefix <= 359) return getCityConfig("governador-valadares") ?? null
  // Future: if (prefix >= 290 && prefix <= 299) return getCityConfig("vitoria")

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
      revenue30d: bookings.reduce((sum: number, b: { amount: number }) => sum + b.amount, 0),
    }
  } catch {
    return null
  }
}
