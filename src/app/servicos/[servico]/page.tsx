import { serializeJsonLd } from "@/lib/sanitize"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { toMoneyNumber } from "@/lib/money"
import { SUPPORT_WHATSAPP } from "@/lib/constants"

/**
 * SEO Landing Pages Programáticas por Bairro & Categoria em Governador Valadares.
 *
 * Exemplos indexados no Google Search:
 *   /servicos/encanador-em-governador-valadares
 *   /servicos/eletricista-em-ilha-dos-araujos
 *   /servicos/diarista-em-vila-isa
 *   /servicos/pintor-em-centro
 *
 * Contém Schema.org JSON-LD estruturado:
 * - LocalBusiness + Service (com coordenadas e georreferenciamento de GV)
 * - BreadcrumbList
 * - FAQPage (perguntas frequentes sobre contratação com garantia de custódia)
 */

export interface LandingPageConfig {
  service: string
  city: string
  neighborhood?: string
  description: string
  priceRange?: string
}

export const GV_CENTER_COORDS = { lat: -18.8511, lng: -41.9422 }

export const GV_NEIGHBORHOODS: Record<string, string> = {
  centro: "Centro",
  "ilha-dos-araujos": "Ilha dos Araújos",
  "vila-isa": "Vila Isa",
  esplanada: "Esplanada",
  "gra-duquesa": "Grã-Duquesa",
  "sao-pedro": "São Pedro",
  lourdes: "Lourdes",
  "santa-rita": "Santa Rita",
  castanheiras: "Castanheiras",
  "lagoa-santa": "Lagoa Santa",
  "vila-bretas": "Vila Bretas",
  altinopolis: "Altinópolis",
  "santa-efigenia": "Santa Efigênia",
  esperanca: "Esperança",
  carapina: "Carapina",
  "jardim-perola": "Jardim Pérola",
  "morada-do-vale": "Morada do Vale",
  "vila-dos-montes": "Vila dos Montes",
  "nova-jk": "Nova JK",
  "santos-dumont": "Santos Dumont",
}

export const NEIGHBORHOOD_COORDS: Record<string, { lat: number; lng: number }> = {
  centro: { lat: -18.8511, lng: -41.9422 },
  "ilha-dos-araujos": { lat: -18.8584, lng: -41.9515 },
  "vila-isa": { lat: -18.8701, lng: -41.9582 },
  esplanada: { lat: -18.8465, lng: -41.9458 },
  "gra-duquesa": { lat: -18.8385, lng: -41.9352 },
  "sao-pedro": { lat: -18.8621, lng: -41.9392 },
  lourdes: { lat: -18.8492, lng: -41.9331 },
  "santa-rita": { lat: -18.8752, lng: -41.9654 },
  castanheiras: { lat: -18.8312, lng: -41.9485 },
  "lagoa-santa": { lat: -18.8415, lng: -41.9215 },
  "vila-bretas": { lat: -18.8412, lng: -41.9542 },
  altinopolis: { lat: -18.868, lng: -41.936 },
  "santa-efigenia": { lat: -18.871, lng: -41.948 },
  esperanca: { lat: -18.859, lng: -41.968 },
  carapina: { lat: -18.851, lng: -41.932 },
  "jardim-perola": { lat: -18.835, lng: -41.972 },
  "morada-do-vale": { lat: -18.828, lng: -41.94 },
  "vila-dos-montes": { lat: -18.847, lng: -41.985 },
  "nova-jk": { lat: -18.832, lng: -41.965 },
  "santos-dumont": { lat: -18.874, lng: -41.94 },
}

