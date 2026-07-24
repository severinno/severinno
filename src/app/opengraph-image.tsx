import { ImageResponse } from "next/og"

export const alt = "Severinno — Encontre profissionais perto de você"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #059669 0%, #047857 50%, #065f46 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <h1 style={{ fontSize: 72, fontWeight: 800, margin: 0 }}>Severinno</h1>
        <p style={{ fontSize: 28, opacity: 0.9, marginTop: 16 }}>
          Encontre profissionais perto de você
        </p>
      </div>
    ),
    { ...size },
  )
}
