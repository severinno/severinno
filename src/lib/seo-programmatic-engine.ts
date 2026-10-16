/**
 * seo-programmatic-engine.ts — SEO Programático Local & Schema.org Structured Data
 *
 * Gera dinamicamente metadados, títulos de alta conversão (CTR), breadcrumbs e JSON-LD
 * estruturado (LocalBusiness + Service + FAQPage) para indexação em massa no Google
 * para combinações de [Estado] / [Cidade] / [Bairro] / [Serviço].
 */

export interface NeighborhoodGeo {
  name: string
  slug: string
  lat: number
  lng: number
}

export interface CityData {
  name: string
  slug: string
  state: string
  stateSlug: string
  lat: number
  lng: number
  neighborhoods: NeighborhoodGeo[]
}

export interface ServiceCategory {
  title: string
  slug: string
  synonyms: string[]
  priceRange: string
  avgArrivalMinutes: number
  typicalServices: string[]
}

export const SUPPORTED_CITIES: Record<string, CityData> = {
  "governador-valadares": {
    name: "Governador Valadares",
    slug: "governador-valadares",
    state: "Minas Gerais",
    stateSlug: "mg",
    lat: -18.8542,
    lng: -41.9511,
    neighborhoods: [
      { name: "Centro", slug: "centro", lat: -18.851, lng: -41.945 },
      { name: "Ilha dos Araújos", slug: "ilha-dos-araujos", lat: -18.858, lng: -41.939 },
      { name: "Vila Isa", slug: "vila-isa", lat: -18.868, lng: -41.968 },
      { name: "Esplanada", slug: "esplanada", lat: -18.847, lng: -41.932 },
      { name: "Grã-Duquesa", slug: "gra-duquesa", lat: -18.835, lng: -41.955 },
      { name: "São Pedro", slug: "sao-pedro", lat: -18.871, lng: -41.962 },
    ],
  },
  "sao-paulo": {
    name: "São Paulo",
    slug: "sao-paulo",
    state: "São Paulo",
    stateSlug: "sp",
    lat: -23.5505,
    lng: -46.6333,
    neighborhoods: [
      { name: "Pinheiros", slug: "pinheiros", lat: -23.567, lng: -46.691 },
      { name: "Moema", slug: "moema", lat: -23.602, lng: -46.662 },
      { name: "Vila Mariana", slug: "vila-mariana", lat: -23.589, lng: -46.634 },
    ],
  },
}

export const SUPPORTED_SERVICES: Record<string, ServiceCategory> = {
  eletricista: {
    title: "Eletricista",
    slug: "eletricista",
    synonyms: ["eletricistas", "instalação elétrica", "troca de disjuntor", "curto circuito"],
    priceRange: "R$ 80 - R$ 350",
    avgArrivalMinutes: 35,
    typicalServices: ["Troca de chuveiro", "Instalação de tomadas", "Quadro de distribuição"],
  },
  encanador: {
    title: "Encanador",
    slug: "encanador",
    synonyms: ["desentupimento", "vazamento de água", "caça vazamento", "troca de torneira"],
    priceRange: "R$ 90 - R$ 400",
    avgArrivalMinutes: 30,
    typicalServices: ["Desentupimento de pia", "Reparo em descarga", "Eliminação de infiltração"],
  },
  diarista: {
    title: "Diarista",
    slug: "diarista",
    synonyms: ["faxineira", "limpeza residencial", "faxina completa", "passadeira"],
    priceRange: "R$ 140 - R$ 220",
    avgArrivalMinutes: 45,
    typicalServices: ["Faxina geral", "Limpeza pesada", "Organização de armários"],
  },
  chaveiro: {
    title: "Chaveiro",
    slug: "chaveiro",
    synonyms: ["abertura de porta", "troca de fechadura", "cópia de chave", "chaveiro 24h"],
    priceRange: "R$ 70 - R$ 250",
    avgArrivalMinutes: 20,
    typicalServices: ["Abertura emergencial", "Instalação de fechadura digital", "Chave tetra"],
  },
}

export interface ProgrammaticSeoResult {
  title: string
  metaDescription: string
  h1: string
  canonicalUrl: string
  city: string
  state: string
  neighborhood?: string
  serviceTitle: string
  priceRange: string
  estimatedArrival: string
  breadcrumbs: Array<{ name: string; url: string }>
  jsonLdLocalBusiness: object
  jsonLdFaq: object
}

/**
 * Gera conjunto completo de SEO estruturado para páginas locais.
 */
