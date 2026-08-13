/* eslint-disable no-console, @typescript-eslint/no-explicit-any  */
/**
 * Script de teste de envio real de emails transactionais
 * via SMTP Hostinger com nodemailer.
 *
 * Uso:
 *   bun run scripts/test-email.ts [destinatário]
 *
 * Se omitir destinatário, envia para severinno@severinno.com.br.
 *
 * Requer SMTP configurado no .env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Carregue o .env explicitamente:
 *   bun --env-file=.env run scripts/test-email.ts
 */

import nodemailer from "nodemailer"

// ── SMTP Config (NUNCA hardcodar credenciais!) ────────────────────────────

const HOST = process.env.SMTP_HOST ?? ""
const PORT = Number(process.env.SMTP_PORT || "465")
const USER = process.env.SMTP_USER ?? ""
const PASS = process.env.SMTP_PASS ?? ""
const FROM = process.env.SMTP_FROM || USER || "noreply@severinno.com.br"
const DESTINATION = process.argv[2] || USER || "severinno@severinno.com.br"

// ── Validate ──────────────────────────────────────────────────────────────

if (!HOST || !USER || !PASS) {
  console.log("\n   ❌ SMTP não configurado!")
  console.log("   Certifique-se de que o .env contém:")
  console.log("     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS")
  console.log("\n   Execute com:")
  console.log("     bun --env-file=.env run scripts/test-email.ts")
  console.log("")
  process.exit(1)
}

// ── Transport ─────────────────────────────────────────────────────────────

const transport = nodemailer.createTransport({
  host: HOST,
  port: PORT,
  secure: PORT === 465,
  auth: { user: USER, pass: PASS },
  tls: { rejectUnauthorized: false },
})

// ── Test connection first ─────────────────────────────────────────────────

console.log("")
console.log("╔══════════════════════════════════════════════════════╗")
console.log("║   TESTE DE CONEXÃO SMTP                            ║")
console.log("╚══════════════════════════════════════════════════════╝")
console.log(`   Host: ${HOST}:${PORT} (${PORT === 465 ? "SSL" : "STARTTLS"})`)
console.log(`   User: ${USER}`)
console.log("")

try {
  const ok = await transport.verify()
  console.log(`   ✅ Conexão SMTP estabelecida com sucesso!`)
} catch (err: any) {
  console.log(`   ❌ Falha na conexão SMTP:`)
  console.log(`      ${err.message}`)
  console.log("")
  console.log("   Verifique:")
  console.log("     - Se o servidor SMTP está acessível")
  console.log("     - Se as credenciais estão corretas")
  console.log("     - Se a porta 465/587 está liberada no firewall")
  console.log("     - Se o .env está sendo carregado (use --env-file=.env)")
  console.log("")
  console.log("   Dica: teste a conexão manualmente com Telnet:")
  console.log(`     openssl s_client -connect ${HOST}:${PORT} -starttls smtp`)
  console.log("")
  process.exit(1)
}

// ── Branding helpers (mirror src/lib/mail.ts) ────────────────────────────

const BRAND_PRIMARY = "#059669"

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
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND_PRIMARY},#047857);padding:32px 24px;text-align:center">
              <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700">Severinno</h1>
              <p style="margin:4px 0 0;color:#a7f3d0;font-size:13px">Marketplace de servicos</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 24px">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px;background-color:#ecfdf5;text-align:center;border-top:1px solid #d1fae5">
              <p style="margin:0;color:#6b7280;font-size:12px">
                © 2026 Severinno Marketplace<br>
                Duvidas? Responda este email ou fale conosco pelo chat.
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

