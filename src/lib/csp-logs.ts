/**
 * csp-logs.ts — leitura das violações CSP dos logs do container.
 *
 * Isolado do route handler para ser trivialmente mockável em testes
 * (mockar node:child_process builtin é frágil sob o runner).
 *
 * O app loga violações via Pino em stdout (jsonl com type: "csp-violation",
 * emitidas pela rota POST /api/csp-report) — o Docker captura stdout+stderr
 * no mesmo buffer, então `docker logs` devolve tudo que precisamos agregar.
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type ContainerLogs = { stdout: string; stderr: string }

export type Violation = {
  time: number
  directive: string
  blockedUri: string
  documentUri: string
}

/** Diretrizes cuja violação BLOQUEIA a página quando CSP sai de Report-Only. */
const BLOCKING_DIRECTIVES = new Set(["script-src", "object-src", "base-uri", "frame-ancestors"])

function countBy(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function topEntries(map: Map<string, number>, limit = 10): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

/**
 * Extrai violações CSP de linhas de log (stdout+stderr do container).
 * Linhas não-JSON e registros sem type "csp-violation" são ignorados
 * silenciosamente — o buffer de logs mistura tudo o que o app imprimiu.
 */
export function parseCspLogs(raw: string): Violation[] {
  const violations: Violation[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    if (entry.type !== "csp-violation") continue
    violations.push({
      time: typeof entry.time === "number" ? entry.time : Date.parse(String(entry.time)) || 0,
      directive: typeof entry.directive === "string" ? entry.directive : "unknown",
      blockedUri: typeof entry.blockedUri === "string" ? entry.blockedUri : "unknown",
      documentUri: typeof entry.documentUri === "string" ? entry.documentUri : "unknown",
    })
  }
  return violations
}

/** Recomendação de rollout por diretiva, a partir das violações agregadas. */
function rolloutFor(directive: string, count: number): string {
  if (count === 0) return "ok"
  if (directive === "script-src")
    return "blocker: violação de script-src vira execução bloqueada no enforce — investigar origem antes de remover CSP_REPORT_ONLY"
  if (directive === "object-src" || directive === "base-uri" || directive === "frame-ancestors")
    return "blocker: diretriz bloqueante com violação — esperado apenas em tentativa de exploração; validar se origem é legítima"
  return "tolerável no enforce (diretriz não-bloqueante, ex. img/style/connect): avaliar allowlist antes de enforcar para não degradar UX"
}

// ── Resumo style-src-attr × style-src-elem ─────────────────────────────────
//
// As duas diretrizes pedem AÇÕES DIFERENTES e o byDirective global mistura:
//   - style-src-ATTR rege o atributo style="..." no HTML — é a dívida que a
//     migração dos style={{}} (docs/STYLE_MIGRATION_PLAN.md) elimina; cada
//     violação aqui nomeia o código/vendador a migrar (origem + documento).
//   - style-src-ELEM rege <style>/<link> — hoje só o hash do global-error é
//     pinado e o guard check:inline-style prova a sincronia; violação aqui é
//     quase sempre defeito IMEDIATO (novo <style> inline, ou hash editado sem
//     recalcular), não dívida planejada.

/** Ação orientada por família — vira texto do painel. */
function styleActionNote(family: "attr" | "elem"): string {
  if (family === "attr")
    return "código (ou vendador) escrevendo atributo style — migrar para classe/CSSOM e allowlistar no censo do guard (docs/STYLE_MIGRATION_PLAN.md)"
  return "elemento <style>/<link> bloqueado — novo <style> inline (guard check:inline-style reprova) ou hash da CSP editado sem recalcular"
}

function topList(
  map: Map<string, number>,
  key: "blockedUri" | "documentUri",
  limit: number,
): Array<Record<string, unknown>> {
  return topEntries(map, limit).map(([value, count]) => ({ [key]: value, count }))
}

/**
 * Separa as violações de estilo por FAMÍLIA (attr × elem) com top origens
 * bloqueadas e top documentos — a visão que orienta a próxima rodada de
 * endurecimento (remoção do 'unsafe-inline' de style-src-attr).
 */
export function summarizeStyleViolations(
  violations: Violation[],
  limit = 5,
): Record<string, unknown> {
  let attrCount = 0
  let elemCount = 0
  const attrBlocked = new Map<string, number>()
  const elemBlocked = new Map<string, number>()
  const attrDocs = new Map<string, number>()
  const elemDocs = new Map<string, number>()

  for (const v of violations) {
    if (v.directive === "style-src-attr") {
      attrCount++
      countBy(attrBlocked, v.blockedUri)
      countBy(attrDocs, v.documentUri)
    } else if (v.directive === "style-src-elem") {
      elemCount++
      countBy(elemBlocked, v.blockedUri)
      countBy(elemDocs, v.documentUri)
    }
  }

  return {
    // Nota de leitura: navegadores antigos reportam a diretiva GENÉRICA
    // (style-src) para violações de atributo — o byDirective global do painel
    // continua cobrindo esse caso; aqui só entra o relato efetivo moderno.
    attr: {
      count: attrCount,
      topBlocked: topList(attrBlocked, "blockedUri", limit),
      topDocuments: topList(attrDocs, "documentUri", limit),
      action: styleActionNote("attr"),
    },
    elem: {
      count: elemCount,
      topBlocked: topList(elemBlocked, "blockedUri", limit),
      topDocuments: topList(elemDocs, "documentUri", limit),
      action: styleActionNote("elem"),
    },
  }
}

/** Agrega violações e produz o corpo do painel (incl. recomendação de rollout). */
export function aggregateCspViolations(
  violations: Violation[],
  opts: { windowHours: number },
): Record<string, unknown> {
  const byDirective = new Map<string, number>()
  const byBlocked = new Map<string, number>()
  const byDocument = new Map<string, number>()

  let firstTs = Number.POSITIVE_INFINITY
  let lastTs = 0
  for (const v of violations) {
    countBy(byDirective, v.directive)
    countBy(byBlocked, v.blockedUri)
    countBy(byDocument, v.documentUri)
    if (v.time > 0) {
      if (v.time < firstTs) firstTs = v.time
      if (v.time > lastTs) lastTs = v.time
    }
  }

  const blocking = topEntries(byDirective)
    .filter(([d]) => BLOCKING_DIRECTIVES.has(d))
    .map(([directive, count]) => ({
      directive,
      count,
      rollout: rolloutFor(directive, count),
    }))

  const directives = topEntries(byDirective).map(([directive, count]) => ({
    directive,
    count,
    rollout: rolloutFor(directive, count),
  }))

  return {
    windowHours: opts.windowHours,
    total: violations.length,
    observed: {
      first: Number.isFinite(firstTs) ? new Date(firstTs).toISOString() : null,
      last: lastTs > 0 ? new Date(lastTs).toISOString() : null,
    },
    byDirective: directives,
    // Resumo orientado à próxima rodada: attr (dívida da migração style={{}})
    // separado de elem (defeito imediato — <style> novo ou hash dessincronizado).
    styleSummary: summarizeStyleViolations(violations),
    blockingViolations: blocking,
    topBlockedSources: topEntries(byBlocked).map(([blockedUri, count]) => ({ blockedUri, count })),
    topDocuments: topEntries(byDocument).map(([documentUri, count]) => ({ documentUri, count })),
    // Critério do plano de rollout: zero violações bloqueantes ⇒ pode tirar
    // CSP_REPORT_ONLY (avançar para enforce). Qualquer blocker ⇒ permanecer
    // em observação e investigar por diretriz/origem acima.
    rollout: {
      readyToEnforce: blocking.length === 0,
      blockingCount: blocking.reduce((acc, b) => acc + b.count, 0),
      criterion:
        "pronto para enforce quando: duas janelas de 24h seguidas com readyToEnforce=true (zero violações de script-src/object-src/base-uri/frame-ancestors)",
    },
  }
}

/**
 * Lê as últimas `lines` linhas de log do container via CLI docker.
 * Roda no host de produção (o container do app enxerga o docker socket do
 * host apenas quando a rota é chamada na VPS — fora dela, a chamada falha e
 * o caller deve degradar com diagnostics, não quebrar).
 */
export async function readContainerLogs(
  lines: number,
  container: string,
  timeoutMs = 10_000,
): Promise<ContainerLogs> {
  const result = await execFileAsync("docker", ["logs", "--tail", String(lines), container], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  })
  return { stdout: result.stdout, stderr: result.stderr }
}
