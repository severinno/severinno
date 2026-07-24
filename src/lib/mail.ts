import "server-only"
import nodemailer from "nodemailer"
import logger from "./logger"

const HOST = process.env.SMTP_HOST ?? ""
const PORT = Number(process.env.SMTP_PORT ?? "587")
const USER = process.env.SMTP_USER ?? ""
const PASS = process.env.SMTP_PASS ?? ""
const FROM = process.env.SMTP_FROM ?? "noreply@severinno.com"

function createTransport() {
  if (!HOST || !USER) return null
  return nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: PORT === 465,
    auth: { user: USER, pass: PASS },
    tls: { rejectUnauthorized: false },
  })
}

export async function sendMail(opts: {
  to: string
  subject: string
  html: string
}): Promise<void> {
  const transport = createTransport()
  if (!transport) {
    logger.warn({ to: opts.to, subject: opts.subject }, "mail not sent (no SMTP config)")
    return
  }

  try {
    await transport.sendMail({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    })
    logger.info({ to: opts.to, subject: opts.subject }, "mail sent")
  } catch (err) {
    logger.error({ err, to: opts.to }, "mail send failed")
  }
}

// ---------------------------------------------------------------------------
// HTML Email Templates (branded, responsive, accessible)
// ---------------------------------------------------------------------------

const BRAND_PRIMARY = "#059669" // emerald-600
const BRAND_LIGHT = "#ecfdf5"

