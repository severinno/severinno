import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { badRequest } from "@/lib/api-server"
import { generateWhatsAppPixCheckoutBundle } from "@/lib/whatsapp-pix-checkout"

export const POST = withRoute<{ id: string }>(
  "api.bookings.whatsapp-checkout.POST",
  async (req, { params }) => {
    const bookingId = params?.id
    const body = await req.json()
    const {
      clientName,
      clientPhone,
      providerName,
      serviceTitle,
      amount,
      pixCopyPaste,
      qrCodeBase64,
      qrCodeUrl,
    } = body

    if (!bookingId || !clientName || !clientPhone || !amount || !pixCopyPaste) {
      throw badRequest("Dados incompletos para gerar checkout WhatsApp")
    }

    const bundle = generateWhatsAppPixCheckoutBundle({
      bookingId,
      clientName,
      clientPhone,
      providerName: providerName || "Prestador Parceiro",
      serviceTitle: serviceTitle || "Serviço Residencial",
      amount: Number(amount),
      pixCopyPaste,
      qrCodeBase64,
      qrCodeUrl,
    })

    return NextResponse.json({
      success: true,
      bundle,
    })
  },
)
