export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, notFound } from "@/lib/api-server"
import { formatBRL, formatDateTime } from "@/lib/format"
import { toMoneyNumber } from "@/lib/money"
import crypto from "crypto"

import { withParams } from "@/lib/api-route"
import { escapeHtml } from "@/lib/sanitize"

/**
 * GET /api/bookings/[id]/receipt
 * Generates a formal digital receipt for completed services.
 */
export const GET = withParams<{ id: string }>(
  "api.bookings.:id.receipt.GET",
  async (request, { params }) => {
    const session = await requireUser()
    const { id: bookingId } = await params

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        amount: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        address: true,
        scheduledAt: true,
        createdAt: true,
        updatedAt: true,
        clientId: true,
        providerId: true,
        service: { select: { title: true, description: true } },
        client: { select: { name: true, email: true, phone: true } },
        provider: { select: { name: true, email: true, phone: true, cpfCnpj: true } },
      },
    })

    if (!booking) {
      throw notFound("Agendamento não encontrado")
    }

    // Access control: client, provider, or admin
    if (
      session.userId !== booking.clientId &&
      session.userId !== booking.providerId &&
      session.role !== "ADMIN"
    ) {
      throw forbidden("Acesso restrito aos envolvidos no agendamento")
    }

    const receiptDate = booking.updatedAt || booking.createdAt
    const dateFormatted = receiptDate.toISOString().slice(0, 10).replace(/-/g, "")
    const serialNumber = `REC-${dateFormatted}-${booking.id.slice(-6).toUpperCase()}`

    // Cryptographic validation hash
    const hashData = `${serialNumber}:${booking.id}:${booking.amount}:${booking.providerId}:${booking.clientId}`
    const authCode = crypto
      .createHash("sha256")
      .update(hashData)
      .digest("hex")
      .slice(0, 16)
      .toUpperCase()

    const url = new URL(request.url)
    const format = url.searchParams.get("format")

    const totalMoney = toMoneyNumber(booking.amount)
    const formattedTotal = formatBRL(totalMoney)
    const issueDateStr = formatDateTime(new Date())
    const serviceDateStr = formatDateTime(booking.scheduledAt)

    if (format === "html") {
      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Recibo Digital - ${serialNumber} - Severinno</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f9fafb; color: #111827; margin: 0; padding: 24px; }
    .receipt-card { max-width: 680px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #10b981; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { font-size: 26px; font-weight: 800; color: #10b981; letter-spacing: -0.5px; }
    .serial { font-family: monospace; font-size: 13px; color: #6b7280; text-align: right; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 8px; border-bottom: 1px solid #f3f4f6; padding-bottom: 4px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .field-label { font-size: 11px; color: #6b7280; }
    .field-val { font-size: 13px; font-weight: 600; color: #1f2937; margin-top: 2px; }
    .financials-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 18px; margin: 24px 0; }
    .amount-row { display: flex; justify-content: space-between; align-items: center; }
    .total-amount { font-size: 24px; font-weight: 800; color: #047857; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600; background: #d1fae5; color: #065f46; }
    .footer { border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 11px; color: #6b7280; display: flex; justify-content: space-between; align-items: center; }
    .no-print { margin-bottom: 16px; text-align: right; max-width: 680px; margin-left: auto; margin-right: auto; }
    .print-btn { background: #10b981; color: #fff; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: background 0.2s; }
    .print-btn:hover { background: #059669; }
    @media print {
      body { background: #fff; padding: 0; }
      .receipt-card { box-shadow: none; border: none; padding: 0; max-width: 100%; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
  </div>
  <div class="receipt-card">
    <div class="header">
      <div>
        <div class="brand">SEVERINNO</div>
        <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">Comprovante de Intermediação & Prestação de Serviços</div>
      </div>
      <div class="serial">
        <div><strong>${escapeHtml(serialNumber)}</strong></div>
        <div style="margin-top: 4px;">Emissão: ${escapeHtml(issueDateStr)}</div>
      </div>
    </div>

    <div class="grid-2">
      <div>
        <div class="section-title">Tomador (Cliente)</div>
        <div class="field-label">Nome:</div>
        <div class="field-val">${escapeHtml(booking.client.name)}</div>
        <div class="field-label" style="margin-top: 6px;">E-mail:</div>
        <div class="field-val">${escapeHtml(booking.client.email || "Não informado")}</div>
      </div>
      <div>
        <div class="section-title">Prestador de Serviços</div>
        <div class="field-label">Nome / Razão Social:</div>
        <div class="field-val">${escapeHtml(booking.provider.name)}</div>
        <div class="field-label" style="margin-top: 6px;">Documento:</div>
        <div class="field-val">${escapeHtml(booking.provider.cpfCnpj ? `${booking.provider.cpfCnpj.slice(0, 3)}***` : "Cadastrado")}</div>
      </div>
    </div>

    <div style="margin-bottom: 20px;">
      <div class="section-title">Discriminação do Serviço</div>
      <div class="field-label">Serviço:</div>
      <div class="field-val" style="font-size: 14px;">${escapeHtml(booking.service.title)}</div>
      <div class="field-label" style="margin-top: 6px;">Endereço de Execução:</div>
      <div class="field-val">${escapeHtml(booking.address || "Local informado pelo cliente")}</div>
      <div class="field-label" style="margin-top: 6px;">Data do Atendimento:</div>
      <div class="field-val">${escapeHtml(serviceDateStr)}</div>
    </div>

    <div class="financials-box">
      <div class="amount-row">
        <div>
          <div style="font-size: 12px; font-weight: 600; color: #065f46;">VALOR TOTAL LIQUIDADO</div>
          <div style="font-size: 11px; color: #047857; margin-top: 2px;">Pagamento garantido via Custódia Escrow (Lytex)</div>
        </div>
        <div class="total-amount">${escapeHtml(formattedTotal)}</div>
      </div>
      <div style="margin-top: 12px; display: flex; gap: 8px;">
        <span class="badge">Meio: ${escapeHtml(booking.paymentMethod || "PIX")}</span>
        <span class="badge">Status: ${escapeHtml(booking.paymentStatus === "PAID" ? "LIQUIDADO" : booking.paymentStatus)}</span>
      </div>
    </div>

    <div class="footer">
      <div>
        <div>Autenticação Digital SHA-256: <code>${escapeHtml(authCode)}</code></div>
        <div style="margin-top: 2px;">Valide em: https://severinno.com.br/recibo/${escapeHtml(authCode)}</div>
      </div>
      <div style="text-align: right;">
        Severinno Marketplace SaaS Ltda.
      </div>
    </div>
  </div>
</body>
</html>`

      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:;",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }

    return NextResponse.json({
      ok: true,
      receipt: {
        serialNumber,
        authCode,
        issueDate: issueDateStr,
        serviceDate: serviceDateStr,
        status: booking.status,
        service: {
          title: booking.service.title,
          description: booking.service.description,
          location: booking.address,
        },
        financials: {
          totalAmount: totalMoney,
          formattedTotal,
          paymentMethod: booking.paymentMethod,
          paymentStatus: booking.paymentStatus,
        },
        provider: {
          name: booking.provider.name,
          document: booking.provider.cpfCnpj
            ? `${booking.provider.cpfCnpj.slice(0, 3)}***`
            : "Cadastrado",
          email: booking.provider.email,
        },
        client: {
          name: booking.client.name,
          email: booking.client.email,
        },
        platform: {
          name: "Severinno Marketplace SaaS",
          authenticityUrl: `https://severinno.com.br/recibo/${authCode}`,
        },
      },
    })
  },
)
