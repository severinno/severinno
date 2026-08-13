#!/usr/bin/env node
/**
 * proof-register.mjs - o registro de prova LOCAL num comando (2026-08-12,
 * sec 11.94 do gates-proofs.md). O espelho do doc-revalidate para o
 * PROOF_CLASSES: o ciclo manual de registrar uma Prova (editar o manifest +
 * o snapshot + a doc em 3+ edits) vira 1 invocacao.
 *
 * WHY: o registro de prova local foi repetido 7+ vezes na thread (Provas
 * 40, 41, 43, 44, 46, 47, 48 - todas run null, sec 8.x) e cada um exigiu
 * 3+ edits (o PROOF_CLASSES, o ABS_PIN_SNAPSHOT, os counts 48/19, a row da
 * tabela ## 1, a sec 8.x). A Prova 48 provou a classe: os 2 count pins do
 * teste (DOC COVERAGE sanity + REAL-REPO CONTRACT) foram esquecidos no
 * registro e so a validacao pegou. Este helper automatiza o ciclo; as
 * partes MECANICAS (a entrada do manifest, a linha do snapshot, os bumps
 * de count, a row da tabela, o skeleton da sec 8.x) sao geradas - a
 * NARRATIVA (O pedido / O veredito / A execucao / A fronteira honesta da
 * sec 8.x) fica manual, o helper scaffol-da o skeleton com placeholders
 * (a MESMA fronteira do doc-revalidate: a linha gerada, a prosa manual).
 *
 * O CONTRATO (o que o teste pina):
 *   - funcoes puras (buildManifestEntry, buildSnapshotLine, bumpCounts,
 *     buildTableRow, buildSection) com conteudo sintetico.
 *   - o template UTF-8 do disco (o pin dos placeholders, o mesmo padrao
 *     do doc-revalidate-line.txt).
 *   - o ciclo E2E com bins falsos (PROOF_REGISTER_SUITE_CMD -> fake no
 *     temp dir, o seam do DOC_REVALIDATE_SUITE_CMD).
 *   - o REAL-REPO CONTRACT do --dry-run --no-suite (o count atual pinado,
 *     nada escrito).
 *
 * USO (bash/git-bash):
 *   node scripts/proof-register.mjs --class hook-proof-run --prova 49
 *     --section 8.44 --what "..." [--run <run>] [--date YYYY-MM-DD]
 *     [--dry-run] [--no-suite]
 *   --class <id>: a classe do PROOF_CLASSES (obrigatorio, precisa existir).
 *     CLASSE NOVA (a 1a prova da classe): o helper nao cria classe - o
 *     gate verde bloqueia a classe vazia (o SHAPE proofs.length>0) e o
 *     bumpCounts so cobre counts de PROVAS, nao de CLASSES. O recipe da
 *     casa (Provas 59 e 60, 2026-08-13): (1) adicionar o skeleton da classe
 *     no manifest no formato MULTI-LINHA (proofs: [ ] nas proprias linhas -
 *     o insertManifestEntry procura a linha '],' isolada), (2) rodar este
 *     helper com --no-suite (o scaffold da entry + snapshot + sec 8.x + os
 *     bumps de provas), (3) bump manual dos 3 pins de classe no teste
 *     (toBe(N) x2 + toContain('N classes')).
 *   --prova N: o numero da Prova nova (obrigatorio, nao pode ja existir na
 *     classe).
 *   --section 8.N: a secao da Prova no doc (obrigatorio, 8.x - a fronteira
 *     da sec 11.51).
 *   --what "...": a descricao curta (obrigatorio, ASCII - vai para o
 *     manifest .mjs que e ASCII-gated; a prosa acentuada fica na narrativa
 *     manual da sec 8.x).
 *   --run <run>: o run do CI (default null = prova local, snapshot 'local').
 *   --date YYYY-MM-DD (default: hoje, data LOCAL - a convencao das sec 8.x).
 *   --dry-run: gera tudo, valida o gate, IMPRIME os 4 pieces (nada escrito).
 *   --no-suite: pula o gate da suite (so o scaffold).
 *
 * HERMETICIDADE (testes): os 3 arquivos editados + a suite sao seams por
 * env (o mesmo padrao do PROOFS_DOC/DOC_REVALIDATE_CLI_CMD):
 *   PROOF_REGISTER_MANIFEST  default: scripts/proofs-manifest.mjs
 *   PROOF_REGISTER_TEST      default: scripts/__tests__/proofs-manifest.test.ts
 *   PROOF_REGISTER_DOC       default: docs/gates-proofs.md
 *   PROOF_REGISTER_SUITE_CMD default: npx vitest run
 *     scripts/__tests__/proofs-manifest.test.ts --config vitest.config.unit.ts
 *     (NO_COLOR via env no spawn - nunca prefixo shell, o ACHADO da Prova 42)
 * Puro node, sem deps, ASCII puro (MJS_GATE_PATTERNS = scripts/*.mjs).
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const DEFAULT_MANIFEST = path.join(process.cwd(), "scripts", "proofs-manifest.mjs")
const DEFAULT_TEST = path.join(process.cwd(), "scripts", "__tests__", "proofs-manifest.test.ts")
const DEFAULT_DOC = path.join(process.cwd(), "docs", "gates-proofs.md")
// bunx e a convencao bun do repo (o scan-surfaces Type F pina que NENHUM
// surface invoca npm/npx - o run-all-fuzz.mjs usa bunx, sec 8.x).
export const DEFAULT_SUITE_CMD =
  "bunx vitest run scripts/__tests__/proofs-manifest.test.ts --config vitest.config.unit.ts"
const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "proof-register-section.txt")
const USAGE =
  "usage: node scripts/proof-register.mjs --class <id> --prova N --section 8.N --what \"...\" [--run <run>] [--date YYYY-MM-DD] [--dry-run] [--no-suite]"

/** Os placeholders do template UTF-8 (o pin do teste). */
const PLACEHOLDERS = ["{{SECTION}}", "{{PROVA}}", "{{WHAT}}", "{{DATE}}", "{{CLASS}}", "{{RUN_CLAUSE}}"]

