#!/usr/bin/env node
// =============================================================================
// check-route-handler-style.mjs
//
// Usage:
//   node scripts/check-route-handler-style.mjs              # repo atual
//   node scripts/check-route-handler-style.mjs --root X     # fixture (testes)
//   node scripts/check-route-handler-style.mjs --list       # (rota, handler) que violam hoje
//   node scripts/check-route-handler-style.mjs --review     # modo estrito: decisão vencida vira violação
//   node scripts/check-route-handler-style.mjs --json
//
// Exit codes:
//   0 — todo handler de rota usa o wrapper (ou está na ALLOWLIST com decisão viva)
//   1 — VIOLAÇÃO: handler novo com try/catch + handleError manual; entrada de
//       allowlist ociosa (a rota migrou); addedAt ausente/malformado/no futuro;
//       com --review, decisão vencida também
//   2 — infra: src/app/api inexistente ou nenhum route.ts encontrado (fail-closed)
//   3 — uso inválido (flag desconhecida, --root sem valor)
//
// O QUE ELE GARANTE
//
// Todo handler HTTP exportado por um `route.ts` (`GET/POST/PUT/PATCH/DELETE/
// HEAD/OPTIONS`) usa o wrapper `withRoute`/`withParams` (src/lib/api-route.ts) —
// tracing OTel + request context + `handleError` num lugar só. O padrão MANUAL
// (`try { ... } catch (e) { return handleError(e) }` dentro do handler) duplica
// o boilerplate que o wrapper eliminou e pula o span/request-id: handler novo
// que volta a escrevê-lo reprova o merge.
//
// ALLOWLIST (as rotas de catch custom intencional + o congelamento do legado)
//
// Cada entrada carrega `route` + `handler` + `addedAt` + `reason` — a MESMA
// régua de addedAt/janela das outras allowlists do repo (scripts/allowlist-review.mjs,
// janela de ROUTE_HANDLER_STYLE_REVIEW_DAYS, default 180 dias). No run normal a
// decisão vencida é `::warning::` (uma data não pode bloquear o commit de todo
// mundo); com `--review` (job semanal) ela vira VIOLAÇÃO — aviso dentro de run
// verde é alerta mudo. Entrada OCIOSA (a rota já usa o wrapper, ou o handler
// sumiu) é violação sempre: allowlist que não encolhe quando o código migra é
// isenção eterna disfarçada de decisão.
//
// HEURÍSTICA DE DETECÇÃO (declarada, não acidental)
//
// O scanner é node-puro (sem parser TS): strip de comentários (linha inteira e
// inline após espaço — `//` dentro de string tipo "http://" não casa), extração
// dos handlers exportados e corpo por brace-balance a partir da lista de
// parâmetros, pulando regiões de ANOTAÇÃO DE TIPO (`Promise<{ id: string }>`:
// região curta, sem `return`). Handler declarado como `= withRoute(`/
// `= withParams(` é WRAPPED e não é escaneado (o corpo do handler de verdade
//  mora dentro do wrapper — e é exatamente isso que a invariante cobra).
// Regiões de HELPERS entre handlers não são escaneadas por si; o que importa é
// o handler. Falso positivo teórico: handler que delega a helper local que faz
// o try/catch+handleError por ele — atribuição por região considera o trecho
// do arquivo do handler até o próximo handler; helper DEPOIS do corpo cai no
// handler anterior. Aceito com a razão escrita: o remédio é o mesmo (usar o
// wrapper e deixar o handleError ser do wrapper).
// =============================================================================

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join, sep } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"
import { reviewAddedAtEntries, DEFAULT_REVIEW_DAYS } from "./allowlist-review.mjs"

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, VIOLATION: 1, UNAVAILABLE: 2, USAGE: 3 }

/** Raiz varrida (relativa à raiz do checkout). */
export const API_ROOT = "src/app/api"

/** Arquivo de rota que o scanner procura (Next App Router). */
export const ROUTE_FILE = "route.ts"

/** Janela de revisão das entradas da ALLOWLIST (dias). */
export const ROUTE_HANDLER_STYLE_REVIEW_DAYS = DEFAULT_REVIEW_DAYS

/** Métodos HTTP que um route handler pode exportar. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

/**
 * As rotas isentas — catch custom INTENCIONAL (webhook com assinatura própria,
 * streaming, cron com auth própria) ou LEGADO congelado aguardando migração
 * para o wrapper. Toda entrada tem `addedAt` + `reason`; entrada ociosa (a
 * rota migrou) vira violação — a lista encolhe conforme a migração anda.
 *
 * @type {{route: string, handler: string, addedAt: string, reason: string}[]}
 */
