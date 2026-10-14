export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { db } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { toMoneyNumber } from "@/lib/money"
import { escapeHtml } from "@/lib/sanitize"
import { FEE_RATE } from "@/lib/constants"
import logger from "@/lib/logger"

const log = logger.child({ module: "provider-batch-receipts" })

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true, name: true, phone: true },
  })

  if (user?.role !== "PROVIDER" && user?.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas prestadores podem exportar lote de recibos fiscais." },
      { status: 403 },
    )
  }

  await assertRateLimit(request, RATE_LIMITS.general)

  const { searchParams } = request.nextUrl
  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const monthParam = searchParams.get("month") || defaultMonth
  const format = searchParams.get("format") || "json"
  const limitParam = parseInt(searchParams.get("limit") || "100", 10)
  const limit = Math.min(Math.max(isNaN(limitParam) ? 100 : limitParam, 1), 500)

  const [yearStr, monthStr] = monthParam.split("-")
  const year = parseInt(yearStr, 10) || now.getFullYear()
  const monthNum = parseInt(monthStr, 10) || now.getMonth() + 1

  const startDate = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0))
  const endDate = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59, 999))

  try {
    const bookings = await db.booking.findMany({
      where: {
        providerId: session.userId,
        status: "COMPLETED",
        paymentStatus: "PAID",
        scheduledAt: { gte: startDate, lte: endDate },
      },
      include: {
        service: { select: { title: true } },
        client: { select: { name: true } },
        payment: { select: { method: true, amount: true } },
      },
      orderBy: { scheduledAt: "asc" },
      take: limit,
    })

    const receipts = bookings.map((b) => {
      const grossAmount = toMoneyNumber(b.amount)
      const platformFee = Math.round(grossAmount * FEE_RATE * 100) / 100
      const netAmount = Math.round((grossAmount - platformFee) * 100) / 100
      const datePart = b.scheduledAt
        ? new Date(b.scheduledAt).toISOString().slice(0, 10).replace(/-/g, "")
        : "DATE"
      const serialNumber = `REC-${datePart}-${b.id.slice(-6).toUpperCase()}`

      const authHash = crypto
        .createHash("sha256")
        .update(`${b.id}:${serialNumber}:${grossAmount}:${b.providerId}`)
        .digest("hex")
        .slice(0, 16)
        .toUpperCase()

      const clientRawName = b.client?.name || "Cliente"
      const nameParts = clientRawName.trim().split(/\s+/)
      const safeClientName =
        nameParts.length > 1
          ? `${nameParts[0]} ${nameParts[nameParts.length - 1][0]}.`
          : nameParts[0]

      return {
        id: b.id,
        serialNumber,
        authHash,
        date: b.scheduledAt ? new Date(b.scheduledAt).toISOString().split("T")[0] : "",
        serviceTitle: b.service?.title || "Serviço Técnico",
        clientName: safeClientName,
        paymentMethod: b.paymentMethod,
        grossAmount,
        platformFee,
        netAmount,
      }
    })

    const totalGross = Math.round(receipts.reduce((acc, r) => acc + r.grossAmount, 0) * 100) / 100
    const totalPlatformFee =
      Math.round(receipts.reduce((acc, r) => acc + r.platformFee, 0) * 100) / 100
    const totalNet = Math.round((totalGross - totalPlatformFee) * 100) / 100

    // 1. JSON response
    if (format === "json") {
      return NextResponse.json({
        provider: {
          id: user.id,
          name: user.name,
        },
        period: monthParam,
        totalBookings: receipts.length,
        totalGross,
        totalPlatformFee,
        totalNet,
        receipts,
      })
    }

    // 2. CSV response for accounting / IRPF / MEI
    if (format === "csv") {
      const headers = [
        "Numero Recibo",
        "Data",
        "Servico",
        "Cliente",
        "Valor Bruto (R$)",
        "Taxa Plataforma (R$)",
        "Valor Liquido (R$)",
        "Forma Pagamento",
        "Autenticidade",
      ]

      const rows = receipts.map((r) => [
        r.serialNumber,
        r.date,
        `"${r.serviceTitle.replace(/"/g, '""')}"`,
        `"${r.clientName.replace(/"/g, '""')}"`,
        r.grossAmount.toFixed(2),
        r.platformFee.toFixed(2),
        r.netAmount.toFixed(2),
        r.paymentMethod,
        r.authHash,
      ])

      const summaryRow = [
        "TOTAL",
        "",
        `"${receipts.length} servicos"`,
        "",
        totalGross.toFixed(2),
        totalPlatformFee.toFixed(2),
        totalNet.toFixed(2),
        "",
        "",
      ]

      const csvContent = [
        headers.join(";"),
        ...rows.map((r) => r.join(";")),
        summaryRow.join(";"),
      ].join("\n")

      return new NextResponse("\uFEFF" + csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="recibos-lote-${monthParam}.csv"`,
        },
      })
    }

    // 3. HTML Printable Booklet / Statement
    const monthDisplay = `${String(monthNum).padStart(2, "0")}/${year}`
    const rowsHtml = receipts
      .map(
        (r) => `
        <tr>
          <td class="font-mono">${escapeHtml(r.serialNumber)}</td>
          <td>${escapeHtml(r.date.split("-").reverse().join("/"))}</td>
          <td>${escapeHtml(r.serviceTitle)}</td>
          <td>${escapeHtml(r.clientName)}</td>
          <td class="num">R$ ${r.grossAmount.toFixed(2)}</td>
          <td class="num text-muted">- R$ ${r.platformFee.toFixed(2)}</td>
          <td class="num font-bold">R$ ${r.netAmount.toFixed(2)}</td>
          <td class="font-mono text-muted text-xs">${escapeHtml(r.authHash)}</td>
        </tr>`,
      )
      .join("")

    const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Extrato e Lote de Recibos Fiscais - ${monthDisplay} - Severinno</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 30px; color: #1e293b; line-height: 1.4; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 24px; }
    .logo { font-size: 24px; font-weight: 800; color: #0284c7; letter-spacing: -0.5px; }
    .title { font-size: 18px; font-weight: 700; color: #0f172a; margin: 0; }
    .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .summary-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
    .summary-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; }
    .summary-value { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 4px; }
    .summary-value.net { color: #16a34a; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
    th { background: #f1f5f9; text-align: left; padding: 10px 8px; font-weight: 600; border-bottom: 1px solid #cbd5e1; font-size: 12px; color: #475569; }
    td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; }
    .num { text-align: right; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
    .font-bold { font-weight: 700; }
    .text-muted { color: #64748b; }
    .text-xs { font-size: 11px; }
    .footer { margin-top: 30px; border-top: 1px dashed #cbd5e1; padding-top: 16px; font-size: 11px; color: #64748b; text-align: center; }
    .no-print { margin-bottom: 20px; display: flex; gap: 10px; }
    button { background: #0284c7; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; }
    button:hover { background: #0369a1; }
    @media print {
      body { margin: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">🖨️ Imprimir / Salvar em PDF</button>
  </div>

  <div class="header">
    <div>
      <div class="logo">SEVERINNO</div>
      <div class="subtitle">Intermediação e Custódia de Serviços Profissionais</div>
    </div>
    <div style="text-align: right;">
      <h1 class="title">Extrato Consolidado de Recibos</h1>
      <div class="subtitle">Competência: <strong>${escapeHtml(monthDisplay)}</strong> • Prestador: <strong>${escapeHtml(user.name)}</strong></div>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="summary-label">Total de Serviços</div>
      <div class="summary-value">${receipts.length}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Faturamento Bruto</div>
      <div class="summary-value">R$ ${totalGross.toFixed(2)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Taxa de Intermediação (${Math.round(FEE_RATE * 100)}%)</div>
      <div class="summary-value text-muted">- R$ ${totalPlatformFee.toFixed(2)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Total Líquido Repassado</div>
      <div class="summary-value net">R$ ${totalNet.toFixed(2)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Nº Recibo</th>
        <th>Data</th>
        <th>Serviço</th>
        <th>Cliente</th>
        <th class="num">Bruto</th>
        <th class="num">Taxa Plataforma</th>
        <th class="num">Líquido</th>
        <th>Autenticidade</th>
      </tr>
    </thead>
    <tbody>
      ${
        receipts.length > 0
          ? rowsHtml
          : `<tr><td colspan="8" style="text-align:center; padding: 24px; color: #64748b;">Nenhum recibo liquidado nesta competência.</td></tr>`
      }
    </tbody>
  </table>

  <div class="footer">
    Documento emitido em conformidade com a legislação fiscal brasileira e normas contábeis aplicáveis a prestadores de serviços e MEI.<br>
    Severinno Marketplace — Pagamentos com Garantia de Custódia (Escrow) • Autenticidade verificável em severinno.com.br
  </div>
</body>
</html>`

    return new NextResponse(htmlContent, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:;",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    log.error({ err, userId: session.userId }, "Error generating batch receipts report")
    return NextResponse.json({ error: "Erro ao gerar lote de recibos fiscais" }, { status: 500 })
  }
}
