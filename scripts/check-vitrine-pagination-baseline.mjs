#!/usr/bin/env node

// =============================================================================
// check-vitrine-pagination-baseline.mjs
//
// Guard de CI do baseline de performance da paginação da vitrine. Roda a rotina
// de navegação do doc (docs/vitrine-pagination-baseline.md) contra um dev
// server REAL, coleta as measures User Timing (`vitrine:*`) pelo mesmo caminho
// que o DevTools expõe (`performance.getEntriesByType("measure")`) e REPROVA
// pioras além dos limiares do doc — a régua sai de impressão e vira gate.
//
// POR QUE UM GUARD SEPARADO DO E2E: os limiares do doc são de DEV (React
// development, sem minificação — 40–120 ms de clique quente). Um `next start`
// de produção mediria outra coisa; o job de CI deste guard sobe `next dev`
// (`.github/workflows/vitrine-baseline.yml`, precedente e2e-cache.yml), mesma
// seed e mesmo método das medições originais.
//
// A ROTINA (4 regimes, os mesmos do doc):
//
//   A. Clique quente — 1 clique de AQUECIMENTO (absorve a anomalia de rota
//      fria do dev: 1ª request pós-recompilação falha silenciosa no client e
//      o prefetch engole, forçando re-seek no clique) + `--samples` cliques
//      em Próxima na cadência do botão. Prefetch dispara na chegada de cada
//      página ⇒ os cliques amostrados nascem de cache. Mediana dos
//      `vitrine:pagina:render` com `warm: true, inFlight: false` ≤ 250 ms;
//      QUALQUER clique (frio/em voo) ≤ 800 ms.
//   B. Deep-link seek — a URL de p3 capturada durante a caminhada reaberta
//      em contexto JS frio (nova página): `vitrine:deeplink:render` com
//      `walked: false` ≤ 800 ms. 3 amostras, mediana.
//   C. Walk reverso — Anterior na p3 do seek (sem âncora de p2 em memória):
//      `vitrine:walk:render` ≤ 800 ms × páginas de walk.
//   D. Deep-link com walk interno — `?pagina=4` sem cursor (nova página):
//      `vitrine:deeplink:render` com `walked: true` ≤ 250 ms × 3 páginas.
//
// FAIL-CLOSED: regime sem measure nenhuma REPROVA (rotina que não produz a
// prova não é verde) — mas é o exit 1, não o 2: o servidor respondeu, a
// aplicação é que não entregou a observabilidade. Exit 2 fica para o ambiente
// não respondendo (base-url inacessível, browser indisponível).
//
// OS LIMIARES MORAM AQUI (`THRESHOLDS`) e o doc os CITA — o teste
// `check-vitrine-pagination-baseline.test.ts` (simetria doc↔script) reprova
// quando um dos dois lados muda sem o outro. Reajustar um limiar é ato
// deliberado: mude o número, rode o teste, atualize a tabela do doc no mesmo
// commit — a mensagem do teste diz onde.
//
// Requisitos do ambiente (verificado pelo guard, nunca presumido):
//   - dev server respondendo em --base-url (default :3100, porta do doc)
//   - banco semeado (prisma/seed.ts — 415 prestadores, ≥ 7 páginas)
//   - Chromium do Playwright instalado (`bunx playwright install chromium`)
//
// Usage:
//   node scripts/check-vitrine-pagination-baseline.mjs
//   node scripts/check-vitrine-pagination-baseline.mjs --base-url http://localhost:3100
//   node scripts/check-vitrine-pagination-baseline.mjs --samples 5 --json
//   node scripts/check-vitrine-pagination-baseline.mjs --report-file /tmp/baseline.json
//   node scripts/check-vitrine-pagination-baseline.mjs --help
//
// Exit codes:
//   0 — dentro dos limiares (pass)
//   1 — piora além do limiar OU regime sem dados (fail-closed: sem prova não há verde)
//   2 — infra: base-url inacessível ou browser/ambiente indisponível
//   3 — uso inválido
// =============================================================================

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// ── Contrato de saída das measures (src/components/vitrine/vitrine.tsx) ─────

export const MEASURES = {
  pagina: "vitrine:pagina:render",
  walk: "vitrine:walk:render",
  deeplink: "vitrine:deeplink:render",
  popstate: "vitrine:popstate:render",
}

// ── Limiares (FONTE CANÔNICA — o doc os cita, o teste de simetria cobra) ────

