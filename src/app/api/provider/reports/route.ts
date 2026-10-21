/**
 * Provider Exportable Reports API
 *
 * GET /api/provider/reports?type=bookings|quotes|financial&period=30d|90d|all&format=csv|json
 * Exports provider business data into formatted CSV or JSON.
 */

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getSession } from "@/lib/auth"
import logger from "@/lib/logger"
import { toMoneyNumber, MoneySettlement, feeOf, netOf } from "@/lib/money"
import { escapeHtml } from "@/lib/sanitize"

const log = logger.child({ module: "provider-reports-api" })

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { role: true, name: true },
  })

  if (user?.role !== "PROVIDER" && user?.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas prestadores podem exportar relatórios de atendimento." },
      { status: 403 },
    )
  }

  const { searchParams } = request.nextUrl
  const reportType = searchParams.get("type") || "bookings"
  const period = searchParams.get("period") || "30d"
  const format = searchParams.get("format") || "csv"
  const limitParam = parseInt(searchParams.get("limit") || "100", 10)
  const limit = Math.min(Math.max(isNaN(limitParam) ? 100 : limitParam, 1), 500)

  const now = new Date()
  let sinceDate = new Date(0) // all time
  if (period === "7d") sinceDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
  if (period === "30d") sinceDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
  if (period === "90d") sinceDate = new Date(now.getTime() - 90 * 24 * 3600 * 1000)

  const monthParam = searchParams.get("month")
  let startDate = sinceDate
  let endDate = now
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [yearStr, monthStr] = monthParam.split("-")
    const y = parseInt(yearStr, 10)
    const m = parseInt(monthStr, 10)
    startDate = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0))
    endDate = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
  }

  try {
    if (reportType === "bookings") {
      const bookings = await db.booking.findMany({
        where: {
          providerId: session.userId,
          createdAt: { gte: sinceDate },
        },
        include: {
          client: { select: { name: true, phone: true } },
          service: { select: { title: true } },
        },
        orderBy: { scheduledAt: "desc" },
        take: limit,
      })

      if (format === "json") {
        return NextResponse.json({ bookings, count: bookings.length })
      }

      // Generate CSV
      const headers = [
        "ID",
        "Data Agendada",
        "Serviço",
        "Cliente",
        "Contato",
        "Valor (R$)",
        "Status",
        "Forma Pagamento",
        "Status Pagamento",
      ]

      const rows = bookings.map((b) => [
        b.id,
        b.scheduledAt ? new Date(b.scheduledAt).toISOString().split("T")[0] : "",
        `"${(b.service?.title || "").replace(/"/g, '""')}"`,
        `"${(b.client?.name || "").replace(/"/g, '""')}"`,
        b.client?.phone || "",
        b.amount.toFixed(2),
        b.status,
        b.paymentMethod,
        b.paymentStatus,
      ])

      const csvContent = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n")

      return new NextResponse("\uFEFF" + csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="relatorio-agendamentos-${period}.csv"`,
        },
      })
    }

    if (reportType === "quotes") {
      const quoteItems = await db.quoteItem.findMany({
        where: {
          providerId: session.userId,
          createdAt: { gte: sinceDate },
        },
        include: {
          service: { select: { title: true } },
          request: {
            include: {
              client: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      })

      if (format === "json") {
        return NextResponse.json({ quotes: quoteItems, count: quoteItems.length })
      }

      const headers = [
        "ID",
        "Data Solicitação",
        "Serviço",
        "Cliente",
        "Valor Ofertado (R$)",
        "Status",
      ]
      const rows = quoteItems.map((q) => [
        q.id,
        new Date(q.createdAt).toISOString().split("T")[0],
        `"${(q.service?.title || "").replace(/"/g, '""')}"`,
        `"${(q.request?.client?.name || "").replace(/"/g, '""')}"`,
        q.price ? q.price.toFixed(2) : "Pendente",
        q.status,
      ])

      const csvContent = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n")

      return new NextResponse("\uFEFF" + csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="relatorio-orcamentos-${period}.csv"`,
        },
      })
    }

    if (reportType === "dre") {
      const bookings = await db.booking.findMany({
        where: {
          providerId: session.userId,
          paymentStatus: "PAID",
          createdAt: { gte: startDate, lte: endDate },
        },
        include: {
          service: { select: { title: true } },
          client: { select: { name: true } },
        },
        orderBy: { scheduledAt: "asc" },
        take: limit,
      })

      let grossRevenue = 0
      let platformFees = 0
      let escrowInCustody = 0
      let escrowReleased = 0

      for (const b of bookings) {
        const amt = toMoneyNumber(b.amount)
        grossRevenue += amt
        platformFees += toMoneyNumber(feeOf(b.amount))
        if (b.status === "COMPLETED" && (b as any).escrowReleasedAt) {
          escrowReleased += amt
        } else {
          escrowInCustody += amt
        }
      }

      grossRevenue = Math.round(grossRevenue * 100) / 100
      platformFees = Math.round(platformFees * 100) / 100
      const netRevenue = Math.round((grossRevenue - platformFees) * 100) / 100
      escrowInCustody = Math.round(escrowInCustody * 100) / 100
      escrowReleased = Math.round(escrowReleased * 100) / 100

      // Withdrawals during this period
      const withdrawals = await db.walletTransaction.findMany({
        where: {
          providerId: session.userId,
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { id: true, amount: true, status: true, createdAt: true },
      })

      let withdrawalsCompleted = 0
      let withdrawalsPending = 0
      for (const w of withdrawals) {
        const amt = Number(w.amount)
        if (w.status === "pending") {
          withdrawalsPending += amt
        } else {
          withdrawalsCompleted += amt
        }
      }
      withdrawalsCompleted = Math.round(withdrawalsCompleted * 100) / 100
      withdrawalsPending = Math.round(withdrawalsPending * 100) / 100

      // Annual MEI compliance
      const ytdStart = new Date(Date.UTC(startDate.getFullYear(), 0, 1))
      const ytdBookings = await db.booking.findMany({
        where: {
          providerId: session.userId,
          paymentStatus: "PAID",
          createdAt: { gte: ytdStart, lte: endDate },
        },
        select: { amount: true },
      })
      const ytdGross =
        Math.round(ytdBookings.reduce((acc, b) => acc + toMoneyNumber(b.amount), 0) * 100) / 100
      const MEI_ANNUAL_LIMIT = 81000.0
      const meiPercentUsed = Math.min(100, Math.round((ytdGross / MEI_ANNUAL_LIMIT) * 1000) / 10)
      const isWithinMeiLimit = ytdGross <= MEI_ANNUAL_LIMIT

      if (format === "json") {
        return NextResponse.json({
          dre: {
            period: monthParam || period,
            providerName: user?.name,
            totalBookings: bookings.length,
            grossRevenue,
            platformFees,
            netRevenue,
            escrowInCustody,
            escrowReleased,
            withdrawalsCompleted,
            withdrawalsPending,
            ytdGross,
            meiAnnualLimit: MEI_ANNUAL_LIMIT,
            meiPercentUsed,
            isWithinMeiLimit,
          },
          bookings,
        })
      }

      if (format === "html") {
        const safeProviderName = escapeHtml(user?.name || "Prestador Autônomo")
        const periodLabel = monthParam || period
        const dateStr = new Date().toLocaleDateString("pt-BR")

        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>DRE & Extrato Financeiro - ${safeProviderName} - Severinno</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; line-height: 1.5; padding: 32px; background: #fff; margin: 0 auto; max-width: 800px; }
    @media print { body { padding: 0; } .no-print { display: none; } }
    .header { border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; }
    .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: #f1f5f9; color: #334155; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 24px; font-size: 13px; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; font-weight: 600; color: #475569; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .bold { font-weight: 700; color: #0f172a; }
    .highlight { background: #f8fafc; font-weight: 600; }
    .deduction { color: #dc2626; }
    .positive { color: #16a34a; }
    .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px; background: #fafafa; }
    .btn { background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 20px; text-align: right;">
    <button class="btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
  </div>

  <div class="header">
    <div>
      <h1 class="title">Demonstrativo de Resultado do Exercício (DRE)</h1>
      <div class="subtitle">Severinno Marketplace — Intermediação de Serviços e Custódia Escrow</div>
    </div>
    <div style="text-align: right;">
      <span class="badge">Competência: ${escapeHtml(periodLabel)}</span>
      <div class="subtitle">Emissão: ${dateStr}</div>
    </div>
  </div>

  <div class="box">
    <div style="display: flex; justify-content: space-between;">
      <div><strong>Prestador:</strong> ${safeProviderName}</div>
      <div><strong>Atendimentos no Período:</strong> ${bookings.length}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th>Descrição Contábil</th>
        <th class="num">Valor (R$)</th>
      </tr>
    </thead>
    <tbody>
      <tr class="bold highlight">
        <td>1.0</td>
        <td>FATURAMENTO BRUTO DE SERVIÇOS</td>
        <td class="num">R$ ${grossRevenue.toFixed(2)}</td>
      </tr>
      <tr>
        <td>2.0</td>
        <td>(-) Taxa de Plataforma Severinno (12% intermediação)</td>
        <td class="num deduction">- R$ ${platformFees.toFixed(2)}</td>
      </tr>
      <tr class="bold highlight">
        <td>3.0</td>
        <td>(=) RECEITA LÍQUIDA OPERACIONAL</td>
        <td class="num positive">R$ ${netRevenue.toFixed(2)}</td>
      </tr>
      <tr>
        <td>4.0</td>
        <td>(-) Custódia Escrow Ativa (Serviços em andamento)</td>
        <td class="num">R$ ${escrowInCustody.toFixed(2)}</td>
      </tr>
      <tr>
        <td>4.1</td>
        <td>(+) Escrow Liberado no Período</td>
        <td class="num positive">R$ ${escrowReleased.toFixed(2)}</td>
      </tr>
      <tr>
        <td>5.0</td>
        <td>(-) Saques Liquidados via PIX</td>
        <td class="num">R$ ${withdrawalsCompleted.toFixed(2)}</td>
      </tr>
      <tr>
        <td>5.1</td>
        <td>(-) Saques em Processamento PIX</td>
        <td class="num">R$ ${withdrawalsPending.toFixed(2)}</td>
      </tr>
    </tbody>
  </table>

  <div class="box">
    <h3 style="margin-top:0; margin-bottom: 8px; font-size: 14px;">Enquadramento MEI / DASN-SIMEI (Ano ${startDate.getFullYear()})</h3>
    <p style="margin: 4px 0; font-size: 12px; color: #475569;">
      Faturamento Acumulado no Ano: <strong>R$ ${ytdGross.toFixed(2)}</strong> de <strong>R$ ${MEI_ANNUAL_LIMIT.toFixed(2)}</strong> (${meiPercentUsed.toFixed(1)}% do teto legal).
    </p>
    <div style="font-size: 12px; font-weight: 600; color: ${isWithinMeiLimit ? "#16a34a" : "#dc2626"}; margin-top: 6px;">
      ${isWithinMeiLimit ? "✅ Situação Regular: Faturamento dentro do limite anual do MEI." : "⚠️ Atenção: Limite do MEI ultrapassado. Consulte seu contador para migração para ME."}
    </div>
  </div>

  <div style="margin-top: 48px; display: flex; justify-content: space-between;">
    <div style="width: 45%; border-top: 1px solid #94a3b8; text-align: center; padding-top: 8px; font-size: 12px;">
      ${safeProviderName}<br><span style="color: #64748b;">Prestador(a) / MEI</span>
    </div>
    <div style="width: 45%; border-top: 1px solid #94a3b8; text-align: center; padding-top: 8px; font-size: 12px;">
      Severinno Marketplace S.A.<br><span style="color: #64748b;">Plataforma Intermediadora</span>
    </div>
  </div>

  <div class="footer">
    Documento emitido eletronicamente pela plataforma Severinno. Válido para controle fiscal e escrituração contábil simplificada do MEI.
  </div>
</body>
</html>`

        return new NextResponse(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
          },
        })
      }

      // Default CSV format
      const meta = [
        "DEMONSTRATIVO DRE & EXTRATO CONTÁBIL — SEVERINNO MARKETPLACE",
        `Prestador:;${user?.name || "Prestador"}`,
        `Competência:;${monthParam || period}`,
        `Data de Emissão:;${new Date().toISOString().split("T")[0]}`,
        "",
        "Item;Descrição Contábil;Valor (R$)",
        `1.0;FATURAMENTO BRUTO DE SERVIÇOS;${grossRevenue.toFixed(2)}`,
        `2.0;(-) Taxa de Plataforma (12%);-${platformFees.toFixed(2)}`,
        `3.0;(=) RECEITA LÍQUIDA OPERACIONAL;${netRevenue.toFixed(2)}`,
        `4.0;(-) Custódia Escrow Ativa;${escrowInCustody.toFixed(2)}`,
        `4.1;(+) Escrow Liberado no Período;${escrowReleased.toFixed(2)}`,
        `5.0;(-) Saques Liquidados (PIX);${withdrawalsCompleted.toFixed(2)}`,
        `5.1;(-) Saques em Processamento;${withdrawalsPending.toFixed(2)}`,
        `6.0;Faturamento Acumulado Ano (MEI);${ytdGross.toFixed(2)}`,
        `6.1;% Teto MEI (R$ 81k);${meiPercentUsed.toFixed(1)}%`,
        `6.2;Status MEI;${isWithinMeiLimit ? "REGULAR" : "EXCEDIDO"}`,
        "",
        "ID Agendamento;Data;Serviço;Cliente;Valor Bruto (R$);Taxa (R$);Líquido (R$);Status",
      ]

      const rows = bookings.map((b) => {
        const amt = toMoneyNumber(b.amount)
        const fee = toMoneyNumber(feeOf(b.amount))
        const net = toMoneyNumber(netOf(b.amount))
        const dateStr = b.scheduledAt ? new Date(b.scheduledAt).toISOString().split("T")[0] : ""
        return [
          b.id,
          dateStr,
          `"${(b.service?.title || "").replace(/"/g, '""')}"`,
          `"${(b.client?.name || "").replace(/"/g, '""')}"`,
          amt.toFixed(2),
          fee.toFixed(2),
          net.toFixed(2),
          b.status,
        ].join(";")
      })

      const csvContent = [...meta, ...rows].join("\n")
      return new NextResponse("\uFEFF" + csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="dre-mensal-${monthParam || period}.csv"`,
        },
      })
    }

    // Default financial settlement summary
    const bookingsPaid = await db.booking.findMany({
      where: {
        providerId: session.userId,
        paymentStatus: "PAID",
        createdAt: { gte: sinceDate },
      },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        updatedAt: true,
      },
      take: limit,
    })

    const settlement = new MoneySettlement()
    for (const b of bookingsPaid) {
      settlement.add(b.amount)
    }

    const totalGross = toMoneyNumber(settlement.gross)
    const platformFee = toMoneyNumber(settlement.fee)
    const netReceived = toMoneyNumber(settlement.net)

    if (format === "json") {
      return NextResponse.json({
        totalGross,
        platformFee,
        netReceived,
        totalBookings: bookingsPaid.length,
      })
    }

    const headers = [
      "ID Agendamento",
      "Data Pagamento",
      "Forma",
      "Valor Bruto (R$)",
      "Taxa Plataforma (R$)",
      "Valor Líquido (R$)",
    ]
    const rows = bookingsPaid.map((b) => {
      const amount = toMoneyNumber(b.amount)
      const fee = toMoneyNumber(feeOf(b.amount))
      const net = toMoneyNumber(netOf(b.amount))
      return [
        b.id,
        new Date(b.updatedAt).toISOString().split("T")[0],
        b.paymentMethod,
        amount.toFixed(2),
        fee.toFixed(2),
        net.toFixed(2),
      ]
    })

    const csvContent = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n")

    return new NextResponse("\uFEFF" + csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="relatorio-financeiro-${period}.csv"`,
      },
    })
  } catch (err) {
    log.error({ err, userId: session.userId }, "Error generating provider report")
    return NextResponse.json({ error: "Erro ao gerar relatório" }, { status: 500 })
  }
}
