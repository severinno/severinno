import { NextRequest, NextResponse } from "next/server"
import { generateWhatsAppPixCheckoutBundle } from "@/lib/whatsapp-pix-checkout"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookingId } = await params
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
      return NextResponse.json(
        { error: "Dados incompletos para gerar checkout WhatsApp" },
        { status: 400 },
      )
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao gerar checkout WhatsApp"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