/** O token verbatim do count no TESTE: o sanity `// sanity: 19 classes / N
 * provas registradas` do ABS PIN suite (a fonte DERIVADA - o numero pinado
 * que o CLI espelha). O manifest em si NAO tem o numero: o template do CLI
 * usa ${total} (`clean (... ${total} provas registradas ...)`).
 */
const COUNT_TOKEN_RE = /(\d+) provas registradas/

/**
 * parseArgs - os flags do registro. { class, prova, section, what, run,
 * date, dryRun, noSuite, error } - error preenche no usage invalido.
 */
export function parseArgs(argv) {
  const out = { class: null, prova: null, section: null, what: null, run: null, date: null, dryRun: false, noSuite: false, error: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--class") out.class = argv[i + 1] ?? null, i++
    else if (a === "--prova") out.prova = argv[i + 1] ?? null, i++
    else if (a === "--section") out.section = argv[i + 1] ?? null, i++
    else if (a === "--what") out.what = argv[i + 1] ?? null, i++
    else if (a === "--run") out.run = argv[i + 1] ?? null, i++
    else if (a === "--date") out.date = argv[i + 1] ?? null, i++
    else if (a === "--dry-run") out.dryRun = true
    else if (a === "--no-suite") out.noSuite = true
    else if (a === "--help") {
      out.error = USAGE
      break
    } else {
      out.error = `flag desconhecida: ${a}`
      break
    }
  }
  for (const [k, label] of [
    ["class", "--class"],
    ["prova", "--prova"],
    ["section", "--section"],
    ["what", "--what"],
  ]) {
    if (!out[k] && !out.error) out.error = `${label} obrigatorio: ${USAGE}`
  }
  if (!out.error && !/^\d+$/.test(out.prova ?? "")) out.error = `--prova deve ser numerico: ${out.prova}`
  if (!out.error && !/^8\.\d+$/.test(out.section ?? "")) {
    out.error = `--section deve ser 8.x (a fronteira da sec 11.51): recebido '${out.section}'`
  }
  // O --what vai para o PROOF_CLASSES (.mjs ASCII-gated) - so ASCII. O
  // check usa byteLength (cada char > 0x7F e multibyte em UTF-8, entao
  // byteLength > length) em vez de um range de bytes `[^\x00-\x7F]` - a
  // forma hex-escape e FRAGILE (fragile-range-patterns.mjs a flagra em
  // codigo LIVE; a classe 2026-08). Mesmo resultado, shape segura.
  if (!out.error && out.what && Buffer.byteLength(out.what, "utf8") !== out.what.length) {
    out.error = `--what deve ser ASCII (vai para o manifest .mjs que e ASCII-gated; a prosa acentuada fica na narrativa manual da sec 8.x): recebido '${out.what}'`
  }
  // O zero a esquerda em --prova escreveria `prova: 049` no manifest - ESM
  // strict-mode = octal legacy = SyntaxError no parse do manifest.
  if (!out.error && /^0\d+$/.test(out.prova ?? "")) {
    out.error = `--prova nao pode ter zero a esquerda (escreveria 'prova: 0${out.prova}' no manifest ESM strict-mode): ${out.prova}`
  }
  // O --run vai para o manifest e o snapshot (o numero do CI e numerico).
  if (!out.error && out.run !== null && !/^\d+$/.test(out.run)) {
    out.error = `--run deve ser numerico (o run do CI): recebido '${out.run}'`
  }
  if (!out.date) out.date = todayLocal()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) out.error = `--date deve ser YYYY-MM-DD: ${out.date}`
  return out
}