export function generateProgrammaticSeo(params: {
  citySlug: string
  serviceSlug: string
  neighborhoodSlug?: string
}): ProgrammaticSeoResult {
  const { citySlug, serviceSlug, neighborhoodSlug } = params

  const city = SUPPORTED_CITIES[citySlug]
  if (!city) {
    throw new Error(`Cidade '${citySlug}' não suportada no gerador SEO`)
  }

  const service = SUPPORTED_SERVICES[serviceSlug]
  if (!service) {
    throw new Error(`Serviço '${serviceSlug}' não suportado no gerador SEO`)
  }

  const neighborhood = neighborhoodSlug
    ? city.neighborhoods.find((n) => n.slug === neighborhoodSlug)
    : undefined

  const locationLabel = neighborhood
    ? `${neighborhood.name}, ${city.name} - ${city.stateSlug.toUpperCase()}`
    : `${city.name} - ${city.stateSlug.toUpperCase()}`

  const locationInText = neighborhood
    ? `no bairro ${neighborhood.name} em ${city.name}`
    : `em ${city.name}`

  const canonicalPath = neighborhood
    ? `/${city.stateSlug}/${city.slug}/${neighborhood.slug}/${service.slug}`
    : `/${city.stateSlug}/${city.slug}/${service.slug}`

  const canonicalUrl = `https://severinno.com.br${canonicalPath}`

  const title = neighborhood
    ? `${service.title} no bairro ${neighborhood.name} (${city.name}) | Severinno`
    : `${service.title} em ${city.name} - MG | Atendimento Rápido | Severinno`

  const metaDescription = `Precisa de ${service.title.toLowerCase()} ${locationInText}? Chegada estimada em até ${service.avgArrivalMinutes} min, pagamento em escrow seguro e nota 4.9. Peça pelo Severinno!`

  const h1 = neighborhood
    ? `${service.title}s Verificados no ${neighborhood.name} (${city.name})`
    : `${service.title}s Profissionais em ${city.name}`

  const lat = neighborhood ? neighborhood.lat : city.lat
  const lng = neighborhood ? neighborhood.lng : city.lng

  // Breadcrumbs hierárquicos
  const breadcrumbs = [
    { name: "Início", url: "https://severinno.com.br" },
    { name: city.state, url: `https://severinno.com.br/${city.stateSlug}` },
    { name: city.name, url: `https://severinno.com.br/${city.stateSlug}/${city.slug}` },
  ]
  if (neighborhood) {
    breadcrumbs.push({
      name: neighborhood.name,
      url: `https://severinno.com.br/${city.stateSlug}/${city.slug}/${neighborhood.slug}`,
    })
  }
  breadcrumbs.push({ name: service.title, url: canonicalUrl })

  // Schema.org LocalBusiness + Service JSON-LD
  const jsonLdLocalBusiness = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: `Severinno Marketplace - ${service.title} ${locationLabel}`,
    url: canonicalUrl,
    telephone: "+55-33-99999-0000",
    priceRange: service.priceRange,
    address: {
      "@type": "PostalAddress",
      addressLocality: city.name,
      addressRegion: city.stateSlug.toUpperCase(),
      addressCountry: "BR",
      ...(neighborhood ? { streetAddress: neighborhood.name } : {}),
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: lat,
      longitude: lng,
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      reviewCount: "148",
      bestRating: "5",
      worstRating: "1",
    },
  }

  // Schema.org FAQPage
  const jsonLdFaq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `Quanto custa um ${service.title.toLowerCase()} ${locationInText}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `O valor médio varia entre ${service.priceRange}, dependendo da complexidade do reparo ou instalação. Você recebe a cotação antes de autorizar o serviço.`,
        },
      },
      {
        "@type": "Question",
        name: `Qual o tempo médio de chegada ${locationInText}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `O tempo médio de chegada é de aproximadamente ${service.avgArrivalMinutes} minutos com acompanhamento GPS em tempo real pelo mapa.`,
        },
      },
    ],
  }

  return {
    title,
    metaDescription,
    h1,
    canonicalUrl,
    city: city.name,
    state: city.state,
    neighborhood: neighborhood?.name,
    serviceTitle: service.title,
    priceRange: service.priceRange,
    estimatedArrival: `${service.avgArrivalMinutes} min`,
    breadcrumbs,
    jsonLdLocalBusiness,
    jsonLdFaq,
  }
}

/**
 * Retorna lista de todas as combinações de URLs para sitemap.xml.
 */
export function generateProgrammaticSitemapSlugs(): Array<{
  city: string
  service: string
  neighborhood?: string
  path: string
}> {
  const result: Array<{
    city: string
    service: string
    neighborhood?: string
    path: string
  }> = []

  for (const city of Object.values(SUPPORTED_CITIES)) {
    for (const service of Object.values(SUPPORTED_SERVICES)) {
      // Cidade + Serviço (nível municipal)
      result.push({
        city: city.slug,
        service: service.slug,
        path: `/${city.stateSlug}/${city.slug}/${service.slug}`,
      })

      // Bairro + Serviço (nível hiperlocal)
      for (const n of city.neighborhoods) {
        result.push({
          city: city.slug,
          service: service.slug,
          neighborhood: n.slug,
          path: `/${city.stateSlug}/${city.slug}/${n.slug}/${service.slug}`,
        })
      }
    }
  }

  return result
}
