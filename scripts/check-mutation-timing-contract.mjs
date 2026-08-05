#!/usr/bin/env node

// =============================================================================
// check-mutation-timing-contract.mjs
//
// CI guard (fast gate, <1s, node-puro) que valida que os MARKERS DE CONTRATO
// do step de mutation-coord estão CONSISTENTES entre os QUATRO locais que os
// duplicam — travando a duplicação contra drift entre o script e o teste:
//
//   1. .github/workflows/seed-guards.yml          — FONTE DA VERDADE (job/step reais)
//   2. scripts/measure-mutation-timing.mjs        — markers SUBSTRING (usados em .includes())
//   3. scripts/test-mutation-timing-budget.sh     — JOB_NAME=/STEP_NAME= (nomes completos)
//   4. src/lib/__tests__/measure-mutation-timing.test.ts — literais dos fixtures
//
// Por que existe: o medidor acha o job/step por
// `j.name.includes(JOB_NAME_MARKER)` (primeiro o JOB, depois o STEP DENTRO
// desse job) — a MESMA semântica do extractMutationStep. O mutation test
// (fixtures da jobs API) e o teste unitário duplicam os NOMES COMPLETOS. Se
// um PR renomear o job/step no seed-guards.yml SEM atualizar os outros três,
// o medidor passa a achar NADA (exit 2 drift) e o mutation test/teste
// unitário ficam exercendo nomes FANTASMA — o CI passaria em silêncio até o
// run real falhar. Este guard fecha o par nos QUATRO lados de uma vez:
//
//   → markers do medidor ⊆ nomes reais do seed-guards (o .includes() ainda casa)
//   → nomes completos do mutation test === nomes reais (fixture reproduz o contrato)
//   → literais do teste unitário CONTÊM os nomes reais (fixtures seguem a fonte)
//   ← discriminação: NENHUM outro literal de job do teste contém o marker do
//     medidor (se o marker virar amplo demais — ex.: 'Mutation Test' — o
//     fixture NEGATIVO 'Mutation Test (seed dev E2E pega regressões?)'
//     passaria a casar e a medição mentiria; o guard detecta)
//
// ESCALA DE JOB: o seed-guards.yml tem DOIS jobs 'Mutation Test (...)' — o
// do contrato (contrato coordenado) e o seed-dev E2E (linha ~224, step 'Run
// mutation test (seed dev E2E deve FALHAR)'). O step do contrato é o do job
// do contrato (mesma lógica do medidor: acha o job pelo marker do JOB e só
// então o step dentro dele) — o guard espelha isso extraindo pares
// job→steps e resolvendo o par do contrato pelo marker do job. Também
// falha se DOIS jobs casarem o marker do job (o .find() do medidor pegaria
// o primeiro em silêncio — ambigüidade = drift) ou dois steps casarem o
// marker do step dentro do job do contrato.
//
// Usage:
//   node scripts/check-mutation-timing-contract.mjs          # repo atual (working tree)
//   node scripts/check-mutation-timing-contract.mjs --root X # fixture (testes)
//   node scripts/check-mutation-timing-contract.mjs --staged # git diff --cached (pre-commit)
//   node scripts/check-mutation-timing-contract.mjs --staged --base HEAD  # ref (CI)
//
// Exit codes:
//   0 — contrato consistente (pass)
//   1 — violação: drift entre os 4 locais (mensagem com o par divergente)
//   2 — infra: arquivo ausente/ilegível OU git/ref indisponível (fail-closed)
//
// Modo --staged (espelho do check-bun-mirror): valida o estado QUE SERIA
// commitado — lê os 4 arquivos do ÍNDICE git (git show :path) ou de uma REF
// com --base, e roda o MESMO check. Um rename staged no seed-guards sem os
// outros 3 locais COORDENADOS falha antes do merge (estágio parcial).
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// ── Paths relativos ao root (fixos — o contrato vive em arquivos concretos) ─
const FILES = {
  seedGuards: join(".github", "workflows", "seed-guards.yml"),
  medidor: join("scripts", "measure-mutation-timing.mjs"),
  mutationTest: join("scripts", "test-mutation-timing-budget.sh"),
  unitTest: join("src", "lib", "__tests__", "measure-mutation-timing.test.ts"),
}

