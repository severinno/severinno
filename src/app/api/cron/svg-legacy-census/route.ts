export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * GET /api/cron/svg-legacy-census — censo SEMANAL de SVG legado no bucket.
 *
 * Roda o scripts/reprocess-svg-uploads.ts em DRY-RUN (leitura pura: list + get
 * — NADA é escrito/removido) contra o bucket de uploads e ALERTA se
 * svgFound > 0. O alarme dispara toda semana enquanto existir SVG legado,
 * até a remediação (`--apply` na VPS) zerar a contagem — é a monotona que
 * fecha o ciclo iniciado quando o SVG saiu da allowlist de upload
 * (src/lib/file-signature.ts, 09/2026).
 *
 * Por que mode "delete" no censo: o contador `svgFound` é idêntico nos dois
 * modos e o modo delete NÃO carrega sharp — o runtime standalone de produção
 * não garante o binário nativo (o teste de conversão roda no dev). Dry-run
 * garante que nenhuma variante toque no bucket.
 *
 * Agendamento: semanal, domingo 03:30 (janela de manutenção, depois do
 * settlements diário das 03:00) — scripts/setup-cron-push.sh.
 *
 * Autenticação: CRON_SECRET fail-closed (Bearer; sem query param — evita
 * vazamento em logs), igual aos demais crons.
 *
 * Alerta: canal unificado notifyGeoAlert (Sentry + push admin) com tag
 * estável `svg-legacy:census` (deduplica o push entre execuções enquanto o
 * valor não muda) + logger.warn estruturado (Loki/fail2ban-friendly).
 * SEM Slack/e-mail dedicados: alarme de dívida conhecida, não de incidente.
 *
 * Query params opcionais (repassados ao censo):
 *   ?prefix=uploads/ — limita o varrimento a um prefixo (default: tudo)
 *   ?max=500         — avalia no máximo N objetos (amostragem)
 *
 * Response:
 *   200: { ok, svgFound, scanned, ... summary do dry-run, alerted }
 *   401: sem/inválido CRON_SECRET
 *
 * Uso manual (VPS, credenciais locais):
 *   curl -s -H "Authorization: Bearer $CRON_SECRET" \
 *     https://severinno.com.br/api/cron/svg-legacy-census | jq
 */

import { NextResponse } from "next/server"

import { withRoute } from "@/lib/api-route"
import logger from "@/lib/logger"

export const GET = withRoute("api.cron.svg-legacy-census.GET", async (request) => {
  const auth = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  // Fail-closed: sem CRON_SECRET configurado ou sem Bearer válido → 401.
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Imports lazy: o módulo do script puxa @aws-sdk/client-s3 — carregar só
  // na execução autorizada (mesma razão do lazy import do geo-health-alert).
  const { runReprocess, buildS3Adapter } =
    await import("../../../../../scripts/reprocess-svg-uploads")

  const prefixParam = new URL(request.url).searchParams.get("prefix")
  const maxParam = Number(new URL(request.url).searchParams.get("max") ?? "")

  const summary = await runReprocess(
    {
      mode: "delete", // não carrega sharp; svgFound é idêntico ao convert
      apply: false, // DRY-RUN — leitura pura, sempre
      prefix: prefixParam || undefined,
      maxObjects: Number.isFinite(maxParam) && maxParam > 0 ? maxParam : undefined,
    },
    buildS3Adapter(), // herda S3_* do ambiente do app (mesmo bucket servido)
    { log: () => {} }, // silencia o log por-objeto do script (cron log limpo)
  )

  const alerted = summary.svgFound > 0

  if (alerted) {
    const sample = summary.errors.length ? summary.errors.slice(0, 5) : undefined

    logger.warn(
      {
        svgFound: summary.svgFound,
        scanned: summary.scanned,
        skippedTooLarge: summary.skippedTooLarge,
        failed: summary.failed,
        prefix: prefixParam ?? null,
      },
      "svg-legacy-census: SVG legado ainda presente no bucket — remediação pendente",
    )

    // Canal unificado (Sentry + push admin). Fire-and-forget: o censo nunca
    // falha por causa da notificação.
    const { notifyGeoAlert } = await import("@/lib/geo-alert-notify")
    void notifyGeoAlert({
      title: `🧹 SVG legado no bucket: ${summary.svgFound} objeto(s)`,
      body:
        `Censo semanal (dry-run) encontrou ${summary.svgFound} SVG(s) em ${summary.scanned} objeto(s) ` +
        `avaliados. Executar a remediação na VPS: docker compose run --rm --no-deps ` +
        `-v ./scripts:/app/scripts:ro app bun scripts/reprocess-svg-uploads.ts --apply`,
      severity: "warning",
      url: "/admin",
      tag: "svg-legacy:census",
      source: "svg-legacy-census",
      context: { ...summary, sample },
    }).catch(() => {})
  } else {
    logger.info(
      { scanned: summary.scanned, skippedTooLarge: summary.skippedTooLarge },
      "svg-legacy-census: bucket limpo — nenhum SVG legado",
    )
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    svgFound: summary.svgFound,
    alerted,
    scanned: summary.scanned,
    notSvg: summary.notSvg,
    skippedTooLarge: summary.skippedTooLarge,
    failed: summary.failed,
    errors: summary.errors.slice(0, 10),
    dryRun: summary.dryRun,
  })
})