export const THRESHOLDS = {
  /** Clique quente: mediana das amostras warm&&!inFlight. */
  paginaWarmMedianMs: 250,
  /** QUALQUER clique — tail de rede (inFlight) ou frio. */
  paginaSingleSampleMs: 800,
  /** Walk reverso, por página encadeada (walk de k páginas ⇒ 800×k). */
  walkMsPerPagina: 800,
  /** Deep-link seek direto (walked: false), mediana. */
  deeplinkSeekMs: 800,
  /** Deep-link com walk interno, por página encadeada. */
  deeplinkWalkMsPerPagina: 250,
  /** Mínimo de amostras quentes para a mediana valer (doc: ≥ 3). */
  minWarmSamples: 3,
}

export const DEFAULT_BASE_URL = "http://localhost:3100"
export const DEFAULT_SAMPLES = 5
export const MIN_SAMPLES = 3
/** 1ª visita em dev compila a rota — o load tolera isso (o medido é o clique). */
export const LOAD_TIMEOUT_MS = 90_000
export const MEASURE_TIMEOUT_MS = 30_000
/** Amostras do deep-link seek: cada uma é 1 page load + 1 request — barato. */
export const SEEK_SAMPLES = 3

/** A p3 é o pouso capturado durante a caminhada (alvo do seek e do walk). */
const SEEK_TARGET = 3
/** `?pagina=4` sem cursor = 3 páginas encadeadas (p1→p2→p3→p4). */
const WALK_INTERNO_TARGET = 4

// ── Seletores do DOM REAL (vitrine-results.tsx — botões Anterior/Próxima) ───

export const NAV_SELECTOR = 'nav[aria-label="Paginação de resultados"]'
export const NEXT_BUTTON = `${NAV_SELECTOR} button:has-text("Próxima")`
export const PREV_BUTTON = `${NAV_SELECTOR} button:has-text("Anterior")`

// ── Erros tipados: o exit code depende da CLASSE da falha ───────────────────

/** Ambiente respondeu, mas a prova não fechou (regime sem measure). Exit 1. */
export class MeasureTimeoutError extends Error {
  constructor(fase, criterio) {
    super(
      `fase "${fase}": a measure não apareceu em tempo (${criterio}) — a rotina ` +
        `precisa da instrumentação User Timing da vitrine para provar o limiar`,
    )
    this.name = "MeasureTimeoutError"
  }
}

// ── Lógica pura (sem browser — testada em src/lib/__tests__) ────────────────

