import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { CategoryPage } from "./category-page"
import { BreadcrumbJsonLd } from "@/components/shared/breadcrumb-json-ld"
import { sanitizeForJsonLd } from "@/lib/sanitize"

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  try {
    const { db } = await import("@/lib/db")
    const category = await db.category.findUnique({
      where: { slug },
      select: { name: true, description: true },
    })
    if (!category) return {}
    return {
      title: `${category.name} — Profissionais em ${category.name} — Severinno`,
      description:
        category.description ??
        `Encontre os melhores profissionais de ${category.name}. Agende serviços online com facilidade.`,
      openGraph: {
        title: `${category.name} — Severinno`,
        description: category.description ?? `Encontre profissionais de ${category.name}.`,
      },
    }
  } catch {
    return {}
  }
}

export default async function Page({ params }: Props) {
  const { slug } = await params
  const { db } = await import("@/lib/db")
  const category = await db.category.findUnique({
    where: { slug },
    select: { id: true, name: true, description: true },
  })
  if (!category) notFound()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com.br"

  const categoryJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: sanitizeForJsonLd(category.name),
    description: sanitizeForJsonLd(
      category.description ?? `Encontre profissionais de ${category.name} no Severinno.`,
    ),
    provider: {
      "@type": "Organization",
      name: "Severinno Marketplace",
      url: baseUrl,
    },
    areaServed: {
      "@type": "Country",
      name: "Brasil",
    },
  }

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Início", url: baseUrl },
          { name: category.name, url: `${baseUrl}/categoria/${slug}` },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(categoryJsonLd) }}
      />
      <CategoryPage category={category} />
    </>
  )
}
