import { Metadata } from "next"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { TrackingPageLoader } from "./tracking-page-loader"

// O mapa é client-only: o `dynamic(..., { ssr: false })` vive no wrapper
// `tracking-page-loader` porque este arquivo é Server Component e o Next 16
// rejeita `ssr: false` declarado aqui (quebrava o `next build`).

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const booking = await db.booking.findUnique({
    where: { id },
    select: { id: true, status: true, service: { select: { title: true } } },
  })
  if (!booking) return { title: "Agendamento não encontrado" }
  const statusLabels: Record<string, string> = {
    PENDING: "Pendente",
    CONFIRMED: "Confirmado",
    IN_PROGRESS: "Em andamento",
    COMPLETED: "Concluído",
    CANCELLED: "Cancelado",
  }
  return {
    title: `${statusLabels[booking.status] ?? booking.status} — ${booking.service.title}`,
    description: "Acompanhe o status do seu agendamento no Severinno.",
  }
}

export default async function Page({ params }: Props) {
  const { id } = await params
  const booking = await db.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      scheduledAt: true,
      address: true,
      createdAt: true,
      amount: true,
      lat: true,
      lng: true,
      provider: { select: { id: true, name: true, avatarUrl: true } },
      client: { select: { id: true, name: true } },
      service: { select: { id: true, title: true, basePrice: true } },
    },
  })
  if (!booking) notFound()
  // Serialize Date fields to strings (Next.js serializes them for client)
  const serialized = {
    ...booking,
    scheduledAt: booking.scheduledAt.toISOString(),
    createdAt: booking.createdAt.toISOString(),
  }
  return <TrackingPageLoader booking={serialized} />
}
