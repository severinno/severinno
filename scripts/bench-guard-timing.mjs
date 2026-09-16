#!/usr/bin/env node
// =============================================================================
// bench-guard-timing.mjs — benchmark de wall time do doctor e dos guards
//
// POR QUE EXISTE: a suíte do doctor e a bateria de guards são os gates que
// decidem o merge. Uma regressão de tempo nelas afeta CADA PR — mas sem
// medição versionada, a degradação é impressão, não dado comparável entre
// commits. Este script mede o wall time de cada guard individual, do doctor
// (perfil --ci) e do CUSTO DA UNIFICACAO DO LINT — o que a régua completa
// (prettier --check + eslint . --max-warnings 0) passou a acrescentar em cada
// call site que antes rodava só `eslint .` — registra em JSON versionado
// (commit + timestamp) e permite comparação contra um baseline.
//
// Usage:
//   node scripts/bench-guard-timing.mjs                # mede e imprime
//   node scripts/bench-guard-timing.mjs --json         # salva em latest
//   node scripts/bench-guard-timing.mjs --save         # salva com data
//   node scripts/bench-guard-timing.mjs --compare      # mede e compara vs baseline
//   node scripts/bench-guard-timing.mjs --baseline     # salva como baseline
//   node scripts/bench-guard-timing.mjs --json --compare  # salva + compara
//   node scripts/bench-guard-timing.mjs --samples 3    # amostras por forma de lint
//   node scripts/bench-guard-timing.mjs --no-lint      # só guards + doctor
//
// Exit codes:
//   0 — benchmark completo
//   1 — falha de infra ou comparação com regressão
//   2 — argumento inválido
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { CORE_INVARIANTS, canonicalCommandOf, runCommands } from "./check-forge-parity.mjs"
import { existingWorkflowDirs, workflowFileNames } from "./forge-workflows.mjs"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, "..")
const BENCH_DIR = join(REPO_ROOT, "docs", "benchmarks")
const LATEST_FILE = "guard-timing-latest.json"
const BASELINE_FILE = "guard-timing-baseline.json"

// ── Guards individuais (comando → label) ──────────────────────────────────
// Lista derivada de .gitea/workflows/ci.yml: cada `run:` do job `guards`
// que é um gate verificável. Ordem = ordem de execução na pipeline.
const GUARDS = [
  { cmd: "bun run check:required-checks", label: "check:required-checks" },
  { cmd: "node scripts/check-script-headers.mjs", label: "check:script-headers" },
  { cmd: "bun run check:prove-docs", label: "check:prove-docs" },
  { cmd: "bun run check:registry-source", label: "check:registry-source" },
  { cmd: "bun scripts/check-doctor-ci.mjs", label: "check:doctor-ci" },
  { cmd: "bun run check:runner-base", label: "check:runner-base" },
  { cmd: "bun run check:workflow-refs:internal", label: "check:workflow-refs" },
  { cmd: "bun run check:ts-nocheck", label: "check:ts-nocheck" },
  { cmd: "bun run check:forge-workflow-scope", label: "check:forge-workflow-scope" },
  { cmd: "bun run check:forge-parity", label: "check:forge-parity" },
  { cmd: "bun run check:bun-audit-baseline", label: "check:bun-audit" },
  { cmd: "bun scripts/rotate-secrets.mjs --check", label: "check:secret-leaks" },
  { cmd: "bun run check:seed-hooks", label: "check:seed-hooks" },
  { cmd: "bun run check:sentinel-producer", label: "check:sentinel-producer" },
  { cmd: "bun run check:bun-mirror", label: "check:bun-mirror" },
  { cmd: "bun run check:no-setup-bun", label: "check:no-setup-bun" },
  { cmd: "bun scripts/check-hooks-symmetry.mjs", label: "check:hooks-symmetry" },
  { cmd: "node scripts/prove-runner-image-gate.mjs", label: "runner-image:prove" },
]

// Doctor (perfil --ci): roda a bateria de guards + contrato + mirrors, sem
// docker/rede/proteção/runner-labels/board. Exit 0 = PRONTA, 2 = INDETERMINADA.
const DOCTOR_CMD =
  "node scripts/forge-doctor.mjs --ci --json --expected ${BUN_VERSION} --expected-var IMAGE_REGISTRY=${IMAGE_REGISTRY} --expected-var IMAGE_NAMESPACE=${IMAGE_NAMESPACE}"