function emailWrapper(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Severinno</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND_PRIMARY},#047857);padding:32px 24px;text-align:center">
              <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700">Severinno</h1>
              <p style="margin:4px 0 0;color:#a7f3d0;font-size:13px">Marketplace de serviços</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 24px">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px;background-color:${BRAND_LIGHT};text-align:center;border-top:1px solid #d1fae5">
              <p style="margin:0;color:#6b7280;font-size:12px">
                © 2026 Severinno Marketplace<br>
                Dúvidas? Responda este email ou fale conosco pelo chat.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function btnPrimary(text: string, url?: string): string {
  if (!url) return `<div style="margin:24px 0;padding:12px 24px;background:${BRAND_PRIMARY};color:#fff;border-radius:8px;text-align:center;font-weight:600;font-size:14px;display:inline-block">${text}</div>`
  const escaped = url.replace(/"/g, "&quot;")
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
    <tr>
      <td style="border-radius:8px;background:${BRAND_PRIMARY};padding:12px 24px;text-align:center">
        <a href="${escaped}" style="color:#fff;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">${text}</a>
      </td>
    </tr>
  </table>`
}

function detailTable(rows: { label: string; value: string }[]): string {
  return rows
    .map(
      (r, i) =>
        `<tr${i < rows.length - 1 ? ` style="border-bottom:1px solid #e5e7eb"` : ""}>
          <td style="padding:10px 0;color:#6b7280;font-size:13px;width:120px;vertical-align:top">${r.label}</td>
          <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:500">${r.value}</td>
        </tr>`,
    )
    .join("")
}

// ── Booking created (pending payment) ───────────────────────────────────────

export function bookingCreatedHtml(opts: {
  clientName: string
  providerName: string
  serviceName: string
  scheduledAt: string
  address: string
  amount: number
  notes?: string | null
}): string {
  const rows = [
    { label: "Prestador", value: opts.providerName },
    { label: "Serviço", value: opts.serviceName },
    { label: "Data", value: opts.scheduledAt },
    { label: "Endereço", value: opts.address },
    { label: "Valor", value: `R$ ${opts.amount.toFixed(2)}` },
  ]
  if (opts.notes) rows.push({ label: "Observações", value: opts.notes })

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Agendamento solicitado! 🎉</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${opts.clientName}</strong>,<br>
      Seu agendamento foi criado com sucesso. O prestador foi notificado e em breve poderá confirmar.
    </p>
    <table style="width:100%;border-collapse:collapse">${detailTable(rows)}</table>
    <p style="margin:24px 0 0;color:#6b7280;font-size:13px;background:#fef9c3;padding:12px;border-radius:6px">
      ⏳ O status do pagamento aparecerá no painel após a confirmação do prestador.
    </p>
  `
  return emailWrapper(body)
}

// ── Booking confirmed (paid) ───────────────────────────────────────────────

export function bookingConfirmedHtml(opts: {
  clientName: string
  providerName: string
  serviceName: string
  scheduledAt: string
  address: string
  amount: number
}): string {
  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Serviço confirmado! ✅</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${opts.clientName}</strong>,<br>
      Seu serviço foi confirmado e o pagamento recebido com sucesso.
    </p>
    <table style="width:100%;border-collapse:collapse">${detailTable([
      { label: "Prestador", value: opts.providerName },
      { label: "Serviço", value: opts.serviceName },
      { label: "Data", value: opts.scheduledAt },
      { label: "Endereço", value: opts.address },
      { label: "Valor pago", value: `R$ ${opts.amount.toFixed(2)}` },
    ])}</table>
    ${btnPrimary("Ver no painel", `${process.env.NEXT_PUBLIC_APP_URL || ""}/?view=client.bookings`)}
  `
  return emailWrapper(body)
}

// ── Booking cancelled ──────────────────────────────────────────────────────

export function bookingCancelledHtml(opts: {
  name: string
  serviceName: string
  providerName: string
  scheduledAt: string
}): string {
  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Agendamento cancelado</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${opts.name}</strong>,<br>
      O agendamento de <strong>${opts.serviceName}</strong> com <strong>${opts.providerName}</strong>
      marcado para <strong>${opts.scheduledAt}</strong> foi cancelado.
    </p>
    <p style="margin:0;color:#6b7280;font-size:13px">
      Se houve pagamento, o valor será estornado em até 7 dias úteis.
    </p>
  `
  return emailWrapper(body)
}

// ── Quote responded ────────────────────────────────────────────────────────

export function quoteRespondedHtml(opts: {
  clientName: string
  providerName: string
  items: { serviceName: string; price: number; note?: string | null }[]
  total: number
}): string {
  const itemsRows = opts.items
    .map(
      (i) =>
        `<tr style="border-bottom:1px solid #e5e7eb">
          <td style="padding:8px 0;color:#111827;font-size:14px">${i.serviceName}</td>
          <td style="padding:8px 0;color:#059669;font-size:14px;font-weight:600;text-align:right">R$ ${i.price.toFixed(2)}</td>
        </tr>${i.note ? `<tr><td colspan="2" style="padding:0 0 8px;color:#6b7280;font-size:12px;font-style:italic">“${i.note}”</td></tr>` : ""}`,
    )
    .join("")

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Orçamento recebido! 📋</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${opts.clientName}</strong>,<br>
      <strong style="color:#111827">${opts.providerName}</strong> respondeu ao seu pedido de orçamento.
      Confira os valores e decida se deseja contratar.
    </p>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:2px solid ${BRAND_PRIMARY}">
          <th style="padding:8px 0;text-align:left;color:#374151;font-size:12px;text-transform:uppercase">Serviço</th>
          <th style="padding:8px 0;text-align:right;color:#374151;font-size:12px;text-transform:uppercase">Preço</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
      <tfoot>
        <tr>
          <td style="padding:12px 0 0;font-weight:700;font-size:16px;color:#111827">Total</td>
          <td style="padding:12px 0 0;text-align:right;font-weight:700;font-size:16px;color:#059669">R$ ${opts.total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    ${btnPrimary("Ver orçamento completo", `${process.env.NEXT_PUBLIC_APP_URL || ""}/?view=client.quotes`)}
  `
  return emailWrapper(body)
}

// ── Review received ────────────────────────────────────────────────────────

export function reviewReceivedHtml(opts: {
  providerName: string
  clientName: string
  rating: number
  comment?: string | null
  serviceName: string
}): string {
  const stars = "★".repeat(opts.rating) + "☆".repeat(5 - opts.rating)
  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Nova avaliação! ⭐</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${opts.providerName}</strong>,<br>
      <strong style="color:#111827">${opts.clientName}</strong> avaliou o serviço
      <strong>${opts.serviceName}</strong>.
    </p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:16px 0">
      <div style="font-size:20px;color:#f59e0b;letter-spacing:2px">${stars}</div>
      ${opts.comment ? `<p style="margin:8px 0 0;color:#374151;font-size:14px;font-style:italic">“${opts.comment}”</p>` : ""}
    </div>
  `
  return emailWrapper(body)
}

// ── Payment confirmed (PIX / Card) ──────────────────────────────────────

export function paymentConfirmedHtml(opts: {
  clientName: string
  providerName: string
  serviceName: string
  amount: number
  paymentMethod: string
  scheduledAt: string
}): string {
  const methodLabel =
    opts.paymentMethod === "PIX" ? "PIX" : "Cartão de crédito"
  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Pagamento confirmado! 🎉</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${opts.clientName}</strong>,<br>
      Recebemos o pagamento de <strong style="color:#059669">R$ ${opts.amount.toFixed(2)}</strong>
      via <strong>${methodLabel}</strong> para o serviço com <strong>${opts.providerName}</strong>.
    </p>
    <table style="width:100%;border-collapse:collapse">${detailTable([
      { label: "Prestador", value: opts.providerName },
      { label: "Serviço", value: opts.serviceName },
      { label: "Data agendada", value: opts.scheduledAt },
      { label: "Valor pago", value: `R$ ${opts.amount.toFixed(2)}` },
      { label: "Forma de pagamento", value: methodLabel },
    ])}</table>
    ${btnPrimary("Ver detalhes", `${process.env.NEXT_PUBLIC_APP_URL || ""}/?view=client.bookings`)}
    <p style="margin:16px 0 0;color:#6b7280;font-size:13px;background:#ecfdf5;padding:12px;border-radius:6px">
      💡 O prestador já foi notificado e em breve entrará em contato para confirmar os detalhes.
    </p>
  `
  return emailWrapper(body)
}

// ── Payment refunded ───────────────────────────────────────────────────────

export function paymentRefundedHtml(opts: {
  clientName: string
  providerName: string
  serviceName: string
  amount: number
}): string {
  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Pagamento estornado ↩️</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${opts.clientName}</strong>,<br>
      O valor de <strong style="color:#059669">R$ ${opts.amount.toFixed(2)}</strong>
      referente ao serviço <strong>${opts.serviceName}</strong> com
      <strong>${opts.providerName}</strong> foi estornado.
    </p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0">
      <p style="margin:0;color:#991b1b;font-size:13px;font-weight:600">⏳ Prazos de estorno</p>
      <p style="margin:4px 0 0;color:#b91c1c;font-size:13px">
        O valor será creditado em até <strong>7 dias úteis</strong> na mesma forma de pagamento
        utilizada na compra. Caso o prazo seja excedido, entre em contato conosco.
      </p>
    </div>
  `
  return emailWrapper(body)
}

// ── Booking completed (review prompt) ────────────────────────────────────

export function bookingCompletedHtml(opts: {
  clientName: string
  providerName: string
  serviceName: string
  reviewUrl: string
}): string {
  const waMessage = encodeURIComponent(
    `Acabei de receber o serviço de ${opts.providerName} pelo Severinno! ⭐ Deixe sua avaliação aqui: ${opts.reviewUrl}`,
  )
  const waUrl = `https://wa.me/?text=${waMessage}`
  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Serviço concluído! ✅</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${opts.clientName}</strong>,<br>
      O serviço de <strong>${opts.serviceName}</strong> com
      <strong>${opts.providerName}</strong> foi concluído com sucesso.
    </p>
    <p style="margin:0 0 8px;color:#374151;font-size:14px">
      Sua opinião é muito importante! Avalie o serviço e ajude outros clientes
      a escolherem o prestador ideal.
    </p>
    ${btnPrimary("Avaliar serviço", opts.reviewUrl)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0">
      <tr>
        <td style="border-radius:8px;background:#25D366;padding:12px 24px;text-align:center">
          <a href="${waUrl}" style="color:#fff;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">
            Compartilhar no WhatsApp
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0;color:#6b7280;font-size:12px">
      Sua avaliação será exibida publicamente no perfil do prestador.
    </p>
  `
  return emailWrapper(body)
}

// ── Password reset ────────────────────────────────────────────────────────

export function passwordResetHtml(opts: {
  userName: string
  resetLink: string
  expiresInHours?: number
}): string {
  const hours = opts.expiresInHours ?? 1
  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Redefinição de senha 🔑</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${opts.userName}</strong>,<br>
      Recebemos uma solicitação de redefinição de senha para sua conta no Severinno.
    </p>
    ${btnPrimary("Redefinir minha senha", opts.resetLink)}
    <p style="margin:16px 0 0;color:#6b7280;font-size:13px">
      Este link expira em <strong>${hours} hora${hours > 1 ? "s" : ""}</strong>.
      Se você não solicitou esta alteração, ignore este e-mail.
    </p>
    <p style="margin:24px 0 0;padding:16px 0 0;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px">
      Link direto: <a href="${opts.resetLink}" style="color:#6b7280;word-break:break-all">${opts.resetLink}</a>
    </p>
  `
  return emailWrapper(body)
}

// ── Password changed (security alert) ───────────────────────────────────

export function passwordChangedHtml(opts: {
  userName: string
  email: string
}): string {
  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Senha alterada 🔐</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${opts.userName}</strong>,<br>
      A senha da sua conta no Severinno foi alterada com sucesso.
    </p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0">
      <p style="margin:0;color:#991b1b;font-size:13px;font-weight:600">⚠️ Não foi você?</p>
      <p style="margin:4px 0 0;color:#b91c1c;font-size:13px">
        Se você não reconhece esta alteração, responda a este e-mail imediatamente
        ou entre em contato com nosso suporte. Sua conta pode estar comprometida.
      </p>
    </div>
    <p style="margin:16px 0 0;color:#6b7280;font-size:13px">
      Esta é uma mensagem automática de segurança enviada para
      <strong>${opts.email}</strong>.
    </p>
  `
  return emailWrapper(body)
}

// ── Booking reminder (24h before) ──────────────────────────────────────────

export function bookingReminderHtml(params: {
  name: string
  serviceName: string
  providerName: string
  scheduledAt: string
}): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://severinno.com.br"
  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">⏰ Lembrete</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${params.name}</strong>,<br>
      Seu agendamento com <strong>${params.providerName}</strong> está marcado para amanhã:
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0">
      <p style="margin:0;font-weight:600;color:#111827;font-size:15px">${params.serviceName}</p>
      <p style="margin:4px 0 0;color:#374151;font-size:14px">${params.scheduledAt}</p>
    </div>
    <p style="margin:16px 0 0">
      <a href="${appUrl}" style="color:#059669;text-decoration:underline">Acesse o Severinno</a> para gerenciar.
    </p>
  `
  return emailWrapper(body)
}

// ── Admin new provider notification ────────────────────────────────────────

export function adminNewProviderHtml(params: {
  adminName: string
  providerName: string
  providerEmail: string
  providerWhatsapp: string
  reviewUrl: string
}): string {
  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Novo prestador cadastrado</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Olá <strong style="color:#111827">${params.adminName}</strong>,<br>
      Um novo prestador acabou de se cadastrar no Severinno.
    </p>
    <div style="background:#f0fdf4;padding:16px;border-radius:8px;margin:16px 0">
      <p style="margin:0"><strong>${params.providerName}</strong></p>
      <p style="margin:4px 0 0">${params.providerEmail}</p>
      ${params.providerWhatsapp ? `<p style="margin:4px 0 0">WhatsApp: ${params.providerWhatsapp}</p>` : ""}
    </div>
    <p style="text-align:center;margin:24px 0">
      <a href="${params.reviewUrl}" style="display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
        Revisar cadastro
      </a>
    </p>
  `
  return emailWrapper(body)
}

// ── Admin monthly commission report ───────────────────────────────────────

export type CommissionReportData = {
  year: number
  month: string
  grossRevenue: number
  platformCommission: number
  providerEarnings: number
  bookingCount: number
  completedCount: number
  providerCount: number
  topProviders: Array<{ name: string; grossRevenue: number; commission: number; netEarnings: number }>
}

export function commissionReportHtml(data: CommissionReportData): string {
  const providerRows = data.topProviders
    .slice(0, 10)
    .map(
      (p) =>
        `<tr style="border-bottom:1px solid #e5e7eb">
          <td style="padding:8px 0;color:#111827;font-size:13px;font-weight:500">${p.name}</td>
          <td style="padding:8px 0;color:#111827;font-size:13px;text-align:right">R$ ${p.grossRevenue.toFixed(2)}</td>
          <td style="padding:8px 0;color:#d97706;font-size:13px;text-align:right">R$ ${p.commission.toFixed(2)}</td>
          <td style="padding:8px 0;color:#059669;font-size:13px;text-align:right;font-weight:600">R$ ${p.netEarnings.toFixed(2)}</td>
        </tr>`,
    )
    .join("")

  const body = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px">📊 Relatório Mensal de Comissões</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
      Resumo financeiro de <strong>${data.month} de ${data.year}</strong>
    </p>

    <!-- KPI Cards -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
      <tr>
        <td style="width:25%;padding:4px" valign="top">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;text-align:center">
            <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600">Receita Bruta</p>
            <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#111827">R$ ${data.grossRevenue.toFixed(2)}</p>
          </div>
        </td>
        <td style="width:25%;padding:4px" valign="top">
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;text-align:center">
            <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600">Comissão (15%)</p>
            <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#d97706">R$ ${data.platformCommission.toFixed(2)}</p>
          </div>
        </td>
        <td style="width:25%;padding:4px" valign="top">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;text-align:center">
            <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600">Repassado</p>
            <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#059669">R$ ${data.providerEarnings.toFixed(2)}</p>
          </div>
        </td>
        <td style="width:25%;padding:4px" valign="top">
          <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:12px;text-align:center">
            <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600">Realizados</p>
            <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#111827">${data.completedCount}</p>
          </div>
        </td>
      </tr>
    </table>

    <p style="margin:16px 0 0;color:#6b7280;font-size:13px">
      <strong>${data.providerCount}</strong> prestadores ativos ·
      <strong>${data.bookingCount}</strong> bookings PAID no período
    </p>

    ${data.topProviders.length > 0 ? `
    <h3 style="margin:24px 0 12px;color:#111827;font-size:15px">🥇 Top Prestadores</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:2px solid #059669">
          <th style="padding:8px 0;text-align:left;color:#374151;font-size:11px;text-transform:uppercase">Prestador</th>
          <th style="padding:8px 0;text-align:right;color:#374151;font-size:11px;text-transform:uppercase">Bruto</th>
          <th style="padding:8px 0;text-align:right;color:#374151;font-size:11px;text-transform:uppercase">Comissão</th>
          <th style="padding:8px 0;text-align:right;color:#374151;font-size:11px;text-transform:uppercase">Repassado</th>
        </tr>
      </thead>
      <tbody>${providerRows}</tbody>
    </table>
    ` : ""}

    <p style="margin:24px 0 0;color:#6b7280;font-size:13px">
      📈 Acesse o painel admin para ver o relatório completo com gráficos mensais.
    </p>
  `
  return emailWrapper(body)
}

// ── Legacy alias (backward compat) ─────────────────────────────────────────

export function bookingConfirmationHtml(opts: {
  clientName: string
  providerName: string
  serviceName: string
  scheduledAt: string
  address: string
  amount: number
}): string {
  return bookingConfirmedHtml(opts)
}
