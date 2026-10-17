export const dynamic = "force-dynamic"

/**
 * GET /api/metrics/prometheus
 *
 * Alias para /api/health/detailed?format=prometheus (redirect 302).
 * O Prometheus segue redirects por padrão (follow_redirects: true).
 *
 * Uso no prometheus.yml:
 *   scrape_configs:
 *     - job_name: 'severinno'
 *       scrape_interval: 15s
 *       metrics_path: '/api/metrics/prometheus'
 *       static_configs:
 *         - targets: ['severinno.com.br']
 *
 * Ou configure metrics_path diretamente como '/api/health/detailed?format=prometheus'
 * se seu Prometheus não seguir redirects.
 *
 * Auth: pública.
 */

import { NextResponse } from "next/server"

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host")
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (url.protocol ? url.protocol.replace(":", "") : "http")
  const origin = host ? `${proto}://${host}` : url.origin
  const redirectUrl = `${origin}/api/health/detailed?format=prometheus`

  return NextResponse.redirect(redirectUrl, 302)
}