// ── Lint: o custo da unificacao ───────────────────────────────────────────
//
// POR QUE MEDIR AQUI: a unificacao do lint levou o par completo
// (`prettier --check` + `eslint . --max-warnings 0`) a call sites que antes
// rodavam so `eslint .`. Consistencia de gate foi COMPRADA com wall time de CI,
// e o preco tem de ser o MESMO tipo de dado do resto do benchmark: medido, com
// commit e comparavel — nao impressao.
//
// TRES FORMAS, TRES PERGUNTAS:
//
//   current     o comando canonico do invariante `lint` — o que as duas forjas
//               rodam hoje.
//   legacy      a REGUA ANTERIOR daqueles call sites (`eslint .` puro). E um
//               CONTRAFACTUAL: o comando saiu das pipelines, mas continua
//               existindo no npm — roda-lo hoje, na MESMA maquina, e o que
//               transforma "acrescentou" em diferenca comparavel. Sem ele, o
//               delta so poderia ser afirmado.
//   added-half  `prettier --check` isolado: a metade NOVA. Se o delta medido
//               nao fechar com ela, o numero tem outra causa e a atribuicao
//               esta errada — por isso a conferencia e feita, nao presumida.
//
// A LISTA DE CALL SITES vem dos proprios workflows (diretorios da fonte unica
// `forge-workflows`, comandos de `runCommands` do `check-forge-parity`): uma
// pipeline que passe a rodar o lint entra na conta sozinha. O que e DECLARADO —
// e provado contra a lista medida — e QUAIS call sites pagaram o custo novo.

/** O invariante do CORE que declara a regua do lint. */
const LINT_INVARIANT = CORE_INVARIANTS.find((i) => i.id === "lint")
if (!LINT_INVARIANT) {
  throw new Error(
    "CORE_INVARIANTS nao declara o invariante 'lint' — sem ele nao ha regua canonica para medir",
  )
}

/** O comando canonico do lint, resolvido da MESMA fonte que o CI usa. */
export const LINT_CANONICAL_CMD = canonicalCommandOf(LINT_INVARIANT)

/**
 * A REGUA ANTERIOR dos call sites que pagaram a unificacao: ate 586b7c07 o script
 * `lint` do package.json era `eslint .` — sem prettier e sem o teto de warnings.
 * `bunx` e o binario local, que e o que o `bun run` resolvia.
 */
export const LINT_LEGACY_CMD = "bunx eslint ."

/** O script `lint` do package.json — a fonte unica da regua. */
function lintEntry() {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
  const entry = pkg.scripts?.lint
  if (typeof entry !== "string" || entry.trim() === "") {
    throw new Error("package.json sem o script 'lint' — o benchmark mede a regua declarada")
  }
  return entry
}

/**
 * A metade NOVA (`prettier --check ...`) LIDA do script `lint`, nao digitada
 * aqui: dois lugares descrevendo o mesmo escopo divergem no dia em que um deles
 * mudar, e o benchmark mediria outra coisa sem avisar. `bunx` entra como
 * lancador porque `bun run lint` faria as DUAS metades.
 */
export const LINT_PRETTIER_CMD = `bunx ${lintEntry().split(" && ")[0].trim()}`

/**
 * Os call sites de `bun run lint` HOJE — derivados dos workflows do repositorio,
 * nao cravados: quantas pipelines pagam o custo e um FATO medido.
 *
 * @param {string} [root]
 * @returns {{file: string, count: number}[]}
 */
export function lintCallSites(root = REPO_ROOT) {
  const sites = []
  for (const dir of existingWorkflowDirs(root)) {
    for (const name of workflowFileNames(root, dir)) {
      const content = readFileSync(join(root, dir, name), "utf8")
      const count = runCommands(content).filter((c) => c.trim() === LINT_CANONICAL_CMD).length
      if (count > 0) sites.push({ file: `${dir}/${name}`, count })
    }
  }
  return sites
}

/**
 * Os call sites que PAGARAM o custo novo da unificacao.
 *
 * O `lint-guard` do pr-check.yml NAO entra: ele JA rodava o par completo inline
 * antes de 586b7c07 (era a unica fonte da regua) — a unificacao levou a MESMA
 * regua aos outros, e o custo novo e so desses. Declarar de menos inflaria a
 * conta; de mais, esconderia um call site que continua laxo.
 *
 * @type {{file: string, where: string}[]}
 */
