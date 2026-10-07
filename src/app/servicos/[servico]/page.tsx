import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { toMoneyNumber } from "@/lib/money"

/**
 * SEO landing pages for high-value search terms.
 *
 * Examples:
 *   /servicos/encanador-em-governador-valadares
 *   /servicos/pedreiro-gv
 *   /servicos/eletricista-bairro-centro
 *
 * These pages are statically generated at build time and indexed by Google.
 * Each page shows providers for a specific service in a specific location.
 */

// Map of slug → { service, city, neighborhood }
const LANDING_PAGES: Record<
  string,
  { service: string; city: string; neighborhood?: string; description: string }
> = {
  "encanador-em-governador-valadares": {
    service: "Encanador",
    city: "Governador Valadares",
    description:
      "Encontre os melhores encanadores verificados em Governador Valadares. Reparos hidráulicos, desentupimento, instalações e mais.",
  },
  "pedreiro-em-governador-valadares": {
    service: "Pedreiro",
    city: "Governador Valadares",
    description:
      "Contrate pedreiros verificados em Governador Valadares. Reformas, construção civil, alvenaria e acabamento.",
  },
  "eletricista-em-governador-valadares": {
    service: "Eletricista",
    city: "Governador Valadares",
    description:
      "Eletricistas verificados em Governador Valadares. Instalações, reparos, fiação e quadro de luz.",
  },
  "pintor-em-governador-valadares": {
    service: "Pintor",
    city: "Governador Valadares",
    description:
      "Pintores profissionais em Governador Valadares. Pintura residencial, comercial, textura e grafiato.",
  },
  "diarista-em-governador-valadares": {
    service: "Diarista",
    city: "Governador Valadares",
    description:
      "Diaristas e faxineiras verificadas em Governador Valadares. Limpeza residencial e comercial.",
  },
  "jardineiro-em-governador-valadares": {
    service: "Jardineiro",
    city: "Governador Valadares",
    description:
      "Jardineiros profissionais em Governador Valadares. Podadeira, manutenção de jardim e paisagismo.",
  },
  "mecanico-em-governador-valadares": {
    service: "Mecânico",
    city: "Governador Valadares",
    description:
      "Mecânicos automotivos verificados em Governador Valadares. Revisão, manutenção e conserto.",
  },
  "chaveiro-em-governador-valadares": {
    service: "Chaveiro",
    city: "Governador Valadares",
    description:
      "Chaveiros 24h em Governador Valadares. Cópia de chaves, abertura de portas e fechaduras.",
  },
  "tecnico-de-ar-condicionado-em-governador-valadares": {
    service: "Técnico de Ar Condicionado",
    city: "Governador Valadares",
    description:
      "Técnicos de ar condicionado em Governador Valadares. Instalação, limpeza e manutenção de splits.",
  },
  "encanador-em-centro": {
    service: "Encanador",
    city: "Governador Valadares",
    neighborhood: "Centro",
    description: "Encanadores no Centro de Governador Valadares. Atendimento rápido e verificado.",
  },
}

type Props = { params: Promise<{ servico: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { servico } = await params
  const page = LANDING_PAGES[servico]
  if (!page) return {}

  const title = `${page.service} em ${page.city}${page.neighborhood ? ` - ${page.neighborhood}` : ""} | Severinno`
  const description = page.description

  return {
    title,
    description,
    keywords: [
      page.service.toLowerCase(),
      `${page.service.toLowerCase()} ${page.city.toLowerCase()}`,
      `contratar ${page.service.toLowerCase()}`,
      `melhor ${page.service.toLowerCase()} ${page.city.toLowerCase()}`,
      "severinno",
    ],
    openGraph: {
      title,
      description,
      url: `https://severinno.com/servicos/${servico}`,
      siteName: "Severinno",
      locale: "pt_BR",
      type: "website",
    },
    alternates: {
      canonical: `https://severinno.com/servicos/${servico}`,
    },
  }
}

export default async function ServicoPage({ params }: Props) {
  const { servico } = await params
  const page = LANDING_PAGES[servico]
  if (!page) notFound()

  // Fetch providers for this service
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

  // Structured data for Google
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `${page.service} em ${page.city}`,
    description: page.description,
    provider: {
      "@type": "Organization",
      name: "Severinno",
      url: "https://severinno.com",
    },
    areaServed: {
      "@type": "City",
      name: page.city,
    },
    serviceType: page.service,
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <h1 className="mb-2 text-3xl font-bold">
        {page.service} em {page.city}
        {page.neighborhood ? ` - ${page.neighborhood}` : ""}
      </h1>
      <p className="text-muted-foreground mb-8">{page.description}</p>

      {providers.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground text-lg">
            Nenhum {page.service.toLowerCase()} encontrado ainda em{" "}
            {page.neighborhood ? `${page.neighborhood}, ` : ""}
            {page.city}.
          </p>
          <Link
            href="/"
            className="bg-primary text-primary-foreground mt-4 inline-block rounded-lg px-6 py-2"
          >
            Buscar outros serviços
          </Link>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground mb-4 text-sm">
            {providers.length} prestador{providers.length !== 1 ? "es" : ""} encontrado
            {providers.length !== 1 ? "s" : ""}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {providers.map((p) => (
              <Link
                key={p.id}
                href={p.slug ? `/u/${p.slug}` : `/u/${p.id}`}
                className="block rounded-xl border p-4 transition-shadow hover:shadow-md"
              >
                <div className="mb-2 flex items-center gap-3">
                  <div className="bg-muted flex size-10 items-center justify-center rounded-full text-lg font-bold">
                    {p.name?.charAt(0)}
                  </div>
                  <div>
                    <h2 className="font-semibold">{p.name}</h2>
                    <p className="text-muted-foreground text-xs">{p.city}</p>
                  </div>
                </div>
                {p.avgRating && p.avgRating > 0 && (
                  <p className="text-sm text-amber-600">
                    ★ {p.avgRating.toFixed(1)} ({p.reviewCount} avaliações)
                  </p>
                )}
                {p.services.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.services.map((s) => (
                      <span key={s.id} className="bg-muted rounded-full px-2 py-0.5 text-xs">
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

      <div className="text-muted-foreground mt-12 text-center text-sm">
        <p>
          Encontrou o profissional certo?{" "}
          <Link href="/" className="text-primary underline">
            Acesse o Severinno
          </Link>{" "}
          para agendar e pagar pelo app.
        </p>
      </div>
    </main>
  )
}