/** Mediana de uma lista não-vazia; `null` em vazia (o chamador reprova). */
export function medianOf(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Páginas encadeadas de um walk com alvo T: o walk parte de p1, então
 * p1→…→T são T-1 transições (T=2 ⇒ 1 página; T=4 ⇒ 3). O piso de 1 evita
 * limiar 0 para um detail malformado — que viraria reprovação automática.
 */
export function walkPaginasOf(detail) {
  const target = Number(detail?.target)
  return Number.isFinite(target) && target > 1 ? target - 1 : 1
}

/**
 * O veredito do baseline: recebe as measures coletadas e devolve violações
 * (vazio = pass). Pura em relação ao browser — o runner só alimenta.
 *
 * Violações têm `tipo: "limiar"` (medido piorou) ou `"dados-insuficientes"`
 * (a rotina não produziu a amostra mínima — o gate reprova do mesmo jeito,
 * com a causa nomeada: verde por ausência validaria o que nunca rodou).
 *
 * @param {{ name: string, duration: number, detail: object | null }[]} entries
 * @param {typeof THRESHOLDS} [thresholds]
 * @param {{ samples?: number, seekSamples?: number }} [opts]
 */
export function evaluateBaseline(entries, thresholds = THRESHOLDS, opts = {}) {
  const samples = opts.samples ?? DEFAULT_SAMPLES
  const seekSamples = opts.seekSamples ?? SEEK_SAMPLES
  const violations = []

  const addLimiar = (regime, observadoMs, limiarMs, detail) =>
    violations.push({
      regime,
      tipo: "limiar",
      observadoMs: Math.round(observadoMs * 10) / 10,
      limiarMs,
      detail: detail ?? null,
    })
  const addInsuficiente = (regime, encontrado, esperado) =>
    violations.push({ regime, tipo: "dados-insuficientes", encontrado, esperado })

  const porNome = (name) => entries.filter((e) => e.name === name)
  const pagina = porNome(MEASURES.pagina)
  const walk = porNome(MEASURES.walk)
  const deeplink = porNome(MEASURES.deeplink)
  const seek = deeplink.filter((e) => e.detail?.walked === false)
  const walkInterno = deeplink.filter((e) => e.detail?.walked === true)

  // ── Regime A: clique quente ──
  const warm = pagina.filter((e) => e.detail?.warm === true && e.detail?.inFlight === false)
  const medianaWarm = medianOf(warm.map((e) => e.duration))
  const minimoWarm = Math.min(samples, thresholds.minWarmSamples)
  if (warm.length < minimoWarm) {
    addInsuficiente(`${MEASURES.pagina} (warm)`, warm.length, minimoWarm)
  } else if (medianaWarm > thresholds.paginaWarmMedianMs) {
    addLimiar(
      `${MEASURES.pagina} (mediana de ${warm.length} quentes)`,
      medianaWarm,
      thresholds.paginaWarmMedianMs,
      null,
    )
  }
  for (const e of pagina) {
    if (e.duration > thresholds.paginaSingleSampleMs) {
      addLimiar(
        `${MEASURES.pagina} (clique único — ${e.detail?.warm ? "quente" : "frio/em voo"})`,
        e.duration,
        thresholds.paginaSingleSampleMs,
        e.detail,
      )
    }
  }

  // ── Regime B: deep-link seek (mediana das amostras baratas) ──
  if (seek.length < seekSamples) {
    addInsuficiente(`${MEASURES.deeplink} (seek)`, seek.length, seekSamples)
  } else {
    const medianaSeek = medianOf(seek.map((e) => e.duration))
    if (medianaSeek > thresholds.deeplinkSeekMs) {
      addLimiar(
        `${MEASURES.deeplink} (seek, mediana de ${seek.length})`,
        medianaSeek,
        thresholds.deeplinkSeekMs,
        seek[0].detail,
      )
    }
  }

  // ── Regime C: walk reverso (limiar ESCALA com as páginas encadeadas) ──
  if (walk.length === 0) {
    addInsuficiente(MEASURES.walk, 0, 1)
  } else {
    for (const e of walk) {
      const paginas = walkPaginasOf(e.detail)
      const limiar = thresholds.walkMsPerPagina * paginas
      if (e.duration > limiar) {
        addLimiar(`${MEASURES.walk} (${paginas} pág.)`, e.duration, limiar, e.detail)
      }
    }
  }

  // ── Regime D: deep-link com walk interno (mesma escala) ──
  if (walkInterno.length === 0) {
    addInsuficiente(`${MEASURES.deeplink} (walk interno)`, 0, 1)
  } else {
    for (const e of walkInterno) {
      const paginas = walkPaginasOf(e.detail)
      const limiar = thresholds.deeplinkWalkMsPerPagina * paginas
      if (e.duration > limiar) {
        addLimiar(
          `${MEASURES.deeplink} (walk interno, ${paginas} pág.)`,
          e.duration,
          limiar,
          e.detail,
        )
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    resumo: {
      paginaCliques: pagina.length,
      paginaWarm: warm.length,
      medianaWarmMs: medianaWarm === null ? null : Math.round(medianaWarm * 10) / 10,
      medianaSeekMs:
        seek.length === 0 ? null : Math.round(medianOf(seek.map((e) => e.duration)) * 10) / 10,
      walk: walk.length,
      deeplinkSeek: seek.length,
      deeplinkWalkInterno: walkInterno.length,
      popstate: porNome(MEASURES.popstate).length,
    },
  }
}

/** Argumentos da CLI — exportado para o teste do contrato de uso. A união é
 *  DISCRIMINADA por `ok`: o chamador (e o typecheck do teste) estreita por ela
 *  em vez de adivinhar se `error` existe.
 *
 * @param {string[]} argv
 * @returns {{ ok: true, baseUrl: string, samples: number, json: boolean, reportFile: string | null, help: boolean } | { ok: false, error: string }}
 */
export function parseArgs(argv) {
  /** @type {{ ok: true, baseUrl: string, samples: number, json: boolean, reportFile: string | null, help: boolean }} */
  const opts = {
    ok: true,
    baseUrl: process.env.VITRINE_BASE_URL || DEFAULT_BASE_URL,
    samples: DEFAULT_SAMPLES,
    json: false,
    reportFile: null,
    help: false,
  }
  /** @param {string} mensagem */
  const erro = (mensagem) => ({ ok: false, error: mensagem })
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--base-url" || arg === "--report-file") {
      const next = argv[++i]
      if (next === undefined || next.startsWith("--")) {
        return erro(`${arg} exige um valor`)
      }
      if (arg === "--base-url") opts.baseUrl = next.replace(/\/+$/, "")
      else opts.reportFile = next
    } else if (arg === "--samples") {
      const next = argv[++i]
      const n = Number(next)
      if (!Number.isInteger(n) || n < MIN_SAMPLES) {
        return erro(`--samples exige inteiro ≥ ${MIN_SAMPLES} (doc: mediana de ≥ 3)`)
      }
      opts.samples = n
    } else {
      return erro(`argumento desconhecido: ${arg}`)
    }
  }
  return opts
}

// ── Rotina de browser (o que os testes unitários NÃO cobrem — cobertos pela
//    execução real de CI e a validação local contra o dev :3100) ─────────────

/** Espera o botão HABILITAR (isFetching desabilita a paginação durante fetch/walk). */
async function waitForEnabled(locator, timeoutMs) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs })
  const deadline = Date.now() + timeoutMs
  while (!(await locator.isEnabled())) {
    if (Date.now() > deadline) throw new Error("botão de paginação não habilitou a tempo")
    await new Promise((r) => setTimeout(r, 120))
  }
}