export const LINT_UPGRADED_SITES = [
  { file: ".gitea/workflows/ci.yml", where: "job `lint` (forja dona do merge)" },
  { file: ".github/workflows/ci.yml", where: "job `lint` (espelho)" },
  { file: ".github/workflows/pr-check.yml", where: "job `check`, passo `Lint`" },
  { file: ".github/workflows/release-deploy.yml", where: "passo de lint do deploy" },
]

/**
 * Arquivos que AINDA executam a regua laxa (`eslint .` puro). Depois da
 * unificacao a lista tem de estar VAZIA: e a prova de que o "antes" medido
 * deixou de existir nas pipelines (e nao de que o benchmark comparou duas coisas
 * que rodam ao mesmo tempo).
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function legacyCallSites(root = REPO_ROOT) {
  const files = []
  for (const dir of existingWorkflowDirs(root)) {
    for (const name of workflowFileNames(root, dir)) {
      const content = readFileSync(join(root, dir, name), "utf8")
      if (runCommands(content).some((c) => c.trim() === LINT_LEGACY_CMD)) {
        files.push(`${dir}/${name}`)
      }
    }
  }
  return files
}

/**
 * Mede uma forma do lint `samples` vezes. O valor reportado e a MEDIANA ALTA
 * (indice central da lista ordenada): wall time so INFLA com ruido de maquina,
 * entao a mediana representa melhor que a media — e as amostras cruas ficam no
 * JSON, para o numero ser auditavel em vez de acreditado.
 *
 * A FORMA DO JSON IMPORTA: o arquivo versionado e gerado aqui e passa pelo
 * `bun run lint` do repositorio, entao ele tem de sair PRETTIER-ESTAVEL. As
 * amostras vao como array de OBJETOS (a mesma forma dos outros benchmarks do
 * repo) e nao como array de escalares: o prettier colapsa array curto de numero
 * numa linha, o `JSON.stringify(…, 2)` nao, e o arquivo versionado passa a
 * REPROVAR o lint de quem o commitar (aconteceu).
 *
 * @param {string} cmd
 * @param {number} samples
 * @returns {{ms: number, minMs: number, maxMs: number, runs: {ms: number, exit: number}[], exit: number, ok: boolean}}
 */
function measureRepeats(cmd, samples) {
  const raw = []
  for (let i = 0; i < samples; i++) raw.push(measure(cmd, { timeoutMs: 600_000 }))
  const sorted = raw.map((r) => r.ms).sort((a, b) => a - b)
  return {
    ms: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    runs: raw.map((r) => ({ ms: r.ms, exit: r.exit })),
    exit: raw[raw.length - 1].exit,
    ok: raw.every((r) => r.exit === 0),
  }
}

/**
 * As violacoes do CONTRATO da conta do lint, a partir dos call sites medidos.
 * Pura em relacao ao filesystem e ao relogio (recebe a lista): e o que permite
 * provar a conferencia sem medir wall time.
 *
 * @param {{file: string, count: number}[]} sites
 * @returns {string[]}
 */
export function lintCostViolations(sites) {
  const violations = []

  // A declaracao dos pagantes e PROVADA: um arquivo declarado que nao tem mais
  // `run: bun run lint` faria a conta medir um lugar onde o lint nao roda.
  const siteFiles = new Set(sites.map((s) => s.file))
  for (const declared of LINT_UPGRADED_SITES) {
    if (!siteFiles.has(declared.file)) {
      violations.push(
        `${declared.file}: declarado como pagante do custo da unificacao, mas nenhum 'run:' executa ${LINT_CANONICAL_CMD} — a conta mediria um lugar onde o lint nao roda mais`,
      )
    }
  }

  // A regua LAXA nao pode continuar em workflow nenhum: se continuar, a
  // unificacao esta incompleta e o delta medido tem mais de uma causa.
  for (const file of legacyCallSites()) {
    violations.push(
      `${file}: ainda executa a regua LAXA (${LINT_LEGACY_CMD}) — a unificacao esta incompleta e o delta medido tem mais de uma causa`,
    )
  }

  return violations
}

