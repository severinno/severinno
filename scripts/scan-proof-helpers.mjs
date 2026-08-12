/**
 * scan-proof-helpers.mjs - o 9o guard do batch do pre-commit: o CONTRATO de
 * fail-loud dos helpers de prova (sec 11.72) executado NO BATCH (2026-08-12,
 * sec 11.93 do gates-proofs.md).
 *
 * WHY: as Provas 44 (hook-proof-run) e 48 (ci-proof-run) provaram o contrato
 * da sec 11.72 ao vivo (mutar o bloco 'Exit codes:' do docblock real -> a
 * suite falha com o caminho exato) - mas so como SUITE via test:unit (no
 * CI/push). O arquivo real dos helpers seguia vulneravel a edicao acidental
 * do bloco 'Exit codes:': um refactor que removesse a parte 1 passaria o
 * commit local (o pre-commit:test nao cobre docs nem este source) e so
 * falharia no push/CI. Este guard fecha a classe: a falha vem ANTES do
 * commit, no batch do pre-commit (o padrao do tripwire do scan-exit-claims,
 * sec 11.42/11.56).
 *
 * INVARIANTE do batch (sec 11.42): guards baratos NAO ganham condicao. O
 * pedido original avaliou 'rodar quando hook-proof-run.mjs/ci-proof-run.mjs
 * mudarem' (a condicao por arquivo) - mas a premisa e supersedida pela
 * invariante: o guard roda INCONDICIONALMENTE, custo medido ~15-25ms (fs +
 * regex puros, boot compartilhado do batch). A condicao por diff seria
 * furavel (a edicao acidental nao avisa o hook de nada) e quebraria o
 * determinismo da agregacao (uma falha nunca esconde as demais).
 *
 * O CONTRATO executado (as MESMAS 3 partes da sec 11.72):
 *   1. exit codes 0-3 documentados no docblock (EXIT_CODES_RE);
 *   2. nota de limpeza definida (NOTE_DEF_RE - o LeftNote que os guards
 *      11.65/11.70 consomem);
 *   3. E2E do caminho na suite (FAKE_BIN_RE + FAIL_EXIT_RE - o fail-loud
 *      exercitado, nao so em prosa).
 * O manifest dos helpers e DERIVADO do package.json (os scripts
 * *-proof:run, a sec 11.79) - a FONTE UNICA: a suite da sec 11.72
 * (proof-helpers-contract.test.ts) importa a derivacao e os regexes DAQUI
 * (a regra dos 2 usos: nao ha lista hardcoded em dois lugares para
 * driftar).
 *
 * Exit codes do CLI: 0 = todos os helpers com as 3 partes - 1 = violacoes
 * listadas no stderr - 2 = uso errado.
 *
 * Re-validacao: `node scripts/scan-proof-helpers.mjs --check` + a suite da
 * sec 11.72 (importa DAQUI a fonte unica).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** ROOT - a raiz do repo, com override por env (o padrao dos guards:
 * NODE_MODULES_ROOT, GUARD_GATES_SCAN_ROOT...). O teste de isolacao do
 * batch aponta PROOF_HELPERS_ROOT para um repo sintetico com um helper
 * quebrado. */
const ROOT = path.resolve(process.env.PROOF_HELPERS_ROOT || process.cwd())

/** As 3 partes do contrato de fail-loud (sec 11.72):
 * 1. Exit codes documentados: o docblock "Exit codes:" cobre 0, 1, 2 e 3 na
 *    ordem (o shape dos dois helpers: "0 = ...; 1 = ...; 2 = ...; 3 = ..." -
 *    os codigos podem continuar em linhas seguintes, dai o [\\s\\S]).
 * 2. Nota de limpeza definida: o const do LeftNote (arrow com params ou
 *    string).
 * 3. E2E do caminho: a suite tem o seam de bins fake (o env override) E um
 *    assert de exit nao-zero num subprocess (o fail-loud exercitado pelo
 *    CLI real - `r.status` no hook, `result.status` no ci).
 * Exportados: a suite da sec 11.72 consome AQUI (fonte unica). */
