import { MetadataRoute } from "next"
import { db } from "@/lib/db"

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com.br"

function staticPages(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 1,
    },
    {
      url: `${BASE_URL}/busca`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/como-funciona`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/termos`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/contato`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.4,
    },
  ]
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Durante build (Docker, sem DB disponível), retorna apenas páginas estáticas
  try {
    const [providers, _categories] = await Promise.all([
      db.user.findMany({
        where: { role: "PROVIDER", active: true, slug: { not: null } },
        select: { slug: true, updatedAt: true },
        take: 1000,
      }),
      db.category.findMany({
        where: { active: true, level: 0 },
        select: { slug: true, updatedAt: true },
      }),
    ])

    const catLevel1 = await db.category.findMany({
      where: { active: true, level: 1 },
      select: { slug: true, updatedAt: true },
    })

    const catLevel2 = await db.category.findMany({
      where: { active: true, level: 2, parent: { active: true } },
      select: { slug: true, updatedAt: true, parent: { select: { slug: true } } },
    })

    const providerUrls: MetadataRoute.Sitemap = providers.map((p) => ({
      url: `${BASE_URL}/u/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }))

    const categoryUrls: MetadataRoute.Sitemap = catLevel1.map((cat) => ({
      url: `${BASE_URL}/categoria/${cat.slug}`,
      lastModified: cat.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }))

    const subcategoryUrls: MetadataRoute.Sitemap = catLevel2.map((cat) => ({
      url: `${BASE_URL}/categoria/${cat.parent!.slug}/${cat.slug}`,
      lastModified: cat.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }))

    return [...staticPages(), ...providerUrls, ...categoryUrls, ...subcategoryUrls]
  } catch {
    // DB indisponível (ex: durante Docker build sem banco)
    // Retorna apenas URLs estáticas
    return staticPages()
  }
}