/** A data LOCAL de hoje (YYYY-MM-DD) - nao UTC (a convencao das sec 8.x). */
function todayLocal() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * buildManifestEntry - a entrada do PROOF_CLASSES (o texto a inserir no
 * array proofs da classe). Formato identico ao do registry real:
 * `{ prova: N, section: "8.N", run: null|"run", what: "..." },`.
 */
export function buildManifestEntry({ class: cls, prova, section, run, what }) {
  const runTxt = run ? `"${run}"` : "null"
  return `      { prova: ${prova}, section: "${section}", run: ${runTxt}, what: "${what}" },`
}

/**
 * buildSnapshotLine - a linha do ABS_PIN_SNAPSHOT (a projecao do
 * PROOF_CLASSES no teste): `["class", N, "8.N", "local"|run],` - run null
 * vira "local" (a projecao `p.run ?? "local"` do teste).
 */
export function buildSnapshotLine({ class: cls, prova, section, run }) {
  const runTxt = run ?? "local"
  return `  ["${cls}", ${prova}, "${section}", "${runTxt}"],`
}

/**
 * bumpCounts - os bumps de count no teste: `toHaveLength(N)` + o sanity do
 * DOC COVERAGE `size).toBe(N)` + o REAL-REPO `toContain("N provas")` + o
 * comentario `N provas registradas`. N e DERIVADO do count atual do
 * manifest (o CLI) + 1 - o helper nunca hardcoda o count (o drift class da
 * Prova 48: os pins esquecidos so a validacao pegou). onMissing e o mesmo
 * padrao do writeModuleCopy: todo pin precisa existir (fail-loud).
 */