/**
 * Espera uma measure ESPECÍFICA (nome + alvo + predicado opcional) na página.
 * O predicado pelo `detail` é o que separa os regimes que compartilham nome —
 * o deep-link seek e o walk-interno são o MESMO `vitrine:deeplink:render`.
 */
async function waitForMeasure(page, { name, target, prop = null, propValue = null, timeoutMs }) {
  await page.waitForFunction(
    ({ name, target, prop, propValue }) => {
      const entries = performance.getEntriesByType("measure").filter((e) => e.name === name)
      return entries.some((e) => {
        const d = e.detail
        if (!d || d.target !== target) return false
        return prop === null || d[prop] === propValue
      })
    },
    { name, target, prop, propValue },
    { timeout: timeoutMs, polling: 120 },
  )
}

/** Coleta as measures da vitrine desta página (mesmo caminho do doc). O
 *  filtro por nome existe porque uma página acumula as measures DELEGADAS:
 *  coletar a página de seek DEPOIS do walk duplicaria a amostra do seek —
 *  a mediana contaria a mesma página duas vezes. */
async function collectMeasures(page, onlyName = null) {
  return page.evaluate(
    (only) =>
      performance
        .getEntriesByType("measure")
        .filter((e) => typeof e.name === "string" && e.name.startsWith("vitrine:"))
        .filter((e) => only === null || e.name === only)
        .map((e) => ({ name: e.name, duration: e.duration, detail: e.detail ?? null })),
    onlyName,
  )
}

/**
 * Roda a rotina completa contra o dev server. Devolve as measures coletadas
 * e o ambiente; quem julga é `evaluateBaseline` (pura, testada sem browser).
 *
 * Cada fase lança `MeasureTimeoutError` (exit 1 — a aplicação não entregou a
 * prova) e erros de ambiente borram como-is para o main (exit 2).
 */
