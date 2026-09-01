import { sanitizeForJsonLd } from "@/lib/sanitize"

type Crumb = { name: string; url: string }

export function BreadcrumbJsonLd({ items }: { items: Crumb[] }) {
  if (items.length < 2) return null

  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: sanitizeForJsonLd(item.name),
      item: sanitizeForJsonLd(item.url),
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
