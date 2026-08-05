import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { CategoryPage } from "../../[slug]/category-page"
import { BreadcrumbJsonLd } from "@/components/shared/breadcrumb-json-ld"

interface Props {
  params: Promise<{ slug: string; child: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, child } = await params
  try {
    const { db } = await import("@/lib/db")
    const category = await db.category.findFirst({
      where: { slug: child, parent: { slug } },
      select: { id: true, name: true, description: true, parent: { select: { name: true } } },
    })
    if (!category) return {}
    return {
      title: `${category.name} ${category.parent ? `— ${category.parent.name}` : ""} — Severinno`,
      description: category.description ?? `Encontre profissionais de ${category.name}.`,
    }
  } catch {
    return {}
  }
}

export default async function Page({ params }: Props) {
  const { slug, child } = await params
  const { db } = await import("@/lib/db")
  const category = await db.category.findFirst({
    where: { slug: child, parent: { slug } },
    select: { id: true, name: true, description: true },
  })
  if (!category) notFound()

  const { db: db2 } = await import("@/lib/db")
  const parentCat = await db2.category.findUnique({
    where: { slug },
    select: { name: true },
  })

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com.br"

  return (
    <div>
      <BreadcrumbJsonLd
        items={[
          { name: "Início", url: baseUrl },
          { name: parentCat?.name ?? slug, url: `${baseUrl}/categoria/${slug}` },
          { name: category.name, url: `${baseUrl}/categoria/${slug}/${child}` },
        ]}
      />
      <div className="mx-auto max-w-7xl px-4 pt-4">
        <nav className="text-muted-foreground text-sm">
          <a href="/" className="hover:text-emerald-600">
            Início
          </a>
          <span className="mx-2">›</span>
          <a href={`/categoria/${slug}`} className="hover:text-emerald-600">
            {parentCat?.name ?? slug}
          </a>
          <span className="mx-2">›</span>
          <span className="text-foreground">{category.name}</span>
        </nav>
      </div>
      <CategoryPage category={category} />
    </div>
  )
}