export async function runBaseline({ baseUrl, samples, log = () => {} }) {
  // Import dinâmico: a lógica pura (testada em vitest/jsdom) não arrasta o
  // playwright para o grafo — só a rotina real de browser precisa dele.
  const { chromium } = await import("@playwright/test")

  log(`→ abrindo Chromium (dev server: ${baseUrl})`)
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      locale: "pt-BR",
      // O goPage rola até a âncora de resultados com behavior "smooth" —
      // animação é ruído no intervalo entre clique e assentamento.
      reducedMotion: "reduce",
    })

    // ── Fase A: clique quente (aquecimento + samples em Próxima) ──
    log(`→ fase A: clique quente (1 aquecimento + ${samples} amostras)`)
    const page = await context.newPage()
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS })
    const next = page.locator(NEXT_BUTTON).first()
    await next.waitFor({ state: "visible", timeout: LOAD_TIMEOUT_MS })

    // Aquecimento (não contabilizado): absorve a rota fria do dev — 1ª
    // request pós-recompilação falha silenciosa e o clique re-seekaria.
    await waitForEnabled(next, LOAD_TIMEOUT_MS)
    await next.click()
    await waitForMeasure(page, {
      name: MEASURES.pagina,
      target: 2,
      timeoutMs: MEASURE_TIMEOUT_MS,
    }).catch(() => {
      throw new MeasureTimeoutError("A (aquecimento p1→p2)", `${MEASURES.pagina} target=2`)
    })

    let seekUrl = null
    for (let i = 2; i <= samples + 1; i++) {
      await waitForEnabled(next, MEASURE_TIMEOUT_MS)
      await next.click()
      await waitForMeasure(page, {
        name: MEASURES.pagina,
        target: i + 1,
        timeoutMs: MEASURE_TIMEOUT_MS,
      }).catch(() => {
        throw new MeasureTimeoutError(
          `A (clique p${i}→p${i + 1})`,
          `${MEASURES.pagina} target=${i + 1}`,
        )
      })
      // A p3 é capturada DURANTE a caminhada — o seek da fase B reabre esta
      // URL (com a âncora de cursor que o pushState registrou).
      if (i === SEEK_TARGET - 1) seekUrl = page.url()
    }
    const paginaEntries = await collectMeasures(page)
    await page.close()

    // ── Fase B: deep-link seek em contexto JS frio (× SEEK_SAMPLES) ──
    log(`→ fase B: deep-link seek (${SEEK_SAMPLES} contextos frios)`)
    const seekEntries = []
    let seekPage = null
    for (let s = 0; s < SEEK_SAMPLES; s++) {
      seekPage = await context.newPage()
      await seekPage.goto(seekUrl, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS })
      await waitForMeasure(seekPage, {
        name: MEASURES.deeplink,
        target: SEEK_TARGET,
        prop: "walked",
        propValue: false,
        timeoutMs: MEASURE_TIMEOUT_MS,
      }).catch(() => {
        throw new MeasureTimeoutError(
          `B (seek ${s + 1}/${SEEK_SAMPLES})`,
          `${MEASURES.deeplink} target=${SEEK_TARGET} walked=false`,
        )
      })
      seekEntries.push(...(await collectMeasures(seekPage)))
    }

    // ── Fase C: walk reverso — Anterior no ÚLTIMO pouso de seek (a p2 nunca
    //    foi visitada neste contexto ⇒ sem âncora de p2 ⇒ walk p1→p2) ──
    log("→ fase C: walk reverso (Anterior sem âncora de N-1)")
    const prev = seekPage.locator(PREV_BUTTON).first()
    await waitForEnabled(prev, MEASURE_TIMEOUT_MS)
    await prev.click()
    await waitForMeasure(seekPage, {
      name: MEASURES.walk,
      target: SEEK_TARGET - 1,
      timeoutMs: MEASURE_TIMEOUT_MS,
    }).catch(() => {
      throw new MeasureTimeoutError(
        "C (walk reverso)",
        `${MEASURES.walk} target=${SEEK_TARGET - 1}`,
      )
    })
    const walkEntries = await collectMeasures(seekPage, MEASURES.walk)
    await seekPage.close()

    // ── Fase D: deep-link com walk interno (?pagina=4, sem cursor) ──
    log(`→ fase D: deep-link com walk interno (?pagina=${WALK_INTERNO_TARGET})`)
    const walkPage = await context.newPage()
    await walkPage.goto(`${baseUrl}/?pagina=${WALK_INTERNO_TARGET}`, {
      waitUntil: "domcontentloaded",
      timeout: LOAD_TIMEOUT_MS,
    })
    await waitForMeasure(walkPage, {
      name: MEASURES.deeplink,
      target: WALK_INTERNO_TARGET,
      prop: "walked",
      propValue: true,
      timeoutMs: MEASURE_TIMEOUT_MS,
    }).catch(() => {
      throw new MeasureTimeoutError(
        "D (walk interno)",
        `${MEASURES.deeplink} target=${WALK_INTERNO_TARGET} walked=true`,
      )
    })
    const walkInternoEntries = await collectMeasures(walkPage)
    await walkPage.close()

    await context.close()
    return {
      entries: [...paginaEntries, ...seekEntries, ...walkEntries, ...walkInternoEntries],
      ambiente: {
        baseUrl,
        samples,
        seekSamples: SEEK_SAMPLES,
        seedUrlCapturada: seekUrl,
      },
    }
  } finally {
    await browser.close()
  }
}

// ── Relatório ────────────────────────────────────────────────────────────────