export const ALLOWLIST = [
  {
    route: "src/app/api/calendar/feed/[token]/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper (feed ICS por token de calendário) — migração para withRoute pendente; a entrada congela o conjunto até lá",
  },
  {
    route: "src/app/api/notifications/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper — migração para withRoute pendente; a entrada congela o conjunto até lá",
  },
  {
    route: "src/app/api/providers/[id]/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper (detail de provider com cache-control próprio) — migração para withRoute pendente",
  },
  {
    route: "src/app/api/push/payload/[id]/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper (payload efêmero de push com 404 custom) — migração para withRoute pendente",
  },
  {
    route: "src/app/api/push/click/route.ts",
    handler: "POST",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper (best-effort: fire-and-forget de tracking com .catch próprio) — migração para withRoute pendente",
  },
  {
    route: "src/app/api/availability/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper — migração para withRoute pendente; a entrada congela o conjunto até lá",
  },
  {
    route: "src/app/api/availability/route.ts",
    handler: "POST",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper — migração para withRoute pendente; a entrada congela o conjunto até lá",
  },
  {
    route: "src/app/api/availability/blocks/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper — migração para withRoute pendente; a entrada congela o conjunto até lá",
  },
  {
    route: "src/app/api/availability/blocks/route.ts",
    handler: "POST",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper — migração para withRoute pendente; a entrada congela o conjunto até lá",
  },
  {
    route: "src/app/api/admin/push/webhooks/[id]/route.ts",
    handler: "PATCH",
    addedAt: "2026-10-01",
    reason:
      "migração a MEIO: o DELETE deste arquivo já usa withParams, o PATCH ficou no padrão manual — entrada congela até o PATCH migrar; handler NOVO neste arquivo reprova",
  },
  {
    route: "src/app/api/cron/geo-health-alert/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "cron de alerta de geo-health: auth própria de cron + agregação de falhas parciais (catch por sub-passo) — catch custom intencional; migração decide depois se o wrapper comporta o agregado",
  },
  {
    route: "src/app/api/search/providers/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper (busca com fallback de upstream) — migração para withRoute pendente",
  },
  {
    route: "src/app/api/search/services/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper (busca com fallback de upstream) — migração para withRoute pendente",
  },
  {
    route: "src/app/api/search/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper (busca com fallback para lista vazia) — migração para withRoute pendente",
  },
  {
    route: "src/app/api/admin/benchmarks/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "benchmark admin: telemetria fire-and-forget com .catch próprio ao longo do corpo — catch custom intencional; migração decide depois se o wrapper comporta",
  },
  {
    route: "src/app/api/admin/settings/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper — migração para withRoute pendente; a entrada congela o conjunto até lá",
  },
  {
    route: "src/app/api/admin/settings/route.ts",
    handler: "POST",
    addedAt: "2026-10-01",
    reason:
      "legado anterior ao wrapper — migração para withRoute pendente; a entrada congela o conjunto até lá",
  },
  {
    route: "src/app/api/geo/search/route.ts",
    handler: "GET",
    addedAt: "2026-10-01",
    reason:
      "proxy geo (OSRM/Nominatim): fallback de upstream com resposta própria por modo (free-form vs estruturado) — catch custom intencional",
  },
]

// ── scanner ─────────────────────────────────────────────────────────────────

/** Remove comentários (linha inteira e inline após espaço) para o scan. */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]+\/\/[^\n]*/g, "")
}

/**
 * Corpo brace-balanced a partir de `start` (índice do primeiro `{`). Devolve
 * o índice logo APÓS o `}` de fechamento, ou -1 se não fechar.
 *
 * @param {string} src
 * @param {number} start índice do `{` de abertura
 * @returns {number}
 */
