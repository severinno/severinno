export const dynamic = "force-dynamic"

/**
 * GET /api/csp-report — painel operacional do rollout da CSP.
 *
 * Fonte dos dados: os logs estruturados da rota POST (type: "csp-violation",
 * Pino → Loki). Esta rota NÃO lê o banco nem o Loki — faz um post-mortem
 * lendo o container de logs do app (via `docker logs`, ver @/lib/csp-logs) e
 * agrega as violações por diretiva, origem bloqueada e URI do documento,
 * adicionando a janela observada e uma recomendação de rollout por diretriz.
 * O `styleSummary` separa style-src-ATTR (atributo style="..." — a dívida que
 * docs/STYLE_MIGRATION_PLAN.md elimina) de style-src-ELEM (<style>/<link> —
 * pin de hash do global-error + guard check:inline-style), cada um com top
 * origens/documentos e a ação orientada.
 *
 * Por que post-mortem do log e não agregação online: em Report-Only o volume
 * de relatórios é alto e a leitura pontual do log responde "como está o
 * rollout?" sem nova infraestrutura (tabela, Redis, Prometheus).
 *
 * Uso no plano de rollout (ver docs/RUNBOOK.md § CSP):
 *   curl -s -H "cookie: severinno_session=..." \
 *     https://severinno.com.br/api/csp-report?lines=300 | jq
 *
 * Critério de avanço Report-Only → Enforce: em duas janelas de 24h seguidas,
 * ZERO violações das diretrizes bloqueantes (script-src, object-src,
 * base-uri, frame-ancestors). `rollout.readyToEnforce` consolida isso.
 */

import { NextResponse } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { readContainerLogs, parseCspLogs, aggregateCspViolations } from "@/lib/csp-logs"
import logger from "@/lib/logger"

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")

    const url = new URL(request.url)
    const linesParam = url.searchParams.get("lines") ?? "300"
    const containerParam = url.searchParams.get("container") ?? "app"

    // Defesa em profundidade: params viram argv de subprocesso — só dígitos e
    // nome de container [a-z0-9_-] (sem $, espaço, ; ou --flags).
    // lines numérico grande é LIMITADO a 5000 (não derrubado ao default).
    const lines = /^\d{1,10}$/.test(linesParam) ? Math.min(Number(linesParam), 5000) : 300
    const container = /^[a-z0-9_-]+$/.test(containerParam) ? containerParam : "app"

    let stdout = ""
    let stderr = ""
    let diagnostics: Record<string, unknown> | undefined
    try {
      const logs = await readContainerLogs(lines, container)
      stdout = logs.stdout
      stderr = logs.stderr
    } catch (e) {
      const err = e as { stderr?: string; message?: string }
      stderr = err.stderr ?? ""
      diagnostics = {
        dockerLogsError: err.message ?? "docker logs falhou",
        hint: "fora do host de produção (ou sem permissão docker), a rota não consegue ler os logs — usar `docker compose logs app` manualmente ou rodar na VPS",
      }
    }

    const violations = parseCspLogs(`${stdout}\n${stderr}`)

    if (violations.length === 0) {
      const parsed = stdout.split("\n").filter((l) => l.trim().startsWith("{")).length
      logger.info(
        { container, lines, parsedJsonLines: parsed, stderrBytes: stderr.length },
        "CSP report: nenhuma violação encontrada no log",
      )
    }

    return NextResponse.json(
      {
        ...aggregateCspViolations(violations, { windowHours: 24 }),
        ...(diagnostics ? { diagnostics } : {}),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 })
    }
    throw e
  }
}
