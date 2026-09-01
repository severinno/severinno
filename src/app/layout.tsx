import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { headers } from "next/headers"
import "./globals.css"
import { Providers } from "@/components/providers"
import { SWRegister } from "@/components/sw-register"

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
    default: "Severinno Marketplace",
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
    title: "Severinno Marketplace",
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
    title: "Severinno Marketplace",
    description: "Encontre prestadores de serviço verificados, com base na sua localização.",
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const _nonce = (await headers()).get("x-nonce") ?? ""

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased`}
      >
        <Providers>{children}</Providers>
        <SWRegister />
      </body>
    </html>
  )
}
