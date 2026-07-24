export function JsonLd() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com.br"

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "Severinno",
        url: baseUrl,
        description: "Conectamos você aos melhores profissionais da sua região.",
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${baseUrl}/?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        name: "Severinno",
        url: baseUrl,
        logo: `${baseUrl}/logo.svg`,
        sameAs: [
          "https://instagram.com/severinno",
          "https://facebook.com/severinno",
        ],
      },
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
