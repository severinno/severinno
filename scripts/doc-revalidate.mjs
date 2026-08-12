#!/usr/bin/env node
/**
 * doc-revalidate.mjs - gera a linha de re-validacao datada das secoes 8.x de
 * controle (o padrao da sec 8.34, Prova 39) num comando: o ciclo manual
 * (rodar o CLI + a suite + editar a doc) vira 1 invocacao.
 *
 * O ciclo que este helper automatiza (a re-validacao 2026-08-11 da 8.34):
 *   1. CLI real do scan-exit-claims (--check) com EXIT_CLAIMS_DOC apontando
 *      o --doc; captura o count verbatim do stdout (ex.: `clean (28 claims
 *      registradas em ...)`).
 *   2. Suite hermetica do par (scan-exit-claims.test.ts, as MUTATIONs da
 *      sec 11.42/11.55) - o verde; --no-suite pula (caminho rapido).
 *   3. Upsert datado da linha gerada na secao alvo (idempotente por data:
 *      re-run do MESMO dia = REPLACE, nunca duplicata; datas diferentes
 *      coexistem; a linha manual '**Re-valida\u00e7\u00e3o datada (' nunca
 *      e tocada - o marcador automatico nao tem o 'datada').
 *
 * A linha gerada e montada do template UTF-8 scripts/doc-revalidate-line.txt
 * (fora do gate ASCII dos scripts/*.mjs - MJS_GATE_PATTERNS) e cita o
 * codigo de saida 0: ela SO e segura em secoes 8.x, onde o detector do
 * scan-exit-claims e 11.x-only por escopo (sec 11.51). Por isso o
 * --section e RESTRITO a 8.x - apontar para uma secao 11.x criaria uma
 * claim nao-registrada de proposito; o guard falha no usage antes de
 * tocar a doc.
 *
 * USO (bash/git-bash, como o hook-proof-run):
 *   node scripts/doc-revalidate.mjs [--doc <path>] [--section 8.34]
 *     [--date YYYY-MM-DD] [--dry-run] [--no-suite]
 *   node scripts/doc-revalidate.mjs --sweep [--doc <path>]
 *   --dry-run: valida tudo (CLI + suite) e so IMPRIME a linha (nada escrito).
 *   --no-suite: pula a suite (so o CLI) - o caminho rapido do dry-run.
 *   --date YYYY-MM-DD (default: hoje, data LOCAL - o UTC rolaria 1 dia e
 *     quebraria a convencao de datas locais das secoes 8.x, sec 11.61).
 *   --sweep: a VARREDURA read-only das secoes 8.x que precisam de
 *     re-validacao (sec 11.68) - roda as 3 dimensoes reais do contrato de
 *     counts (11.62 checkCitedCounts, 11.66 checkRevalCurrent, 11.67
 *     checkDigestCounts) e imprime a lista com a CURE por secao, o padrao
 *     --check dos guards (exit 0 limpo / exit 1 com a lista). Nada escrito.
 *     NAO combina com --section/--date/--dry-run/--no-suite (a varredura
 *     cobre TODAS as secoes - fail-loud no usage).
 *
 * HERMETICIDADE (testes): os comandos spawnados sao via shell com override
 * por env, o mesmo seam do HOOK_PROOF_GIT do hook-proof-run:
 *   DOC_REVALIDATE_CLI_CMD    default: node scripts/scan-exit-claims.mjs --check
 *   DOC_REVALIDATE_SUITE_CMD  default: npx vitest run
 *     scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts
 *     (NO_COLOR via env no spawn - nunca prefixo shell: o `NO_COLOR=1 cmd`
 *     POSIX quebra no cmd.exe, ACHADO da Prova 42)
 * O doc validado e SEMPRE o --doc (passado ao CLI via EXIT_CLAIMS_DOC).
 * Puro node, sem deps, ASCII puro (MJS_GATE_PATTERNS = scripts/*.mjs).
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { EXIT_CLAIMS, checkCitedCounts, checkDigestCounts, checkRevalCurrent } from "./scan-exit-claims.mjs"

const DEFAULT_DOC = path.join(process.cwd(), "docs", "gates-proofs.md")
const DEFAULT_SECTION = "8.34"
// Exported (o pin do Windows, sec 8.37): o teste de forma pina que NENHUM
// default de comando spawnado tem prefixo de env shell (`VAR=valor cmd` -
// a classe que o cmd.exe rejeita, ACHADO da Prova 42).
export const DEFAULT_CLI_CMD = "node scripts/scan-exit-claims.mjs --check"
export const DEFAULT_SUITE_CMD =
  "bunx vitest run scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts"
const SUITE_TOTAL_RE = /Tests\s+(\d+)\s+passed/
// O marcador da entrada AUTOMATICA: '**Re-valida\u00e7\u00e3o (DATE,' - sem o
// 'datada' da linha manual (que nunca colide com a idempotencia por data).
const MARKER_PREFIX = "**Re-valida\u00e7\u00e3o ("

const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "doc-revalidate-line.txt")
const USAGE =
  "usage: node scripts/doc-revalidate.mjs [--doc <path>] [--section 8.34] [--date YYYY-MM-DD] [--dry-run] [--no-suite] | --sweep"

/**
 * parseCliCount - extrai count + breakdown do stdout clean do CLI.
 * O breakdown e o texto apos 'claims' DENTRO do parenteses, verbatim
 * (ex.: ' registradas em 25 current + 1 superseded + 2 measurement - sec
 * 11.42', com o espaco inicial). Retorna { count, breakdown } | null.
 */
