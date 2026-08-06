#!/usr/bin/env node
// =============================================================================
// check-jsdom-baseline.mjs — Guard de DRIFT da suíte jsdom de componentes
// =============================================================================
//
// Roda a suíte jsdom REAL de componentes (vitest.config.ts — src/components,
// a suíte que o test:unit do CI EXCLUI) e compara as falhas com um BASELINE
// commitado (docs/quality/jsdom-failures-baseline.json). Falha (exit 1)
// SOMENTE quando o drift é PARA CIMA:
//   • arquivo de teste NOVO passando a falhar (não está no baseline);
//   • count de falhas de um arquivo CRESCENDO (baseline N → atual M, M > N).
// Falhas que SUMEM (arquivo curado / count menor) PASSAM — o guard protege o
// FUTURO, não pune remediação.
//
// Por que baseline e não zero: a suíte tem falhas PRÉ-EXISTENTES (163 em
// 26 arquivos, medido 08/2026 — mocks de lucide incompletos em testes
// próprios, getComputedStyle não implementado no jsdom, ambiguidade de
// queries por poluição entre arquivos) e NUNCA rodou no CI (excluída do
// vitest.config.unit.ts). Zerar
// é uma operação deliberada por arquivo; o guard torna o drift VISÍVEL e
// GATEIA o crescimento enquanto a remediação anda. O count do baseline é
// DERIVADO do run real (nunca literal) — `--update` regenera o arquivo
// (mesmo princípio do check-secret-leaks-baseline).
//
// Comparação por ARQUIVO, não por count total: um arquivo curado e outro
// quebrado mantêm o total, mas o arquivo NOVO é detectado. Fail-closed:
// baseline ausente sem --update = exit 2 com instrução clara.
//
// Usage:
//   node scripts/check-jsdom-baseline.mjs                          # check real
//   node scripts/check-jsdom-baseline.mjs --update                 # regenera baseline
//   node scripts/check-jsdom-baseline.mjs --baseline X             # path custom
//   node scripts/check-jsdom-baseline.mjs --results-file X.json    # fixture (testes/
//                                                                  # mutation tests — NÃO
//                                                                  # roda o vitest)
//   node scripts/check-jsdom-baseline.mjs --json                   # output JSON
//
// Exit codes:
//   0 — nenhum drift para cima (ou --update aplicado)
//   1 — drift para cima detectado (arquivo novo falhando OU count cresceu)
//   2 — infra: run do vitest falhou / results inválido / baseline ausente
//       (sem --update) / flag inválida
//
// CONFIRMAÇÃO DE DRIFT (anti-flake): a suíte jsdom tem variação de ±1 teste
// por poluição entre arquivos (medido 08/2026: provider-mini-map oscila 4↔5
// entre runs agregados). Com drift detectado NO RUN REAL (sem --results-file),
// o guard refaz o run UMA vez: se a 2ª run não reproduz o drift, é flakiness
// (poluição), não regressão — exit 0 com aviso. Só drift REPRODUZIDO falha —
// ruído de runner não derruba o PR, regressão real não escapa.
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

/** Path do baseline default (commitado — a fonte da verdade das falhas conhecidas). */
const DEFAULT_BASELINE = "docs/quality/jsdom-failures-baseline.json"

/** Comando default: a suíte jsdom REAL de componentes (config + filtro de path). */
const VITEST_CMD = ["vitest", "run", "--config", "vitest.config.ts", "src/components"]
const VITEST_TIMEOUT_MS = 25 * 60 * 1000

/**
 * Parse do JSON do reporter do vitest (--reporter=json, shape jest-like:
 * `{ testResults: [{ name, status, assertionResults: [{ status }] }] }`) →
 * falhas por ARQUIVO de teste (só arquivos com falha > 0).
 *
 * Defensivo de propósito: o shape do reporter variou entre versões do vitest
 * (em algumas o `assertionResults` carrega o status por teste; em outras o
 * status da suite). Um suite sem assertionResults com status 'failed' conta 1.
 *
 * @param {string|object} json  conteúdo do JSON (string parseável ou objeto)
 * @returns {Record<string, number>} arquivo de teste → nº de testes falhados
 */
