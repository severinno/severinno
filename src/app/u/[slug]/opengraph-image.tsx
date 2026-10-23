import { ImageResponse } from "next/og"
import { db } from "@/lib/db"

export const alt = "Perfil Profissional no Severinno Marketplace"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

type Props = { params: Promise<{ slug: string }> }

export default async function Image({ params }: Props) {
  const { slug } = await params

  let provider: {
    name: string
    city: string | null
    state: string | null
    verified: boolean
    rating: number
    reviewsCount: number
    completedBookings: number
    topService: string | null
  } | null = null

  try {
    const user = await db.user.findFirst({
      where: { OR: [{ slug }, { id: slug }], role: "PROVIDER", active: true },
      select: {
        name: true,
        city: true,
        state: true,
        verified: true,
        services: {
          where: { active: true },
          take: 1,
          select: { title: true },
        },
        reviewsReceived: {
          select: { rating: true },
        },
        _count: {
          select: {
            reviewsReceived: true,
            bookingsAsProvider: { where: { status: "COMPLETED" } },
          },
        },
      },
    })

    if (user) {
      const avgRating =
        user.reviewsReceived.length > 0
          ? user.reviewsReceived.reduce((acc, r) => acc + r.rating, 0) / user.reviewsReceived.length
          : 5.0

      provider = {
        name: user.name,
        city: user.city,
        state: user.state,
        verified: user.verified,
        rating: avgRating,
        reviewsCount: user._count.reviewsReceived,
        completedBookings: user._count.bookingsAsProvider,
        topService: user.services[0]?.title ?? null,
      }
    }
  } catch {
    // Fallback if DB error during edge/prerender
  }

  const name = provider?.name || "Profissional Severinno"
  const location = provider?.city
    ? `${provider.city}${provider.state ? ` - ${provider.state}` : " - MG"}`
    : "Governador Valadares - MG"
  const ratingFormatted = provider ? provider.rating.toFixed(1) : "5.0"
  const reviewCount = provider?.reviewsCount || 0
  const completed = provider?.completedBookings || 0
  const initial = name.charAt(0).toUpperCase()
  const topService = provider?.topService || "Serviços Residenciais e Comerciais"

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px 80px",
        background: "linear-gradient(135deg, #09090b 0%, #18181b 60%, #27272a 100%)",
        color: "white",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "#059669",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
            }}
          >
            ⚡
          </div>
          <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.5px" }}>Severinno</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "rgba(255, 255, 255, 0.1)",
            padding: "8px 20px",
            borderRadius: 9999,
            fontSize: 20,
            fontWeight: 600,
          }}
        >
          📍 {location}
        </div>
      </div>

      {/* Center Main Content */}
      <div style={{ display: "flex", alignItems: "center", gap: "36px" }}>
        {/* Avatar initial circular badge */}
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: 70,
            background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 64,
            fontWeight: 900,
            color: "#ffffff",
            boxShadow: "0 10px 25px rgba(16, 185, 129, 0.4)",
            border: "4px solid rgba(255, 255, 255, 0.2)",
          }}
        >
          {initial}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <span
              style={{
                fontSize: 54,
                fontWeight: 900,
                letterSpacing: "-1px",
                lineHeight: 1.1,
              }}
            >
              {name}
            </span>
            {provider?.verified && (
              <div
                style={{
                  background: "#059669",
                  color: "white",
                  borderRadius: 9999,
                  padding: "4px 14px",
                  fontSize: 16,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                ✓ Verificado
              </div>
            )}
          </div>

          <div style={{ fontSize: 26, color: "#9ca3af", fontWeight: 500 }}>{topService}</div>

          <div style={{ display: "flex", alignItems: "center", gap: "20px", marginTop: "4px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: "rgba(251, 191, 36, 0.15)",
                color: "#fbbf24",
                padding: "6px 16px",
                borderRadius: 12,
                fontSize: 22,
                fontWeight: 800,
              }}
            >
              ★ {ratingFormatted}
              <span style={{ color: "#d1d5db", fontWeight: 500, fontSize: 18, marginLeft: 8 }}>
                ({reviewCount} avaliações)
              </span>
            </div>

            {completed > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "#e5e7eb",
                  padding: "6px 16px",
                  borderRadius: 12,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                🚀 {completed} serviços concluídos
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Feature Badges */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "#064e3b",
              border: "1px solid rgba(5, 150, 105, 0.4)",
              padding: "10px 22px",
              borderRadius: 16,
              fontSize: 18,
              fontWeight: 700,
              color: "#6ee7b7",
            }}
          >
            🛡️ Custódia Garantida & Chegada Monitorada
          </div>
        </div>

        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#10b981",
            background: "rgba(16, 185, 129, 0.1)",
            padding: "10px 24px",
            borderRadius: 16,
            border: "1px solid rgba(16, 185, 129, 0.3)",
          }}
        >
          Agendamento Rápido no App
        </div>
      </div>
    </div>,
    { ...size },
  )
}