function btn(text: string, url?: string): string {
  if (!url)
    return `<div style="margin:24px 0;padding:12px 24px;background:${BRAND_PRIMARY};color:#fff;border-radius:8px;text-align:center;font-weight:600;font-size:14px;display:inline-block">${text}</div>`
  const escaped = url.replace(/"/g, "&quot;")
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
    <tr>
      <td style="border-radius:8px;background:${BRAND_PRIMARY};padding:12px 24px;text-align:center">
        <a href="${escaped}" style="color:#fff;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">${text}</a>
      </td>
    </tr>
  </table>`
}

function row(label: string, value: string): string {
  return `<tr style="border-bottom:1px solid #e5e7eb">
    <td style="padding:10px 0;color:#6b7280;font-size:13px;width:120px;vertical-align:top">${label}</td>
    <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:500">${value}</td>
  </tr>`
}

// ── Templates ─────────────────────────────────────────────────────────────

const templates = [
  {
    subject: "🧪 TESTE - Agendamento solicitado! - Severinno",
    html: emailWrapper(`
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Agendamento solicitado! 🎉</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
        Ol\u00e1 <strong style="color:#111827">Maria Oliveira</strong>,<br>
        Seu agendamento foi criado com sucesso. O prestador foi notificado e em breve poder\u00e1 confirmar.
      </p>
      <table style="width:100%;border-collapse:collapse">
        ${row("Prestador", "Jo\u00e3o Silva Servi\u00e7os")}
        ${row("Servi\u00e7o", "Limpeza Residencial Completa")}
        ${row("Data", "15 de agosto de 2026 \u00e0s 09:00")}
        ${row("Endere\u00e7o", "Rua das Flores, 123 - S\u00e3o Paulo, SP")}
        ${row("Valor", "R$ 189,90")}
      </table>
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;background:#fef9c3;padding:12px;border-radius:6px">
        ⏳ O status do pagamento aparecer\u00e1 no painel ap\u00f3s a confirma\u00e7\u00e3o do prestador.
      </p>
    `),
  },
  {
    subject: "🧪 TESTE - Servi\u00e7o confirmado! - Severinno",
    html: emailWrapper(`
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Servi\u00e7o confirmado! ✅</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
        Ol\u00e1 <strong style="color:#111827">Maria Oliveira</strong>,<br>
        Seu servi\u00e7o foi confirmado e o pagamento recebido com sucesso.
      </p>
      <table style="width:100%;border-collapse:collapse">
        ${row("Prestador", "Jo\u00e3o Silva Servi\u00e7os")}
        ${row("Servi\u00e7o", "Limpeza Residencial Completa")}
        ${row("Data", "15 de agosto de 2026 \u00e0s 09:00")}
        ${row("Endere\u00e7o", "Rua das Flores, 123 - S\u00e3o Paulo, SP")}
        ${row("Valor pago", "R$ 189,90")}
      </table>
      ${btn("Ver no painel", "https://severinno.com.br/?view=client.bookings")}
    `),
  },
  {
    subject: "🧪 TESTE - Agendamento cancelado - Severinno",
    html: emailWrapper(`
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Agendamento cancelado</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
        Ol\u00e1 <strong style="color:#111827">Maria Oliveira</strong>,<br>
        O agendamento de <strong>Limpeza Residencial Completa</strong> com
        <strong>Jo\u00e3o Silva Servi\u00e7os</strong> marcado para
        <strong>15 de agosto de 2026 \u00e0s 09:00</strong> foi cancelado.
      </p>
      <p style="margin:0;color:#6b7280;font-size:13px">
        Se houve pagamento, o valor ser\u00e1 estornado em at\u00e9 7 dias \u00fateis.
      </p>
    `),
  },
  {
    subject: "🧪 TESTE - Como foi o servi\u00e7o? - Severinno",
    html: emailWrapper(`
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Servi\u00e7o conclu\u00eddo! ✅</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
        Ol\u00e1 <strong style="color:#111827">Maria Oliveira</strong>,<br>
        O servi\u00e7o de <strong>Limpeza Residencial Completa</strong> com
        <strong>Jo\u00e3o Silva Servi\u00e7os</strong> foi conclu\u00eddo com sucesso.
      </p>
      <p style="margin:0 0 8px;color:#374151;font-size:14px">
        Sua opini\u00e3o \u00e9 muito importante! Avalie o servi\u00e7o e ajude outros clientes
        a escolherem o prestador ideal.
      </p>
      ${btn("Avaliar servi\u00e7o", "https://severinno.com.br/?view=client.reviews&bookingId=abc-123")}
      <p style="margin:16px 0 0;color:#6b7280;font-size:12px">
        Sua avalia\u00e7\u00e3o ser\u00e1 exibida publicamente no perfil do prestador.
      </p>
    `),
  },
  {
    subject: "🧪 TESTE - Or\u00e7amento recebido! - Severinno",
    html: emailWrapper(`
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Or\u00e7amento recebido! 📋</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
        Ol\u00e1 <strong style="color:#111827">Maria Oliveira</strong>,<br>
        <strong style="color:#111827">Jo\u00e3o Silva Servi\u00e7os</strong> respondeu ao seu
        pedido de or\u00e7amento. Confira os valores e decida se deseja contratar.
      </p>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid ${BRAND_PRIMARY}">
            <th style="padding:8px 0;text-align:left;color:#374151;font-size:12px;text-transform:uppercase">Servi\u00e7o</th>
            <th style="padding:8px 0;text-align:right;color:#374151;font-size:12px;text-transform:uppercase">Pre\u00e7o</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:8px 0;color:#111827;font-size:14px">Limpeza de Sala e Cozinha</td>
            <td style="padding:8px 0;color:#059669;font-size:14px;font-weight:600;text-align:right">R$ 89,90</td>
          </tr>
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:8px 0;color:#111827;font-size:14px">Limpeza de 2 Quartos</td>
            <td style="padding:8px 0;color:#059669;font-size:14px;font-weight:600;text-align:right">R$ 69,90</td>
          </tr>
          <tr><td colspan="2" style="padding:0 0 8px;color:#6b7280;font-size:12px;font-style:italic">\u201cInclui troca de roupa de cama\u201d</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:8px 0;color:#111827;font-size:14px">Limpeza de Banheiro</td>
            <td style="padding:8px 0;color:#059669;font-size:14px;font-weight:600;text-align:right">R$ 49,90</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td style="padding:12px 0 0;font-weight:700;font-size:16px;color:#111827">Total</td>
            <td style="padding:12px 0 0;text-align:right;font-weight:700;font-size:16px;color:#059669">R$ 209,70</td>
          </tr>
        </tfoot>
      </table>
      ${btn("Ver or\u00e7amento completo", "https://severinno.com.br/?view=client.quotes")}
    `),
  },
  {
    subject: "🧪 TESTE - Nova avalia\u00e7\u00e3o! - Severinno",
    html: emailWrapper(`
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Nova avalia\u00e7\u00e3o! ⭐</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
        Ol\u00e1 <strong style="color:#111827">Jo\u00e3o Silva</strong>,<br>
        <strong style="color:#111827">Maria Oliveira</strong> avaliou o servi\u00e7o
        <strong>Limpeza Residencial Completa</strong>.
      </p>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:16px 0">
        <div style="font-size:20px;color:#f59e0b;letter-spacing:2px">\u2605\u2605\u2605\u2605\u2605</div>
        <p style="margin:8px 0 0;color:#374151;font-size:14px;font-style:italic">
          \u201cExcelente servi\u00e7o! Muito profissional e pontual. Super recomendo!\u201d
        </p>
      </div>
    `),
  },
  {
    subject: "🧪 TESTE - Redefini\u00e7\u00e3o de senha - Severinno",
    html: emailWrapper(`
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Redefini\u00e7\u00e3o de senha 🔑</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
        Ol\u00e1 <strong style="color:#111827">Maria Oliveira</strong>,<br>
        Recebemos uma solicita\u00e7\u00e3o de redefini\u00e7\u00e3o de senha para sua conta no Severinno.
      </p>
      ${btn("Redefinir minha senha", "https://severinno.com.br/auth/reset-password?token=test-token-abc-123")}
      <p style="margin:16px 0 0;color:#6b7280;font-size:13px">
        Este link expira em <strong>1 hora</strong>.
        Se voc\u00ea n\u00e3o solicitou esta altera\u00e7\u00e3o, ignore este e-mail.
      </p>
    `),
  },
  {
    subject: "🧪 TESTE - Senha alterada - Severinno",
    html: emailWrapper(`
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Senha alterada 🔐</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">
        Ol\u00e1 <strong style="color:#111827">Maria Oliveira</strong>,<br>
        A senha da sua conta no Severinno foi alterada com sucesso.
      </p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0">
        <p style="margin:0;color:#991b1b;font-size:13px;font-weight:600">⚠️ N\u00e3o foi voc\u00ea?</p>
        <p style="margin:4px 0 0;color:#b91c1c;font-size:13px">
          Se voc\u00ea n\u00e3o reconhece esta altera\u00e7\u00e3o, responda a este e-mail imediatamente
          ou entre em contato com nosso suporte. Sua conta pode estar comprometida.
        </p>
      </div>
      <p style="margin:16px 0 0;color:#6b7280;font-size:13px">
        Esta \u00e9 uma mensagem autom\u00e1tica de seguran\u00e7a enviada para
        <strong>${DESTINATION}</strong>.
      </p>
    `),
  },
]

// ── Send emails ───────────────────────────────────────────────────────────

console.log("")
console.log("╔══════════════════════════════════════════════════════╗")
console.log("║   ENVIANDO EMAIS                                   ║")
console.log("╚══════════════════════════════════════════════════════╝")
console.log(`   Destinat\u00e1rio: ${DESTINATION}`)
console.log(`   Templates: ${templates.length}`)
console.log("")

let sent = 0
let failed = 0

for (const tpl of templates) {
  try {
    const info = await transport.sendMail({
      from: FROM,
      to: DESTINATION,
      subject: tpl.subject,
      html: tpl.html,
    })
    console.log(`   [OK] ${info.messageId?.substring(0, 36) || "sem ID"}`)
    console.log(`        ${tpl.subject}`)
    sent++
  } catch (err: any) {
    console.log(`   [ERR] ${tpl.subject}`)
    console.log(`         ${err.message}`)
    failed++
  }
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log("")
console.log("╔══════════════════════════════════════════════════════╗")
console.log("║   RESUMO                                           ║")
console.log("╚══════════════════════════════════════════════════════╝")
console.log(`   Enviados: ${sent}`)
console.log(`   Falhas:   ${failed}`)
console.log(`   Total:    ${templates.length}`)
console.log("")

if (failed === 0 && sent > 0) {
  console.log("   🎉 TODOS OS EMAILS ENVIADOS COM SUCESSO!")
  console.log(`   📬 Verifique a caixa de entrada: ${DESTINATION}`)
  console.log("   ⚠️  Verifique tamb\u00e9m a caixa de SPAM.")
} else if (sent > 0) {
  console.log("   ⚠️  Alguns emails falharam. Verifique os erros acima.")
} else {
  console.log("   ❌ NENHUM EMAIL ENVIADO.")
  console.log("   Verifique as credenciais SMTP e a conectividade.")
}
console.log("")

process.exit(failed === 0 ? 0 : 1)