export function bumpCounts(testText, oldCount, newCount) {
  const pins = [
    { re: new RegExp(`toHaveLength\\(${oldCount}\\)`), to: `toHaveLength(${newCount})` },
    { re: new RegExp(`size\\)\\.toBe\\(${oldCount}\\)`), to: `size).toBe(${newCount})` },
    { re: new RegExp(`toContain\\("${oldCount} provas"\\)`), to: `toContain("${newCount} provas")` },
    { re: new RegExp(`${oldCount} provas registradas`), to: `${newCount} provas registradas` },
  ]
  let next = testText
  for (const pin of pins) {
    if (!pin.re.test(next)) {
      throw new Error(`bumpCounts: pin ${pin.re} nao encontrado no teste (o count mudou de forma?) - atualize o harness`)
    }
    next = next.replace(pin.re, pin.to)
  }
  return next
}

/**
 * buildTableRow - a row da tabela ## 1 (o digest). Formato real: `| N |
 * classe - **what** (Prova N, sec 8.N) | ... |` - as celulas de prosa
 * (classe de erro / o que foi injetado / resultado) ficam como placeholders
 * (a narrativa manual, a mesma fronteira da sec 8.x).
 */
export function buildTableRow({ row, class: cls, prova, section, what }) {
  // O em-dash via \u2014 (o source .mjs e ASCII-gated; o runtime gera o char).
  return `| ${row} | ${cls} \u2014 **${what}** (Prova ${prova}, sec ${section}) | <!-- a classe de erro protegida --> | <!-- o que foi injetado --> | <!-- a prova / run --> | <!-- o resultado observado --> |`
}

/**
 * buildSection - a sec 8.x a partir do template UTF-8 do disco. A NARRATIVA
 * (O pedido / O veredito / A execucao / A fronteira honesta / controle) fica
 * como placeholders - o dev preenche apos o comando (a fronteira honesta).
 */
export function buildSection(template, { section, prova, what, date, class: cls, run }) {
  const runClause = run ? `, run ${run}` : ", local, sem rede"
  return template
    .replaceAll("{{SECTION}}", section)
    .replaceAll("{{PROVA}}", String(prova))
    .replaceAll("{{WHAT}}", what)
    .replaceAll("{{DATE}}", date)
    .replaceAll("{{CLASS}}", cls)
    .replaceAll("{{RUN_CLAUSE}}", runClause)
}

/**
 * insertManifestEntry - insere a entrada no array proofs da classe (antes
 * do fechamento `],` do array - o fim da secao da classe no PROOF_CLASSES).
 */
export function insertManifestEntry(manifestText, classId, entry) {
  const lines = manifestText.split(/\r?\n/)
  const clsIdx = lines.findIndex((l) => l.includes(`class: "${classId}",`))
  if (clsIdx === -1) throw new Error(`insertManifestEntry: classe '${classId}' nao encontrada no manifest`)
  // o fechamento do array proofs: a primeira `],` depois do header da classe
  // e a do proofs (a classe tem class/module/proofs/} - o primeiro array que
  // fecha depois do header e o proofs).
  let closeIdx = -1
  for (let i = clsIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "],") {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) throw new Error(`insertManifestEntry: fechamento do array proofs da classe '${classId}' nao encontrado`)
  lines.splice(closeIdx, 0, entry)
  return lines.join("\n")
}

/**
 * insertSnapshotLine - insere a linha do snapshot DEPOIS da ultima tupla da
 * classe (o snapshot e a projecao em ordem do manifest - as tuplas da
 * classe sao contiguas; inserir depois da ultima preserva a ordem).
 */
export function insertSnapshotLine(testText, classId, line) {
  const lines = testText.split(/\r?\n/)
  let lastIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`  ["${classId}"`)) lastIdx = i
  }
  if (lastIdx === -1) {
    // classe sem tupla ainda (a 1a Prova da classe): insere antes do fim do
    // snapshot (antes do fechamento `]`) - a projecao em ordem do manifest.
    const closeIdx = lines.findIndex((l) => l.trim() === "]")
    if (closeIdx === -1) throw new Error(`insertSnapshotLine: fechamento do ABS_PIN_SNAPSHOT nao encontrado`)
    lines.splice(closeIdx, 0, line)
    return lines.join("\n")
  }
  lines.splice(lastIdx + 1, 0, line)
  return lines.join("\n")
}

