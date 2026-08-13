#!/usr/bin/env node
/**
 * scan-evidence-sweep.mjs - o 12o guard do batch do pre-commit: o CHECK dos
 * DOIS sweeps de evidencia datada (sec 11.117 nos guards + sec 11.118 nos
 * helpers de prova) executado NO BATCH (2026-08-13, sec 11.120).
 *
 * WHY: a fronteira (MODULE_CITE_RE + EVIDENCE_MARK_RE + section11Bodies) e
 * as derivadas (deriveEvidenceCited / derive11xCited / evidenceCitedViolations
 * + o sweep irmao dos helpers) viviam no evidence-sweep.ts compartilhado e
 * rodavam SO como suite via test:unit (no CI/push) - uma nota datada nova
 * no gates-proofs.md citando um modulo fake passava o commit local e so
 * falharia no push. A sec 11.119 (a avaliacao da regra dos 2 usos) previu
 * exatamente esta classe: "a forma-guard so se justifica quando o check
 * roda no batch" - e este guard e o canal executavel que a sec 11.120
 * fecha. Roda INCONDICIONAL (a invariante da sec 11.42, o padrao do 9o
 * guard da sec 11.93 - ~15-25ms de fs + regex, boot compartilhado).
 *
 * A FRONTEIRA E AS DERIVADAS vivem AQUI (a fonte unica que as suites das
 * secs 11.117/11.118 importam - a regra dos 2 usos, o padrao do
 * scan-proof-helpers da sec 11.93: nunca uma copia que pudesse driftar).
 *
 * Exit codes do CLI: 0 = doc real sem violacoes nos DOIS sweeps - 1 =
 * violacoes listadas no stderr (com a CURE) - 2 = uso errado.
 *
 * Re-validacao: `node scripts/scan-evidence-sweep.mjs --check` + as suites
 * das secs 11.117/11.118 (importam DAQUI a fonte unica) + a suite deste
 * guard (scripts/__tests__/scan-evidence-sweep.test.ts).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PROOF_CLASSES, WIRED_ALLOWLIST } from "./proofs-manifest.mjs"
import { deriveProofHelpers } from "./scan-proof-helpers.mjs"

/** ROOT - a raiz do repo, com override por env (o padrao dos guards). O
 * teste de isolacao aponta EVIDENCE_SWEEP_ROOT para um repo sintetico. */
const ROOT = path.resolve(process.env.EVIDENCE_SWEEP_ROOT || process.cwd())
/** DOC - o doc real dos sweeps, com override por env (os testes sinteticos
 * apontam EVIDENCE_SWEEP_DOC para um doc com nota fake). */
const DOC = path.resolve(process.env.EVIDENCE_SWEEP_DOC || path.join(ROOT, "docs", "gates-proofs.md"))

/** A citacao de modulo em backticks: `scripts/X.mjs|.sh` ou
 * `.github/workflows/X.yml` (o que o sweep rastreia). */
export const MODULE_CITE_RE = /`((?:scripts\/|\.github\/workflows\/)[\w./-]+(?:\.mjs|\.sh|\.yml))`/g

/** O marcador de evidencia DATADA (a fronteira da sec 11.117): prova viva /
 * nota datada / probe datado / parentese datado. Mencoes em prosa (sem o
 * marcador) escapam por desenho (a limitacao documentada da 11.117). */
export const EVIDENCE_MARK_RE = /prova viva|Prova viva|nota datada|probe 20\d\d|\(20\d\d-\d\d-\d\d\)/

/**
 * O corpo das secoes 11.x do doc, na ordem do doc. Fecha o corpo corrente em
 * QUALQUER header numerado de topo (`## N` - inclusive `## 12.` e `## 8.x`,
 * nao so o proximo `## 11.N`). `### 11.x.y` NAO fecha (e subsecao da
 * corrente, `^## ` nao casa `###`).
 */
export function section11Bodies(docText) {
  const out = []
  const lines = docText.split(/\r?\n/)
  let cur = null
  for (const line of lines) {
    if (/^## \d/.test(line)) {
      if (cur) out.push(cur.join("\n"))
      cur = /^## 11\.\d+/.test(line) ? [] : null
    } else if (cur) {
      cur.push(line)
    }
  }
  if (cur) out.push(cur.join("\n"))
  return out
}

