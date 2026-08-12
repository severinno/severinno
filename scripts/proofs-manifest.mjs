#!/usr/bin/env node
/**
 * proofs-manifest.mjs - o REGISTRY das provas vivas por classe de guard
 * (2026-08-11, sec 11.60 do gates-proofs.md).
 *
 * WHY: o pedido "avalie uma prova" re-propos 2x uma prova JA registrada -
 * a Prova 39 (sec 8.34, o PAR CURE+stale) e o caso do hook-proof-run (sec
 * 11.58, ja automatizado). A classe: 're-derivar o que ja esta pinado'.
 * ESTE modulo e o consultavel: PROOF_CLASSES mapeia cada classe de guard a
 * sua prova viva (Prova N + run do CI ou null = local + secao do doc), no
 * padrao EXIT_CLAIMS da sec 11.42 - o "avalie uma prova" do futuro
 * consulta o registry ANTES de propor.
 *
 * O CONTRATO (o que a suite pina contra o doc real):
 *   - ABS PIN: o conteudo do manifest (prova + classe + secao + run) -
 *     editar o registry exige editar o snapshot conscientemente.
 *   - DOC COVERAGE doc -> manifest: toda secao com 'Prova N' no doc (os
 *     headers `## N Prova M` + a linha da tabela `(Prova N, sec X)` que
 *     registra a Prova 20) tem entrada no manifest - uma Prova nova no doc
 *     sem registro falha (o growth contract).
 *   - manifest -> doc (stale): toda entrada tem secao detectada no doc.
 *   - PIN REALITY: o module da classe existe (o padrao manifest-registry).
 *   - RUN REALITY: todo run nao-nulo aparece no texto do doc.
 *
 * OUT OF SHAPE (como scan-exit-claims/FRONTIERS, sec 11.40): SEM
 * superficie --print-* (CLI = --check), entao a LIVE TREE check do
 * manifest-registry nao o flagra. Roda via test:unit (o MESMO canal do
 * scan-exit-claims) - NAO no test:guard, cuja lista de 13 suites e pinada
 * pela Prova 35 (sec 8.30).
 *
 * Exit codes do CLI: 0 = clean (registry coberto pelo doc) - 1 =
 * violacoes listadas no stderr - 2 = uso errado.
 *
 * Re-validacao: `npx vitest run scripts/__tests__/proofs-manifest.test.ts --config vitest.config.unit.ts`
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** DOC - o doc real, com override por env (o padrao EXIT_CLAIMS_DOC). */
const DOC = process.env.PROOFS_DOC || path.join(process.cwd(), "docs", "gates-proofs.md")

/**
 * PROOF_CLASSES - o registry: classe de guard -> provas vivas.
 * class: id curto da classe (o consultavel do "avalie uma prova").
 * module: o arquivo da classe (PIN REALITY - precisa existir).
 * proofs: [{ prova, section, run, what }] - prova = numero da Prova;
 * section = secao do doc onde a Prova e registrada (o header `## N Prova
 * M`, exceto a Prova 20 cujo registro vive na linha da tabela); run = o
 * run do CI (null = prova local, sem run dedicado); what = descricao curta.
 */