export const EXIT_CODES_RE = /Exit codes?:?\s*0\s*=[\s\S]*?1\s*=[\s\S]*?2\s*=[\s\S]*?3\s*=/
export const NOTE_DEF_RE = /\w+LeftNote\s*=\s*(\(|")/
export const FAKE_BIN_RE = /(CI_PROOF_GIT|HOOK_PROOF_GIT)\s*:/
export const FAIL_EXIT_RE = /\.status\)\.toBe\([123]/

/**
 * deriveProofHelpers - o manifest dos helpers DERIVADO do package.json (sec
 * 11.79, a fonte unica): cada script `*-proof:run` vira { script, mjs, ts,
 * note } - script (o nome no package.json), mjs (o runner), ts (a suite por
 * convencao <stem>.test.ts) e note (o PRIMEIRO const `\w+LeftNote = (` do
 * source do helper - a nota que os guards 11.65/11.70 consomem; o
 * revertLeftNote da 11.75 e function declaration, nao casa o regex). NAO
 * ha lista hardcoded: a derivada E o manifest (o padrao TARGET_DIRS/fatos
 * consumidos - a fonte unica).
 *
 * @param {string} pkg - o texto do package.json.
 * @param {string} root - raiz do repo (default ROOT).
 * @returns {Array<{script: string, mjs: string, ts: string, note: string}>}
 */
export function deriveProofHelpers(pkg, root = ROOT) {
  return [...pkg.matchAll(/"([a-z0-9-]+-proof:run)"\s*:\s*"node scripts\/([a-z0-9_.-]+\.mjs)"/g)]
    .map((m) => {
      const mjs = m[2]
      const ts = mjs.replace(/\.mjs$/, ".test.ts")
      const srcPath = path.join(root, "scripts", mjs)
      const note = fs.existsSync(srcPath)
        ? fs.readFileSync(srcPath, "utf8").match(/(\w+LeftNote)\s*=\s*(\(|")/)?.[1] ?? ""
        : ""
      return { script: m[1], mjs, ts, note }
    })
    .sort((a, b) => a.mjs.localeCompare(b.mjs))
}

/**
 * helperViolations - as violacoes das 3 partes de UM helper contra o fs
 * (sec 11.72). Arquivo ausente => a parte correspondente viola (o read
 * nunca crasha o guard - o sintetico dos testes de isolacao pode ter
 * helper sem suite). Retorna array de mensagens prontas para o stderr.
 */
export function helperViolations(h, root = ROOT) {
  const srcPath = path.join(root, "scripts", h.mjs)
  const suitePath = path.join(root, "scripts", "__tests__", h.ts)
  const src = fs.existsSync(srcPath) ? fs.readFileSync(srcPath, "utf8") : ""
  const suite = fs.existsSync(suitePath) ? fs.readFileSync(suitePath, "utf8") : ""
  const v = []
  if (!EXIT_CODES_RE.test(src)) {
    v.push(`${h.mjs}: o docblock deve documentar os exit codes 0-3 (Exit codes: 0 = ... 1 = ... 2 = ... 3 = ...)`)
  }
  if (!NOTE_DEF_RE.test(src)) {
    v.push(`${h.mjs}: deve definir a nota de limpeza (${h.note} = ... - a parte que os guards 11.65/11.70 consomem)`)
  }
  if (!FAKE_BIN_RE.test(suite)) {
    v.push(`${h.ts}: deve ter o seam de bins fake (CI_PROOF_GIT/HOOK_PROOF_GIT: o E2E do caminho roda o CLI real)`)
  }
  if (!FAIL_EXIT_RE.test(suite)) {
    v.push(`${h.ts}: deve ter um E2E que assere exit nao-zero (.status).toBe(1|2|3) - o fail-loud exercitado, nao so em prosa`)
  }
  return v
}

/**
 * checkProofHelpers - o scan real (o que o CLI roda): deriva os helpers do
 * package.json do root e agrega as violacoes das 3 partes.
 * @returns {{ helpers: Array<{script: string, mjs: string, ts: string, note: string}>, violations: string[] }}
 */
export function checkProofHelpers(root = ROOT) {
  const pkgPath = path.join(root, "package.json")
  if (!fs.existsSync(pkgPath)) return { helpers: [], violations: ["package.json ausente em " + root] }
  const pkg = fs.readFileSync(pkgPath, "utf8")
  const helpers = deriveProofHelpers(pkg, root)
  const violations = []
  for (const h of helpers) violations.push(...helperViolations(h, root))
  return { helpers, violations }
}

/** CLI: `node scripts/scan-proof-helpers.mjs [--check]` - exit 0/1/2. */
export function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--check")
  if (unknown.length > 0) {
    process.stderr.write("proof-helpers: usage: node scripts/scan-proof-helpers.mjs [--check]\n")
    return 2
  }
  const { helpers, violations } = checkProofHelpers()
  if (violations.length === 0) {
    process.stdout.write(`proof-helpers: clean (${helpers.length} helpers com as 3 partes - sec 11.72/11.93)\n`)
    return 0
  }
  process.stderr.write(`proof-helpers: ${violations.length} violacao(oes) do contrato de fail-loud (sec 11.72/11.93):\n`)
  for (const v of violations) process.stderr.write(`  ${v}\n`)
  process.stderr.write(
    "  CURE: restaure a parte quebrada no source do helper (o bloco 'Exit codes:' do docblock / a nota LeftNote / o E2E da suite - o padrao das Provas 44/48) e confirme com: node scripts/scan-proof-helpers.mjs --check\n",
  )
  return 1
}

// Entry-point guard: so roda o CLI quando executado direto (o batch runner
// importa main() e o chama no MESMO processo - importar NAO executa).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
