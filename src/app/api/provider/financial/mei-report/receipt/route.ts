export const dynamic = "force-dynamic"

import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import {
  generateCorporateFiscalReceipt,
  renderCorporateFiscalReceiptHtml,
  type CorporateFiscalReceiptInput,
} from "@/lib/mei-fiscal"
import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.provider.financial.mei-report.receipt.POST", async (req) => {
  await requireRole("PROVIDER")
  await assertRateLimit(req, RATE_LIMITS.general)

  const body = await req.json()
  const {
    bookingId,
    providerName,
    providerCpfCnpj,
    clientName,
    clientCnpj,
    serviceTitle,
    serviceDate,
    grossAmount,
    platformFee,
    city,
    format = "json",
  } = body

  if (!bookingId || !providerName || !providerCpfCnpj || !clientName || !grossAmount) {
    return Response.json(
      { error: "Campos obrigatórios ausentes para emissão do recibo fiscal" },
      { status: 400 },
    )
  }

  const receiptInput: CorporateFiscalReceiptInput = {
    bookingId,
    providerName,
    providerCpfCnpj,
    clientName,
    clientCnpj: clientCnpj || "Consumidor Final",
    serviceTitle: serviceTitle || "Serviço Residencial/Comercial",
    serviceDate: serviceDate ? new Date(serviceDate) : new Date(),
    grossAmount: Number(grossAmount),
    platformFee: platformFee ? Number(platformFee) : undefined,
    city,
  }

  const receipt = generateCorporateFiscalReceipt(receiptInput)

  if (format === "html") {
    const html = renderCorporateFiscalReceiptHtml(receipt)
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    })
  }

  return Response.json({
    success: true,
    data: receipt,
  })
})