/**
 * insertTableRow - insere a row no FIM da tabela ## 1 (depois da ultima row,
 * antes do proximo header). A row numero = max row atual + 1.
 */
export function insertTableRow(docText, row) {
  const lines = docText.split(/\r?\n/)
  let inDigest = false
  let lastRowIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^## 1\./.test(lines[i])) {
      inDigest = true
      continue
    }
    if (inDigest && /^## /.test(lines[i])) break
    if (inDigest && /^\|\s*\d+\s*\|/.test(lines[i])) lastRowIdx = i
  }
  if (lastRowIdx === -1) throw new Error(`insertTableRow: tabela ## 1 sem rows no doc`)
  lines.splice(lastRowIdx + 1, 0, row)
  return lines.join("\n")
}

/**
 * insertSection - insere a sec 8.x ANTES do proximo header depois da
 * ultima secao 8.x (a secao nova precisa estar na ordem monotona do doc).
 */
export function insertSection(docText, sectionText) {
  const lines = docText.split(/\r?\n/)
  let last8Idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^## 8\./.test(lines[i])) last8Idx = i
  }
  if (last8Idx === -1) throw new Error(`insertSection: nenhuma secao 8.x no doc`)
  let insertAt = lines.length
  for (let i = last8Idx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      insertAt = i
      break
    }
  }
  lines.splice(insertAt, 0, sectionText)
  return lines.join("\n")
}

/** O proximo row da tabela: max row da tabela ## 1 (o digest) + 1. Escopado
 * ao digest (o mesmo scan do insertTableRow) - o max GLOBAL do doc poderia
 * pegar rows de OUTRA tabela (a matriz da 11.31, a tabela da 8.1) e gerar
 * um numero fora de sequencia no digest. */