export function parseCliCount(stdout) {
  const m = stdout.match(/clean \(([^)]+)\)/)
  if (!m) return null
  const cm = m[1].match(/^(\d+) claims(.*)$/)
  if (!cm) return null
  return { count: Number(cm[1]), breakdown: cm[2] }
}

/**
 * buildRevalidateLine - monta a linha datada do template UTF-8 do disco.
 * suiteTotal null (--no-suite) omite a clausula da suite (o SUITE_CLAUSE
 * fica vazio - nunca 'null/null verde').
 */
export function buildRevalidateLine(template, { date, count, breakdown, suiteTotal }) {
  const quote = `clean (${count} claims${breakdown ?? ""})`
  const suiteClause =
    suiteTotal == null
      ? ""
      : ` + a suite herm\u00e9tica do par (scan-exit-claims.test.ts, as MUTATIONs da sec 11.42/11.55) ${suiteTotal}/${suiteTotal} verde`
  return template
    .replaceAll("{{DATE}}", date)
    .replaceAll("{{COUNT}}", String(count))
    .replaceAll("{{QUOTE}}", quote)
    .replaceAll("{{SUITE_CLAUSE}}", suiteClause)
}

/**
 * upsertRevalidateLine - insere/atualiza a entrada automatica datada na
 * secao alvo. Idempotente por data: se uma entrada automatica do MESMO dia
 * ja existe, REPLACE (a ultima fisica); senao, append no FIM do conteudo da
 * secao (antes dos blanks finais / do proximo header - nunca no meio de um
 * paragrafo). A linha manual 'datada' nunca colide (prefixo diferente).
 * CRLF preservado. Lanca se a secao nao existir no doc.
 */
export function upsertRevalidateLine(doc, section, date, line) {
  const eol = doc.includes("\r\n") ? "\r\n" : "\n"
  const lines = doc.split(/\r?\n/)
  const header = `## ${section} `
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(header)) {
      start = i
      break
    }
  }
  if (start === -1) {
    throw new Error(`upsertRevalidateLine: secao '${header}' nao encontrada no doc`)
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i
      break
    }
  }
  const marker = new RegExp(`^${MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${date}, `)
  for (let i = end - 1; i >= start; i--) {
    if (marker.test(lines[i])) {
      lines[i] = line
      return lines.join(eol)
    }
  }
  let insertAt = end
  while (insertAt > start && lines[insertAt - 1].trim() === "") insertAt--
  // A linha de re-validacao precisa iniciar NOVO PARAGRAFO: o scanCitedCounts
  // da sec 11.62 detecta hasReval pelo PRIMEIRO token do paragrafo
  // (REVAL_MARKER_RE). Se a ultima linha de conteudo da secao NAO for vazia
  // (o conteudo abuta o proximo header, sem blank final - o ACHADO da sec
  // 11.93, 8.36/8.37), insere um blank separador ANTES da linha: a versao
  // antiga fundia a linha ao paragrafo anterior e o proprio contrato a
  // rejeitava (o CURE gerava linha que o contrato nao reconhecia; corrigido
  // manualmente na doc). Quando a secao ja termina em blank, o walk-back
  // acima o deixa como separador (o mesmo layout de antes).
  if (insertAt > start && lines[insertAt - 1].trim() !== "") {
    lines.splice(insertAt, 0, "")
    insertAt++
  }
  lines.splice(insertAt, 0, line)
  return lines.join(eol)
}