export function parseVitestJson(json) {
  const j = typeof json === "string" ? JSON.parse(json) : json
  const results = Array.isArray(j?.testResults) ? j.testResults : []
  const failedFiles = {}
  for (const suite of results) {
    const file = suite?.name
    if (!file) continue
    let failed = 0
    if (Array.isArray(suite.assertionResults)) {
      failed = suite.assertionResults.filter((a) => a?.status === "failed").length
    } else if (suite.status === "failed") {
      failed = 1
    }
    if (failed > 0) failedFiles[file] = (failedFiles[file] ?? 0) + failed
  }
  return failedFiles
}

/**
 * Normaliza o path de um arquivo de teste para RELATIVO ao cwd — o reporter
 * do vitest emite paths ABSOLUTOS (ex.:
 * C:/repo/src/components/a.test.tsx ou /home/runner/work/r/r/...), que são
 * específicos da máquina/runner. O baseline é commitado e comparado em
 * AMBIENTES DIFERENTES (local Windows + CI ubuntu) — um path absoluto nunca
 * casaria entre eles e todo arquivo viraria 'NOVO' (falso drift). Um path
 * que não comece com o cwd é deixado intacto (defensivo — fixtures de teste
 * usam paths arbitrários).
 *
 * @param {string} file  path emitido pelo reporter
 * @param {string} cwd   diretório de trabalho (para strip)
 * @returns {string} path relativo (ou intacto se fora do cwd)
 */
export function normalizePath(file, cwd) {
  const f = String(file).replace(/\\/g, "/")
  const c = String(cwd).replace(/\\/g, "/")
  if (f.startsWith(c + "/")) return f.slice(c.length + 1)
  return f
}

/**
 * Constrói o baseline a partir das falhas atuais (formato do arquivo).
 *
 * @param {Record<string, number>} failedFiles  arquivo → count de falhas
 * @returns {{ count: number, fileCount: number, updatedAt: string, files: Record<string, number> }}
 */
export function buildBaseline(failedFiles) {
  return {
    count: Object.values(failedFiles).reduce((a, b) => a + b, 0),
    fileCount: Object.keys(failedFiles).length,
    updatedAt: new Date().toISOString().slice(0, 10),
    files: failedFiles,
  }
}

/**
 * Lê e valida o conteúdo do arquivo de baseline.
 *
 * @param {string} content
 * @returns {{ count: number, fileCount: number, updatedAt: string, files: Record<string, number> }}
 */
export function parseBaseline(content) {
  const j = JSON.parse(content)
  if (!j || typeof j !== "object" || !j.files || typeof j.files !== "object") {
    throw new Error("baseline sem campo 'files' (objeto arquivo → count)")
  }
  return j
}

/**
 * A regra do guard — drift PARA CIMA (novo arquivo falhando ou count
 * crescendo) vs. melhoria (count caindo). Remoção de arquivo do current
 * (curado 100%) não é violação — só o crescimento.
 *
 * @param {Record<string, number>} current        falhas do run atual
 * @param {Record<string, number>} baselineFiles  falhas do baseline (campo files)
 * @returns {{ violations: Array<{file: string, kind: string, current: number, baseline: number}>, improved: string[] }}
 */
export function findDrift(current, baselineFiles) {
  const violations = []
  const improved = []
  // União current ∪ baseline — um arquivo CURADO (ausente do current) também
  // vira melhoria reportada (base → 0), não só os que caíram parcialmente.
  const files = [...new Set([...Object.keys(current), ...Object.keys(baselineFiles)])].sort()
  for (const file of files) {
    const cur = current[file] ?? 0 // arquivo ausente do current = curado (0)
    const base = baselineFiles[file]
    if (base === undefined) {
      violations.push({ file, kind: "novo", current: cur, baseline: 0 })
    } else if (cur > base) {
      violations.push({ file, kind: "crescimento", current: cur, baseline: base })
    } else if (cur < base) {
      improved.push(`${file} (${base} → ${cur})`)
    }
  }
  return { violations, improved }
}

/**
 * Coleta as falhas por arquivo (relativizadas ao cwd) a partir do run REAL
 * do vitest OU de um fixture (--results-file). Fail-closed (exit 2) quando
 * o run não produz JSON válido ou o fixture não existe.
 *
 * @param {string} cwd          diretório de trabalho (cwd do run do vitest)
 * @param {string|null} resultsFile  path do fixture (null = run real)
 * @returns {Record<string, number>} arquivo → count de falhas (paths relativos)
 */
