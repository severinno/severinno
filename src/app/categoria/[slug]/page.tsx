import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { CategoryPage } from "./category-page"
import { BreadcrumbJsonLd } from "@/components/shared/breadcrumb-json-ld"

// ISR — página pública de SEO: dados de categoria mudam raramente.
// generateStaticParams pré-renderiza todas as categorias no build (estática
// de verdade); slugs novos/desconhecidos caem em on-demand (dynamicParams
// default true) e entram no full route cache com a mesma revalidação.
// Prisma direto, sem fetch — o route-level revalidate é o mecanismo correto.
export const revalidate = 300

export async function generateStaticParams() {
  try {
    const { db } = await import("@/lib/db")
    const categories = await db.category.findMany({
      select: { slug: true },
    })
    return categories.flatMap((c) => (c.slug ? [{ slug: c.slug }] : []))
  } catch {
    // DB indisponível no build (ex.: Docker sem service): cai para on-demand ISR.
    return []
  }
}

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
      description: category.description ?? `Encontre os melhores profissionais de ${category.name}. Agende serviços online com facilidade.`,
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

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Início", url: baseUrl },
          { name: category.name, url: `${baseUrl}/categoria/${slug}` },
        ]}
      />
      <CategoryPage category={category} />
    </>
  )
}