export const PROOF_CLASSES = [
  {
    class: "verify-encoding",
    module: "scripts/verify-encoding.sh",
    proofs: [
      { prova: 1, section: "2", run: "31298436074", what: "utf8-byte" },
      { prova: 2, section: "3", run: "31306797327", what: "fragile-range" },
      { prova: 4, section: "5", run: "31312427503", what: "FRAGILE_SCAN_ROOT sentinel" },
      { prova: 5, section: "6", run: null, what: ".zscripts fixed-dir 0x97" },
      { prova: 6, section: "7", run: "31331423557", what: "SPREAD CONTRACT" },
    ],
  },
  {
    class: "check-js-budget",
    module: "scripts/check-js-budget.mjs",
    proofs: [
      { prova: 3, section: "4", run: null, what: "budget sentinel" },
    ],
  },
  {
    class: "guard-gates-push-net",
    module: ".github/workflows/guard-gates.yml",
    proofs: [
      { prova: 7, section: "8", run: "31336318902", what: "push net guard vitest" },
      { prova: 35, section: "8.30", run: "31526224328", what: "test:guard 13 suites" },
    ],
  },
  {
    class: "scan-surfaces-contract",
    module: "scripts/__tests__/scan-surfaces-contract.test.ts",
    proofs: [
      { prova: 8, section: "8.2", run: "31342311844", what: "Type D HERMETIC" },
    ],
  },
  {
    class: "check-next-types",
    module: "scripts/check-next-types.mjs",
    proofs: [
      { prova: 9, section: "8.3", run: null, what: "auto-heal .next/types" },
    ],
  },
  {
    class: "scan-push-full-suite",
    module: "scripts/scan-push-full-suite.mjs",
    proofs: [
      { prova: 10, section: "8.7", run: "31354308733", what: "REAL-REPO CONTRACT do Gate 3" },
    ],
  },
  {
    class: "run-mapped-fuzz",
    module: "scripts/run-mapped-fuzz.mjs",
    proofs: [
      { prova: 11, section: "8.8", run: null, what: "Gate 2 fuzz MAPEADO (pre-push real)" },
    ],
  },
  {
    class: "run-all-fuzz",
    module: "scripts/run-all-fuzz.mjs",
    proofs: [
      { prova: 12, section: "8.9", run: "31397642499", what: "fuzz:ci BATCHADO" },
      { prova: 13, section: "8.10", run: "31411254090", what: "pr-check completo do estado atual" },
    ],
  },
  {
    class: "check-node-modules-integrity",
    module: "scripts/check-node-modules-integrity.mjs",
    proofs: [
      { prova: 14, section: "8.11", run: null, what: "SPEC-FORMAT contract" },
    ],
  },
  {
    class: "scan-guard-gates",
    module: "scripts/scan-guard-gates.mjs",
    proofs: [
      { prova: 15, section: "8.12", run: null, what: "FRAGILE GUARD NEEDS local" },
      { prova: 16, section: "8.13", run: "31430040398", what: "FRAGILE GUARD NEEDS via CI" },
      { prova: 17, section: "8.14", run: null, what: "multi-violacao AGREGADA local" },
      { prova: 19, section: "8.15", run: "31439238631", what: "GUARD GATES JOB NEEDS via push real" },
      { prova: 21, section: "8.16", run: "31444762608", what: "FUZZ JOB NEEDS + FUZZ STEP MISSING" },
      { prova: 22, section: "8.17", run: "31446588931", what: "multi-violacao AGREGADA via CI" },
      { prova: 24, section: "8.19", run: "31461526068", what: "agregacao lado PUSH NET" },
      { prova: 28, section: "8.23", run: "31488081528", what: "rule 11 DANGLING NEEDS (inconclusiva)" },
      { prova: 36, section: "8.31", run: "31533234250", what: "sufixo --since no test:guard" },
    ],
  },
  {
    class: "check-exit-claims-push",
    module: "scripts/check-exit-claims-push.mjs",
    proofs: [
      { prova: 37, section: "8.32", run: null, what: "claim fake 11.99 bloqueia o push" },
      { prova: 38, section: "8.33", run: null, what: "CURE como ultima saida" },
    ],
  },
  {
    class: "prepush-order",
    module: ".husky/pre-push",
    proofs: [
      { prova: 18, section: "11.19", run: null, what: "integrity ANTES do fuzz mapeado" },
    ],
  },
  {
    class: "ci-proof-run",
    module: "scripts/ci-proof-run.mjs",
    proofs: [
      { prova: 20, section: "11.20", run: "31442006152", what: "--only-jobs EARLY-EXIT" },
      { prova: 32, section: "8.27", run: "31511149307", what: "--stash-uncommitted positivo" },
    ],
  },
  {
    class: "scan-prepush-batch",
    module: "scripts/scan-prepush-batch.mjs",
    proofs: [
      { prova: 23, section: "8.18", run: null, what: "SEGUNDO NODE GUARD live" },
    ],
  },
  {
    class: "scan-eol-anchor",
    module: "scripts/scan-eol-anchor.mjs",
    proofs: [
      { prova: 25, section: "8.20", run: "31480438465", what: "eol-anchor BASELINE live" },
    ],
  },
  {
    class: "scan-curl-timeouts",
    module: "scripts/scan-curl-timeouts.mjs",
    proofs: [
      { prova: 26, section: "8.21", run: "31485163704", what: "eval falso-negativo observado" },
      { prova: 27, section: "8.22", run: "31487497462", what: "--connect-timeout sozinho" },
      { prova: 29, section: "8.24", run: "31492035257", what: "tripwire eval+curl lado PR" },
      { prova: 30, section: "8.25", run: "31496492582", what: "split-form residual exit 0" },
      { prova: 31, section: "8.26", run: "31506284327", what: "continuation-form exit 1" },
      { prova: 34, section: "8.29", run: "31518328191", what: "tri-caso AGREGADO" },
    ],
  },
  {
    class: "scan-exit-claims",
    module: "scripts/scan-exit-claims.mjs",
    proofs: [
      { prova: 33, section: "8.28", run: "31516054686", what: "DOC COVERAGE com a secao exata" },
      { prova: 39, section: "8.34", run: null, what: "PAR CURE+stale no CLI real" },
    ],
  },
  {
    class: "hook-proof-run",
    module: "scripts/hook-proof-run.mjs",
    proofs: [
      { prova: 40, section: "8.35", run: null, what: "renumber CURE+0stale via helper" },
      { prova: 41, section: "8.36", run: null, what: "colisao de target fail-loud exit 3" },
    ],
  },
]