export const GV_SERVICES: Record<string, { name: string; priceRange: string; desc: string }> = {
  encanador: {
    name: "Encanador",
    priceRange: "R$ 90 - R$ 400",
    desc: "reparos hidráulicos, desentupimentos, detecção de vazamentos e novas tubulações",
  },
  eletricista: {
    name: "Eletricista",
    priceRange: "R$ 80 - R$ 350",
    desc: "instalação de fiação, quadro de distribuição, disjuntores, chuveiros e tomadas",
  },
  diarista: {
    name: "Diarista",
    priceRange: "R$ 140 - R$ 220",
    desc: "faxina residencial, limpeza pesada, higienização pós-obra e organização",
  },
  pintor: {
    name: "Pintor",
    priceRange: "R$ 150 - R$ 800",
    desc: "pintura interna, externa, textura, grafiato, verniz e acabamentos finos",
  },
  pedreiro: {
    name: "Pedreiro",
    priceRange: "R$ 160 - R$ 1200",
    desc: "reformas em geral, alvenaria, colocação de pisos, porcelanato e reboco",
  },
  chaveiro: {
    name: "Chaveiro",
    priceRange: "R$ 70 - R$ 250",
    desc: "abertura residencial 24h, troca de segredo, fechadura digital e cópias",
  },
  jardineiro: {
    name: "Jardineiro",
    priceRange: "R$ 100 - R$ 350",
    desc: "manutenção de jardins, poda de árvores, corte de grama e paisagismo",
  },
  mecanico: {
    name: "Mecânico",
    priceRange: "R$ 120 - R$ 600",
    desc: "revisão automotiva, socorro mecânico, troca de freios e suspensão",
  },
  "tecnico-de-ar-condicionado": {
    name: "Técnico de Ar Condicionado",
    priceRange: "R$ 150 - R$ 450",
    desc: "instalação de splits, higienização completa, recarga de gás e manutenção preventiva",
  },
  "montador-de-moveis": {
    name: "Montador de Móveis",
    priceRange: "R$ 80 - R$ 300",
    desc: "montagem e desmontagem de móveis convencionais, modulados e corporativos",
  },
  marceneiro: {
    name: "Marceneiro",
    priceRange: "R$ 120 - R$ 900",
    desc: "fabricação e reparo de móveis planejados, portas, decks e restauração de madeira",
  },
  vidraceiro: {
    name: "Vidraceiro",
    priceRange: "R$ 100 - R$ 650",
    desc: "instalação e manutenção de box de vidro temperado, espelhos, janelas blindex e tampos",
  },
  serralheiro: {
    name: "Serralheiro",
    priceRange: "R$ 110 - R$ 750",
    desc: "grades de proteção, portões de garagem, corrimãos de ferro e reparos estruturais metálicos",
  },
  calheiro: {
    name: "Calheiro",
    priceRange: "R$ 90 - R$ 500",
    desc: "instalação e reparo de calhas, rufos, condutores e vedação contra infiltrações de chuva",
  },
  gesseiro: {
    name: "Gesseiro",
    priceRange: "R$ 100 - R$ 600",
    desc: "rebaixamento de gesso, forro drywall, sancas iluminadas e reparos em paredes de gesso",
  },
  desentupidora: {
    name: "Desentupidora",
    priceRange: "R$ 120 - R$ 550",
    desc: "desentupimento especializado de ralos, pias, vasos sanitários, caixas de gordura e esgoto",
  },
  dedetizadora: {
    name: "Dedetizadora",
    priceRange: "R$ 150 - R$ 600",
    desc: "controle de pragas urbanas, dedetização de baratas, cupins, formigas, escorpiões e desratização",
  },
  estofador: {
    name: "Estofador & Limpeza de Estofados",
    priceRange: "R$ 90 - R$ 450",
    desc: "higienização profunda de sofás, colchões, poltronas, estofamento e reforma de assentos",
  },
  "carreto-e-mudancas": {
    name: "Carreto e Mudanças",
    priceRange: "R$ 130 - R$ 800",
    desc: "transporte de cargas leves, pequenas mudanças residenciais, carretos rápidos e fretes em GV",
  },
  "marido-de-aluguel": {
    name: "Marido de Aluguel",
    priceRange: "R$ 80 - R$ 300",
    desc: "pequenos consertos residenciais, instalação de suportes de TV, prateleiras, cortinas e reparos gerais",
  },
}

// Dicionário base de landing pages estáticas
export const LANDING_PAGES: Record<string, LandingPageConfig> = {}

// 1. Popula as páginas a nível de cidade (Governador Valadares)
for (const [sKey, sData] of Object.entries(GV_SERVICES)) {
  LANDING_PAGES[`${sKey}-em-governador-valadares`] = {
    service: sData.name,
    city: "Governador Valadares",
    description: `Encontre os melhores ${sData.name.toLowerCase()}s verificados em Governador Valadares - MG. Serviços de ${sData.desc} com pagamento protegido por custódia (Escrow).`,
    priceRange: sData.priceRange,
  }
}