/**
 * Valida uma ref git (ex.: HEAD, origin/main) — rejeita metacharacters de
 * shell/argumentos (espelho do check-bun-mirror.mjs): o execFileSync usa
 * array de args (sem shell), mas uma ref com caracteres inválidos falharia
 * com mensagem confusa do git — o guard falha cedo com diagnóstico claro.
 *
 * @param {string} ref
 * @returns {boolean}
 */
export function isValidGitRef(ref) {
  return /^[a-zA-Z0-9._\-/]+$/.test(ref)
}

/**
 * Lê um arquivo do ESTADO git (índice via `:path`, ou ref via `ref:path`)
 * — a fonte do modo --staged. Indexado por `git show` porque o índice é a
 * fonte da verdade do que SERIA commitado (mesma semântica do git diff
 * --cached), independente do working tree.
 *
 * @param {string} root  diretório do repo
 * @param {string|null} ref  ref git (null = índice)
 * @param {string} rel  caminho relativo do arquivo
 * @returns {{ content: string } | { error: string }}
 */
export function gitShowFile(root, ref, rel) {
  // git exige forward slashes no path (no Windows o join() produz `\\` —
  // `git show :.github\\workflows\\x.yml` falha com 'ambiguous argument';
  // o teste CLI staged-crashou exatamente assim no Windows e foi travado).
  const gitPath = rel.split(/[\\/]/).join("/")
  const spec = ref ? `${ref}:${gitPath}` : `:${gitPath}`
  try {
    const content = execFileSync("git", ["-C", root, "show", spec], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    return { content }
  } catch (e) {
    const stderr = (e.stderr ?? "").toString().trim().slice(0, 200)
    return { error: `git show '${spec}' falhou: ${stderr || e.message}` }
  }
}

/**
 * Modo --staged: coleta os 4 arquivos do contrato do ESTADO git (índice por
 * padrão, ou a ref dada) em vez do working tree — validando o que SERIA
 * commitado, não o working tree. Reusa os MESMOS extractors do
 * collectContractData (fonte única do parse).
 *
 * @param {string} root  diretório do repo
 * @param {string|null} ref  ref git (null = índice)
 * @returns {{ data: object } | { error: string }}
 */
export function collectStagedData(root, ref) {
  const contents = {}
  for (const [key, rel] of Object.entries(FILES)) {
    const res = gitShowFile(root, ref, rel)
    if (res.error) return { error: res.error }
    contents[key] = res.content
  }
  return { data: buildContractInput(contents) }
}

// ── Helpers puros (exportados para testes) ────────────────────────────────

/**
 * Extrai os markers SUBSTRING do medidor (export const JOB_NAME_MARKER / ...
 * STEP_NAME_MARKER). Os markers são o que o medidor usa em .includes() para
 * achar o job/step na jobs API — a âncora da discriminação.
 *
 * @param {string} content  conteúdo de scripts/measure-mutation-timing.mjs
 * @returns {{ jobMarker: string, stepMarker: string } | null}
 *   null quando os exports não são encontrados (estrutura quebrada → infra)
 */
export function extractMedidorMarkers(content) {
  const job = content.match(/export const JOB_NAME_MARKER\s*=\s*"([^"]+)"/)
  const step = content.match(/export const STEP_NAME_MARKER\s*=\s*"([^"]+)"/)
  if (!job || !step) return null
  return { jobMarker: job[1], stepMarker: step[1] }
}

/**
 * Extrai os pares job→steps de 'Mutation Test (...)' do seed-guards.yml — a
 * ESCALA DE JOB: o seed-dev E2E também tem job/step 'Mutation Test (...)' /
 * 'Run mutation test (...)', então cada step fica atrelado ao JOB que o
 * contém (mesma semântica do medidor: primeiro acha o job, depois o step
 * dentro dele). Um job é toda linha `name: Mutation Test (...)` SEM o dash
 * de step; um step é toda linha `- name: Run mutation test (...)` — atrelado
 * ao ÚLTIMO job visto (no YAML, os steps vêm logo após o name do job e antes
 * do próximo job).
 *
 * @param {string} content  conteúdo de .github/workflows/seed-guards.yml
 * @returns {{ jobName: string, stepNames: string[] }[]} pares na ordem do arquivo
 */
