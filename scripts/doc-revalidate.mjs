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
 *   --dry-run: valida tudo (CLI + suite) e so IMPRIME a linha (nada escrito).
 *   --no-suite: pula a suite (so o CLI) - o caminho rapido do dry-run.
 *   --date YYYY-MM-DD (default: hoje, data LOCAL - o UTC rolaria 1 dia e
 *     quebraria a convencao de datas locais das secoes 8.x, sec 11.61).
 *
 * HERMETICIDADE (testes): os comandos spawnados sao via shell com override
 * por env, o mesmo seam do HOOK_PROOF_GIT do hook-proof-run:
 *   DOC_REVALIDATE_CLI_CMD    default: node scripts/scan-exit-claims.mjs --check
 *   DOC_REVALIDATE_SUITE_CMD  default: NO_COLOR=1 npx vitest run
 *     scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts
 * O doc validado e SEMPRE o --doc (passado ao CLI via EXIT_CLAIMS_DOC).
 * Puro node, sem deps, ASCII puro (MJS_GATE_PATTERNS = scripts/*.mjs).
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const DEFAULT_DOC = path.join(process.cwd(), "docs", "gates-proofs.md")
const DEFAULT_SECTION = "8.34"
const DEFAULT_CLI_CMD = "node scripts/scan-exit-claims.mjs --check"
const DEFAULT_SUITE_CMD =
  "NO_COLOR=1 npx vitest run scripts/__tests__/scan-exit-claims.test.ts --config vitest.config.unit.ts"
const SUITE_TOTAL_RE = /Tests\s+(\d+)\s+passed/
// O marcador da entrada AUTOMATICA: '**Re-valida\u00e7\u00e3o (DATE,' - sem o
// 'datada' da linha manual (que nunca colide com a idempotencia por data).
const MARKER_PREFIX = "**Re-valida\u00e7\u00e3o ("

const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "doc-revalidate-line.txt")
const USAGE = "usage: node scripts/doc-revalidate.mjs [--doc <path>] [--section 8.34] [--date YYYY-MM-DD] [--dry-run] [--no-suite]"

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
    error: null,
  }
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
    else if (a === "--help") {
      out.error = USAGE
      break
    } else {
      out.error = `flag desconhecida: ${a}`
      break
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
 * Main flow. Retorna o exit code (o entry-point guard seta process.exitCode).
 * Exit 2 = usage (flag desconhecida / --section fora de 8.x / --date invalido).
 * Exit 1 = falha de execucao (CLI ou suite nao verdes / doc ausente / count
 * nao-parseado). Exit 0 = linha upsertada (ou dry-run impressa).
 */
export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  if (opts.error) return fail(2, opts.error)
  if (!/^8\.\d+$/.test(opts.section)) {
    return fail(
      2,
      `--section deve ser 8.x (a linha gerada cita o codigo de saida 0 e so e segura em secoes 8.x - a fronteira do detector 11.x-only da sec 11.51): recebido '${opts.section}'`,
    )
  }
  const docPath = path.resolve(opts.doc)
  if (!fs.existsSync(docPath)) return fail(1, `doc nao encontrado: ${docPath}`)

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
    const suite = runCmd(suiteCmd, {})
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
