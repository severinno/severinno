import { NextResponse } from "next/server"
import { db } from "@/lib/db"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return "agora"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return `${days} dia${days > 1 ? "s" : ""}`
}

function firstNameInitial(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`
}

// ---------------------------------------------------------------------------
// Internal type used while merging activities before sorting
// ---------------------------------------------------------------------------

interface RawActivity {
  type: "booking" | "review" | "signup" | "quote"
  userName: string
  userAvatar: string | null
  action: string
  target: string
  service?: string
  rating?: number
  timeAgo: string
  emoji: string
  createdAt: Date
}

// ---------------------------------------------------------------------------
// GET /api/stats/activity — recent platform activity feed (public, no auth)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    // 1. Fetch latest records from each source in parallel
    const [bookings, reviews, signups, quotes] = await Promise.all([
      db.booking.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          client: {
            select: { name: true, avatarUrl: true, city: true },
          },
          service: {
            select: {
              title: true,
              category: { select: { name: true } },
            },
          },
        },
      }),
      db.review.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          client: { select: { name: true, avatarUrl: true } },
          provider: { select: { name: true } },
          service: { select: { title: true } },
        },
      }),
      db.user.findMany({
        where: { role: "PROVIDER" },
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          name: true,
          avatarUrl: true,
          verified: true,
          createdAt: true,
        },
      }),
      db.quoteRequest.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          client: {
            select: { name: true, avatarUrl: true, city: true },
          },
          items: {
            take: 1,
            include: {
              service: {
                select: {
                  title: true,
                  category: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
    ])

    const activities: RawActivity[] = []

    // 2a. Bookings → "agendou"
    for (const b of bookings) {
      const categoryName = b.service.category?.name ?? ""
      const location = b.client.city ? ` em ${b.client.city}` : ""
      activities.push({
        type: "booking",
        userName: firstNameInitial(b.client.name),
        userAvatar: b.client.avatarUrl,
        action: "agendou",
        target: categoryName
          ? `${categoryName.toLowerCase()}${location}`
          : location.replace(/^ em /, "") || "serviço",
        service: b.service.title,
        timeAgo: timeAgo(b.createdAt),
        emoji: "📅",
        createdAt: b.createdAt,
      })
    }

    // 2b. Reviews → "avaliou"
    for (const r of reviews) {
      activities.push({
        type: "review",
        userName: firstNameInitial(r.client.name),
        userAvatar: r.client.avatarUrl,
        action: "avaliou",
        target: firstNameInitial(r.provider.name),
        rating: r.rating,
        service: r.service?.title ?? undefined,
        timeAgo: timeAgo(r.createdAt),
        emoji: "⭐",
        createdAt: r.createdAt,
      })
    }

    // 2c. Provider signups → "se cadastrou como prestador"
    for (const s of signups) {
      activities.push({
        type: "signup",
        userName: firstNameInitial(s.name),
        userAvatar: s.avatarUrl,
        action: "se cadastrou como prestador",
        target: s.verified ? "verificado" : "pendente",
        timeAgo: timeAgo(s.createdAt),
        emoji: s.verified ? "✅" : "🆕",
        createdAt: s.createdAt,
      })
    }

    // 2d. Quote requests → "pediu orçamento para"
    for (const q of quotes) {
      const firstItem = q.items[0]
      const categoryName = firstItem?.service?.category?.name ?? ""
      const location = q.client.city ? ` em ${q.client.city}` : ""
      activities.push({
        type: "quote",
        userName: firstNameInitial(q.client.name),
        userAvatar: q.client.avatarUrl,
        action: "pediu orçamento para",
        target: categoryName
          ? `${categoryName.toLowerCase()}${location}`
          : location.replace(/^ em /, "") || "serviço",
        timeAgo: timeAgo(q.createdAt),
        emoji: "📋",
        createdAt: q.createdAt,
      })
    }

    // 3. Sort all by createdAt descending, take top 10
    activities.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )
    const topActivities = activities.slice(0, 10).map(
      // Strip the internal createdAt field from the public response
      ({ createdAt: _ct, ...rest }) => rest,
    )

    // 4. Count quotes created today
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const quotesToday = await db.quoteRequest.count({
      where: { createdAt: { gte: todayStart } },
    })

    // 5. Simulated "browsing now" (18–42)
    const browsingNow = Math.floor(Math.random() * 25) + 18

    return NextResponse.json(
      { activities: topActivities, browsingNow, quotesToday },
      {
        headers: {
          // Cache for 30 s on the edge / CDN — "live" feel without hammering DB
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    )
  } catch {
    return NextResponse.json({
      activities: [],
      browsingNow: 0,
      quotesToday: 0,
    })
  }
}