function matchBrace(src, start) {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * A partir do índice de abertura do handler, devolve o CORPO executável
 * (região brace-balanced que contém código, não anotação de tipo): pula a
 * lista de parâmetros, e regiões curtas sem `return` (tipos como
 * `Promise<{ id: string }>`) são descartadas até achar o corpo de verdade.
 *
 * @param {string} src
 * @param {number} from índice logo após o nome do handler na declaração
 * @returns {{body: string, wrapped: boolean}}
 */
function extractHandlerBody(src, from) {
  // Wrapper canônico direto na atribuição (`export const GET = withRoute(`)?
  const afterEq = src.slice(from, from + 120)
  if (
    /^\s*[:\w<>,\s|[\]{}]*?=\s*(withRoute|withParams)\b/.test(afterEq) ||
    /^\s*\(\s*[^)]*\)\s*(:[^=]*)?=>?\s*(withRoute|withParams)\b/.test(afterEq)
  ) {
    return { body: "", wrapped: true }
  }
  // Caminha até a lista de parâmetros e a fecha.
  let i = from
  while (i < src.length && src[i] !== "(") i++
  if (i >= src.length) return { body: "", wrapped: false }
  let paren = 0
  for (; i < src.length; i++) {
    if (src[i] === "(") paren++
    else if (src[i] === ")") {
      paren--
      if (paren === 0) break
    }
  }
  if (paren !== 0) return { body: "", wrapped: false }
  // Regiões brace-balanced seguintes: pula anotações de tipo (curtas e sem
  // `return`), devolve a primeira que parece corpo executável.
  for (let cursor = i; cursor < src.length; cursor++) {
    const open = src.indexOf("{", cursor)
    if (open === -1) break
    const end = matchBrace(src, open)
    if (end === -1) break
    const region = src.slice(open, end)
    if (region.includes("return") || region.length >= 80) {
      return { body: region, wrapped: false }
    }
    cursor = end - 1 // região era anotação de tipo — continua procurando
  }
  return { body: "", wrapped: false }
}

/**
 * Handlers HTTP exportados num route.ts (fonte JÁ sem comentários):
 * `export [async] function METHOD(` e `export const METHOD[: T] =`.
 *
 * @param {string} src
 * @returns {{name: string, body: string, wrapped: boolean}[]}
 */
export function extractHandlers(src) {
  const clean = stripComments(src)
  const out = []
  for (const method of HTTP_METHODS) {
    const re = new RegExp(
      `export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\b`,
      "g",
    )
    for (const m of clean.matchAll(re)) {
      const { body, wrapped } = extractHandlerBody(clean, m.index + m[0].length)
      out.push({ name: method, body, wrapped })
    }
  }
  return out
}

/**
 * Varre a árvore de rotas e devolve TODAS as violações do desenho: handler
 * manual (try/catch + handleError sem wrapper) que NÃO está na ALLOWLIST,
 * entrada de allowlist ociosa, addedAt inválido (e, com review, vencido).
 *
 * @param {string} root raiz do checkout
 * @param {{now?: number, review?: boolean}} [options]
 * @returns {string[]} — mensagens de violação (uma por linha)
 */
