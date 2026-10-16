export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import {
  generateProofOfWorkCertificate,
  renderProofOfWorkHtml,
} from "@/lib/proof-of-work-certificate"
import { withParams } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * GET /api/bookings/[id]/certificate
 *
 * Emite o Certificado Criptográfico de Conclusão de Serviço ("Proof of Work")
 * em formato JSON ou HTML pronto para impressão/defesa de chargeback.
 *
 * Query Params:
 *   format: "html" | "json" (default: "json")
 */
export const GET = withParams<{ id: string }>(
  "api.bookings.:id.certificate.GET",
  async (req, { params }) => {
    await assertRateLimit(req, RATE_LIMITS.bookings)

    const { id: bookingId } = await params

    if (!bookingId) {
      return NextResponse.json({ error: "Booking ID é obrigatório." }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const format = searchParams.get("format") || "json"

    const certificate = await generateProofOfWorkCertificate(bookingId)

    if (!certificate) {
      return NextResponse.json(
        { error: "Agendamento não encontrado para emissão do certificado." },
        { status: 404 },
      )
    }

    if (format === "html") {
      const html = renderProofOfWorkHtml(certificate)
      return new NextResponse(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; font-src 'none';",
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: certificate,
    })
  },
)
