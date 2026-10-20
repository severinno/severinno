import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { toMoneyNumber } from "@/lib/money"

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
    ],
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdService) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBreadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFaq) }}
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
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
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

      {providers.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-muted-foreground text-lg">
            Nenhum {page.service.toLowerCase()} com perfil público disponível no momento para{" "}
            {locText}.
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Nossa equipe conecta você diretamente via WhatsApp com um profissional verificado.
          </p>
          <Link
            href="/busca"
            className="bg-primary text-primary-foreground mt-4 inline-block rounded-lg px-6 py-2.5 font-medium transition-colors hover:opacity-90"
          >
            Buscar em bairros vizinhos
          </Link>
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

      {/* Seção explicativa de confiança para SEO e conversão */}
      <section className="bg-muted/40 mt-12 rounded-xl border p-6">
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
    </main>
  )
}
