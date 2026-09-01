/**
 * GraphQL Schema — public API layer via Yoga
 *
 * Provides a GraphQL endpoint for the mobile app / admin dashboard.
 * Resolves: providers, services, bookings, reviews, geo search.
 *
 * Endpoint: POST /api/graphql
 */
import { createSchema, createYoga } from "graphql-yoga"
import { db } from "@/lib/db"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

const typeDefs = /* GraphQL */ `
  type Query {
    providers(latitude: Float!, longitude: Float!, radiusKm: Float, limit: Int): [Provider!]!
    provider(id: ID!): Provider
    services(providerId: ID, categoryId: ID): [Service!]!
    bookings(clientId: ID, providerId: ID, status: String, limit: Int): [Booking!]!
    reviews(providerId: ID!, limit: Int): [Review!]!
    searchProviders(query: String!, latitude: Float, longitude: Float): [Provider!]!
    categories: [Category!]!
  }

  type Provider {
    id: ID!
    name: String!
    avatarUrl: String
    lat: Float
    lng: Float
    city: String
    bio: String
    verified: Boolean!
    active: Boolean!
    services: [Service!]!
    reviews: [Review!]!
    averageRating: Float
    distanceKm: Float
  }

  type Service {
    id: ID!
    title: String!
    description: String!
    basePrice: Float!
    active: Boolean!
    category: Category
    provider: Provider
  }

  type Category {
    id: ID!
    name: String!
    slug: String!
  }

  type Booking {
    id: ID!
    status: String!
    amount: Float!
    scheduledAt: String
    address: String
    lat: Float
    lng: Float
    client: Provider
    provider: Provider
    service: Service
    createdAt: String
  }

  type Review {
    id: ID!
    rating: Int!
    comment: String
    createdAt: String
    client: Provider
  }
`

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Select only public fields — never expose email, phone, or passwordHash
const PUBLIC_PROVIDER_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
  lat: true,
  lng: true,
  city: true,
  bio: true,
  verified: true,
  active: true,
} as const

const resolvers = {
  Query: {
    providers: async (
      _: unknown,
      args: { latitude: number; longitude: number; radiusKm?: number; limit?: number },
    ) => {
      const { latitude, longitude, radiusKm = 50, limit = 20 } = args

      const providers = await db.user.findMany({
        where: { role: "PROVIDER", active: true },
        select: {
          ...PUBLIC_PROVIDER_SELECT,
          services: { where: { active: true }, take: 5, include: { category: true } },
          reviewsReceived: { take: 5, orderBy: { createdAt: "desc" }, select: { rating: true } },
        },
        take: 500,
      })

      return providers
        .map((p) => ({
          ...p,
          distanceKm: p.lat && p.lng ? haversineKm(latitude, longitude, p.lat, p.lng) : null,
        }))
        .filter((p) => p.distanceKm !== null && p.distanceKm <= radiusKm)
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
        .slice(0, limit)
    },

    provider: async (_: unknown, args: { id: string }) => {
      return db.user.findUnique({
        where: { id: args.id },
        select: {
          ...PUBLIC_PROVIDER_SELECT,
          services: { where: { active: true }, include: { category: true } },
          reviewsReceived: {
            take: 10,
            orderBy: { createdAt: "desc" },
            select: {
              rating: true,
              comment: true,
              createdAt: true,
              client: { select: PUBLIC_PROVIDER_SELECT },
            },
          },
        },
      })
    },

    services: async (_: unknown, args: { providerId?: string; categoryId?: string }) => {
      return db.service.findMany({
        where: {
          active: true,
          ...(args.providerId && { providerId: args.providerId }),
          ...(args.categoryId && { categoryId: args.categoryId }),
        },
        include: { category: true, provider: { select: PUBLIC_PROVIDER_SELECT } },
        take: 50,
      })
    },

    bookings: async (
      _: unknown,
      args: { clientId?: string; providerId?: string; status?: string; limit?: number },
    ) => {
      return db.booking.findMany({
        where: {
          ...(args.clientId && { clientId: args.clientId }),
          ...(args.providerId && { providerId: args.providerId }),
          ...(args.status && {
            status: args.status as
              "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED",
          }),
        },
        include: {
          client: { select: PUBLIC_PROVIDER_SELECT },
          provider: { select: PUBLIC_PROVIDER_SELECT },
          service: { include: { category: true } },
        },
        orderBy: { createdAt: "desc" },
        take: args.limit ?? 50,
      })
    },

    reviews: async (_: unknown, args: { providerId: string; limit?: number }) => {
      return db.review.findMany({
        where: { providerId: args.providerId },
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          client: { select: PUBLIC_PROVIDER_SELECT },
        },
        orderBy: { createdAt: "desc" },
        take: args.limit ?? 20,
      })
    },

    searchProviders: async (
      _: unknown,
      args: { query: string; latitude?: number; longitude?: number },
    ) => {
      const providers = await db.user.findMany({
        where: {
          role: "PROVIDER",
          OR: [
            { name: { contains: args.query, mode: "insensitive" } },
            { services: { some: { title: { contains: args.query, mode: "insensitive" } } } },
          ],
        },
        select: {
          ...PUBLIC_PROVIDER_SELECT,
          services: { where: { active: true }, take: 5, include: { category: true } },
        },
        take: 50,
      })

      if (args.latitude && args.longitude) {
        return providers
          .map((p) => ({
            ...p,
            distanceKm:
              p.lat && p.lng ? haversineKm(args.latitude!, args.longitude!, p.lat, p.lng) : null,
          }))
          .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
      }

      return providers
    },

    categories: async () => {
      return db.category.findMany({ where: { active: true }, orderBy: { name: "asc" } })
    },
  },

  Provider: {
    averageRating: async (parent: { id: string; reviewsReceived?: Array<{ rating: number }> }) => {
      if (parent.reviewsReceived && parent.reviewsReceived.length > 0) {
        const sum = parent.reviewsReceived.reduce((acc, r) => acc + r.rating, 0)
        return sum / parent.reviewsReceived.length
      }
      return 0
    },
  },
}

export const schema = createSchema({ typeDefs, resolvers })

// Wrap yoga handler with rate limiting
const yoga = createYoga({ schema, graphqlEndpoint: "/api/graphql" })

export const graphqlHandler = {
  handle: async (request: Request, _ctx: unknown) => {
    await assertRateLimit(request, RATE_LIMITS.general)
    return yoga.handle({ request } as any, {} as any)
  },
}