export function parseArgs(argv) {
  const out = {
    doc: DEFAULT_DOC,
    section: DEFAULT_SECTION,
    date: null,
    dryRun: false,
    noSuite: false,
    sweep: false,
    error: null,
  }
  const seen = new Set()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--doc") {
      out.doc = argv[i + 1] ?? null
      i++
    } else if (a === "--section") {
      out.section = argv[i + 1] ?? null
      i++
    } else if (a === "--date") {
      out.date = argv[i + 1] ?? null
      i++
    } else if (a === "--dry-run") out.dryRun = true
    else if (a === "--no-suite") out.noSuite = true
    else if (a === "--sweep") out.sweep = true
    else if (a === "--help") {
      out.error = USAGE
      break
    } else {
      out.error = `flag desconhecida: ${a}`
      break
    }
    seen.add(a)
  }
  if (out.sweep) {
    for (const f of ["--section", "--date", "--dry-run", "--no-suite"]) {
      if (seen.has(f)) {
        out.error = `--sweep nao combina com ${f} (a varredura cobre TODAS as secoes 8.x - sec 11.68)`
        break
      }
    }
  }
  if (!out.date) out.date = todayLocal()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) out.error = `--date deve ser YYYY-MM-DD: ${out.date}`
  return out
}

/** A data LOCAL de hoje (YYYY-MM-DD) - nao UTC: a linha tem que casar com
 * a convencao de datas locais das secoes 8.x (o nit do reviewer, sec 11.61). */
function todayLocal() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function runCmd(cmd, extraEnv) {
  return spawnSync(cmd, {
    shell: true,
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
  })
}

function fail(code, msg) {
  console.error(`doc-revalidate: ${msg}`)
  return code
}

/**
 * sweepMain - a varredura read-only da sec 11.68: roda as 3 dimensoes
 * REAIS do contrato de counts (11.62 checkCitedCounts, 11.66
 * checkRevalCurrent, 11.67 checkDigestCounts) contra o doc (o --doc ou o
 * default) e imprime a lista das secoes que precisam de re-validacao com
 * a CURE por secao - o padrao --check dos guards. Exit 0 = limpo
 * (nenhuma secao precisa); Exit 1 = violacoes listadas. Nada escrito.
 */
function sweepMain(docPath) {
  const cited = checkCitedCounts(docPath)
  const reval = checkRevalCurrent(docPath)
  const digest = checkDigestCounts(docPath)
  const lines = []
  for (const s of cited) {
    lines.push(
      `  secao ${s.section} sem re-validacao datada citando ${JSON.stringify(s.counts)}: node scripts/doc-revalidate.mjs --section ${s.section} (sec 11.62)`,
    )
  }
  for (const s of reval) {
    lines.push(
      `  secao ${s.section} com reval citando ${JSON.stringify(s.counts)} e o EXIT_CLAIMS em ${EXIT_CLAIMS.length}: node scripts/doc-revalidate.mjs --section ${s.section} (sec 11.66)`,
    )
  }
  for (const d of digest) {
    if (d.section) {
      lines.push(
        `  row ${d.row} da tabela citando ${JSON.stringify(d.counts)} com origem ${d.section} descoberta: node scripts/doc-revalidate.mjs --section ${d.section} (sec 11.67)`,
      )
    } else {
      lines.push(
        `  row ${d.row} da tabela citando ${JSON.stringify(d.counts)} SEM referencia de secao de origem: adicione a referencia sec 8.N na row (sec 11.67)`,
      )
    }
  }
  if (lines.length === 0) {
    console.log(`doc-revalidate --sweep: clean (nenhuma secao 8.x precisa de re-validacao - sec 11.68)`)
    return 0
  }
  console.log(`doc-revalidate --sweep: ${lines.length} violacao(oes) de re-validacao em ${docPath} (sec 11.68):`)
  for (const l of lines) console.log(l)
  return 1
}