function collectFailures(cwd, resultsFile) {
  let raw
  if (resultsFile) {
    if (!existsSync(join(cwd, resultsFile))) {
      console.error(`❌ --results-file não encontrado: ${resultsFile}`)
      process.exit(2)
    }
    try {
      raw = readFileSync(join(cwd, resultsFile), "utf8")
    } catch (e) {
      console.error(`❌ Não foi possível ler --results-file: ${e.message}`)
      process.exit(2)
    }
  } else {
    // O stdout do `--reporter=json` É o JSON do run (sem --outputFile — evita
    // path de temp com quoting entre shells). Windows: `npx` é um shim .cmd —
    // spawnSync sem shell lança EINVAL (status null); `shell: true` resolve
    // via cmd.exe no Windows e /bin/sh no Linux (CI).
    const res = spawnSync(["npx", ...VITEST_CMD, "--reporter=json"].join(" "), {
      cwd,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      timeout: VITEST_TIMEOUT_MS,
      shell: true,
    })
    // O exit cru do vitest é 1 quando há falhas de teste — ESPERE falhas
    // (o guard compara contra o baseline; o exit não decide nada). O gate é
    // o stdout parseável como JSON com testResults.
    try {
      JSON.parse(res.stdout ?? "")
      raw = res.stdout
    } catch {
      console.error(
        `❌ check-jsdom-baseline: run do vitest não produziu JSON válido` +
          ` (exit ${res.status ?? "?"}) — infra, não drift.`,
      )
      if (res.error?.message) console.error(res.error.message)
      console.error(res.stderr ? res.stderr.slice(0, 800) : "")
      process.exit(2)
    }
  }

  let failedFiles
  try {
    failedFiles = parseVitestJson(raw)
  } catch (e) {
    console.error(`❌ check-jsdom-baseline: JSON de resultados inválido: ${e.message}`)
    process.exit(2)
  }
  // Paths relativos ao cwd — portabilidade do baseline entre ambientes
  // (local Windows vs CI ubuntu). Sem isso o baseline commitado nunca casaria.
  const normalized = {}
  for (const [file, count] of Object.entries(failedFiles)) {
    normalized[normalizePath(file, cwd)] = count
  }
  return normalized
}

