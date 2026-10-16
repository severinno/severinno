/**
 * Home — Server Component with SSR Streaming.
 *
 * The initial HTML (skeleton/shell) ships immediately while the full
 * interactive client bundle loads and hydrates. This gives users instant
 * visual feedback and makes the page SEO-friendly.
 *
 * Sections with interactive state (filtering, search, auth) are wrapped
 * in Suspense so they load progressively without blocking the rest of
 * the page.
 *
 * The real work (view routing, auth, data fetching, interactivity)
 * happens inside the suspended client component.
 */

import { Suspense } from "react"
import dynamic from "next/dynamic"

import { LoadingShell } from "@/components/vitrine/loading-shell"

// The full app shell — view router, auth, panels, all interactivity.
// Loaded inside Suspense so the shell streams immediately.
const AppShell = dynamic(() => import("@/components/app-shell"), {
  ssr: true,
  loading: () => <LoadingShell />,
})

const homeJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://severinno.com/#website",
      url: "https://severinno.com",
      name: "Severinno",
      description: "Marketplace de Serviços em Governador Valadares e Região",
      potentialAction: {
        "@type": "SearchAction",
        target: "https://severinno.com/?q={search_term_string}",
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "LocalBusiness",
      "@id": "https://severinno.com/#organization",
      name: "Severinno Marketplace",
      url: "https://severinno.com",
      logo: "https://severinno.com/logo-severinno.png",
      image: "https://severinno.com/logo-severinno.png",
      description:
        "Encontre prestadores verificados em Governador Valadares e região com garantia de custódia e pagamento protegido.",
      telephone: "+55-33-99111-3030",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Governador Valadares",
        addressRegion: "MG",
        addressCountry: "BR",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: -18.8511,
        longitude: -41.9494,
      },
      areaServed: {
        "@type": "City",
        name: "Governador Valadares",
      },
      priceRange: "$$",
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "4.9",
        reviewCount: "128",
        bestRating: "5",
        worstRating: "1",
      },
    },
  ],
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd) }}
      />
      <Suspense fallback={<LoadingShell />}>
        <AppShell />
      </Suspense>
    </>
  )
}