/**
 * Mede o custo da unificacao do lint: o delta entre a regua completa (hoje) e a
 * regua anterior (contrafactual), por call site e por rodada de CI, com a
 * atribuicao conferida contra a metade nova.
 *
 * @param {number} [samples]
 * @returns {object}
 */
export function measureLintCost(samples = 2) {
  const forms = [
    { role: "current", label: "lint (par completo — hoje)", cmd: LINT_CANONICAL_CMD },
    { role: "legacy", label: "lint (regua anterior — contrafactual)", cmd: LINT_LEGACY_CMD },
    { role: "added-half", label: "prettier --check (a metade nova)", cmd: LINT_PRETTIER_CMD },
  ]
  const measured = forms.map((form) => ({ ...form, ...measureRepeats(form.cmd, samples) }))
  const byRole = (role) => measured.find((m) => m.role === role)
  const current = byRole("current")
  const legacy = byRole("legacy")
  const addedHalf = byRole("added-half")

  const sites = lintCallSites()
  const violations = lintCostViolations(sites)

  const addedPerSiteMs = current.ms - legacy.ms
  const attributionPct =
    addedHalf.ms > 0 ? Math.abs(addedPerSiteMs - addedHalf.ms) / addedHalf.ms : 1
  return {
    canonicalCmd: LINT_CANONICAL_CMD,
    legacyCmd: LINT_LEGACY_CMD,
    prettierCmd: LINT_PRETTIER_CMD,
    samplesPerForm: samples,
    forms: measured,
    sites,
    pipelineFiles: sites.length,
    callSites: sites.reduce((acc, s) => acc + s.count, 0),
    upgraded: LINT_UPGRADED_SITES,
    upgradedSites: LINT_UPGRADED_SITES.length,
    addedPerSiteMs,
    addedHalfMs: addedHalf.ms,
    attributionPct: Number(attributionPct.toFixed(4)),
    attributionMatches: attributionPct <= 0.1,
    addedPerFanOutMs: addedPerSiteMs * LINT_UPGRADED_SITES.length,
    violations,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getCommitHash() {
  try {
    const { stdout } = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 5_000,
    })
    return stdout.trim()
  } catch {
    return "unknown"
  }
}

function getCommitTimestamp() {
  try {
    const { stdout } = spawnSync("git", ["log", "-1", "--format=%ci"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 5_000,
    })
    return stdout.trim()
  } catch {
    return new Date().toISOString()
  }
}

