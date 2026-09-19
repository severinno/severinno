#!/usr/bin/env node
// =============================================================================
// check-mutation-count.mjs — Guard do Nº de sub-tests do mutation-guards
// =============================================================================
//
// Usage:
//   node scripts/check-mutation-count.mjs            # repo atual (default)
//   node scripts/check-mutation-count.mjs --root X   # fixture (testes/mutation)
//   node scripts/check-mutation-count.mjs --json     # output JSON estruturado
//
// Exit codes:
//   0 — o nº derivado da matriz bate com todas as refs (pass)
//   1 — drift: alguma ref diverge do nº derivado (fail — mensagem com o par)
//   2 — infra: arquivo ausente/ilegível (fail-closed)
//
// POR QUE: o nº de sub-tests da matriz `scripts/test-mutation-guards.sh`
// (array SUBTESTS) é derivável e aparece em VÁRIOS lugares — o summary do job
// `mutation-guards` no pr-check.yml, o header do próprio master e 4 refs no
// README (tabelas de overhead). Cada bump de sub-test exigia atualizar TODOS
// manualmente — e o drift aconteceu de verdade (12→13 em 08/2026, corrigido à
// mão). Este guard deriva N do SUBTESTS e falha (exit 1) se QUALQUER ref viva
// divergir — o drift de counts vira erro de CI, não tarefa manual.
//
// O `name:` DO JOB É PROIBIDO DE CARREGAR O COUNT (e isso é metade do guard).
// O nome de um job é o CONTEXTO do status check na forja, e o branch protection
// exige esse contexto (`ci/required-checks.json`, aplicado por
// scripts/apply-required-checks.mjs). Enquanto o nome dizia
// "Mutation guards master (N node-pure mutation tests)", CADA bump da matriz
// reescrevia o contexto protegido: a proteção aplicada na forja passava a
// exigir um check que já não existe e o PR travava — um sub-test novo virava
// mudança de contrato de merge. O count é DIAGNÓSTICO e vive onde não é
// contrato: summary, comentário, header do master e README. Aqui o guard
// exige o nome EXATO e sem número.
//
// O QUE é derivado:
//   N = nº de entradas do array SUBTESTS=( ... ) no test-mutation-guards.sh
//       (cada linha "id|descrição|script" = 1 sub-test; linhas de comentário
//       dentro do array são ignoradas).
//
// O QUE é validado (refs VIVAS — devem usar EXATAMENTE N, salvo o name):
//   1. pr-check.yml:
//      - name do job mutation-guards: "Mutation guards master" EXATO e SEM
//        número (o CONTEXTO do required check não pode depender do tamanho da
//        matriz; um count de volta = exit 1 apontando o acoplamento)
//      - summary: "All N node-pure mutation tests passed"
//      - comentário do job: "Roda os N mutation tests node-puro"
//   2. test-mutation-guards.sh (header): "Roda os N mutation tests node-puro"
//   3. README.md — TODA ocorrência de "<M> sub-tests" e "<M> sub-tests
//      node-puro" deve ter M == N, EXCETO refs HISTÓRICAS (linhas com
//      marcador de passado: "era de", "após a medição", "foi adicionado
//      após" — ex.: a nota de overhead cita "era de 5 sub-tests... depois
//      de 10" como histórico da medição, não como count atual).
//
// --json: { ok, derivedCount, refs: { prCheck: [...], masterHeader, readme:
// [...] }, violations: [...] } — exit 0 mesmo com violações (modo report).
//
// CONTRATO DE FRASE: o guard exige a string EXATA "Roda os N mutation tests
// node-puro" no header do master E no comentário do job do pr-check.yml —
// renomear a frase (sem mudar o count) falha de propósito: é o texto que o
// guard ancora. Edite os DOIS juntos se precisar reformular.
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

// ── Helpers ────────────────────────────────────────────────────────────────

function readOrDie(root, rel) {
  const p = join(root, rel)
  if (!existsSync(p)) {
    const err = new Error(`arquivo ausente: ${rel}`)
    err.code = "INFRA"
    throw err
  }
  return readFileSync(p, "utf8")
}

/** Deriva N do array SUBTESTS do master. Retorna { count, ids }. */
function deriveSubtestCount(masterSrc) {
  const start = masterSrc.indexOf("SUBTESTS=(")
  if (start === -1) {
    const err = new Error("array SUBTESTS=( não encontrado no master")
    err.code = "INFRA"
    throw err
  }
  const block = masterSrc.slice(start)
  const end = block.indexOf("\n)")
  const arrayBody = block.slice("SUBTESTS=(".length, end)

  const ids = []
  for (const rawLine of arrayBody.split("\n")) {
    const m = rawLine.match(/^\s*"([^"|]+)\|/)
    if (m) ids.push(m[1].trim())
  }
  return { count: ids.length, ids }
}

/** True se a linha tem marcador de contexto HISTÓRICO (não é count atual). */
function isHistoricalLine(line) {
  return /era de\b|após a medição|foi adicionado após|medição de \d/.test(line)
}

