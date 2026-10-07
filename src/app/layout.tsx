import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { headers } from "next/headers"
import "./globals.css"
import { Providers } from "@/components/providers"
import { SWRegister } from "@/components/sw-register"
import { WebVitals } from "@/components/web-vitals"
import { MaintenanceScreen } from "@/components/maintenance-screen"
import { isMaintenanceMode } from "@/lib/maintenance-mode"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "severinno",
    template: "%s · Severinno",
  },
  description:
    "Marketplace de serviços com geolocalização: encontre prestadores verificados próximos a você — encanador, eletricista, pintor, diarista e mais.",
  keywords: [
    "marketplace de serviços",
    "prestadores de serviço",
    "encanador",
    "eletricista",
    "pintor",
    "diarista",
    "geolocalização",
    "Governador Valadares",
    "Minas Gerais",
    "Severinno",
  ],
  authors: [{ name: "Severinno" }],
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.svg",
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
    "mobile-web-app-capable": "yes",
    "format-detection": "telephone=no",
    "apple-mobile-web-app-title": "Severinno",
  },
  openGraph: {
    title: "severinno",
    description:
      "Encontre prestadores de serviço verificados, com base na sua localização — Governador Valadares, MG.",
    url: process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com",
    siteName: "Severinno",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: "/logo-severinno.png",
        width: 1200,
        height: 630,
        alt: "Severinno — Marketplace de Serviços",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "severinno",
    description: "Encontre prestadores de serviço verificados, com base na sua localização.",
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const _nonce = (await headers()).get("x-nonce") ?? ""

  // ── Chave de manutenção (um clique no painel admin) ────────────────────────
  // Quando LIGADA, o público inteiro vê a tela de manutenção em QUALQUER
  // página — o gate mora no layout raiz, então nem rota nova nem rota esquecida
  // escapa. ADMIN atravessa (painel de pé para DESLIGAR). Fail-safe da lib:
  // DB fora do ar → flag lida false → site ACESSÍVEL (nunca sequestrado).
  const maintenance = await isMaintenanceMode()

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased`}
      >
        {maintenance ? (
          <MaintenanceScreen />
        ) : (
          <>
            <Providers>{children}</Providers>
            <WebVitals />
            <SWRegister />
          </>
        )}
      </body>
    </html>
  )
}