export function extractSeedGuardsJobs(content) {
  const jobs = []
  let current = null
  for (const line of content.split(/\r?\n/)) {
    // job: `    name: Mutation Test (...)` (sem dash — o step tem dash)
    const job = line.match(/^\s{2,}name:\s*(Mutation Test \([^)]*\))\s*$/)
    if (job && !line.trim().startsWith("-")) {
      current = { jobName: job[1], stepNames: [] }
      jobs.push(current)
      continue
    }
    // step: `      - name: Run mutation test (...)` — atrelado ao job atual
    const step = line.match(/^\s*-\s*name:\s*(Run mutation test \([^)]*\))\s*$/)
    if (step && current) current.stepNames.push(step[1])
  }
  return jobs
}

/**
 * Extrai os nomes completos do mutation test (JOB_NAME="..." / STEP_NAME="...")
 * — as fixtures da jobs API reproduzem o contrato com nomes completos.
 *
 * @param {string} content  conteúdo de scripts/test-mutation-timing-budget.sh
 * @returns {{ jobName: string | null, stepName: string | null }}
 */
export function extractMutationTestNames(content) {
  const job = content.match(/^JOB_NAME="([^"]+)"/m)
  const step = content.match(/^STEP_NAME="([^"]+)"/m)
  return { jobName: job?.[1] ?? null, stepName: step?.[1] ?? null }
}

/**
 * Extrai TODOS os literais de job `"Mutation Test (...)"` e step
 * `"Run mutation test (...)"` do teste unitário — incluindo o fixture
 * NEGATIVO (seed-dev E2E), que o guard usa para provar a discriminação.
 *
 * @param {string} content  conteúdo de src/lib/__tests__/measure-mutation-timing.test.ts
 * @returns {{ jobNames: string[], stepNames: string[] }}
 */
export function extractUnitTestLiterals(content) {
  const jobNames = [...content.matchAll(/"Mutation Test \([^"]*\)"/g)].map((m) => m[0].slice(1, -1))
  const stepNames = [...content.matchAll(/"Run mutation test \([^"]*\)"/g)].map((m) =>
    m[0].slice(1, -1),
  )
  return { jobNames: [...new Set(jobNames)], stepNames: [...new Set(stepNames)] }
}

/**
 * Valida a consistência dos QUATRO locais do contrato. Retorna as violações
 * (vazio = consistente). Cada direção de drift tem mensagem própria.
 *
 * A resolução do par do contrato espelha o medidor (extractMutationStep):
 * primeiro acha o JOB pelo marker do job, depois o STEP dentro desse job
 * pelo marker do step — a ESCALA DE JOB (o seed-dev E2E também tem
 * 'Mutation Test' no nome e 'Run mutation test' num step).
 *
 * @param {{
 *   markers: { jobMarker: string, stepMarker: string } | null,
 *   seedJobs: { jobName: string, stepNames: string[] }[],
 *   mutationTestNames: { jobName: string | null, stepName: string | null },
 *   unitJobNames: string[], unitStepNames: string[],
 * }} input  dados extraídos dos 4 locais
 * @returns {string[]} violações (vazio = contrato consistente)
 */
