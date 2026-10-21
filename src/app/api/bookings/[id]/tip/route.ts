import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { badRequest } from "@/lib/api-server"
import { processDigitalTip } from "@/lib/digital-tips-engine"

export const POST = withRoute<{ id: string }>("api.bookings.tip.POST", async (req, { params }) => {
  const bookingId = params?.id
  const body = await req.json()
  const { clientName, providerName, providerPixKey, amount, message } = body

  if (!bookingId || !clientName || !providerName || !providerPixKey || amount === undefined) {
    throw badRequest("Dados incompletos para envio da gorjeta")
  }

  const receipt = processDigitalTip({
    bookingId,
    clientName,
    providerName,
    providerPixKey,
    amount: Number(amount),
    message,
  })

  return NextResponse.json({
    success: true,
    message: "Gorjeta processada com sucesso (0% taxa da plataforma)",
    receipt,
  })
})
