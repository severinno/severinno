import { ImageResponse } from "next/og"
import { resolveLandingPage } from "./page"

export const alt = "Severinno Marketplace — Serviços Verificados em Governador Valadares"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

type Props = { params: Promise<{ servico: string }> }

export default async function Image({ params }: Props) {
  const { servico } = await params
  const page = resolveLandingPage(servico)

  const serviceTitle = page ? page.service : "Serviços Profissionais"
  const locationLabel = page
    ? page.neighborhood
      ? `${page.neighborhood}, ${page.city} - MG`
      : `${page.city} - MG`
    : "Governador Valadares - MG"
  const priceRange = page?.priceRange || "Orçamento sob demanda"

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px 80px",
        background: "linear-gradient(135deg, #064e3b 0%, #047857 50%, #0f766e 100%)",
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
              background: "rgba(255, 255, 255, 0.2)",
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
            background: "rgba(255, 255, 255, 0.15)",
            padding: "8px 20px",
            borderRadius: 9999,
            fontSize: 20,
            fontWeight: 600,
          }}
        >
          📍 {locationLabel}
        </div>
      </div>

      {/* Center Main Content */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div
          style={{
            fontSize: 64,
            fontWeight: 900,
            lineHeight: 1.1,
            letterSpacing: "-1px",
            textShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}
        >
          {serviceTitle}
        </div>
        <div style={{ fontSize: 28, opacity: 0.92, fontWeight: 500, maxWidth: 900 }}>
          Profissionais verificados com chegada rápida e avaliação comprovada.
        </div>
      </div>

      {/* Bottom Feature Badges */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: "16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "#065f46",
              border: "1px solid rgba(255, 255, 255, 0.25)",
              padding: "10px 22px",
              borderRadius: 16,
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            🛡️ Pagamento com Escrow Seguro
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(255, 255, 255, 0.15)",
              padding: "10px 22px",
              borderRadius: 16,
              fontSize: 20,
              fontWeight: 600,
            }}
          >
            ★ 4.9 de Satisfação
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            background: "rgba(0, 0, 0, 0.25)",
            padding: "12px 24px",
            borderRadius: 16,
          }}
        >
          <span style={{ fontSize: 16, opacity: 0.8, textTransform: "uppercase" }}>
            Faixa Média
          </span>
          <span style={{ fontSize: 26, fontWeight: 800, color: "#a7f3d0" }}>{priceRange}</span>
        </div>
      </div>
    </div>,
    { ...size },
  )
}