/** As citacoes de modulo nas secoes 11.x com evidencia datada. */
export function deriveEvidenceCited(docText) {
  const out = new Set()
  for (const body of section11Bodies(docText)) {
    if (!EVIDENCE_MARK_RE.test(body)) continue
    for (const m of body.matchAll(MODULE_CITE_RE)) out.add(m[1])
  }
  return [...out].sort()
}

/** As citacoes de modulo em QUALQUER secao 11.x (sem o filtro de evidencia) -
 * a fronteira da direcao orfa da sec 11.118: a exclusao de helper precisa
 * estar citada em ALGUMA secao 11.x (o home ADOTADO), nao so em evidencia. */
export function derive11xCited(docText) {
  const out = new Set()
  for (const body of section11Bodies(docText)) {
    for (const m of body.matchAll(MODULE_CITE_RE)) out.add(m[1])
  }
  return [...out].sort()
}

/**
 * EVIDENCE_EXCLUSIONS - os nao-guards documentados citados em secoes de
 * evidencia (sec 11.117): modulos que NAO sao classe nem allowlist porque
 * nao sao guards - sub-modulos consumidos por classes, dados, ou o proprio
 * registry (self-reference). Compartilhada: a sec 11.118 (os helpers)
 * usa-a como home de guard no pass-through (um modulo ja coberto pela
 * 11.117 nao e re-flagrado pelo sweep irmao).
 */
export const EVIDENCE_EXCLUSIONS = {
  "scripts/eslintd-shim.sh": "sub-modulo do scan-lint-staged-loader (allowlist) - nao e guard",
  "scripts/fuzz-targets.mjs": "dados consumidos pelos fuzz guards (run-mapped-fuzz/run-all-fuzz) - nao e guard",
  "scripts/proofs-manifest.mjs": "o proprio registry (self-reference da sec 11.60) - nao e guard",
}

/**
 * As violacoes do sweep da 11.117: citacao de modulo em evidencia sem
 * classe no PROOF_CLASSES, entrada no WIRED_ALLOWLIST ou exclusao
 * documentada (a direcao citacao -> home) E a exclusao que nao esta
 * citada em NENHUMA secao de evidencia (a direcao orfa - o espelho da sec
 * 11.90 direcao B: a lista nao pode acumular lixo em silencio). Com
 * injecao de exclusions (os MUTATIONs das suites provam a classe).
 */
export function evidenceCitedViolations(opts) {
  const classModules = new Set(PROOF_CLASSES.map((c) => c.module))
  const allowlist = new Set(WIRED_ALLOWLIST)
  const exclusions = opts.exclusions ?? EVIDENCE_EXCLUSIONS
  const cited = deriveEvidenceCited(opts.docText)
  const citedSet = new Set(cited)
  const viol = []
  for (const cite of cited) {
    const missing = []
    if (!classModules.has(cite) && !allowlist.has(cite.split("/").pop()) && !(cite in exclusions)) {
      missing.push("classe no PROOF_CLASSES nem allowlist nem exclusao documentada")
    }
    if (missing.length) viol.push([cite, missing])
  }
  // A direcao orfa (sec 11.90 direcao B aplicada): a exclusao precisa estar
  // citada hoje - uma entrada de modulo nunca citado e lixo acumulado.
  for (const key of Object.keys(exclusions)) {
    if (!citedSet.has(key)) viol.push([key, ["exclusao orfa (o modulo nao e citado em secao de evidencia)"]])
  }
  return viol
}

/** HELPER_EVIDENCE_EXCLUSIONS - os helpers de prova suite-pinned citados em
 * evidencia SEM classe/allowlist (sec 11.118): fora do *-proof:run do
 * package.json por desenho (o manifest derivado nao os pega). */
export const HELPER_EVIDENCE_EXCLUSIONS = {
  "scripts/guard-remeasure.mjs": "helper de prova suite-pinned (sec 11.81) - sem classe/allowlist, fora do *-proof:run por desenho",
  "scripts/proof-register.mjs": "helper de prova suite-pinned (sec 11.94) - sem classe/allowlist, fora do *-proof:run por desenho",
}

/** As citacoes de helper nas secoes 11.x com evidencia datada (o universo de
 * helpers = o PROOF_HELPERS derivado + a HELPER_EVIDENCE_EXCLUSIONS DEFAULT
 * - a superficie fixa; o mapa injetado decide so a membership, nunca o
 * universo: o padrao da 11.117). */