export function nextTableRow(docText) {
  const lines = docText.split(/\r?\n/)
  let inDigest = false
  let max = 0
  for (const line of lines) {
    if (/^## 1\./.test(line)) {
      inDigest = true
      continue
    }
    if (inDigest && /^## /.test(line)) break
    if (inDigest) {
      const m = line.match(/^\|\s*(\d+)\s*\|/)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  return max + 1
}

/**
 * currentProofCount - o count atual de provas, da suite do ABS PIN (o
 * sanity `N provas registradas` do teste - a fonte derivada que o CLI
 * espelha). Nao do manifest: o manifest usa ${total} no template do CLI.
 * O REAL-REPO CONTRACT do teste pina a equivalencia: derivado == CLI.
 */
export function currentProofCount(testText) {
  const m = testText.match(COUNT_TOKEN_RE)
  return m ? Number(m[1]) : null
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
  console.error(`proof-register: ${msg}`)
  return code
}

/**
 * Main flow. Retorna o exit code (o entry-point guard seta process.exitCode).
 * Exit 2 = usage. Exit 1 = gate falhou / classe ou prova invalida / arquivo
 * ausente / count nao-parseado. Exit 0 = dry-run impresso ou registro
 * aplicado (com a CURE de re-validacao).
 */
export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  if (opts.error) return fail(2, opts.error)
  const manifestPath = process.env.PROOF_REGISTER_MANIFEST || DEFAULT_MANIFEST
  const testPath = process.env.PROOF_REGISTER_TEST || DEFAULT_TEST
  const docPath = process.env.PROOF_REGISTER_DOC || DEFAULT_DOC
  for (const [p, label] of [
    [manifestPath, "manifest"],
    [testPath, "test"],
    [docPath, "doc"],
  ]) {
    if (!fs.existsSync(p)) return fail(1, `arquivo nao encontrado: ${p} (o ${label})`)
  }

  // 1. Gate: a suite do contrato (prova que o estado atual esta verde antes
  //    de tocar nada - o padrao do doc-revalidate). --no-suite pula.
  if (!opts.noSuite) {
    const suiteCmd = process.env.PROOF_REGISTER_SUITE_CMD || DEFAULT_SUITE_CMD
    const suite = runCmd(suiteCmd, { NO_COLOR: "1" })
    if (suite.status !== 0) {
      return fail(1, `suite do contrato falhou (status ${suite.status}): ${(suite.stderr || "").slice(-400)}`)
    }
  }

  // 2. Ler os 3 arquivos + validar classe/prova contra o manifest real.
  const manifest = fs.readFileSync(manifestPath, "utf8")
  const test = fs.readFileSync(testPath, "utf8")
  const doc = fs.readFileSync(docPath, "utf8")
  if (!manifest.includes(`class: "${opts.class}",`)) {
    return fail(1, `classe '${opts.class}' nao encontrada no PROOF_CLASSES (o --class precisa existir)`)
  }
  const existingProva = manifest.match(new RegExp(`prova: ${opts.prova},\\s*section: "8\\.`))
  if (existingProva) {
    return fail(1, `Prova ${opts.prova} ja existe no manifest (registrar e a decisao, nunca duplicar)`)
  }
  if (doc.includes(`## ${opts.section} `)) {
    return fail(1, `secao '## ${opts.section} ' ja existe no doc`)
  }
  const count = currentProofCount(test)
  if (count === null) {
    return fail(1, `nao parseou o count de provas da suite do ABS PIN (o sanity 'N provas registradas' do teste - o token que o CLI espelha)`)
  }
  const newCount = count + 1

  // 3. Gerar os 4 pieces.
  const entry = buildManifestEntry(opts)
  const snapshotLine = buildSnapshotLine(opts)
  let testNext = bumpCounts(test, count, newCount)
  testNext = insertSnapshotLine(testNext, opts.class, snapshotLine)
  const row = buildTableRow({ row: nextTableRow(doc), ...opts })
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8")
  const section = buildSection(template, opts)
  const manifestNext = insertManifestEntry(manifest, opts.class, entry)
  const docNext = insertTableRow(doc, row)
  const docFinal = insertSection(docNext, section)

  if (opts.dryRun) {
    console.log(`proof-register (dry-run): classe ${opts.class} / Prova ${opts.prova} / secao ${opts.section} / ${count} -> ${newCount} provas`)
    console.log("=== PROOF_CLASSES entry ===")
    console.log(entry)
    console.log("=== ABS_PIN_SNAPSHOT line ===")
    console.log(snapshotLine)
    console.log("=== table row ===")
    console.log(row)
    console.log("=== sec 8.x skeleton (preencha a narrativa) ===")
    console.log(section)
    console.log("=== NADA FOI ESCRITO (dry-run) ===")
    return 0
  }

  // 4. Aplicar os 3 edits (manifest + teste + doc).
  fs.writeFileSync(manifestPath, manifestNext, "utf8")
  fs.writeFileSync(testPath, testNext, "utf8")
  fs.writeFileSync(docPath, docFinal, "utf8")
  console.log(
    `proof-register: Prova ${opts.prova} (secao ${opts.section}, classe ${opts.class}) registrada - ${count} -> ${newCount} provas em ${manifestPath}, ${testPath} e ${docPath}`,
  )
  console.log("  preencha a narrativa da sec 8.x (O pedido / O veredito / A execucao / A fronteira honesta) e re-valide:")
  console.log("  bunx vitest run scripts/__tests__/proofs-manifest.test.ts scripts/__tests__/proof-register.test.ts --config vitest.config.unit.ts")
  console.log("  node scripts/proofs-manifest.mjs --check")
  return 0
}

// Entry-point guard: so roda o CLI quando executado direto (vitest importa
// as funcoes puras para os testes sem efeitos colaterais).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
