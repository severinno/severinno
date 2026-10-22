import { Metadata } from "next"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { PublicProfilePage, type PublicProfileProvider } from "./public-profile-page"
import { BreadcrumbJsonLd } from "@/components/shared/breadcrumb-json-ld"
import { sanitizeForJsonLd, serializeJsonLd } from "@/lib/sanitize"
import { exactShape } from "@/lib/api-server"
import { toMoneyNumber } from "@/lib/money"
import { isAmbassador } from "@/lib/referral"

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const user = await db.user.findFirst({
    where: { OR: [{ slug }, { id: slug }] },
    select: { name: true, bio: true, avatarUrl: true, city: true, state: true },
  })
  if (!user) return { title: "Perfil não encontrado" }

  return {
    title: `${user.name} - Severinno`,
    description: user.bio ?? `Conheça ${user.name} no Severinno. Agende serviços online.`,
    openGraph: {
      title: `${user.name} - Severinno`,
      description: user.bio ?? `Conheça ${user.name} no Severinno.`,
      ...(user.avatarUrl ? { images: [{ url: user.avatarUrl }] } : {}),
    },
  }
}

export default async function Page({ params }: Props) {
  const { slug } = await params

  const provider = await db.user.findFirst({
    where: { OR: [{ slug }, { id: slug }], role: "PROVIDER", active: true },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      coverUrl: true,
      bio: true,
      city: true,
      state: true,
      whatsapp: true,
      verified: true,
      identityStatus: true,
      services: {
        where: { active: true },
        select: { id: true, title: true, basePrice: true, duration: true, description: true },
      },
      reviewsReceived: {
        select: {
          id: true,
          rating: true,
          comment: true,
          photos: true,
          createdAt: true,
          client: { select: { name: true, avatarUrl: true } },
          booking: {
            select: {
              status: true,
              paymentStatus: true,
              escrowReleasedAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      availability: {
        select: { dayOfWeek: true, startTime: true, endTime: true, active: true },
        orderBy: { dayOfWeek: "asc" },
      },
      _count: {
        select: { reviewsReceived: true, bookingsAsProvider: { where: { status: "COMPLETED" } } },
      },
    },
  })

  if (!provider) notFound()

  const rating =
    provider.reviewsReceived.length > 0
      ? provider.reviewsReceived.reduce((acc, r) => acc + r.rating, 0) /
        provider.reviewsReceived.length
      : 0

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: sanitizeForJsonLd(provider.name),
    description: provider.bio ? sanitizeForJsonLd(provider.bio) : undefined,
    image: provider.avatarUrl ?? undefined,
    address: {
      "@type": "PostalAddress",
      addressLocality: provider.city ?? undefined,
      addressRegion: provider.state ?? undefined,
    },
    priceRange: "$$",
    ...(provider.reviewsReceived.length > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: rating.toFixed(1),
            reviewCount: provider.reviewsReceived.length,
            bestRating: 5,
          },
        }
      : {}),
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com.br"

  // Segunda barreira do perfil público (a primeira é o `select` acima):
  // `_count` fica só para derivar os números, e o restante é travado na forma
  // exata que o componente consome. Se alguém voltar a pedir `email` (ou
  // qualquer coluna sensível) no `select`, isto deixa de compilar em vez de
  // vazar no payload RSC desta página pública e indexável.
  const { _count, ...profileRow } = provider
  const ambassador = await isAmbassador(provider.id)
  const profile = exactShape<PublicProfileProvider>()({
    ...profileRow,
    isAmbassador: ambassador,
    // Decimal → number na fronteira RSC: o contrato do componente é number
    services: profileRow.services.map((s) => ({ ...s, basePrice: toMoneyNumber(s.basePrice) })),
    reviewsReceived: profileRow.reviewsReceived.map((r) => {
      const photosArray = Array.isArray(r.photos)
        ? (r.photos as string[]).filter((p) => typeof p === "string")
        : []
      const isVerified =
        r.booking?.status === "COMPLETED" &&
        (r.booking?.paymentStatus === "PAID" || r.booking?.escrowReleasedAt != null)
      return {
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        photos: photosArray,
        isVerified,
        createdAt: r.createdAt,
        client: r.client,
      }
    }),
    rating,
    reviewCount: _count.reviewsReceived,
    completedBookings: _count.bookingsAsProvider,
  })

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Início", url: baseUrl },
          { name: provider.name, url: `${baseUrl}/u/${slug}` },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <PublicProfilePage provider={profile} />
    </>
  )
}
