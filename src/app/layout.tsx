import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"

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
    "São Paulo",
    "Severinno",
  ],
  authors: [{ name: "Severinno" }],
  manifest: "/manifest.json",
  icons: {
    icon: "/logo.svg",
    apple: [
      { url: "/icons/icon-152.png", sizes: "152x152", type: "image/png" },
      { url: "/icons/icon-167.png", sizes: "167x167", type: "image/png" },
      { url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" },
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
    description: "Encontre prestadores de serviço verificados, com base na sua localização.",
    siteName: "Severinno",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Severinno Marketplace",
    description: "Encontre prestadores de serviço verificados, com base na sua localização.",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