/** Mede o wall time de um comando. Devolve {ms, exit, ok}. */
function measure(cmd, { timeoutMs = 120_000, env = process.env } = {}) {
  const start = performance.now()
  const res = spawnSync("bash", ["-c", cmd], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const ms = Math.round(performance.now() - start)
  return {
    ms,
    exit: res.status,
    ok: res.status === 0 || res.status === 2, // 2 = INDETERMINADA (doctor)
    stderr: (res.stderr ?? "").slice(-500),
  }
}

// ── Benchmark ─────────────────────────────────────────────────────────────

/**
 * @param {{samples?: number, lint?: boolean}} [opts]
 */
function runBenchmark({ samples = 2, lint = true } = {}) {
  const commit = getCommitHash()
  const commitDate = getCommitTimestamp()
  const timestamp = new Date().toISOString()

  // Envia vars do ambiente ou fallbacks para o doctor --ci
  const bunVersion = process.env.BUN_VERSION || "1.3.14"
  const imageRegistry = process.env.IMAGE_REGISTRY || "ghcr.io"
  const imageNamespace = process.env.IMAGE_NAMESPACE || "severinno"

  const doctorEnv = {
    ...process.env,
    BUN_VERSION: bunVersion,
    IMAGE_REGISTRY: imageRegistry,
    IMAGE_NAMESPACE: imageNamespace,
  }

  // ── Guards individuais ──────────────────────────────────────────────────
  const guards = []
  let guardsTotalMs = 0
  for (const g of GUARDS) {
    const r = measure(g.cmd)
    guards.push({
      label: g.label,
      cmd: g.cmd,
      ms: r.ms,
      exit: r.exit,
      ok: r.ok,
    })
    guardsTotalMs += r.ms
  }

  // ── Doctor (perfil --ci) ────────────────────────────────────────────────
  const doctorCmd = DOCTOR_CMD.replace(/\$\{BUN_VERSION\}/g, bunVersion)
    .replace(/\$\{IMAGE_REGISTRY\}/g, imageRegistry)
    .replace(/\$\{IMAGE_NAMESPACE\}/g, imageNamespace)
  const doctorResult = measure(doctorCmd, { env: doctorEnv })

  // ── Lint: o custo da unificacao ─────────────────────────────────────────
  const lintCost = lint ? measureLintCost(samples) : null

  // ── Soma total ─────────────────────────────────────────────────────────
  const totalMs = guardsTotalMs + doctorResult.ms

  const result = {
    meta: {
      tool: "bench-guard-timing",
      version: 2,
      commit,
      commitDate,
      timestamp,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    summary: {
      guardsCount: guards.length,
      guardsTotalMs,
      doctorMs: doctorResult.ms,
      doctorExit: doctorResult.exit,
      totalMs,
      lintAddedPerSiteMs: lintCost?.addedPerSiteMs ?? null,
      lintAddedPerFanOutMs: lintCost?.addedPerFanOutMs ?? null,
    },
    guards,
    doctor: {
      label: "doctor --ci",
      cmd: doctorCmd,
      ms: doctorResult.ms,
      exit: doctorResult.exit,
      ok: doctorResult.ok,
    },
    lint: lintCost,
  }

  return result
}

// ── Relatório legível ─────────────────────────────────────────────────────

/**
 * Imprime a secao do custo do lint: as tres formas, os call sites medidos, os
 * que pagaram o custo novo e a atribuicao conferida.
 *
 * @param {object} lint  resultado de measureLintCost
 */
function printLintReport(lint) {
  console.log("  Lint — o custo da unificacao (uma regua so nas duas forjas):")
  console.log("  ─────────────────────────────────────────────────────")
  for (const form of lint.forms) {
    const mark = form.ok ? "✅" : "⚠️ "
    const time = `${(form.ms / 1000).toFixed(1)}s`
    const samples = form.runs.map((r) => (r.ms / 1000).toFixed(1)).join("/")
    console.log(
      `    ${mark} ${form.label.padEnd(40)} ${time.padStart(7)}  (${form.runs.length}x: ${samples}s)`,
    )
  }
  console.log("  ─────────────────────────────────────────────────────")
  console.log(
    `    call sites de \`${lint.canonicalCmd}\`: ${lint.callSites} em ${lint.pipelineFiles} pipelines`,
  )
  for (const site of lint.sites) {
    console.log(`      · ${site.file}${site.count > 1 ? ` (${site.count} call sites)` : ""}`)
  }
  console.log(`    pagaram o custo novo (regua laxa -> par completo): ${lint.upgradedSites}`)
  for (const site of lint.upgraded) console.log(`      · ${site.file} — ${site.where}`)
  console.log()
  console.log(`    acrescentado por call site: +${(lint.addedPerSiteMs / 1000).toFixed(1)}s`)
  console.log(
    `    acrescentado por rodada de CI (${lint.upgradedSites} call sites): +${(lint.addedPerFanOutMs / 1000).toFixed(1)}s`,
  )
  console.log(
    `    a metade nova isolada (prettier): ${(lint.addedHalfMs / 1000).toFixed(1)}s — atribuicao ${lint.attributionMatches ? "confere" : "NAO confere"} (${(lint.attributionPct * 100).toFixed(0)}% de diferenca)`,
  )
  for (const violation of lint.violations) console.log(`    ❌ ${violation}`)
  console.log()
}

function printReport(result) {
  const { meta, summary, guards, doctor, lint } = result
  console.log()
  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log("   ⏱  BENCH — wall time do doctor e guards")
  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log()
  console.log(`  commit: ${meta.commit} (${meta.commitDate})`)
  console.log(`  node: ${meta.nodeVersion} · ${meta.platform}/${meta.arch}`)
  console.log()

  // Tabela de guards
  console.log("  Guards individuais:")
  console.log("  ─────────────────────────────────────────────────────")
  for (const g of guards) {
    const mark = g.ok ? "✅" : "❌"
    const time = `${(g.ms / 1000).toFixed(1)}s`
    console.log(`    ${mark} ${g.label.padEnd(30)} ${time.padStart(8)}  (exit ${g.exit})`)
  }
  console.log("  ─────────────────────────────────────────────────────")
  console.log(
    `  Total guards: ${(summary.guardsTotalMs / 1000).toFixed(1)}s (${summary.guardsCount} gates)`,
  )
  console.log()

  // Doctor
  const dMark = doctor.ok ? "✅" : "❌"
  console.log(`  Doctor (--ci): ${dMark} ${(doctor.ms / 1000).toFixed(1)}s (exit ${doctor.exit})`)
  console.log()

  // Lint (custo da unificacao)
  if (lint) printLintReport(lint)

  // Total
  console.log(`  TOTAL: ${(summary.totalMs / 1000).toFixed(1)}s`)
  console.log()
}

// ── Comparação ────────────────────────────────────────────────────────────

function loadBaseline() {
  const p = join(BENCH_DIR, BASELINE_FILE)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

function compareReport(current, baseline) {
  if (!baseline) {
    console.log("  ⚠️  Sem baseline para comparar. Execute com --baseline primeiro.")
    return { regression: false }
  }

  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log("   📊 COMPARAÇÃO vs baseline")
  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log()
  console.log(`  baseline: ${baseline.meta?.commit ?? "?"} (${baseline.meta?.timestamp ?? "?"})`)
  console.log(`  atual:    ${current.meta.commit} (${current.meta.timestamp})`)
  console.log()

  const THRESHOLD = 0.2 // 20% de piora é regressão
  let regression = false

  // Guards individuais
  const baselineGuards = new Map((baseline.guards ?? []).map((g) => [g.label, g]))
  console.log("  Guards:")
  console.log("  ─────────────────────────────────────────────────────")
  for (const g of current.guards) {
    const b = baselineGuards.get(g.label)
    if (!b) {
      console.log(`    ➕ ${g.label.padEnd(30)} ${(g.ms / 1000).toFixed(1)}s (novo)`)
      continue
    }
    const diff = g.ms - b.ms
    const pct = b.ms > 0 ? diff / b.ms : 0
    const arrow = diff > 0 ? "📈" : diff < 0 ? "📉" : "  "
    const sign = diff > 0 ? "+" : ""
    const flag = pct > THRESHOLD ? " ⚠️  REGRESSÃO" : ""
    console.log(
      `    ${arrow} ${g.label.padEnd(30)} ${(g.ms / 1000).toFixed(1)}s (${sign}${(diff / 1000).toFixed(1)}s, ${sign}${(pct * 100).toFixed(0)}%)${flag}`,
    )
    if (pct > THRESHOLD) regression = true
  }
  console.log("  ─────────────────────────────────────────────────────")

  // Doctor
  const bDoctor = baseline.doctor
  if (bDoctor) {
    const diff = current.doctor.ms - bDoctor.ms
    const pct = bDoctor.ms > 0 ? diff / bDoctor.ms : 0
    const arrow = diff > 0 ? "📈" : diff < 0 ? "📉" : "  "
    const sign = diff > 0 ? "+" : ""
    const flag = pct > THRESHOLD ? " ⚠️  REGRESSÃO" : ""
    console.log(
      `    ${arrow} doctor --ci${" ".repeat(20)} ${(current.doctor.ms / 1000).toFixed(1)}s (${sign}${(diff / 1000).toFixed(1)}s, ${sign}${(pct * 100).toFixed(0)}%)${flag}`,
    )
    if (pct > THRESHOLD) regression = true
  }

  // Lint (custo da unificacao). O baseline v1 nao tem a secao: sem ela, anota
  // que o numero e novo em vez de inventar uma comparacao.
  if (current.lint) {
    const bLint = baseline.lint
    if (bLint) {
      const diff = current.lint.addedPerFanOutMs - bLint.addedPerFanOutMs
      const pct = bLint.addedPerFanOutMs > 0 ? diff / bLint.addedPerFanOutMs : 0
      const sign = diff > 0 ? "+" : ""
      const flag = pct > THRESHOLD ? " ⚠️  REGRESSÃO" : ""
      console.log(
        `    ${diff > 0 ? "📈" : diff < 0 ? "📉" : "  "} lint (custo por rodada)${" ".repeat(7)} ${(current.lint.addedPerFanOutMs / 1000).toFixed(1)}s (${sign}${(diff / 1000).toFixed(1)}s, ${sign}${(pct * 100).toFixed(0)}%)${flag}`,
      )
      if (pct > THRESHOLD) regression = true
    } else {
      console.log(
        `    ➕ lint (custo por rodada)${" ".repeat(7)} ${(current.lint.addedPerFanOutMs / 1000).toFixed(1)}s (novo no baseline)`,
      )
    }
  }

  // Total
  const bTotal = baseline.summary?.totalMs ?? 0
  const totalDiff = current.summary.totalMs - bTotal
  const totalPct = bTotal > 0 ? totalDiff / bTotal : 0
  const totalSign = totalDiff > 0 ? "+" : ""
  console.log()
  console.log(
    `  TOTAL: ${(current.summary.totalMs / 1000).toFixed(1)}s (${totalSign}${(totalDiff / 1000).toFixed(1)}s vs baseline)`,
  )
  if (totalPct > THRESHOLD) {
    console.log(`  ⚠️  REGRESSÃO DE TEMPO: +${(totalPct * 100).toFixed(0)}% (limiar: 20%)`)
    regression = true
  }

  console.log()
  return { regression }
}

// ── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    json: false,
    save: false,
    baseline: false,
    compare: false,
    lint: true,
    samples: 2,
    help: false,
    error: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "--save") opts.save = true
    else if (arg === "--baseline") opts.baseline = true
    else if (arg === "--compare") opts.compare = true
    else if (arg === "--no-lint") opts.lint = false
    else if (arg === "--samples") {
      const raw = argv[++i]
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 1) {
        opts.error = `--samples exige um inteiro >= 1 (recebido: ${raw ?? "nada"})`
        return opts
      }
      opts.samples = n
    } else if (arg === "-h" || arg === "--help") opts.help = true
    else opts.error = `argumento desconhecido: ${arg}`
  }
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(`bench-guard-timing — mede wall time do doctor e guards

Usage:
  node scripts/bench-guard-timing.mjs                # mede e imprime
  node scripts/bench-guard-timing.mjs --json         # salva em latest
  node scripts/bench-guard-timing.mjs --save         # salva com data
  node scripts/bench-guard-timing.mjs --baseline     # salva como baseline
  node scripts/bench-guard-timing.mjs --compare      # compara vs baseline
  node scripts/bench-guard-timing.mjs --json --compare  # salva + compara
  node scripts/bench-guard-timing.mjs --samples 3    # amostras por forma de lint
  node scripts/bench-guard-timing.mjs --no-lint      # só guards + doctor

Exit codes: 0 sucesso · 1 falha/regressão · 2 argumento inválido`)
    return 0
  }
  if (opts.error) {
    console.error(`bench-guard-timing: ${opts.error}`)
    return 2
  }

  const result = runBenchmark({ samples: opts.samples, lint: opts.lint })
  printReport(result)

  // Salvar
  if (opts.json || opts.save || opts.baseline) {
    mkdirSync(BENCH_DIR, { recursive: true })
  }

  if (opts.baseline) {
    const p = join(BENCH_DIR, BASELINE_FILE)
    writeFileSync(p, JSON.stringify(result, null, 2) + "\n")
    console.log(`  📁 Baseline salvo: ${p}`)
  } else if (opts.json) {
    const p = join(BENCH_DIR, LATEST_FILE)
    writeFileSync(p, JSON.stringify(result, null, 2) + "\n")
    console.log(`  📁 Resultado salvo: ${p}`)
  }

  if (opts.save && !opts.baseline) {
    const date = new Date().toISOString().slice(0, 10)
    const p = join(BENCH_DIR, `guard-timing-${date}.json`)
    writeFileSync(p, JSON.stringify(result, null, 2) + "\n")
    console.log(`  📁 Resultado salvo: ${p}`)
  }

  // Comparar
  if (opts.compare) {
    const baseline = loadBaseline()
    const { regression } = compareReport(result, baseline)
    if (regression) return 1
  }

  return 0
}

// ── modo CLI (so quando invocado diretamente, nao quando importado) ────────
// O modulo e importavel (o teste do contrato do lint le os call sites sem
// executar a medicao): sem este guard, um import derrubaria o processo do teste
// com o exit code do benchmark.
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "bench-guard-timing.mjs"

if (isMain) process.exit(main())