export function deriveHelperEvidenceCited(docText) {
  const pkg = fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  const helperMjs = new Set(deriveProofHelpers(pkg, ROOT).map((h) => `scripts/${h.mjs}`))
  const universe = new Set([...helperMjs, ...Object.keys(HELPER_EVIDENCE_EXCLUSIONS)])
  return deriveEvidenceCited(docText).filter((c) => universe.has(c)).sort()
}

/**
 * As violacoes do sweep irmao da 11.118: citacao de helper em evidencia sem
 * entrada no PROOF_HELPERS derivado nem exclusao documentada (a direcao
 * citacao -> home) E a exclusao que nao esta citada em NENHUMA secao 11.x (a
 * direcao orfa - o espelho da sec 11.90 direcao B). Com injecao de
 * exclusions (os MUTATIONs provam a classe).
 */
export function helperEvidenceViolations(opts) {
  const pkg = fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  const exclusions = opts.exclusions ?? HELPER_EVIDENCE_EXCLUSIONS
  const helperMjs = new Set(deriveProofHelpers(pkg, ROOT).map((h) => `scripts/${h.mjs}`))
  const cited = deriveHelperEvidenceCited(opts.docText)
  const cited11x = new Set(derive11xCited(opts.docText))
  const viol = []
  for (const cite of cited) {
    const missing = []
    if (!helperMjs.has(cite) && !(cite in exclusions)) {
      missing.push("entrada no PROOF_HELPERS (o manifest derivado) nem exclusao documentada")
    }
    if (missing.length) viol.push([cite, missing])
  }
  // A direcao orfa (sec 11.90 direcao B aplicada): a exclusao precisa estar
  // citada em ALGUMA secao 11.x (a fronteira e o home ADOTADO 11.81/11.94,
  // nao a evidencia - as exclusoes de helper vivem em secoes de decisao).
  for (const key of Object.keys(exclusions)) {
    if (!cited11x.has(key)) {
      viol.push([key, ["exclusao orfa (o modulo nao e citado em nenhuma secao 11.x)"]])
    }
  }
  return viol
}

/**
 * checkEvidenceSweep - o scan real (o que o CLI roda): le o doc e agrega as
 * violacoes dos DOIS sweeps (11.117 nos guards + 11.118 nos helpers).
 * @returns {{ violations: string[] }}
 */
export function checkEvidenceSweep(root = ROOT) {
  const docPath = process.env.EVIDENCE_SWEEP_DOC ? DOC : path.join(root, "docs", "gates-proofs.md")
  if (!fs.existsSync(docPath)) {
    return { violations: [`doc ausente: ${docPath} (o gates-proofs.md dos sweeps)`] }
  }
  const docText = fs.readFileSync(docPath, "utf8")
  const violations = []
  for (const [cite, missing] of evidenceCitedViolations({ docText })) {
    violations.push(`${cite}: ${missing.join("; ")} (sec 11.117)`)
  }
  for (const [cite, missing] of helperEvidenceViolations({ docText })) {
    violations.push(`${cite}: ${missing.join("; ")} (sec 11.118)`)
  }
  return { violations }
}

/** CLI: `node scripts/scan-evidence-sweep.mjs [--check]` - exit 0/1/2. */
export function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--check")
  if (unknown.length > 0) {
    process.stderr.write("evidence-sweep: usage: node scripts/scan-evidence-sweep.mjs [--check]\n")
    return 2
  }
  const { violations } = checkEvidenceSweep()
  if (violations.length === 0) {
    process.stdout.write("evidence-sweep: clean (doc real sem violacoes de evidencia datada nos DOIS sweeps - sec 11.117/11.118/11.120)\n")
    return 0
  }
  process.stderr.write(`evidence-sweep: ${violations.length} violacao(oes) dos sweeps de evidencia datada (sec 11.117/11.118/11.120):\n`)
  for (const v of violations) process.stderr.write(`  ${v}\n`)
  process.stderr.write(
    "  CURE: registre o modulo citado na nota datada no PROOF_CLASSES (classe com Prova viva), no WIRED_ALLOWLIST ou na exclusao documentada dos sweeps (a fronteira da sec 11.117/11.118) e confirme com: node scripts/scan-evidence-sweep.mjs --check\n",
  )
  return 1
}

// Entry-point guard: so roda o CLI quando executado direto (o batch runner
// importa main() e o chama no MESMO processo - importar NAO executa).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