export function collectViolations(root, { now = Date.now(), review = false } = {}) {
  const violations = []
  const apiDir = join(root, API_ROOT)
  // Infra lança (fail-closed): quem decide o exit é a CLI (exit 2), a função
  // devolve só VIOLAÇÕES de contrato.
  if (!existsSync(apiDir)) {
    throw new Error(`${API_ROOT} não existe em ${root} — a árvore de rotas sumiu (fail-closed).`)
  }
  const routeFiles = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry === ROUTE_FILE) routeFiles.push(full)
    }
  }
  walk(apiDir)
  if (routeFiles.length === 0) {
    throw new Error(`nenhum ${ROUTE_FILE} sob ${API_ROOT} — a árvore de rotas sumiu (fail-closed).`)
  }

  /** (rota, handler) que violam HOJE — a régua contra a allowlist. */
  const manual = new Map() // route rel -> Set(handler)
  for (const full of routeFiles) {
    const rel = full
      .slice(root.length + 1)
      .split(sep)
      .join("/")
    const src = readFileSync(full, "utf8")
    for (const h of extractHandlers(src)) {
      if (h.wrapped) continue
      const isManual = /\btry\s*{/.test(h.body) && /\bhandleError\s*\(/.test(h.body)
      if (isManual) {
        if (!manual.has(rel)) manual.set(rel, new Set())
        manual.get(rel).add(h.name)
      }
    }
  }

  // Allowlist: cobre EXATAMENTE o que a varredura acha (entrada ociosa é
  // violação; violação sem entrada é violação).
  const allowlisted = new Set(ALLOWLIST.map((e) => `${e.route} ${e.handler}`))
  for (const [route, handlers] of manual) {
    for (const handler of handlers) {
      if (!allowlisted.has(`${route} ${handler}`)) {
        violations.push(
          `${route} (${handler}): handler com try/catch + handleError MANUAL em vez do wrapper withRoute/withParams ` +
            `(tracing + request-id + mapeamento de erro num lugar só). Use withRoute/withParams; ` +
            `catch custom intencional exige entrada na ALLOWLIST com addedAt + reason.`,
        )
      }
    }
  }
  for (const entry of ALLOWLIST) {
    const key = `${entry.route} ${entry.handler}`
    const stillManual = manual.get(entry.route)?.has(entry.handler) ?? false
    if (!stillManual) {
      violations.push(
        `${key}: entrada OCIOSA na ALLOWLIST — a rota usa o wrapper (ou o handler sumiu). ` +
          `Remova a entrada: allowlist que não encolhe quando o código migra é isenção eterna.`,
      )
    }
  }

  // addedAt: mesma régua das outras allowlists (scripts/allowlist-review.mjs).
  const { invalid, aged } = reviewAddedAtEntries(ALLOWLIST, {
    idOf: (entry) => `${entry.route} ${entry.handler}`,
    now,
  })
  for (const v of invalid) {
    violations.push(
      `${v.id}: ${v.why} — fail-closed: sem data válida a isenção não está registrada.`,
    )
  }
  for (const v of aged) {
    if (review) {
      violations.push(
        `${v.id}: decisão vencida (addedAt ${v.addedAt}, ${v.days} dias > janela de ${v.limit}) — ` +
          `REAFIRME (se o motivo vale, atualize a data) ou REMOVA (migre para o wrapper).`,
      )
    } else {
      console.warn(
        `::warning:: [route-handler-style] ${v.id}: decisão vencida (addedAt ${v.addedAt}, ` +
          `${v.days} dias > ${v.limit}) — reafirme ou migre para o wrapper (com --review isso é violação).`,
      )
    }
  }

  return violations
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function usage() {
  return [
    "Usage: node scripts/check-route-handler-style.mjs [opções]",
    "",
    "Opções:",
    "  --root <dir>  raiz do checkout (default: cwd)",
    "  --list        lista os (rota, handler) que violam hoje, sem julgar",
    "  --review      modo estrito: decisão vencida da ALLOWLIST vira violação",
    "  --json        saída estruturada",
    "  -h, --help    esta ajuda",
    "",
    "Exit codes: 0 wrapper em todo handler | 1 violação | 2 infra | 3 uso inválido",
  ].join("\n")
}

function run(args) {
  let root = process.cwd()
  let json = false
  let review = false
  let list = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-h" || arg === "--help") {
      console.log(usage())
      return EXIT.OK
    }
    if (arg === "--json") {
      json = true
      continue
    }
    if (arg === "--review") {
      review = true
      continue
    }
    if (arg === "--list") {
      list = true
      continue
    }
    if (arg === "--root") {
      root = args[++i]
      if (!root) return usageExit()
      continue
    }
    return usageExit()
  }

  try {
    if (list) {
      // Modo de inventário: apenas (rota, handler) manuais de hoje.
      const apiDir = join(root, API_ROOT)
      if (!existsSync(apiDir)) {
        console.error(`❌ route-handler-style (infra): ${API_ROOT} não existe em ${root}`)
        return EXIT.UNAVAILABLE
      }
      const routeFiles = []
      const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          if (statSync(full).isDirectory()) walk(full)
          else if (entry === ROUTE_FILE) routeFiles.push(full)
        }
      }
      walk(apiDir)
      for (const full of routeFiles) {
        const rel = full
          .slice(root.length + 1)
          .split(sep)
          .join("/")
        for (const h of extractHandlers(readFileSync(full, "utf8"))) {
          if (h.wrapped) continue
          if (/\btry\s*{/.test(h.body) && /\bhandleError\s*\(/.test(h.body)) {
            console.log(`${rel} ${h.name}`)
          }
        }
      }
      return EXIT.OK
    }

    const violations = collectViolations(root, { review })
    if (violations.length === 0) {
      if (json) console.log(JSON.stringify({ ok: true, violations: [] }))
      else
        console.log(
          `✅ route-handler-style: todos os handlers de ${API_ROOT} usam withRoute/withParams (ou isenção viva na ALLOWLIST)`,
        )
      return EXIT.OK
    }
    if (json) console.log(JSON.stringify({ ok: false, violations }))
    else {
      console.error(`❌ route-handler-style: ${violations.length} violação(ões):`)
      for (const v of violations) console.error(`   · ${v}`)
      console.error(
        `   Remédio: use withRoute/withParams (src/lib/api-route.ts); catch custom intencional exige entrada na ALLOWLIST com addedAt + reason.`,
      )
    }
    return EXIT.VIOLATION
  } catch (err) {
    if (json) console.log(JSON.stringify({ ok: false, error: err.message }))
    else console.error(`❌ route-handler-style (infra): ${err.message}`)
    return EXIT.UNAVAILABLE
  }
}

function usageExit() {
  console.error(usage())
  return EXIT.USAGE
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(run(process.argv.slice(2)))
}