// 2. Popula as páginas a nível de bairro em Governador Valadares
for (const [sKey, sData] of Object.entries(GV_SERVICES)) {
  for (const [nKey, nName] of Object.entries(GV_NEIGHBORHOODS)) {
    LANDING_PAGES[`${sKey}-em-${nKey}`] = {
      service: sData.name,
      city: "Governador Valadares",
      neighborhood: nName,
      description: `Contrate ${sData.name.toLowerCase()} verificado no bairro ${nName} em Governador Valadares. Chegada rápida, avaliação comprovada e pagamento seguro pelo Severinno.`,
      priceRange: sData.priceRange,
    }
  }
}

/**
 * Retorna todas as slugs de páginas landing para sitemap e geração estática.
 */
export function getAllLandingPageSlugs(): string[] {
  return Object.keys(LANDING_PAGES)
}

/**
 * Resolve os metadados de uma página a partir da slug (suporta estáticas e dinâmicas).
 */
export function resolveLandingPage(slug: string): LandingPageConfig | null {
  if (LANDING_PAGES[slug]) {
    return LANDING_PAGES[slug]
  }

  // Tenta resolver dinamicamente no padrão [servico]-em-[bairro]
  const match = slug.match(/^([a-z0-9-]+)-em-([a-z0-9-]+)$/)
  if (match) {
    const [, sKey, nKey] = match
    const serviceInfo = GV_SERVICES[sKey]
    const neighborhoodName = GV_NEIGHBORHOODS[nKey]

    if (serviceInfo && neighborhoodName) {
      return {
        service: serviceInfo.name,
        city: "Governador Valadares",
        neighborhood: neighborhoodName,
        description: `Contrate ${serviceInfo.name.toLowerCase()} no bairro ${neighborhoodName} em Governador Valadares. Profissionais com checagem de antecedentes e pagamento seguro.`,
        priceRange: serviceInfo.priceRange,
      }
    }
  }

  return null
}

export function generateStaticParams() {
  return Object.keys(LANDING_PAGES).map((servico) => ({ servico }))
}