function main() {
  const args = process.argv.slice(2)
  const update = args.includes("--update")
  const json = args.includes("--json")

  const baselineIdx = args.indexOf("--baseline")
  if (baselineIdx !== -1 && args[baselineIdx + 1] === undefined) {
    console.error("check-jsdom-baseline: --baseline requer um path")
    process.exit(2)
  }
  const baselinePath = baselineIdx !== -1 ? args[baselineIdx + 1] : DEFAULT_BASELINE

  const resultsIdx = args.indexOf("--results-file")
  if (resultsIdx !== -1 && args[resultsIdx + 1] === undefined) {
    console.error("check-jsdom-baseline: --results-file requer um path")
    process.exit(2)
  }
  const resultsFile = resultsIdx !== -1 ? args[resultsIdx + 1] : null

  const cwd = process.cwd()
  const baselineFile = join(cwd, baselinePath)

  // ── Fonte das falhas: fixture (--results-file, testes/mutation tests) ou
  // run REAL do vitest (spawn da suíte jsdom de componentes). ────────────
  const failedFiles = collectFailures(cwd, resultsFile)
  const currentTotal = Object.values(failedFiles).reduce((a, b) => a + b, 0)

  // ── --update: regenera o baseline a partir do run atual ──────────────
  if (update) {
    mkdirSync(dirname(baselineFile), { recursive: true })
    const baseline = buildBaseline(failedFiles)
    writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, "utf8")
    console.log(
      `✅ Baseline atualizado: ${currentTotal} falha(s) em ${baseline.fileCount} arquivo(s) → ${baselinePath}`,
    )
    process.exit(0)
  }

  // ── Fail-closed: baseline ausente sem --update ────────────────────────
  if (!existsSync(baselineFile)) {
    console.error(`❌ Baseline ausente: ${baselinePath}`)
    console.error(`   Rode primeiro: node scripts/check-jsdom-baseline.mjs --update`)
    process.exit(2)
  }

  let baseline
  try {
    baseline = parseBaseline(readFileSync(baselineFile, "utf8"))
  } catch (e) {
    console.error(`❌ Baseline inválido (${baselinePath}): ${e.message}`)
    process.exit(2)
  }

  // ── Comparação por arquivo — só drift PARA CIMA falha ────────────────
  let { violations, improved } = findDrift(failedFiles, baseline.files ?? {})

  // ── CONFIRMAÇÃO DE DRIFT (anti-flake): com drift no run REAL, refaz o
  // run UMA vez. Se a 2ª run não reproduz o drift, é flakiness (poluição
  // entre arquivos — medido ±1 teste em 08/2026), não regressão — passa
  // com aviso. Só drift REPRODUZIDO falha. Fixtures (--results-file) não
  // são re-rodados (o caller controla o fixture — mutation tests/unit).
  if (violations.length > 0 && !resultsFile) {
    const second = collectFailures(cwd, null)
    const secondDrift = findDrift(second, baseline.files ?? {})
    if (secondDrift.violations.length === 0) {
      // Flakiness (poluição entre arquivos) — PASS com aviso. O --json não
      // pode sair SEM relatório: emite o shape mínimo (driftReproduced:
      // false) para o caller estruturado não receber stdout vazio.
      if (json) {
        console.log(
          JSON.stringify(
            {
              total: currentTotal,
              baselineTotal: baseline.count,
              driftReproduced: false,
              note: "drift na 1ª run não reproduzido na 2ª — flakiness, não regressão",
            },
            null,
            2,
          ),
        )
      } else {
        console.error(
          `⚠️  Drift detectado na 1ª run (${currentTotal} falha(s)) mas NÃO reproduzido` +
            ` na 2ª (${Object.values(second).reduce((a, b) => a + b, 0)}) — flakiness de` +
            ` poluição entre arquivos, não regressão. PASS com aviso.`,
        )
      }
      process.exit(0)
    }
    // drift reproduzido → usa a 2ª run para o relatório (mais recente)
    failedFiles = second
    ;({ violations, improved } = secondDrift)
  }

  // Recalcula o total do run que vale para o relatório (1ª ou 2ª, pós-retry)
  const reportedTotal = Object.values(failedFiles).reduce((a, b) => a + b, 0)

  if (json) {
    console.log(
      JSON.stringify(
        {
          total: reportedTotal,
          baselineTotal: baseline.count,
          files: failedFiles,
          violations,
          improved,
        },
        null,
        2,
      ),
    )
    process.exit(violations.length > 0 ? 1 : 0)
  }

  if (violations.length === 0) {
    console.log(
      `✅ check-jsdom-baseline: ${reportedTotal} falha(s) jsdom — nenhum drift para cima` +
        ` (baseline ${baseline.count}, ${baseline.updatedAt}).`,
    )
    if (improved.length > 0) {
      console.log(`   Melhorias (count caiu — passe --update para re-baselinear):`)
      for (const i of improved) console.log(`     • ${i}`)
    }
    process.exit(0)
  }

  console.error(
    `🔻 check-jsdom-baseline: DRIFT PARA CIMA na suíte jsdom de componentes` +
      ` (baseline ${baseline.count} → atual ${reportedTotal}):\n`,
  )
  for (const v of violations) {
    if (v.kind === "novo") {
      console.error(`   • NOVO arquivo falhando: ${v.file} (${v.current} teste(s))`)
    } else {
      console.error(`   • Crescimento: ${v.file} (${v.baseline} → ${v.current})`)
    }
  }
  if (improved.length > 0) {
    console.error(`\nℹ️  Melhorias no mesmo run (não falham): ${improved.join(", ")}`)
  }
  console.error(
    `\n⚠️  A suíte jsdom (src/components, vitest.config.ts) NÃO roda no test:unit` +
      `\n   do CI — este gate existe para o drift não passar despercebido.` +
      `\n   • Curado um arquivo? Atualize o baseline: node scripts/check-jsdom-baseline.mjs --update` +
      `\n   • Falha nova legítima (mudança INTENCIONAL)? Corrija o teste OU revise o` +
      `\n     baseline via --update — nunca re-baselineie para esconder drift.`,
  )
  process.exit(1)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o run.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