/**
 * Main flow. Retorna o exit code (o entry-point guard seta process.exitCode).
 * Exit 2 = usage (flag desconhecida / --section fora de 8.x / --date invalido /
 * --sweep mal-combinado). Exit 1 = falha de execucao (CLI ou suite nao verdes /
 * doc ausente / count nao-parseado) ou --sweep com violacoes. Exit 0 = linha
 * upsertada (ou dry-run impressa) ou --sweep limpo.
 */
export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  if (opts.error) return fail(2, opts.error)
  const docPath = path.resolve(opts.doc)
  if (!fs.existsSync(docPath)) return fail(1, `doc nao encontrado: ${docPath}`)
  // Sec 11.68 - a varredura (--sweep): read-only, sem CLI/suite/upsert.
  if (opts.sweep) return sweepMain(docPath)
  if (!/^8\.\d+$/.test(opts.section)) {
    return fail(
      2,
      `--section deve ser 8.x (a linha gerada cita o codigo de saida 0 e so e segura em secoes 8.x - a fronteira do detector 11.x-only da sec 11.51): recebido '${opts.section}'`,
    )
  }

  // 1. CLI real do scan-exit-claims (valida o MESMO doc do --doc).
  const cliCmd = process.env.DOC_REVALIDATE_CLI_CMD || DEFAULT_CLI_CMD
  const cli = runCmd(cliCmd, { EXIT_CLAIMS_DOC: docPath })
  if (cli.status !== 0) {
    return fail(1, `CLI do scan-exit-claims falhou (status ${cli.status}): ${(cli.stderr || "").trim()}`)
  }
  const parsed = parseCliCount(cli.stdout || "")
  if (!parsed) {
    return fail(1, `nao parseou o count do CLI: ${(cli.stdout || "").trim().split("\n").pop()}`)
  }

  // 2. Suite hermetica do par (--no-suite pula).
  let suiteTotal = null
  if (!opts.noSuite) {
    const suiteCmd = process.env.DOC_REVALIDATE_SUITE_CMD || DEFAULT_SUITE_CMD
    // NO_COLOR vai no ENV (extraEnv), nao no prefixo shell: o default
    // POSIX `NO_COLOR=1 cmd` quebra no cmd.exe (ACHADO da Prova 42 - o
    // caminho real da suite nunca tinha sido exercitado; os E2Es usam
    // fakes e o REAL-REPO CONTRACT roda --no-suite).
    const suite = runCmd(suiteCmd, { NO_COLOR: "1" })
    if (suite.status !== 0) {
      return fail(1, `suite hermetica falhou (status ${suite.status}): ${(suite.stderr || "").slice(-500)}`)
    }
    const m = (suite.stdout || "").match(SUITE_TOTAL_RE)
    if (!m) {
      return fail(1, `nao parseou o total da suite: ${(suite.stdout || "").trim().split("\n").pop()}`)
    }
    suiteTotal = Number(m[1])
  }

  // 3. Linha + upsert datado (dry-run so imprime).
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8").trim()
  const line = buildRevalidateLine(template, {
    date: opts.date,
    count: parsed.count,
    breakdown: parsed.breakdown,
    suiteTotal,
  })
  const doc = fs.readFileSync(docPath, "utf8")
  if (opts.dryRun) {
    console.log(`doc-revalidate (dry-run): secao ${opts.section} de ${docPath}`)
    console.log(line)
    return 0
  }
  const next = upsertRevalidateLine(doc, opts.section, opts.date, line)
  fs.writeFileSync(docPath, next, "utf8")
  console.log(`doc-revalidate: linha ${opts.date} (${parsed.count} claims) upsertada em '## ${opts.section} ' de ${docPath}`)
  console.log(line)
  return 0
}

// Entry-point guard: so roda o CLI quando executado direto (vitest importa
// as funcoes puras para os testes sem efeitos colaterais - o padrao da
// sec 11.37).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