export function checkMutationTimingContract(input) {
  const violations = []
  const { markers, seedJobs, mutationTestNames, unitJobNames, unitStepNames } = input

  if (!markers) {
    return [
      "export const JOB_NAME_MARKER/STEP_NAME_MARKER não encontrados no measure-mutation-timing.mjs — o medidor não expõe os markers (estrutura quebrada ou renomeada)",
    ]
  }

  // ── 0. Resolve o par do contrato (ESCALA DE JOB — espelho do medidor) ──
  // O medidor faz jobs.find(j => j.name.includes(JOB_NAME_MARKER)) e DEPOIS
  // steps.find(s => s.name.includes(STEP_NAME_MARKER)) DENTRO desse job. O
  // guard replica: jobs do seed-guards que contêm o marker do job; ambigüidade
  // (2+ jobs casando) = drift (o .find() do medidor pegaria o primeiro em
  // silêncio). Só então o step dentro do par escolhido.
  const contractJobs = seedJobs.filter((j) => j.jobName.includes(markers.jobMarker))
  if (contractJobs.length === 0) {
    violations.push(
      `nenhum job 'Mutation Test (...)' do seed-guards.yml contém o marker '${markers.jobMarker}' — o medidor (includes) nunca acharia o job (drift de marker ou renomeação do job)`,
    )
    return violations
  }
  if (contractJobs.length > 1) {
    violations.push(
      `AMBIGUIDADE: ${contractJobs.length} jobs do seed-guards.yml contêm o marker '${markers.jobMarker}': [${contractJobs.map((j) => `'${j.jobName}'`).join(", ")}] — o .find() do medidor pegaria o PRIMEIRO em silêncio; afunile o marker`,
    )
    return violations
  }
  const seedJob = contractJobs[0].jobName
  const contractSteps = contractJobs[0].stepNames.filter((s) => s.includes(markers.stepMarker))
  if (contractSteps.length === 0) {
    violations.push(
      `nenhum step 'Run mutation test (...)' DENTRO do job do contrato '${seedJob}' contém o marker '${markers.stepMarker}' — o medidor (includes, escopo do job) nunca acharia o step (drift de marker ou renomeação do step)`,
    )
    return violations
  }
  if (contractSteps.length > 1) {
    violations.push(
      `AMBIGUIDADE: ${contractSteps.length} steps DENTRO do job do contrato '${seedJob}' contêm o marker '${markers.stepMarker}': [${contractSteps.map((s) => `'${s}'`).join(", ")}] — o .find() do medidor pegaria o primeiro em silêncio; afunile o marker`,
    )
    return violations
  }
  const seedStep = contractSteps[0]

  // ── 1. nomes completos do mutation test === nomes reais ────────────────
  if (mutationTestNames.jobName !== seedJob) {
    violations.push(
      `JOB_NAME do mutation test '${mutationTestNames.jobName}' ≠ job real do seed-guards '${seedJob}' — fixture diverge da fonte da verdade`,
    )
  }
  if (mutationTestNames.stepName !== seedStep) {
    violations.push(
      `STEP_NAME do mutation test '${mutationTestNames.stepName}' ≠ step real do seed-guards '${seedStep}' — fixture diverge da fonte da verdade`,
    )
  }

  // ── 2. literais do teste unitário contêm os nomes reais ────────────────
  if (!unitJobNames.includes(seedJob)) {
    violations.push(
      `teste unitário não contém o job real '${seedJob}' em NENHUM literal de fixture — fixtures desatualizadas vs seed-guards.yml`,
    )
  }
  if (!unitStepNames.includes(seedStep)) {
    violations.push(
      `teste unitário não contém o step real '${seedStep}' em NENHUM literal de fixture — fixtures desatualizadas vs seed-guards.yml`,
    )
  }

  // ── 3. discriminação: nenhum OUTRO literal de job contém o marker ─────
  // Se o marker virar amplo demais (ex.: 'Mutation Test'), o fixture
  // NEGATIVO 'Mutation Test (seed dev E2E pega regressões?)' passaria a
  // casar no medidor — a medição mentiria. O guard exige que o marker só
  // case com o job do contrato.
  //
  // OBS: a discriminação NÃO cobre steps — o medidor acha o step SÓ DENTRO
  // do job do contrato (escopo de job), então o literal seed-dev
  // 'Run mutation test (seed dev E2E deve FALHAR)' é IRRELEVANTE (o medidor
  // nunca o vê). Um marker de step amplo demais dentro do job do contrato é
  // pego pela checagem de AMBIGUIDADE acima — a discriminação de steps é
  // redundante E geraria falso positivo.
  for (const literal of unitJobNames) {
    if (literal !== seedJob && literal.includes(markers.jobMarker)) {
      violations.push(
        `literal de job do teste '${literal}' contém o marker '${markers.jobMarker}' mas NÃO é o job do contrato '${seedJob}' — marker amplo demais: o fixture negativo casaria no medidor (discriminação quebrada)`,
      )
    }
  }

  return violations
}

// ── Varredura principal ───────────────────────────────────────────────────