/** Coleta refs vivas de count num texto: { lineNo, match, historical }[] */
function collectCountRefs(text, patterns) {
  const refs = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const pat of patterns) {
      const re = new RegExp(pat, "g")
      let m
      while ((m = re.exec(line)) !== null) {
        refs.push({
          lineNo: i + 1,
          number: Number(m[1]),
          match: m[0],
          historical: isHistoricalLine(line),
        })
      }
    }
  }
  return refs
}

// ── Guard principal ────────────────────────────────────────────────────────

export function run(root) {
  const masterPath = "scripts/test-mutation-guards.sh"
  const workflowPath = ".github/workflows/pr-check.yml"
  const readmePath = "README.md"

  const masterSrc = readOrDie(root, masterPath)
  const workflowSrc = readOrDie(root, workflowPath)
  const readmeSrc = readOrDie(root, readmePath)

  const { count: N } = deriveSubtestCount(masterSrc)

  const violations = []

  // 1. pr-check.yml — o NAME do job mutation-guards é o CONTEXTO do required
  //    check: tem de ser estável e COUNT-FREE.
  const contextName = "Mutation guards master"
  const nameMatch = /(?:^|\n)[ \t]*name:[ \t]*Mutation guards master([^\n]*)/.exec(workflowSrc)
  if (!nameMatch) {
    violations.push(
      `pr-check.yml: name do job 'mutation-guards' não é '${contextName}' — o CONTEXTO do required check mudou (aplique a proteção de novo: scripts/apply-required-checks.mjs) ou o job sumiu`,
    )
  } else {
    const sufixo = nameMatch[1].trim()
    if (sufixo !== "") {
      // Um número (ou qualquer sufixo) aqui re-acopla o tamanho da matriz ao
      // contrato de merge: o contexto protegido passa a mudar a cada bump.
      violations.push(
        `pr-check.yml: name do job 'mutation-guards' tem sufixo '${sufixo}' além de '${contextName}' — o CONTEXTO do required check é derivado do workflow; um count aqui faz o branch protection da forja apontar para um check inexistente a cada bump de matriz. O count vai no summary/comentário/header/README.`,
      )
    }
  }
  // summary do job
  const summaryRe = new RegExp(`All ${N} node-pure mutation tests passed`)
  if (!summaryRe.test(workflowSrc)) {
    violations.push(
      `pr-check.yml: summary do job não usa 'All ${N} node-pure mutation tests passed'`,
    )
  }
  // comentário do job
  const commentRe = new RegExp(`Roda os ${N} mutation tests node-puro`)
  if (!commentRe.test(workflowSrc)) {
    violations.push(
      `pr-check.yml: comentário do job não usa 'Roda os ${N} mutation tests node-puro'`,
    )
  }

  // 2. master (header) — "Roda os N mutation tests node-puro"
  if (!new RegExp(`Roda os ${N} mutation tests node-puro`).test(masterSrc)) {
    violations.push(
      `test-mutation-guards.sh: header não usa 'Roda os ${N} mutation tests node-puro'`,
    )
  }

  // 3. README.md — toda ocorrência viva deve ter M == N
  // Um padrão ÚNICO (sub-tests com opcional node-puro) evita ref duplicada por linha.
  const readmeRefs = collectCountRefs(readmeSrc, ["(\\d+) sub-tests( node-puro)?"])
  for (const ref of readmeRefs) {
    if (ref.number !== N && !ref.historical) {
      violations.push(`README.md:${ref.lineNo}: '${ref.match}' ≠ ${N} (ref viva divergente)`)
    }
  }
  // O README deve ter PELO MENOS uma ref viva com o count atual (prova que a
  // doc acompanha — sem nenhuma, o count sumiu da doc).
  if (!readmeRefs.some((r) => r.number === N && !r.historical)) {
    violations.push(`README.md: nenhuma ref viva com '${N} sub-tests' (a doc perdeu o count)`)
  }

  return {
    ok: violations.length === 0,
    derivedCount: N,
    refs: {
      prCheck: {
        context: contextName,
        summary: `All ${N} node-pure mutation tests passed`,
      },
      masterHeader: `Roda os ${N} mutation tests node-puro`,
      readmeLive: readmeRefs.filter((r) => !r.historical),
      readmeHistorical: readmeRefs.filter((r) => r.historical),
    },
    violations,
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2)
  let root = process.cwd()
  let json = false

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      root = resolve(argv[++i])
    } else if (argv[i] === "--json") {
      json = true
    } else {
      console.error(`flag desconhecida: ${argv[i]} (use --root X | --json)`)
      process.exit(2)
    }
  }

  let result
  try {
    result = run(root)
  } catch (e) {
    console.error(`❌ check-mutation-count: ${e.message}`)
    process.exit(2)
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  }

  if (result.ok) {
    console.log(
      `✅ check-mutation-count: ${result.derivedCount} sub-tests da matriz — pr-check.yml, master e README consistentes.`,
    )
    process.exit(0)
  }

  console.error(
    `❌ check-mutation-count: drift de count (derivado=${result.derivedCount}) — refs divergentes:`,
  )
  for (const v of result.violations) console.error(`   - ${v}`)
  process.exit(1)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