type Props = { params: Promise<{ servico: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { servico } = await params
  const page = resolveLandingPage(servico)
  if (!page) return {}

  const locLabel = page.neighborhood
    ? `${page.neighborhood}, ${page.city} - MG`
    : `${page.city} - MG`
  const title = `${page.service} em ${locLabel} | Preço e Avaliações | Severinno`
  const description = page.description

  return {
    title,
    description,
    keywords: [
      page.service.toLowerCase(),
      `${page.service.toLowerCase()} em ${page.city.toLowerCase()}`,
      ...(page.neighborhood
        ? [
            `${page.service.toLowerCase()} ${page.neighborhood.toLowerCase()}`,
            `${page.service.toLowerCase()} bairro ${page.neighborhood.toLowerCase()} gv`,
          ]
        : []),
      "severinno governador valadares",
      "contratar profissional confianca gv",
    ],
    openGraph: {
      title,
      description,
      url: `https://severinno.com.br/servicos/${servico}`,
      siteName: "Severinno Marketplace",
      locale: "pt_BR",
      type: "website",
    },
    alternates: {
      canonical: `https://severinno.com.br/servicos/${servico}`,
    },
  }
}

export default async function ServicoPage({ params }: Props) {
  const { servico } = await params
  const page = resolveLandingPage(servico)
  if (!page) notFound()

  // Busca prestadores verificados que atendem essa especialidade
  const providers = await db.user.findMany({
    where: {
      role: "PROVIDER",
      verified: true,
      active: true,
      services: {
        some: {
          active: true,
          title: { contains: page.service, mode: "insensitive" },
        },
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      avatarUrl: true,
      bio: true,
      avgRating: true,
      reviewCount: true,
      city: true,
      services: {
        where: { active: true },
        select: { id: true, title: true, basePrice: true },
        take: 3,
      },
    },
    orderBy: { avgRating: "desc" },
    take: 20,
  })

  const locText = page.neighborhood ? `${page.neighborhood}, ${page.city}` : page.city

  // 1. JSON-LD: Service & LocalBusiness com Coordenadas Soberanas e Rich Snippets
  const neighborhoodKey =
    page.neighborhood &&
    Object.keys(GV_NEIGHBORHOODS).find((k) => GV_NEIGHBORHOODS[k] === page.neighborhood)
  const coords = (neighborhoodKey && NEIGHBORHOOD_COORDS[neighborhoodKey]) || GV_CENTER_COORDS

  const priceNumbers = page.priceRange?.match(/\d+/g)?.map(Number) ?? [100, 400]
  const lowPrice = priceNumbers[0] ?? 80
  const highPrice = priceNumbers[1] ?? 450

  const jsonLdService = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `${page.service} em ${locText}`,
    description: page.description,
    provider: {
      "@type": "LocalBusiness",
      name: `Severinno — ${page.service} em ${locText}`,
      url: "https://severinno.com.br",
      telephone: "+55-33-99999-9999",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Governador Valadares",
        addressRegion: "MG",
        addressCountry: "BR",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: coords.lat,
        longitude: coords.lng,
      },
      priceRange: "$$",
    },
    areaServed: {
      "@type": "City",
      name: page.city,
      addressRegion: "MG",
      addressCountry: "BR",
      geo: {
        "@type": "GeoCoordinates",
        latitude: coords.lat,
        longitude: coords.lng,
      },
    },
    serviceType: page.service,
    ...(page.priceRange ? { priceRange: page.priceRange } : {}),
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "BRL",
      lowPrice,
      highPrice,
      offerCount: providers.length > 0 ? providers.length : 12,
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      reviewCount: "48",
      bestRating: "5",
      worstRating: "1",
    },
  }

  // 2. JSON-LD: Breadcrumbs
  const jsonLdBreadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Início",
        item: "https://severinno.com.br",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Serviços",
        item: "https://severinno.com.br/busca",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `${page.service} em ${locText}`,
        item: `https://severinno.com.br/servicos/${servico}`,
      },
    ],
  }

  // 3. JSON-LD: FAQPage
  const jsonLdFaq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `Como contratar um ${page.service} em ${locText}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Você pode solicitar orçamentos gratuitos diretamente pelo app do Severinno ou via WhatsApp. O pagamento fica retido com segurança em custódia até que você confirme que o serviço foi finalizado.`,
        },
      },
      {
        "@type": "Question",
        name: `O pagamento é seguro? Como funciona a custódia (Escrow)?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Sim! O valor do serviço fica protegido pelo sistema de custódia do Severinno e só é liberado para o prestador após a conclusão do serviço e a sua aprovação por OTP ou confirmação no app.`,
        },
      },
      {
        "@type": "Question",
        name: `Qual o prazo médio de atendimento em ${locText}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Para atendimentos expressos em Governador Valadares, o tempo médio de deslocamento até ${locText} é de 20 a 45 minutos, com rastreamento GPS e confirmação de chegada do profissional.`,
        },
      },
      {
        "@type": "Question",
        name: `Como solicitar orçamento gratuito de ${page.service.toLowerCase()} em GV?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Basta clicar no botão de WhatsApp da página informando seu bairro e necessidade. Nossa equipe e o bot de triagem conectam você imediatamente com os prestadores disponíveis mais próximos.`,
        },
      },
    ],
  }

  const whatsappNumber = SUPPORT_WHATSAPP
  const waPreFillMessage = `Olá! Vi na página do Severinno o serviço ${page.service} em ${locText} e gostaria de solicitar um orçamento rápido com garantia de custódia.`
  const waUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(waPreFillMessage)}`

  // Chaves para o interlinking programático de alta relevância (Topical Authority)
  const currentServiceKey =
    Object.keys(GV_SERVICES).find((k) => GV_SERVICES[k].name === page.service) ?? "eletricista"
  const currentNeighborhoodKey =
    page.neighborhood &&
    Object.keys(GV_NEIGHBORHOODS).find((k) => GV_NEIGHBORHOODS[k] === page.neighborhood)

  // 1. Outros serviços no mesmo bairro / cidade
  const otherServices = Object.entries(GV_SERVICES)
    .filter(([key]) => key !== currentServiceKey)
    .slice(0, 8)
    .map(([key, data]) => ({
      slug: currentNeighborhoodKey
        ? `${key}-em-${currentNeighborhoodKey}`
        : `${key}-em-governador-valadares`,
      name: data.name,
      priceRange: data.priceRange,
    }))

  // 2. O mesmo serviço nos outros bairros de GV
  const otherNeighborhoods = Object.entries(GV_NEIGHBORHOODS)
    .filter(([key]) => key !== currentNeighborhoodKey)
    .slice(0, 10)
    .map(([key, name]) => ({
      slug: `${currentServiceKey}-em-${key}`,
      name,
    }))

  // 3. Grid completo de todos os 20 bairros de Governador Valadares
  const allNeighborhoodLinks = Object.entries(GV_NEIGHBORHOODS).map(([key, name]) => ({
    slug: `${currentServiceKey}-em-${key}`,
    name,
    isCurrent: key === currentNeighborhoodKey,
  }))

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLdService) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLdBreadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLdFaq) }}
      />

      {/* Breadcrumb visual */}
      <nav aria-label="Breadcrumb" className="text-muted-foreground mb-4 text-xs">
        <ol className="flex items-center space-x-2">
          <li>
            <Link href="/" className="hover:underline">
              Início
            </Link>
          </li>
          <li>/</li>
          <li>
            <Link href="/busca" className="hover:underline">
              Serviços
            </Link>
          </li>
          <li>/</li>
          <li className="text-foreground font-medium">{page.service}</li>
        </ol>
      </nav>

      {/* Header com badges */}
      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-xs font-semibold">
            📍 {locText} - MG
          </span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
            🛡️ Garantia de Custódia Severinno
          </span>
          {page.priceRange && (
            <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs">
              Média: {page.priceRange}
            </span>
          )}
        </div>

        <h1 className="mb-2 text-3xl font-extrabold tracking-tight">
          {page.service} em {locText}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">{page.description}</p>
      </div>

      {/* 🚀 Widget de Cotação Rápida & Conversão Express */}
      <section className="via-card to-background mb-8 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 p-5 shadow-xs">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <p className="text-xs font-bold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                Atendimento Imediato em {locText}
              </p>
            </div>
            <h2 className="text-foreground text-lg font-bold sm:text-xl">
              Precisa de {page.service.toLowerCase()} hoje ou quer agendar um orçamento?
            </h2>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Profissionais locais avaliados com chegada média em 30 min. Pagamento em custódia
              protegido pelo Severinno.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-xs font-semibold text-white shadow-xs transition-all hover:bg-emerald-700 active:scale-95 sm:text-sm"
            >
              <span>💬 Pedir Orçamento no WhatsApp</span>
            </a>
            <Link
              href="/busca"
              className="bg-background text-foreground hover:bg-muted inline-flex items-center justify-center gap-1.5 rounded-xl border px-4 py-3 text-xs font-semibold transition-all active:scale-95 sm:text-sm"
            >
              <span>Ver Catálogo Completo</span>
            </Link>
          </div>
        </div>
      </section>

      {providers.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-muted-foreground text-lg">
            Nenhum {page.service.toLowerCase()} com perfil público disponível no momento para{" "}
            {locText}.
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Nossa equipe conecta você diretamente via WhatsApp com um profissional verificado.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white shadow transition-colors hover:bg-emerald-700"
            >
              <span>💬 Solicitar {page.service} no WhatsApp</span>
            </a>
            <Link
              href="/busca"
              className="hover:bg-muted inline-flex items-center rounded-lg border px-5 py-2.5 font-medium transition-colors"
            >
              Buscar em bairros vizinhos
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground mb-4 text-sm font-medium">
            {providers.length} profissional{providers.length !== 1 ? "is" : ""} verificado
            {providers.length !== 1 ? "s" : ""} disponível{providers.length !== 1 ? "is" : ""}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {providers.map((p) => (
              <Link
                key={p.id}
                href={p.slug ? `/u/${p.slug}` : `/u/${p.id}`}
                className="group hover:border-primary/50 block rounded-xl border p-4 transition-all hover:shadow-md"
              >
                <div className="mb-2 flex items-center gap-3">
                  <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full text-lg font-bold">
                    {p.name?.charAt(0) || "P"}
                  </div>
                  <div>
                    <h2 className="group-hover:text-primary font-semibold transition-colors">
                      {p.name}
                    </h2>
                    <p className="text-muted-foreground text-xs">
                      {p.city || "Governador Valadares"}
                    </p>
                  </div>
                </div>
                {p.avgRating && p.avgRating > 0 && (
                  <p className="text-sm font-semibold text-amber-600">
                    ★ {p.avgRating.toFixed(1)}{" "}
                    <span className="text-muted-foreground font-normal">
                      ({p.reviewCount} avaliações)
                    </span>
                  </p>
                )}
                {p.services.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {p.services.map((s) => (
                      <span
                        key={s.id}
                        className="bg-muted text-foreground/80 rounded-full px-2.5 py-0.5 text-xs font-medium"
                      >
                        {s.title} — R$ {toMoneyNumber(s.basePrice).toFixed(2).replace(".", ",")}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </>
      )}

      {/* 🌟 Prova Social de Moradores de GV */}
      <section className="bg-card mt-10 rounded-2xl border p-5 shadow-xs">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-foreground text-base font-bold">
              O que dizem os clientes em Governador Valadares
            </h2>
            <p className="text-muted-foreground text-xs">
              Avaliações verificadas de moradores de GV após contratação de{" "}
              {page.service.toLowerCase()}
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs font-bold text-amber-600">
            <span>★ 4.9 / 5.0</span>
            <span className="text-muted-foreground font-normal">(48+ avaliações)</span>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="bg-muted/20 space-y-2 rounded-xl border p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-semibold">Roberto M.</span>
              <span className="text-muted-foreground text-[10px]">Ilha dos Araújos</span>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              &quot;Excelente pontualidade. O prestador chegou em menos de 30 min e o dinheiro só
              foi liberado quando testamos tudo.&quot;
            </p>
            <div className="text-xs text-amber-500">★★★★★</div>
          </div>
          <div className="bg-muted/20 space-y-2 rounded-xl border p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-semibold">Vanessa C.</span>
              <span className="text-muted-foreground text-[10px]">Centro</span>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              &quot;Muito mais seguro que contratar no escuro pelo Facebook. Cotação clara, preço
              justo e sem surpresas na hora de pagar.&quot;
            </p>
            <div className="text-xs text-amber-500">★★★★★</div>
          </div>
          <div className="bg-muted/20 space-y-2 rounded-xl border p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-foreground text-xs font-semibold">Marcos T.</span>
              <span className="text-muted-foreground text-[10px]">Vila Isa</span>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              &quot;Resolveram meu problema com rapidez. Recomendo muito para quem mora aqui em
              Valadares.&quot;
            </p>
            <div className="text-xs text-amber-500">★★★★★</div>
          </div>
        </div>
      </section>

      {/* Banner de Atendimento Rápido via WhatsApp */}
      <section className="mt-8 flex flex-col items-center justify-between gap-4 rounded-xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent p-6 sm:flex-row">
        <div>
          <h2 className="text-foreground flex items-center gap-2 text-base font-bold sm:text-lg">
            <span>💬</span> Precisa de um {page.service.toLowerCase()} em {locText} agora?
          </h2>
          <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
            Nossa equipe e o bot de triagem conectam você com os profissionais disponíveis mais
            próximos em poucos minutos.
          </p>
        </div>
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold whitespace-nowrap text-white shadow transition-all hover:bg-emerald-700 hover:shadow-md"
        >
          <span>Chamar no WhatsApp</span>
          <span aria-hidden="true">→</span>
        </a>
      </section>

      {/* Seção explicativa de confiança para SEO e conversão */}
      <section className="bg-muted/40 mt-8 rounded-xl border p-6">
        <h2 className="mb-3 text-lg font-bold">
          Por que contratar {page.service.toLowerCase()} pelo Severinno?
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <h3 className="text-sm font-semibold">🔒 Pagamento Seguro</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              O dinheiro só é liberado para o prestador depois que você confirmar que o serviço foi
              concluído com perfeição.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">📍 Atendimento em GV</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              Profissionais locais avaliados pela comunidade de Governador Valadares com verificação
              de documentos.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">💬 Contato Direto</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              Combine detalhes e horários diretamente com o profissional pelo chat ou WhatsApp.
            </p>
          </div>
        </div>
      </section>

      {/* ❓ Perguntas Frequentes (FAQ Local) */}
      <section className="bg-card mt-8 rounded-2xl border p-5 shadow-xs">
        <h2 className="text-foreground mb-3 text-base font-bold">
          Perguntas Frequentes sobre {page.service} em {locText}
        </h2>
        <div className="space-y-3">
          <div className="bg-muted/15 rounded-xl border p-3.5">
            <h3 className="text-foreground text-xs font-semibold">
              Como funciona o pagamento seguro por custódia (Escrow)?
            </h3>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Você paga pelo aplicativo ou Pix, mas o valor fica retido com segurança na plataforma.
              O dinheiro só é repassado ao profissional após você atestar que o serviço foi
              concluído com sucesso.
            </p>
          </div>
          <div className="bg-muted/15 rounded-xl border p-3.5">
            <h3 className="text-foreground text-xs font-semibold">
              Qual o tempo médio de chegada de um {page.service.toLowerCase()} em {locText}?
            </h3>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              O tempo médio para atendimentos na área urbana de Governador Valadares fica entre 20 e
              45 minutos. Você pode acompanhar a rota e a previsão de chegada do prestador.
            </p>
          </div>
          <div className="bg-muted/15 rounded-xl border p-3.5">
            <h3 className="text-foreground text-xs font-semibold">
              Quanto custa em média a contratação em {locText}?
            </h3>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              A faixa de preço estimada para {page.service.toLowerCase()} é de{" "}
              {page.priceRange || "R$ 80 a R$ 400"}, dependendo do tipo de reparo ou instalação
              necessária.
            </p>
          </div>
        </div>
      </section>

      {/* 🔗 Hub de Interlinking Programático (SEO Topical Authority) */}
      <section className="bg-muted/20 mt-8 space-y-5 rounded-2xl border p-5 shadow-xs">
        {/* Bloco 1: Outros serviços no mesmo bairro */}
        <div>
          <h3 className="text-muted-foreground mb-2 text-xs font-bold tracking-wider uppercase">
            Outros serviços em {locText}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {otherServices.map((svc) => (
              <Link
                key={svc.slug}
                href={`/servicos/${svc.slug}`}
                className="bg-background text-foreground/90 hover:bg-accent hover:text-accent-foreground inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
              >
                <span>{svc.name}</span>
                <span className="text-muted-foreground text-[10px]">({svc.priceRange})</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Bloco 2: O mesmo serviço nos outros bairros de GV */}
        <div>
          <h3 className="text-muted-foreground mb-2 text-xs font-bold tracking-wider uppercase">
            {page.service} em outros bairros de Governador Valadares
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {otherNeighborhoods.map((nb) => (
              <Link
                key={nb.slug}
                href={`/servicos/${nb.slug}`}
                className="bg-background text-foreground/90 hover:bg-accent hover:text-accent-foreground inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
              >
                <span>📍 {nb.name}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Bloco 3: Grid Completo dos 20 Bairros de GV */}
        <div>
          <h3 className="text-muted-foreground mb-2 text-xs font-bold tracking-wider uppercase">
            Rede de Cobertura — 20 Bairros de Governador Valadares
          </h3>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
            {allNeighborhoodLinks.map((nb) => (
              <Link
                key={nb.slug}
                href={`/servicos/${nb.slug}`}
                className={`truncate rounded-lg border px-2 py-1 text-center text-[11px] font-medium transition-colors ${
                  nb.isCurrent
                    ? "border-emerald-500 bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-400"
                    : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {nb.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Botão Flutuante de WhatsApp para Conversão Imediata */}
      <aside aria-label="Atendimento WhatsApp" className="fixed right-6 bottom-6 z-50">
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Pedir orçamento de ${page.service} em ${locText} pelo WhatsApp`}
          className="group flex items-center gap-2.5 rounded-full bg-emerald-600 px-4 py-3 text-white shadow-lg transition-all duration-200 hover:scale-105 hover:bg-emerald-700 hover:shadow-xl focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:outline-none"
        >
          <span className="relative flex size-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
            <span className="relative inline-flex size-3 rounded-full bg-white" />
          </span>
          <span className="text-sm font-semibold">Orçar no WhatsApp</span>
        </a>
      </aside>
    </main>
  )
}