/**
 * Monta o INPUT do contract check a partir dos CONTEÚDOS dos 4 arquivos —
 * fonte única do shape compartilhada entre o modo working tree
 * (collectContractData) e o modo --staged (collectStagedData): se um dia o
 * shape mudar, muda num lugar só (mesmo padrão de reuse do repo, ex.:
 * deriveWarnFromMedian compartilhado entre medidor e trend guard).
 *
 * @param {Record<string, string>} contents  conteúdos dos 4 arquivos (FILES)
 * @returns {object} input do checkMutationTimingContract
 */
export function buildContractInput(contents) {
  return {
    markers: extractMedidorMarkers(contents.medidor),
    seedJobs: extractSeedGuardsJobs(contents.seedGuards),
    mutationTestNames: extractMutationTestNames(contents.mutationTest),
    unitJobNames: extractUnitTestLiterals(contents.unitTest).jobNames,
    unitStepNames: extractUnitTestLiterals(contents.unitTest).stepNames,
  }
}

/**
 * Lê os 4 arquivos do contrato e extrai os dados de cada um.
 *
 * @param {string} root  diretório do repo (ou fixture de teste)
 * @returns {{ data: object } | { error: string }}
 */
export function collectContractData(root) {
  const contents = {}
  for (const [key, rel] of Object.entries(FILES)) {
    const abs = join(root, rel)
    if (!existsSync(abs)) return { error: `${rel} ausente em ${root}` }
    try {
      contents[key] = readFileSync(abs, "utf8")
    } catch (e) {
      return { error: `falha ao ler ${rel}: ${e.message}` }
    }
  }
  return { data: buildContractInput(contents) }
}

// ── CLI ───────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2)
  const rootIdx = argv.indexOf("--root")
  const root = rootIdx !== -1 ? argv[rootIdx + 1] : process.cwd()
  if (rootIdx !== -1 && !argv[rootIdx + 1]) {
    console.error("❌ --root exige um caminho")
    process.exit(2)
  }

  const staged = argv.includes("--staged")
  const baseIdx = argv.indexOf("--base")
  const base = baseIdx !== -1 ? argv[baseIdx + 1] : null
  if (baseIdx !== -1 && !argv[baseIdx + 1]) {
    console.error("❌ --base exige uma ref (ex.: HEAD, origin/main)")
    process.exit(2)
  }
  if (base && !staged) {
    console.error("❌ --base exige --staged (o --base só tem efeito no modo --staged)")
    process.exit(2)
  }
  if (staged && base !== null && !isValidGitRef(base)) {
    console.error(`❌ --base com ref inválida: '${base}'`)
    process.exit(2)
  }

  const { data, error } = staged ? collectStagedData(root, base) : collectContractData(root)
  if (error) {
    console.error(`❌ check-mutation-timing-contract${staged ? " (--staged)" : ""}: ${error}`)
    process.exit(2)
  }

  const violations = checkMutationTimingContract(data)
  if (violations.length > 0) {
    console.error(
      `❌ Contrato de markers do mutation-coord inconsistente entre os 4 locais (${violations.length}):\n`,
    )
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   Locais: seed-guards.yml (fonte da verdade) ↔ measure-mutation-timing.mjs (markers` +
        `\n   substring) ↔ test-mutation-timing-budget.sh (JOB_NAME/STEP_NAME) ↔` +
        `\n   measure-mutation-timing.test.ts (literais dos fixtures). Renomear o job/step no` +
        `\n   seed-guards.yml exige atualizar os OUTROS TRÊS no MESMO PR — este guard fecha o par.` +
        `\n   Modo --staged: o estado validado é o que SERIA commitado (índice${base ? ` / ref ${base}` : ""}),` +
        `\n   não o working tree — um estágio parcial (só seed-guards.yml) falha aqui.`,
    )
    process.exit(1)
  }

  // Localiza o par do contrato para a mensagem de sucesso (espelho da resolução).
  const contractJob = data.seedJobs.find((j) => j.jobName.includes(data.markers.jobMarker))
  const contractStep = contractJob?.stepNames.find((s) => s.includes(data.markers.stepMarker))
  console.log(
    `✅ Contrato de markers do mutation-coord consistente (${staged ? "staged — " : ""}seed-guards ↔ medidor ↔ mutation test ↔ teste unitário): job '${contractJob?.jobName}', step '${contractStep}'.`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