/**
 * scanProvaSections - o DETECTOR das registracoes de Prova no doc (a
 * direcao doc -> manifest, o mesmo padrao do scanDocExitClaims). Duas
 * fontes:
 *   1. HEADER: `## <sec> Prova <N>` (a forma autoritativa - as Provas
 *      1-6 nos headers `## 2.`-`## 7.`, a 7 no `## 8.`, 8-39 nos `## 8.x`,
 *      a 18 no `## 11.19 Prova 18`). O first-match do titulo (a Prova do
 *      titulo, nao referencias cruzadas no corpo do titulo).
 *   2. TABELA: a linha `(Prova N, sec X` - a registracao da Prova 20,
 *      cuja secao 11.20 NAO tem 'Prova N' no titulo (`## 11.20
 *      ci-proof-run -- custo real do ciclo...`; a linha real e `(Prova
 *      20, sec 11.20; o poll...` - o greedy para no ';'). A tabela e
 *      REDUNDANTE para as demais (mesmo valor do header) - um conflito
 *      (valor diferente do header) DEFERE ao header como autoridade
 *      (continue): a tabela referencia secoes de OUTRAS provas em
 *      prosa, entao o header e o unico que pode decidir.
 *
 * @returns {Map<string, number>} secao -> prova.
 */
export function scanProvaSections(docPath = DOC) {
  const lines = fs.readFileSync(docPath, "utf8").split(/\r?\n/)
  const sections = new Map()
  for (const line of lines) {
    const m = line.match(/^## (\d+(?:\.\d+)?)\.?\s+Prova (\d+)/)
    if (m) sections.set(m[1], Number(m[2]))
  }
  for (const line of lines) {
    // Lenienta por design: a linha real da Prova 20 e
    // `(Prova 20, sec 11.20; o poll termina no JOB...)` - a secao nao fecha
    // parenteses (segue com ';'). O greedy `([0-9.]+)` para no ';' (ou ')'
    // na forma sintetica `(Prova 20, sec 11.20)` da MUTATION).
    const m = line.match(/\(Prova (\d+), sec ([0-9.]+)/)
    if (m) {
      const sec = m[2]
      const prova = Number(m[1])
      if (sections.has(sec) && sections.get(sec) !== prova) continue // o header e a autoridade
      sections.set(sec, prova)
    }
  }
  return sections
}

/**
 * checkProofs - a validacao completa do contrato sobre o doc real.
 * @returns {{ unregistered: string[], stale: string[], brokenPins: string[], brokenRuns: string[] }}
 *   unregistered: secao/Prova detectada no doc sem entrada no manifest
 *                 (ou com secao divergente) - o growth contract.
 *   stale: entrada do manifest cuja secao NAO esta no doc (secao
 *          renumerada/removida = drift - a direcao manifest -> doc).
 *   brokenPins: module da classe nao existe (PIN REALITY).
 *   brokenRuns: run nao-nulo que nao aparece no texto do doc (RUN
 *               REALITY - o run nunca e inventado).
 */
export function checkProofs(docPath = DOC) {
  const detected = scanProvaSections(docPath)
  const byProva = new Map()
  for (const c of PROOF_CLASSES) {
    for (const p of c.proofs) byProva.set(p.prova, { class: c.class, section: p.section, run: p.run })
  }
  const unregistered = []
  for (const [sec, prova] of detected) {
    const e = byProva.get(prova)
    if (!e) unregistered.push(`Prova ${prova} (secao ${sec}) sem entrada no PROOF_CLASSES`)
    else if (e.section !== sec) unregistered.push(`Prova ${prova}: manifest secao ${e.section} != doc secao ${sec}`)
  }
  const stale = []
  for (const c of PROOF_CLASSES) {
    for (const p of c.proofs) {
      if (!detected.has(p.section)) stale.push(`entrada ${c.class} / Prova ${p.prova} (secao ${p.section}) sem secao no doc`)
      else if (detected.get(p.section) !== p.prova) stale.push(`entrada ${c.class} / Prova ${p.prova}: doc secao ${p.section} -> Prova ${detected.get(p.section)}`)
    }
  }
  const brokenPins = []
  for (const c of PROOF_CLASSES) {
    if (!fs.existsSync(path.join(process.cwd(), c.module))) brokenPins.push(`${c.class}: module ${c.module} nao existe`)
  }
  const brokenRuns = []
  const docText = fs.readFileSync(docPath, "utf8")
  for (const c of PROOF_CLASSES) {
    for (const p of c.proofs) {
      if (p.run && !docText.includes(p.run)) brokenRuns.push(`${c.class} / Prova ${p.prova}: run ${p.run} ausente no doc`)
    }
  }
  return { unregistered, stale, brokenPins, brokenRuns }
}

/** CLI: `node scripts/proofs-manifest.mjs [--check]` - exit 0/1/2. */
export function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--check")
  if (unknown.length > 0) {
    process.stderr.write("proofs-manifest: usage: node scripts/proofs-manifest.mjs [--check]\n")
    return 2
  }
  const { unregistered, stale, brokenPins, brokenRuns } = checkProofs()
  const total = PROOF_CLASSES.reduce((n, c) => n + c.proofs.length, 0)
  if (unregistered.length === 0 && stale.length === 0 && brokenPins.length === 0 && brokenRuns.length === 0) {
    process.stdout.write(
      `proofs-manifest: clean (${PROOF_CLASSES.length} classes / ${total} provas registradas - sec 11.60)\n`,
    )
    return 0
  }
  if (unregistered.length > 0) {
    process.stderr.write(`proofs-manifest: ${unregistered.length} Prova(s) no doc SEM registro no PROOF_CLASSES (sec 11.60):\n`)
    for (const u of unregistered) process.stderr.write(`  ${u}\n`)
    process.stderr.write("  registre a Prova no PROOF_CLASSES de scripts/proofs-manifest.mjs (sec 11.60) e confirme com: node scripts/proofs-manifest.mjs --check\n")
  }
  if (stale.length > 0) {
    process.stderr.write(`proofs-manifest: ${stale.length} entrada(s) do manifest SEM secao detectada no doc (secao renumerada/removida - sec 11.60):\n`)
    for (const s of stale) process.stderr.write(`  ${s}\n`)
    process.stderr.write("  stale nao tem registro de cura - a secao foi renumerada/removida: atualize a secao no PROOF_CLASSES ou remova a entrada (sec 11.60)\n")
  }
  if (brokenPins.length > 0) {
    process.stderr.write(`proofs-manifest: ${brokenPins.length} module(s) de classe inexistente(s) (PIN REALITY - sec 11.60):\n`)
    for (const b of brokenPins) process.stderr.write(`  ${b}\n`)
  }
  if (brokenRuns.length > 0) {
    process.stderr.write(`proofs-manifest: ${brokenRuns.length} run(s) ausente(s) no doc (RUN REALITY - sec 11.60):\n`)
    for (const r of brokenRuns) process.stderr.write(`  ${r}\n`)
  }
  return 1
}

// Entry-point guard: so roda o CLI quando executado direto (vitest importa
// o modulo para os testes das funcoes puras sem efeitos colaterais).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