export function renderReport(result, { ambiente, resumo, thresholds = THRESHOLDS } = {}) {
  const lines = []
  if (result.ok) {
    lines.push(`✅ Baseline de paginação dentro dos limiares (docs/vitrine-pagination-baseline.md)`)
  } else {
    lines.push(`❌ Baseline de paginação REPROVADO — ${result.violations.length} violação(ões):`)
  }
  lines.push(
    `   ambiente: ${ambiente.baseUrl} · cliques=${resumo.paginaCliques} (warm ${resumo.paginaWarm}) · ` +
      `mediana warm=${resumo.medianaWarmMs ?? "—"}ms · mediana seek=${resumo.medianaSeekMs ?? "—"}ms · ` +
      `walk=${resumo.walk} · walk-interno=${resumo.deeplinkWalkInterno}`,
  )
  for (const v of result.violations) {
    if (v.tipo === "limiar") {
      lines.push(
        `   · ${v.regime}: ${v.observadoMs}ms > limiar ${v.limiarMs}ms — investigue (piora relativa importa mais que absoluta)`,
      )
    } else {
      lines.push(
        `   · ${v.regime}: ${v.encontrado}/${v.esperado} amostras — sem a prova o regime não pode passar (fail-closed)`,
      )
    }
  }
  lines.push(
    `   limiares: warm mediana ≤ ${thresholds.paginaWarmMedianMs}ms · clique ≤ ${thresholds.paginaSingleSampleMs}ms · ` +
      `walk ≤ ${thresholds.walkMsPerPagina}ms/pág · seek ≤ ${thresholds.deeplinkSeekMs}ms · walk-interno ≤ ${thresholds.deeplinkWalkMsPerPagina}ms/pág`,
  )
  if (!result.ok) {
    lines.push(
      `   ruído de máquina? rode de novo (--json traz as amostras cruas) antes de investigar o código`,
    )
  }
  return lines.join("\n")
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`check-vitrine-pagination-baseline: ${parsed.error}`)
    process.exit(3)
  }
  if (parsed.help) {
    console.log(
      [
        "check-vitrine-pagination-baseline — roda a rotina de baseline da paginação e reprova pioras além dos limiares do doc",
        "",
        "Usage:",
        "  node scripts/check-vitrine-pagination-baseline.mjs [opções]",
        "",
        "Opções:",
        "  --base-url <url>     dev server da vitrine (default: env VITRINE_BASE_URL ou http://localhost:3100)",
        `  --samples <n>        cliques quentes amostrados (default ${DEFAULT_SAMPLES}, mínimo ${MIN_SAMPLES})`,
        "  --json               imprime o relatório estruturado (medidas + violações)",
        "  --report-file <path> escreve o JSON do relatório no caminho (para artifact de CI)",
        "  -h, --help           esta ajuda",
        "",
        "Exit codes:",
        "  0 — dentro dos limiares",
        "  1 — piora além do limiar OU regime sem dados (fail-closed)",
        "  2 — infra: base-url inacessível ou browser indisponível",
        "  3 — uso inválido",
      ].join("\n"),
    )
    process.exit(0)
  }

  const log = parsed.json ? () => {} : (s) => console.error(s)
  try {
    const { entries, ambiente } = await runBaseline({
      baseUrl: parsed.baseUrl,
      samples: parsed.samples,
      log,
    })
    const result = evaluateBaseline(entries, THRESHOLDS, { samples: parsed.samples })
    const reporte = {
      ...result,
      ambiente,
      limiares: THRESHOLDS,
      // As amostras cruas vão no JSON: o número auditável em vez de acreditado
      // (mesma disciplina do bench-guard-timing).
      medidas: entries,
    }
    if (parsed.reportFile) {
      writeFileSync(parsed.reportFile, JSON.stringify(reporte, null, 2))
      log(`→ relatório: ${parsed.reportFile}`)
    }
    if (parsed.json) {
      console.log(JSON.stringify(reporte, null, 2))
    } else {
      console.log(renderReport(result, { ambiente, resumo: result.resumo }))
    }
    process.exit(result.ok ? 0 : 1)
  } catch (err) {
    if (err instanceof MeasureTimeoutError) {
      console.error(`❌ ${err.message}`)
      process.exit(1)
    }
    // O resto é ambiente: browser indisponível, dev server fora do ar,
    // página quebrada no load. Distinguir isso do exit 1 é o que impede
    // "gate vermelho" de significar duas coisas diferentes.
    console.error(`❌ infra: ${err?.message ?? err}`)
    process.exit(2)
  }
}

// True apenas quando executado diretamente — os testes importam as funções
// puras sem disparar browser nenhum.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) main()

/** Caminho canônico do doc que este guard aplica (usado pelo teste de simetria). */
export const BASELINE_DOC = join("docs", "vitrine-pagination-baseline.md")
