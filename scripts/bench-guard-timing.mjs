#!/usr/bin/env node
// =============================================================================
// bench-guard-timing.mjs — benchmark de wall time do doctor e dos guards
//
// POR QUE EXISTE: a suíte do doctor e a bateria de guards são os gates que
// decidem o merge. Uma regressão de tempo nelas afeta CADA PR — mas sem
// medição versionada, a degradação é impressão, não dado comparável entre
// commits. Este script mede o wall time de cada guard individual, do doctor
// (perfil --ci), o CUSTO DAS TRES UNIFICAÇÕES DE RÉGUA — as que trocaram a
// régua por UMA só e passaram a ser pagas onde antes havia (ou não havia)
// outra: o lint (`prettier --check` + `eslint . --max-warnings 0`), o
// typecheck (o comando inteiro, com o heap, dentro do script do package.json) e
// a suíte de testes (`bun run test:run`, que INCLUI `src/components/**`) — e o
// custo da OFERTA de remendo no pre-commit (a família `hook`), nos dois caminhos
// do commit: o comum (nada reprova) e o de falha (defeito no índice).
// Registra em JSON versionado (commit + timestamp + a máquina) e permite
// comparação contra um baseline.
//
// Usage:
//   node scripts/bench-guard-timing.mjs                # mede e imprime
//   node scripts/bench-guard-timing.mjs --json         # salva em latest
//   node scripts/bench-guard-timing.mjs --save         # salva com data
//   node scripts/bench-guard-timing.mjs --compare      # mede e compara vs baseline
//   node scripts/bench-guard-timing.mjs --baseline     # salva como baseline
//   node scripts/bench-guard-timing.mjs --json --compare  # salva + compara
//   node scripts/bench-guard-timing.mjs --samples 3    # amostras por forma de lint
//   node scripts/bench-guard-timing.mjs --no-lint      # só guards + doctor + réguas
//   node scripts/bench-guard-timing.mjs --no-typecheck # pula a família do typecheck
//   node scripts/bench-guard-timing.mjs --no-tests     # pula a família da suíte
//   node scripts/bench-guard-timing.mjs --no-hook      # pula a família do hook
//   node scripts/bench-guard-timing.mjs --counterfactual  # mede a régua estreita da suíte (~7min)
//   node scripts/bench-guard-timing.mjs --only tests   # só a família da suíte (sem a bateria)
//   node scripts/bench-guard-timing.mjs --only hook    # só o custo da oferta no commit
//   node scripts/bench-guard-timing.mjs --json --merge # herda do arquivo o que não mediu
//
// CUSTO: as duas famílias de régua medem COMANDOS INTEIROS (um typecheck frio e as
// suítes), então uma rodada completa leva minutos; a família `hook` roda o hook de
// verdade num repositório git temporário (seis formas, ~0,3s cada) e a detecção
// contra a árvore real, então custa segundos. Elas medem UMA amostra por
// forma, de propósito e declarado (`samplesPerForm: 1`): o `--samples` continua
// sendo o controle da mediana das formas de lint, que rodam em segundos. O
// `--merge` existe para medir em partes em máquina lenta (ou sob timeout de
// runner), herdando do arquivo as famílias não medidas — marcadas e fora do
// veredito. Fora do veredito nas DUAS pontas: a família herdada não julga o
// TOTAL (que é a soma de guards+doctor) nem serve de prova para FECHAR a dívida
// de tempo (`measured: false`); uma família que a baseline tem e a rodada não
// mediu NEM herdou faz o mesmo (`--no-lint` no dispatch).
//
// Exit codes:
//   0 — benchmark completo
//   1 — falha de infra ou comparação com regressão
//   2 — argumento inválido
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { cpus, totalmem } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { requireBunVersion } from "./bun-version.mjs"
import { requireImageSource } from "./registry-source.mjs"
import { CORE_INVARIANTS, canonicalCommandOf, runCommands } from "./check-forge-parity.mjs"
import { existingWorkflowDirs, workflowFileNames } from "./forge-workflows.mjs"
import { cleanupFixtures, runSourcedHook, stage } from "./hook-simulator.mjs"
import {
  HOOK,
  REMEDY,
  REMEDY_STUB_ENV,
  WORKFLOW,
  WORKFLOW_CICATRIZ,
  WORKFLOW_VALIDO,
  hookSource,
  novoRepo as novoRepoHook,
} from "./pre-commit-proof.mjs"
import { NO_PROMPT_ENV } from "./pre-commit-remedy.mjs"

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
 * Os call sites de um comando canonico HOJE — derivados dos workflows do
 * repositorio, nao cravados: quantas pipelines pagam o custo e um FATO medido.
 *
 * E a MESMA leitura para as tres familias de regua (lint, typecheck, suite):
 * tres varreduras com a mesma pergunta, cada uma com a sua copia do loop, e uma
 * delas medindo outra coisa no dia em que o layout de workflow mudar.
 *
 * @param {string} cmd
 * @param {string} [root]
 * @returns {{file: string, count: number}[]}
 */
export function canonicalCallSites(cmd, root = REPO_ROOT) {
  const sites = []
  for (const dir of existingWorkflowDirs(root)) {
    for (const name of workflowFileNames(root, dir)) {
      const content = readFileSync(join(root, dir, name), "utf8")
      const count = runCommands(content).filter((c) => c.trim() === cmd).length
      if (count > 0) sites.push({ file: `${dir}/${name}`, count })
    }
  }
  return sites
}

/**
 * Os call sites de `bun run lint` HOJE.
 *
 * @param {string} [root]
 * @returns {{file: string, count: number}[]}
 */
export function lintCallSites(root = REPO_ROOT) {
  return canonicalCallSites(LINT_CANONICAL_CMD, root)
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
 * Arquivos de WORKFLOW que ainda executam uma regua ANTERIOR. Depois da
 * unificacao a lista tem de estar VAZIA: e a prova de que o "antes" medido
 * deixou de existir nas pipelines (e nao de que o benchmark comparou duas coisas
 * que rodam ao mesmo tempo).
 *
 * Só WORKFLOW: um hook local pode rodar um recorte por decisao escrita (o
 * `test:unit` do smart-skip, por exemplo) — essa pergunta e do
 * `check-hook-ci-parity`, que exige a declaracao. Duas reguas no CI, nao.
 *
 * @param {string} cmd
 * @param {string} [root]
 * @returns {string[]}
 */
export function legacyRulerFiles(cmd, root = REPO_ROOT) {
  const files = []
  for (const dir of existingWorkflowDirs(root)) {
    for (const name of workflowFileNames(root, dir)) {
      const content = readFileSync(join(root, dir, name), "utf8")
      if (runCommands(content).some((c) => c.trim() === cmd)) {
        files.push(`${dir}/${name}`)
      }
    }
  }
  return files
}

/**
 * @param {string} [root]
 * @returns {string[]}
 */
export function legacyCallSites(root = REPO_ROOT) {
  return legacyRulerFiles(LINT_LEGACY_CMD, root)
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
 * `before` roda ANTES de cada amostra: e o gancho das formas que tem CACHE (o
 * `tsconfig.tsbuildinfo` do tsc). Sem ele, a segunda amostra mediria o cache e
 * nao o gate.
 *
 * @param {string} cmd
 * @param {number} samples
 * @param {{before?: () => void}} [options]
 * @returns {{ms: number, minMs: number, maxMs: number, runs: {ms: number, exit: number}[], exit: number, ok: boolean}}
 */
function measureRepeats(cmd, samples, { before } = {}) {
  const raw = []
  for (let i = 0; i < samples; i++) {
    if (before) before()
    raw.push(measure(cmd, { timeoutMs: 600_000 }))
  }
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

// ── Typecheck: o custo da unificacao ──────────────────────────────────────
//
// POR QUE MEDIR AQUI: o `typecheck` passou a ser UM comando nas duas forjas e
// no veredito local — o comando INTEIRO (o tsc com o heap de 4GB) dentro do
// script `typecheck` do package.json. Antes, o heap era um `env: NODE_OPTIONS`
// inline repetido em QUATRO workflows, e o hook de push rodava
// `bunx tsc --noEmit` SEM o heap. As duas metades desta medicao respondem a
// perguntas diferentes:
//
//   a) o que a unificacao ACRESCENTOU de wall time nos workflows? A forma
//      `legacy-inline` (o MESMO comando com o MESMO heap) e o contrafactual
//      exato: se o delta for ~0, a unificacao moveu um VALOR, nao um trabalho;
//   b) o que ela acrescentou no HOOK? O heap. E o heap so muda algo onde o
//      default do node NAO basta — por isso a forma `legacy-bare` (o comando sem
//      o heap) e medida junto, e o heap default da maquina tambem: onde o
//      default ja e maior que o do script, a regua sem heap COMPLETA e o
//      relatorio diz INDETERMINADO sobre o 134 do runner em vez de presumi-lo.
//
// A MEDICAO E FRIA (`cold: true`): `tsconfig.json` tem `incremental: true` e o
// `tsconfig.tsbuildinfo` (gitignored) faz o tsc responder em SEGUNDOS com o
// trabalho ja feito. Medir o cache nao mede o gate — o step do CI comeca frio.

/** O invariante do CORE que declara a regua do typecheck. */
const TYPECHECK_INVARIANT = CORE_INVARIANTS.find((i) => i.id === "typecheck")
if (!TYPECHECK_INVARIANT) {
  throw new Error(
    "CORE_INVARIANTS nao declara o invariante 'typecheck' — sem ele nao ha regua canonica para medir",
  )
}

/** O comando canonico do typecheck, resolvido da MESMA fonte que o CI usa. */
export const TYPECHECK_CANONICAL_CMD = canonicalCommandOf(TYPECHECK_INVARIANT)

/** O cache do tsc — o que faz uma medicao quente medir outra coisa. */
export const TSC_CACHE_FILE = "tsconfig.tsbuildinfo"

/** O script `typecheck` do package.json — a fonte unica da regua. */
function typecheckEntry() {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
  const entry = pkg.scripts?.typecheck
  if (typeof entry !== "string" || entry.trim() === "") {
    throw new Error("package.json sem o script 'typecheck' — o benchmark mede a regua declarada")
  }
  return entry
}

/**
 * O heap do script, LIDO da entry do package.json (nao digitado): se o valor
 * mudar la, a forma contrafactual acompanha — e a conta continua sendo do MESMO
 * comando, que e o que a pergunta (a) precisa para valer.
 */
export const TYPECHECK_HEAP_MB = (() => {
  const m = /--max-old-space-size=(\d+)/.exec(typecheckEntry())
  if (!m) {
    throw new Error(
      "o script 'typecheck' do package.json nao declara --max-old-space-size: a unificacao medida e a do heap dentro do script",
    )
  }
  return Number(m[1])
})()

/** A regua ANTERIOR dos workflows: o MESMO comando, com o heap passado INLINE. */
export const TYPECHECK_LEGACY_INLINE_CMD = `NODE_OPTIONS=--max-old-space-size=${TYPECHECK_HEAP_MB} bunx tsc --noEmit`

/** A regua ANTERIOR do hook: o mesmo comando SEM o heap. */
export const TYPECHECK_LEGACY_BARE_CMD = "bunx tsc --noEmit"

/**
 * Os call sites que pagaram a unificacao do typecheck: os QUATRO workflows que
 * declaravam o heap inline (`env: NODE_OPTIONS`) e passaram a chamar o script.
 *
 * @type {{file: string, where: string}[]}
 */
export const TYPECHECK_UPGRADED_SITES = [
  { file: ".gitea/workflows/ci.yml", where: "job `typecheck` (forja dona do merge)" },
  { file: ".github/workflows/ci.yml", where: "job `typecheck` (espelho)" },
  { file: ".github/workflows/pr-check.yml", where: "job `typecheck` (espelho do PR)" },
  { file: ".github/workflows/release-deploy.yml", where: "passo de typecheck do deploy" },
]

/**
 * O hook onde o heap FALTAVA — a outra metade da unificacao, e a unica onde o
 * valor mudou de verdade (nos workflows o comando ja era o mesmo).
 *
 * A prova destes fatos e o CONTEUDO do arquivo (nao ha `run:` de workflow para
 * ler): `hookRulerFacts` confere as duas linhas. O hook entra na conta com
 * `kind: "hook"` porque um arquivo de workflow a menos na lista e um lugar
 * invisivel a mais.
 */
export const TYPECHECK_HEAP_ADDED_AT = {
  file: ".husky/pre-push",
  where: "hook de push — rodava o tsc SEM o heap (o 134 que o merge nunca via)",
  kind: "hook",
}

/**
 * Arquivos de workflow cujo CONTEUDO casa um padrao.
 *
 * Existe para as declaracoes que nao sao um `run:` — o heap era um `env:`, e um
 * `env:` nao aparece em `runCommands`. Varrer so as linhas de `run:` deixaria a
 * segunda regua do `NODE_OPTIONS` invisivel justamente onde ela morava.
 *
 * @param {RegExp} pattern
 * @param {string} [root]
 * @returns {string[]}
 */
export function workflowFilesMatching(pattern, root = REPO_ROOT) {
  const files = []
  for (const dir of existingWorkflowDirs(root)) {
    for (const name of workflowFileNames(root, dir)) {
      const content = readFileSync(join(root, dir, name), "utf8")
      if (pattern.test(content)) files.push(`${dir}/${name}`)
    }
  }
  return files
}

/**
 * Remove o cache do tsc. O arquivo e GERADO e gitignored: removerlo nao mexe no
 * repositorio, e e o que faz cada amostra comecar fria (como o step do CI).
 *
 * @param {string} [root]
 * @returns {string} o caminho do cache (declarado no relatorio)
 */
export function clearTscCache(root = REPO_ROOT) {
  const file = join(root, TSC_CACHE_FILE)
  if (existsSync(file)) rmSync(file, { force: true })
  return file
}

/**
 * O heap default do NODE — nao o do runtime que executa o benchmark (o `bunx`
 * dispara `node_modules/.bin/tsc`, cujo shebang e `env node`; medido: com
 * `NODE_OPTIONS=--max-old-space-size=16` o processo morre com 134).
 *
 * E o numero que decide se a regua SEM o heap morre nesta maquina: o default do
 * node vem da RAM disponivel, e por isso o mesmo commit da 134 no runner e passa
 * num desktop grande. `null` quando o node nao puder ser interrogado
 * (INDETERMINADO, nunca "nao existe").
 */
/**
 * As familias de custo de unificacao que o benchmark conhece. E a lista que
 * `--only` aceita, e a mesma que `reuseFamilies` sabe herdar.
 */
/**
 * As familias que uma rodada sabe medir. O `hook` entrou por ultimo: ele nao e uma
 * unificacao de REGUA, e o custo que a OFERTA de remendo acrescentou ao caminho de
 * cada commit — mas e medido com a mesma disciplina (formas, deltas, contrato) e
 * pelo mesmo `--only`/`--merge`.
 */
export const RULER_FAMILIES = ["lint", "typecheck", "tests", "hook"]

/**
 * Le a lista de `--only`. Família desconhecida e ERRO (nao um silencio que mede
 * tudo): medir a família errada por um typo custaria minutos de runner.
 *
 * @param {string} raw
 * @returns {{families: string[]|null, error: string|null}}
 */
export function parseOnly(raw) {
  if (raw === undefined) return { families: null, error: null }
  const parts = String(raw)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
  const unknown = parts.filter((p) => !RULER_FAMILIES.includes(p))
  if (parts.length === 0 || unknown.length > 0) {
    return {
      families: null,
      error: `--only aceita ${RULER_FAMILIES.join("|")} (recebido: ${raw || "nada"})`,
    }
  }
  return { families: parts, error: null }
}

/**
 * @param {{only?: string[]|null}} [opts]
 */
function familiesToRun({ only = null } = {}) {
  return {
    lint: only === null || only.includes("lint"),
    typecheck: only === null || only.includes("typecheck"),
    tests: only === null || only.includes("tests"),
    hook: only === null || only.includes("hook"),
  }
}

export function nodeHeapLimitMb() {
  const res = spawnSync(
    "node",
    [
      "-e",
      "const v8=require('node:v8');process.stdout.write(String(Math.round(v8.getHeapStatistics().heap_size_limit/1048576)))",
    ],
    { encoding: "utf8", timeout: 15_000 },
  )
  const n = Number((res.stdout ?? "").trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Os fatos do hook: ele roda o comando CANONICO? ainda roda a regua SEM o heap?
 *
 * @param {string} [file]
 * @param {string} [root]
 */
export function hookRulerFacts(file = TYPECHECK_HEAP_ADDED_AT.file, root = REPO_ROOT) {
  const path = join(root, file)
  if (!existsSync(path)) return { file, exists: false, hasCanonical: false, hasBare: false }
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
  return {
    file,
    exists: true,
    hasCanonical: lines.includes(TYPECHECK_CANONICAL_CMD),
    hasBare: lines.includes(TYPECHECK_LEGACY_BARE_CMD),
  }
}

/**
 * As violacoes do contrato da unificacao do typecheck.
 *
 * Recebe o que foi MEDIDO (sites, hook, heap fora do script) em vez de medir: e
 * o que permite provar a conferencia sem rodar um typecheck. A unica varredura
 * que ela faz por conta propria e a da regua ANTIGA nos workflows — o estado do
 * repositorio que a conta precisa negar.
 *
 * @param {{sites?: {file: string}[], hook?: object|null, heapOutside?: string[]}} [measured]
 * @returns {string[]}
 */
export function typecheckCostViolations({ sites = [], hook = null, heapOutside = [] } = {}) {
  const violations = []

  // A declaracao dos pagantes e PROVADA: um arquivo declarado que nao chama mais
  // o script faria a conta medir um lugar onde o typecheck nao roda.
  const siteFiles = new Set(sites.map((s) => s.file))
  for (const declared of TYPECHECK_UPGRADED_SITES) {
    if (!siteFiles.has(declared.file)) {
      violations.push(
        `${declared.file}: declarado como pagante da unificacao do typecheck, mas nenhum 'run:' executa ${TYPECHECK_CANONICAL_CMD}`,
      )
    }
  }

  // O heap NAO pode voltar a ser declarado fora do script: e a SEGUNDA REGUA do
  // mesmo invariante (o `env:` que a unificacao removeu), e ela nao aparece em
  // `runCommands` — por isso a varredura do CONTEUDO.
  for (const file of heapOutside) {
    violations.push(
      `${file}: declara o heap do tsc (--max-old-space-size) FORA do script 'typecheck' — segunda regua para a mesma invariante`,
    )
  }

  // A regua SEM heap nao pode voltar a workflow nenhum.
  for (const file of legacyRulerFiles(TYPECHECK_LEGACY_BARE_CMD)) {
    violations.push(
      `${file}: executa ${TYPECHECK_LEGACY_BARE_CMD} — a regua que morre com 134 onde o default do node nao basta`,
    )
  }

  // E o hook, o lugar de onde o valor faltava, tem de rodar o comando canonico.
  if (hook) {
    if (!hook.exists) {
      violations.push(
        `${hook.file}: o hook declarado nao existe — o valor acrescentado la nao pode ser conferido`,
      )
    } else {
      if (!hook.hasCanonical) {
        violations.push(
          `${hook.file}: o hook declarado como beneficiario do heap nao executa ${TYPECHECK_CANONICAL_CMD}`,
        )
      }
      if (hook.hasBare) {
        violations.push(
          `${hook.file}: ainda executa ${TYPECHECK_LEGACY_BARE_CMD} SEM o heap — a regua que so o veredito local tinha voltou`,
        )
      }
    }
  }

  return violations
}

/**
 * O que a unificacao do typecheck acrescentou ONDE ela agora roda — derivado dos
 * fatos medidos, nao escrito a mao.
 *
 * @param {{addedPerSiteMs: number, legacyBare: object, heapMb: number, nodeHeapLimitMb: number|null, upgradedSites: number}} f
 */
export function typecheckWhatItAdded({
  addedPerSiteMs,
  legacyBare,
  heapMb,
  nodeHeapLimitMb,
  upgradedSites,
}) {
  const semCusto = Math.abs(addedPerSiteMs) <= Math.max(1_000, (legacyBare?.ms ?? 0) * 0.1)
  const wall = `${signedSeconds(addedPerSiteMs)} por call site (${upgradedSites} workflows)`
  const custo = semCusto
    ? `${wall} — o MESMO comando com o MESMO heap: a unificacao moveu o VALOR, nao o trabalho`
    : `${wall} de trabalho novo`
  const heap =
    nodeHeapLimitMb === null
      ? `o heap default do node NAO foi medido — se a regua sem o heap morre ou completa aqui fica INDETERMINADO`
      : nodeHeapLimitMb >= heapMb
        ? `o heap default do node nesta maquina (${nodeHeapLimitMb}MB) ja e >= os ${heapMb}MB do script, entao a regua SEM o heap completou aqui (exit ${legacyBare?.exit}): o 134 do runner NAO se reproduz nesta maquina — INDETERMINADO, nao "nao existe"`
        : `o heap e o que faz o gate COMPLETAR: o default do node nesta maquina (${nodeHeapLimitMb}MB) nao basta e a regua sem o heap morreu (exit ${legacyBare?.exit})`
  return `${custo}. No hook ${TYPECHECK_HEAP_ADDED_AT.file} o acrescentado foi o HEAP: ${heap}.`
}

/**
 * Mede o custo da unificacao do typecheck: as tres formas (frias), os call sites
 * medidos, os pagantes declarados (provados) e o que a unificacao acrescentou.
 *
 * @param {{samples?: number}} [opts]
 * @returns {object}
 */
export function measureTypecheckCost({ samples = 1 } = {}) {
  const forms = [
    { role: "current", label: "typecheck (script, hoje)", cmd: TYPECHECK_CANONICAL_CMD },
    {
      role: "legacy-inline",
      label: "typecheck (heap inline — contrafactual)",
      cmd: TYPECHECK_LEGACY_INLINE_CMD,
    },
    {
      role: "legacy-bare",
      label: "typecheck (SEM heap — a regua do hook)",
      cmd: TYPECHECK_LEGACY_BARE_CMD,
    },
  ]
  const measured = forms.map((form) => ({
    ...form,
    ...measureRepeats(form.cmd, samples, { before: () => clearTscCache() }),
  }))
  const byRole = (role) => measured.find((m) => m.role === role)
  const current = byRole("current")
  const legacyInline = byRole("legacy-inline")
  const legacyBare = byRole("legacy-bare")

  const sites = canonicalCallSites(TYPECHECK_CANONICAL_CMD)
  const heapOutside = workflowFilesMatching(/max-old-space-size/)
  const hook = hookRulerFacts()
  const violations = typecheckCostViolations({ sites, hook, heapOutside })
  const heap = nodeHeapLimitMb()
  const addedPerSiteMs = current.ms - legacyInline.ms

  return {
    invariant: "typecheck",
    canonicalCmd: TYPECHECK_CANONICAL_CMD,
    legacyInlineCmd: TYPECHECK_LEGACY_INLINE_CMD,
    legacyBareCmd: TYPECHECK_LEGACY_BARE_CMD,
    heapMb: TYPECHECK_HEAP_MB,
    samplesPerForm: samples,
    cold: true,
    cacheFile: TSC_CACHE_FILE,
    forms: measured,
    canonicalMs: current.ms,
    sites,
    pipelineFiles: sites.length,
    callSites: sites.reduce((acc, s) => acc + s.count, 0),
    upgraded: TYPECHECK_UPGRADED_SITES,
    upgradedSites: TYPECHECK_UPGRADED_SITES.length,
    heapAddedAt: TYPECHECK_HEAP_ADDED_AT,
    hook,
    heapDeclaredOutside: heapOutside,
    nodeHeapLimitMb: heap,
    legacyBareExit: legacyBare.exit,
    legacyBareMs: legacyBare.ms,
    legacyBareCompleted: legacyBare.exit === 0,
    addedPerSiteMs,
    addedPerFanOutMs: addedPerSiteMs * TYPECHECK_UPGRADED_SITES.length,
    violations,
    whatItAdded: typecheckWhatItAdded({
      addedPerSiteMs,
      legacyBare,
      heapMb: TYPECHECK_HEAP_MB,
      nodeHeapLimitMb: heap,
      upgradedSites: TYPECHECK_UPGRADED_SITES.length,
    }),
  }
}

// ── Suite de testes: o custo da unificacao ────────────────────────────────
//
// POR QUE MEDIR AQUI: `bun run test:run` (config do app: `src/**/*.test.{ts,tsx}`
// INCLUINDO `src/components/**`) e `bun run test:unit` (config unit, que EXCLUI
// `src/components/**`) eram DUAS reguas para a mesma invariante: a forja rodava a
// mais ampla e o check EXIGIDO do GitHub a mais estreita — o lado mais fraco do
// par era o que decidia o merge no espelho. A unificacao levou a mais ampla aos
// dois, e o preco esta no call site que upgrade.
//
// A METADE NOVA E DERIVADA, nao digitada: o escopo que a config unit EXCLUI e
// lido do `vitest.config.unit.ts` — mudar o `exclude` la muda o que este
// benchmark mede, em vez de deixar a conta medindo um escopo que nao existe mais.
//
// A ATRIBUICAO E CONFERIDA, e pode NAO fechar: as duas reguas diferem em mais de
// escopo (o app roda com 4 workers e o unit com 1, e o setup do vitrine entra so
// no app) — o relatorio diz "NAO confere" e mostra a diferenca em vez de
// apresentar o delta como se fosse so a suite de componentes.

/** O invariante do CORE que declara a regua da suite. */
const TESTS_INVARIANT = CORE_INVARIANTS.find((i) => i.id === "tests")
if (!TESTS_INVARIANT) {
  throw new Error(
    "CORE_INVARIANTS nao declara o invariante 'tests' — sem ele nao ha regua canonica para medir",
  )
}

/** O comando canonico da suite, resolvido da MESMA fonte que o CI usa. */
export const TEST_CANONICAL_CMD = canonicalCommandOf(TESTS_INVARIANT)

/** A regua ANTERIOR do check exigido do GitHub (`vitest.config.unit.ts`). */
export const TEST_LEGACY_CMD = "bun run test:unit"

/** A config que a regua anterior usava (a fonte do escopo que ela EXCLUI). */
export const TEST_LEGACY_CONFIG = "vitest.config.unit.ts"

/**
 * O diretorio que a regua anterior EXCLUI, lido da propria config: e a metade
 * que a unificacao acrescentou no call site que upgrade.
 *
 * @param {string} [root]
 * @returns {string}
 */
export function excludedScopeDir(root = REPO_ROOT) {
  const cfg = readFileSync(join(root, TEST_LEGACY_CONFIG), "utf8")
  const block = /exclude:\s*\[([\s\S]*?)\]/.exec(cfg)?.[1] ?? ""
  const first = /"([^"]+)"/.exec(block)?.[1] ?? null
  if (!first) {
    throw new Error(
      `${TEST_LEGACY_CONFIG} sem 'exclude' legivel — a metade medida da unificacao da suite nao pode ser derivada`,
    )
  }
  return first.split("/*")[0]
}

/** O comando que roda SO a metade nova (a suite de componentes, config do app). */
export const TEST_ADDED_HALF_CMD = `bunx vitest run ${excludedScopeDir()}`

/**
 * O call site que pagou a unificacao da suite: o job `check` do espelho do
 * GitHub, que rodava a regua ESTREITA. A forja ja rodava o `test:run`.
 *
 * @type {{file: string, where: string}[]}
 */
export const TEST_UPGRADED_SITES = [
  {
    file: ".github/workflows/pr-check.yml",
    where: "job `check`, passo `Unit tests` (rodava `test:unit`, que EXCLUI src/components)",
  },
]

/**
 * As violacoes do contrato da unificacao da suite. Pura: recebe o medido.
 *
 * @param {{sites?: {file: string}[]}} [measured]
 * @returns {string[]}
 */
export function testCostViolations({ sites = [] } = {}) {
  const violations = []
  const siteFiles = new Set(sites.map((s) => s.file))
  for (const declared of TEST_UPGRADED_SITES) {
    if (!siteFiles.has(declared.file)) {
      violations.push(
        `${declared.file}: declarado como pagante da unificacao da suite, mas nenhum 'run:' executa ${TEST_CANONICAL_CMD}`,
      )
    }
  }

  // A regua ESTREITA nao pode voltar a workflow nenhum: se voltar, o lado mais
  // fraco do par volta a ser um veredito de merge.
  for (const file of legacyRulerFiles(TEST_LEGACY_CMD)) {
    violations.push(
      `${file}: executa ${TEST_LEGACY_CMD} — a regua ESTREITA (EXCLUI ${excludedScopeDir()}) nao pode ser veredito de merge`,
    )
  }

  return violations
}

/**
 * O que a unificacao da suite acrescentou ONDE ela agora roda — derivado do
 * medido, com a atribuicao conferida (ou declarada como NAO conferida).
 *
 * `addedPerSiteMs === null` e o caso do contrafactual NAO medido nesta rodada
 * (ver `--no-counterfactual`): o que a unificacao acrescentou de ESCOPO continua
 * medido (a metade nova), mas o delta contra a regua anterior fica INDETERMINADO
 * — e o relatorio diz isso, em vez de apresentar a metade nova como se fosse o
 * delta.
 *
 * @param {{addedPerSiteMs: number|null, addedHalfMs: number, upgradedSites: number, scopeDir: string}} f
 */
export function testWhatItAdded({ addedPerSiteMs, addedHalfMs, upgradedSites, scopeDir }) {
  const escopo =
    `a suite \`${scopeDir}/**\`, que a regua anterior EXCLUIA, medida em ` +
    `${signedSeconds(addedHalfMs)} isolada`
  if (addedPerSiteMs === null) {
    return (
      `a regua anterior NAO foi medida nesta rodada, entao o DELTA no call site que upgrade (${upgradedSites}) ` +
      `fica INDETERMINADO. O que a unificacao acrescentou de ESCOPO esta medido: ${escopo}.`
    )
  }
  const confere = addedHalfMs > 0 && Math.abs(addedPerSiteMs - addedHalfMs) / addedHalfMs <= 0.1
  return (
    `${signedSeconds(addedPerSiteMs)} por rodada no call site que upgrade (${upgradedSites}) — ${escopo}` +
    (confere
      ? `, e ela fecha com o delta`
      : ` (o delta NAO e so ela: as duas reguas diferem tambem em workers e setup)`)
  )
}

/**
 * Mede o custo da unificacao da suite: a canonica, a metade nova isolada e —
 * quando o contrafactual e medido — a regua estreita (a que o check do GitHub
 * rodava).
 *
 * O CONTRAFACTUAL E OPCIONAL, e a razao e WALL TIME, nao conveniencia: a regua
 * estreita roda com `maxWorkers: 1` (declarado no `vitest.config.unit.ts`) e leva
 * ~7min sozinha, contra ~2min da canonica. Medir tudo junto passa de um timeout
 * de runner com facilidade. Quando ele NAO e medido, o JSON diz
 * `counterfactual: "not-measured"` e o delta sai `null` — o campo nao fica com um
 * numero de outra rodada.
 *
 * @param {{samples?: number, counterfactual?: boolean}} [opts]
 * @returns {object}
 */
export function measureTestCost({ samples = 1, counterfactual = false } = {}) {
  const scopeDir = excludedScopeDir()
  const forms = [
    { role: "current", label: "suite completa (hoje: test:run)", cmd: TEST_CANONICAL_CMD },
    { role: "added-half", label: `suite de ${scopeDir} (a metade nova)`, cmd: TEST_ADDED_HALF_CMD },
  ]
  if (counterfactual) {
    forms.push({
      role: "legacy",
      label: "suite estreita (test:unit — contrafactual)",
      cmd: TEST_LEGACY_CMD,
    })
  }
  const measured = forms.map((form) => ({ ...form, ...measureRepeats(form.cmd, samples) }))
  const byRole = (role) => measured.find((m) => m.role === role)
  const current = byRole("current")
  const legacy = byRole("legacy")
  const addedHalf = byRole("added-half")

  const sites = canonicalCallSites(TEST_CANONICAL_CMD)
  const violations = testCostViolations({ sites })
  const addedPerSiteMs = legacy ? current.ms - legacy.ms : null
  const attributionPct =
    addedPerSiteMs === null
      ? null
      : addedHalf.ms > 0
        ? Math.abs(addedPerSiteMs - addedHalf.ms) / addedHalf.ms
        : 1

  return {
    invariant: "tests",
    canonicalCmd: TEST_CANONICAL_CMD,
    legacyCmd: TEST_LEGACY_CMD,
    legacyConfig: TEST_LEGACY_CONFIG,
    addedHalfCmd: TEST_ADDED_HALF_CMD,
    addedHalfLabel: scopeDir,
    samplesPerForm: samples,
    counterfactual: counterfactual ? "measured" : "not-measured",
    forms: measured,
    canonicalMs: current.ms,
    legacyMs: legacy?.ms ?? null,
    sites,
    pipelineFiles: sites.length,
    callSites: sites.reduce((acc, s) => acc + s.count, 0),
    upgraded: TEST_UPGRADED_SITES,
    upgradedSites: TEST_UPGRADED_SITES.length,
    addedPerSiteMs,
    addedHalfMs: addedHalf.ms,
    attributionPct: attributionPct === null ? null : Number(attributionPct.toFixed(4)),
    attributionMatches: attributionPct === null ? null : attributionPct <= 0.1,
    addedPerFanOutMs: addedPerSiteMs === null ? null : addedPerSiteMs * TEST_UPGRADED_SITES.length,
    violations,
    whatItAdded: testWhatItAdded({
      addedPerSiteMs,
      addedHalfMs: addedHalf.ms,
      upgradedSites: TEST_UPGRADED_SITES.length,
      scopeDir,
    }),
  }
}

// ── Hook: quanto a OFERTA de remendo custa no caminho do commit ────────────
//
// POR QUE MEDIR AQUI: o pre-commit passou a OFERECER o remédio dos defeitos
// mecânicos (as quatro classes, numa pergunta só) DEPOIS das duas fases, e o
// veredito da fase reprovada passou a ser dado pela FASE RODADA DE NOVO, com o
// remendo já no índice. As duas coisas vivem no caminho de CADA commit — a oferta
// é um `if` que só abre quando algo reprova; a revalidação só acontece depois de
// um remédio verde. Sem número, "o hook ficou mais lento" é impressão, e este
// benchmark existe para isso ser dado comparável entre commits.
//
// OS DOIS CAMINHOS, medidos SEPARADOS (um delta, uma causa):
//
//   comum — o índice passa (as duas fases verdes). A oferta NÃO roda por
//           construção (o `if` não abre), então o delta contra o MESMO hook sem a
//           oferta mede o que o CONTROLE do commit paga quando nada falha. É o
//           caminho da esmagadora maioria dos commits: um custo aqui seria pago
//           em TODO commit, inclusive nos que não têm defeito nenhum.
//   falha — o índice carrega um defeito mecânico: a oferta roda de verdade. Sem
//           terminal (o caso do CI e o de sessão sem tty de controle) ela NÃO
//           pergunta: mede-se o caminho fail-closed, que é o determinístico. Uma
//           terceira forma afirma o REMÉDIO verde pelo dublê declarado
//           (`REMEDY_STUB_ENV`) e mede o que só acontece DEPOIS dele: a fase
//           rodada de novo.
//
// O CONTRAFACTUAL É UMA TRANSFORMAÇÃO DO PRÓPRIO HOOK, ancorada no texto dele
// (`hookSemOferta` / `hookWaitAgregada`): se o hook perder as âncoras, a medição
// se declara NÃO MEDIDA em vez de comparar o hook com ele mesmo (um delta 0
// "perfeito" que não mediu nada).
//
// ONDE O CUSTO É PAGO DE VERDADE: no fixture a detecção acha o que o fixture tem.
// Por isso a família mede TAMBÉM a detecção contra a ÁRVORE REAL
// (`HOOK_DETECTION_CMD`) — o número que responde "quanto custa remeter o commit
// quando há um defeito mecânico NESTE repositório". Ela é read-only por construção
// (sem resposta afirmativa não há escrita) e o benchmark CONFERE que não escreveu:
// compara a árvore antes e depois, e diz se mudou.

/**
 * As âncoras do bloco da OFERTA no `.husky/pre-commit`: do `if` que a abre até a
 * fase sequencial (o que vem depois dela não muda na transformação).
 */
export const OFERTA_INICIO = 'if [ "$SINTAXE" -ne 0 ] || [ "$FASE_B" -ne 0 ]; then'
export const OFERTA_FIM = "# ── Phase C: Sequential checks"

/** As âncoras da espera do gate de sintaxe: SEPARADA (hoje) × agregada. */
export const WAIT_SEPARADO =
  "wait_all $PID_BUN $PID_MUT $PID_DEPS $PID_TIMING $PID_REQCHECKS || FASE_A=$?"
export const WAIT_AGREGADO =
  "wait_all $PID_BUN $PID_MUT $PID_DEPS $PID_TIMING $PID_REQCHECKS $PID_RUNSYNTAX || FASE_A=$?"
export const ESPERA_SINTAXE = 'SINTAXE=0\nwait "$PID_RUNSYNTAX" || SINTAXE=$?'
export const ESPERA_AGREGADA = "SINTAXE=$FASE_A"

/**
 * O MESMO hook com a OFERTA REMOVIDA: o veredito fica (a fase reprovada segue
 * bloqueando o commit, com o mesmo exit), o remédio e a revalidação saem. É o
 * único jeito de atribuir ao bloco da oferta o delta medido — qualquer outra
 * diferença entre as duas formas teria causa própria.
 *
 * @param {string} fonte  o texto do `.husky/pre-commit`
 * @returns {string|null} null quando as âncoras não estão no texto (NÃO MEDIDO)
 */
export function hookSemOferta(fonte) {
  const inicio = fonte.indexOf(OFERTA_INICIO)
  const fim = fonte.indexOf(OFERTA_FIM)
  if (inicio < 0 || inicio !== fonte.lastIndexOf(OFERTA_INICIO)) return null
  if (fim < inicio) return null
  const veredito =
    "# SEM A OFERTA: o MESMO veredito (a fase reprovada bloqueia o commit, com o\n" +
    "# mesmo exit), sem o remédio e sem a revalidação.\n" +
    'if [ "$SINTAXE" -ne 0 ]; then\n' +
    '  exit "$SINTAXE"\n' +
    "fi\n" +
    'if [ "$FASE_B" -ne 0 ]; then\n' +
    '  exit "$FASE_B"\n' +
    "fi\n\n"
  return fonte.slice(0, inicio) + veredito + fonte.slice(fim)
}

/**
 * O MESMO hook com o gate de sintaxe AGREGADO ao `wait_all` da fase A — a forma
 * que a espera separada substituiu.
 *
 * Medido SÓ no caminho comum: ali as duas formas esperam o MESMO conjunto (o teto
 * é o `max`), então a diferença é a ESTRUTURA da espera. No caminho de falha a
 * agregação muda QUAL status dispara a oferta (o `wait_all` devolve o PRIMEIRO
 * não-zero, e o valor viraria o do guard que reprovou), isto é, mudaria o
 * COMPORTAMENTO e não só o tempo — duas causas para um delta.
 *
 * @param {string} fonte
 * @returns {string|null}
 */
export function hookWaitAgregada(fonte) {
  if (fonte.split(WAIT_SEPARADO).length !== 2) return null
  if (fonte.split(ESPERA_SINTAXE).length !== 2) return null
  return fonte.split(WAIT_SEPARADO).join(WAIT_AGREGADO).split(ESPERA_SINTAXE).join(ESPERA_AGREGADA)
}

/** As amostras por forma do hook: ele roda em ~0,3s — 3 tira o ruído por pouco. */
export const HOOK_SAMPLES = 3

/**
 * `120ms` / `1.4s` — a unidade em que o número TEM resolução. O hook inteiro roda
 * em centenas de milissegundos, e o delta que esta família registra é de dezenas:
 * imprimir 0,1s arredondaria justamente o que se mede.
 *
 * @param {number} ms
 * @returns {string}
 */
function formatMs(ms) {
  const n = Math.round(ms ?? 0)
  return n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`
}

/** `+120ms` / `-3ms` / `0ms` — o sinal sempre explícito. */
function signedMillis(ms) {
  const n = Math.round(ms ?? 0)
  return `${n > 0 ? "+" : ""}${n}ms`
}

/**
 * Abaixo disto o delta do caminho comum é RUÍDO de medição, não custo: a oferta
 * que não é alcançada não pode custar mais do que o erro de uma medição de ~0,3s.
 */
export const HOOK_RUIDO_MS = 50

/**
 * O que cada forma é: o CAMINHO do fixture, a FONTE do hook, o que ela EXIGE do
 * desfecho (`zero` no caminho comum; `non-zero` no caminho de falha — o hook
 * BLOQUEAR um commit defeituoso não é defeito dele) e o env extra que a forma usa.
 */
export const HOOK_FORMS = [
  {
    role: "comum-hoje",
    path: "comum",
    fonte: "hoje",
    label: "hoje — índice ok (o caminho comum)",
    expect: "zero",
  },
  {
    role: "comum-sem-oferta",
    path: "comum",
    fonte: "sem-oferta",
    label: "sem a oferta — índice ok (contrafactual)",
    expect: "zero",
  },
  {
    role: "comum-agregada",
    path: "comum",
    fonte: "agregada",
    label: "sintaxe AGREGADA ao wait_all — índice ok (contrafactual)",
    expect: "zero",
  },
  {
    role: "falha-hoje",
    path: "falha",
    fonte: "hoje",
    label: "hoje — defeito no índice (fail-closed, sem terminal)",
    expect: "non-zero",
  },
  {
    role: "falha-sem-oferta",
    path: "falha",
    fonte: "sem-oferta",
    label: "sem a oferta — defeito no índice (contrafactual)",
    expect: "non-zero",
  },
  {
    role: "falha-revalidacao",
    path: "falha",
    fonte: "hoje",
    label: "remédio VERDE — a fase rodada de novo (dublê declarado)",
    expect: "non-zero",
    env: { [REMEDY_STUB_ENV]: "0" },
  },
]

/** O comando da detecção contra a ÁRVORE REAL: o mesmo que o hook executa. */
export const HOOK_DETECTION_CMD = `node scripts/${REMEDY}`

/** O `git status --porcelain` da árvore real (null quando o git não respondeu). */
function hookGitStatus() {
  const r = spawnSync("git", ["status", "--porcelain"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
  })
  return r.status === 0 ? r.stdout : null
}

/**
 * O desfecho LEGÍVEL da detecção, a partir da saída do remédio: são estados
 * diferentes e o número sozinho não diz qual deles foi medido.
 *
 * @param {string} saida
 * @returns {string}
 */
export function vereditoDaDeteccao(saida) {
  const t = String(saida ?? "")
  if (t.includes("SEM TERMINAL"))
    return "fail-closed (sem terminal): não pergunta, mantém o commit bloqueado"
  if (t.includes("carrega defeito(s) MECÂNICO(s)"))
    return "há defeito mecânico no commit (ofereceria o remédio)"
  if (t.includes("nada a remendar")) return "nada a remendar neste commit"
  if (t.includes("Sem medição não há remédio")) return "INDETERMINADO (infra: sem medição)"
  return "não classificado"
}

/**
 * A detecção contra a ÁRVORE REAL, com a conferência de que ela NÃO ESCREVEU:
 * o `git status --porcelain` é comparado antes e depois (um artefato novo aparece
 * como `??`, então a conferência cobre arquivo gerado, não só arquivo rastreado).
 *
 * O exit NÃO é veredito aqui: `0` = nada a remendar, `1` = há defeito e o remédio
 * não foi aplicado (fail-closed). O que se mede é o PROCESSO; o `ok` da forma só
 * cai quando ele não terminou.
 *
 * @returns {object}
 */
export function measureDetection() {
  const antes = hookGitStatus()
  const start = performance.now()
  const res = spawnSync("bash", ["-c", HOOK_DETECTION_CMD], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, [NO_PROMPT_ENV]: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const ms = Math.round(performance.now() - start)
  const depois = hookGitStatus()
  const saida = `${res.stdout ?? ""}${res.stderr ?? ""}`
  const medido = antes !== null && depois !== null
  return {
    cmd: HOOK_DETECTION_CMD,
    promptOff: `${NO_PROMPT_ENV}=1`,
    ms,
    exit: res.status,
    completou: res.status !== null,
    veredito: vereditoDaDeteccao(saida),
    medido,
    // `null` (e não `false`) quando não deu para comparar: "não escreveu" é uma
    // MEDIÇÃO, e afirmá-la sem ela seria o verde por omissão que o resto do repo
    // recusa. Quem julga (`hookCostViolations`) só acusa com `escreveu === true`.
    escreveu: medido ? antes !== depois : null,
  }
}

/**
 * O CONTRATO da família: o caminho comum passa e NÃO paga a oferta; o caminho de
 * falha bloqueia; a medição na árvore real não escreve. É o que impede a família de
 * registrar um número bonito sobre um hook que deixou de bloquear.
 *
 * @param {{forms?: object[], deltas?: object|null, detection?: object|null}} [facts]
 * @returns {string[]}
 */
export function hookCostViolations({ forms = [], deltas = null, detection = null } = {}) {
  const violations = []

  for (const form of forms) {
    if (form.ok) continue
    violations.push(
      `${form.label}: exit ${form.exit} — a forma esperava ${form.expect === "zero" ? "exit 0" : "exit não-zero"}`,
    )
  }

  // A OFERTA NO CAMINHO COMUM: o delta tem de ser ~0. Um valor acima do ruído
  // significa que o `if` da oferta passou a abrir com as duas fases verdes — o
  // custo da oferta sendo pago em todo commit, que é exatamente o que a
  // construção (oferta DEPOIS das fases) existe para evitar.
  if (deltas !== null && deltas.ofertaComumMs !== null && deltas.ofertaComumMs > HOOK_RUIDO_MS) {
    violations.push(
      `a oferta custa ${signedMillis(deltas.ofertaComumMs)} no caminho COMUM (acima do ruído de ${HOOK_RUIDO_MS}ms): ela está sendo alcançada com as duas fases verdes`,
    )
  }

  if (detection?.escreveu === true) {
    violations.push(
      `a detecção contra a árvore real ESCREVEU no repositório (${detection.cmd}) — a medição deixou de ser read-only`,
    )
  }

  return violations
}

/**
 * O que a família ACRESCENTOU, em frases — o mesmo estilo das outras três: o
 * número sozinho não diz de onde ele vem, e a direção de cada delta é o dado.
 *
 * @param {{deltas?: object|null, detection?: object|null}} [facts]
 * @returns {string[]}
 */
export function hookWhatItAdded({ deltas = null, detection = null } = {}) {
  const semMedida = (rotulo) => `${rotulo}: NÃO MEDIDO nesta rodada`
  if (deltas === null) return [semMedida("o custo da oferta no commit")]

  const ruido = (ms) => Math.abs(ms) <= HOOK_RUIDO_MS
  return [
    deltas.ofertaComumMs === null
      ? semMedida("o custo da oferta no caminho comum")
      : `caminho COMUM (as duas fases passam): ${signedMillis(deltas.ofertaComumMs)} por commit` +
        (ruido(deltas.ofertaComumMs)
          ? " — a oferta NÃO é alcançada quando nada reprova (o `if` não abre)"
          : " — ATENÇÃO: ela está sendo alcançada sem falha nenhuma"),
    deltas.esperaMs === null
      ? semMedida("a espera separada do gate de sintaxe")
      : `espera SEPARADA do gate de sintaxe vs agregada no \`wait_all\`: ${signedMillis(deltas.esperaMs)}` +
        " — as duas esperam o MESMO conjunto, então a diferença é a estrutura da espera",
    deltas.ofertaFalhaMs === null
      ? semMedida("o custo da oferta no caminho de falha")
      : `caminho de FALHA (defeito no índice): a oferta custa ${signedMillis(deltas.ofertaFalhaMs)}` +
        " — fail-closed, sem terminal ela não pergunta nem remenda",
    deltas.revalidacaoMs === null
      ? semMedida("a revalidação depois de um remédio verde")
      : `depois de um remédio VERDE, a fase rodada de novo custa ${signedMillis(deltas.revalidacaoMs)}` +
        " (aqui só o gate de sintaxe é re-executado: a fase B é dublada no fixture)",
    detection === null || !detection.medido
      ? semMedida("a detecção contra a árvore real")
      : `detecção contra a ÁRVORE REAL: ${formatMs(detection.ms)} ("${detection.veredito}")` +
        (detection.escreveu === true
          ? " — ⚠️ E ESCREVEU no repositório"
          : " — e não escreveu nada"),
  ]
}

/**
 * Mede o custo da OFERTA no caminho do commit: as seis formas (três do comum, três
 * da falha), os deltas que dizem de onde cada custo vem e a detecção contra a
 * árvore real.
 *
 * `fonte` existe como parâmetro para o TESTE poder exercitar o caminho NÃO MEDIDO
 * (um texto sem as âncoras) sem mexer no hook versionado; na CLI ela vem do disco.
 *
 * @param {{samples?: number, fonte?: string|null}} [opts]
 * @returns {object}
 */
export function measureHookCost({ samples = HOOK_SAMPLES, fonte = hookSource() } = {}) {
  const fontes = {
    hoje: fonte,
    "sem-oferta": fonte === null ? null : hookSemOferta(fonte),
    agregada: fonte === null ? null : hookWaitAgregada(fonte),
  }
  const faltando = Object.entries(fontes)
    .filter(([, texto]) => texto === null)
    .map(([nome]) => nome)

  // SEM AS ANCORAS NAO HA CONTRAFACTUAL: medir assim seria comparar o hook com
  // ele mesmo e registrar um delta 0 que nao mediu nada.
  if (faltando.length > 0) {
    const reason =
      fonte === null
        ? `${HOOK} não existe neste checkout`
        : `o texto do hook não tem as âncoras da medição (${faltando.join(", ")}) — a transformação do contrafactual não se aplica`
    return {
      measured: false,
      reason,
      hookPath: HOOK,
      samplesPerForm: samples,
      forms: [],
      deltas: null,
      detection: null,
      violations: [],
      // A frase da familia NOMEIA o NAO MEDIDO no mesmo vocabulario da forma
      // medida: um consumidor do arquivo nao pode ler "nada foi acrescentado"
      // onde o que houve foi "nao deu para medir".
      whatItAdded: [`NÃO MEDIDO: ${reason}`],
    }
  }

  const dirs = { comum: novoRepoHook(), falha: novoRepoHook() }
  let forms = []
  try {
    stage(dirs.comum, WORKFLOW, WORKFLOW_VALIDO)
    stage(dirs.falha, WORKFLOW, WORKFLOW_CICATRIZ)
    forms = HOOK_FORMS.map((form) => {
      const runs = []
      for (let i = 0; i < samples; i++) {
        const inicio = performance.now()
        const r = runSourcedHook(dirs[form.path], fontes[form.fonte], form.env ?? {})
        runs.push({ ms: Math.round(performance.now() - inicio), exit: r.status })
      }
      const ordenadas = runs.map((r) => r.ms).sort((a, b) => a - b)
      const exit = runs[runs.length - 1].exit
      return {
        ...form,
        ms: ordenadas[Math.floor(ordenadas.length / 2)],
        minMs: ordenadas[0],
        maxMs: ordenadas[ordenadas.length - 1],
        runs,
        exit,
        bloqueou: exit !== null && exit !== 0,
        ok: exit === null ? false : form.expect === "zero" ? exit === 0 : exit !== 0,
      }
    })
  } finally {
    cleanupFixtures()
  }

  const por = (role) => forms.find((f) => f.role === role)
  const delta = (a, b) =>
    por(a) === undefined || por(b) === undefined ? null : por(a).ms - por(b).ms
  const deltas = {
    // A OFERTA no caminho comum: o contrafactual é o MESMO hook sem o bloco.
    ofertaComumMs: delta("comum-hoje", "comum-sem-oferta"),
    // A ESPERA SEPARADA do gate de sintaxe contra a agregação no `wait_all`.
    esperaMs: delta("comum-hoje", "comum-agregada"),
    // A OFERTA no caminho de falha (fail-closed: sem terminal, sem pergunta).
    ofertaFalhaMs: delta("falha-hoje", "falha-sem-oferta"),
    // A REVALIDAÇÃO: a fase rodada de novo depois de um remédio VERDE (o remédio
    // afirmado pelo dublê declarado, que custa o retorno de uma função de shell).
    revalidacaoMs: delta("falha-revalidacao", "falha-sem-oferta"),
  }
  const detection = measureDetection()

  return {
    measured: true,
    reason: null,
    hookPath: HOOK,
    fixture: {
      comum: `${WORKFLOW} com corpo válido`,
      falha: `${WORKFLOW} com a cicatriz mecânica (operador pendente)`,
    },
    samplesPerForm: samples,
    forms,
    deltas,
    detection,
    violations: hookCostViolations({ forms, deltas, detection }),
    whatItAdded: hookWhatItAdded({ deltas, detection }),
  }
}

/** `+20.8s` / `-3.1s` / `+0.0s` — o sinal sempre explicito. */
function signedSeconds(ms) {
  const value = (ms ?? 0) / 1000
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}s`
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
 * @param {{samples?: number, lint?: boolean, typecheck?: boolean, tests?: boolean, hook?: boolean, counterfactual?: boolean, battery?: boolean}} [opts]
 */
function runBenchmark({
  samples = 2,
  lint = true,
  typecheck = true,
  tests = true,
  hook = true,
  counterfactual = false,
  battery = true,
} = {}) {
  const commit = getCommitHash()
  const commitDate = getCommitTimestamp()
  const timestamp = new Date().toISOString()

  // A versão do Bun do doctor: da variável (quando o job a passa pelo env) ou
  // dos espelhos DECLARADOS no repositório (.actrc / deploy/env.gitea.example),
  // via o resolvedor único — SEM literal de reserva. O `|| "1.3.14"` que vivia
  // aqui sobrevivia ao bump: o doctor seria medido contra uma versão que o
  // repositório não declara, e o número no benchmark envelheceria em silêncio.
  let bunVersion
  try {
    bunVersion = requireBunVersion({ root: REPO_ROOT }).version
  } catch (e) {
    console.error(`❌ bench-guard-timing: ${e.message}`)
    process.exit(2)
  }
  // O registry/namespace que o doctor recebe vêm do RESOLVEDOR (`registry-source
  // .mjs`): env e, na falta dele, o espelho DECLARADO. O `|| "ghcr.io"` que
  // vivia aqui era o default literal que a varredura de espelhos caça — ele
  // sobrevive à troca de registry e o doctor passaria a ser medido contra uma
  // imagem que o repositório não declara.
  let image
  try {
    image = requireImageSource({ root: REPO_ROOT })
  } catch (e) {
    console.error(`❌ bench-guard-timing: ${e.message}`)
    process.exit(2)
  }
  const imageRegistry = image.registry
  const imageNamespace = image.namespace

  const doctorEnv = {
    ...process.env,
    BUN_VERSION: bunVersion,
    IMAGE_REGISTRY: imageRegistry,
    IMAGE_NAMESPACE: imageNamespace,
  }

  // ── Guards individuais ──────────────────────────────────────────────────
  const guards = []
  let guardsTotalMs = 0
  if (battery) {
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
  }

  // ── Doctor (perfil --ci) ────────────────────────────────────────────────
  const doctorCmd = DOCTOR_CMD.replace(/\$\{BUN_VERSION\}/g, bunVersion)
    .replace(/\$\{IMAGE_REGISTRY\}/g, imageRegistry)
    .replace(/\$\{IMAGE_NAMESPACE\}/g, imageNamespace)
  const doctorResult = battery ? measure(doctorCmd, { env: doctorEnv }) : null

  // ── Lint: o custo da unificacao ─────────────────────────────────────────
  const lintCost = lint ? measureLintCost(samples) : null

  // ── As outras duas unificacoes de regua ─────────────────────────────────
  // Custam MINUTOS por forma (comandos inteiros): uma amostra cada, declarada.
  const typecheckCost = typecheck ? measureTypecheckCost({ samples: 1 }) : null
  const testsCost = tests ? measureTestCost({ samples: 1, counterfactual }) : null

  // ── O hook: a oferta de remendo no caminho do commit ────────────────────
  // Barata (segundos), mas medida com a propria mediana (HOOK_SAMPLES): o que
  // ela registra sao DELTAS de ~0 entre formas, e uma amostra so nao distingue
  // "nao custou nada" de ruido.
  const hookCost = hook ? measureHookCost({ samples: HOOK_SAMPLES }) : null

  // ── Soma total ─────────────────────────────────────────────────────────
  // Guards + doctor: os gates que rodam em TODO PR. As familias de regua ficam
  // FORA do total de proposito — elas medem o custo de rodada (que a comparacao
  // acompanha por forma), nao a bateria do dia a dia.
  const totalMs = guardsTotalMs + (doctorResult?.ms ?? 0)

  const result = {
    meta: {
      tool: "bench-guard-timing",
      version: 4,
      commit,
      commitDate,
      timestamp,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      // A maquina entra no relatorio: um numero de wall time sem ela nao e
      // comparavel entre runners (e o heap default do node VEM da RAM).
      cpus: cpus().length,
      totalMemMb: Math.round(totalmem() / 1048576),
      // Familias herdadas de uma rodada ANTERIOR por `--merge` (objeto vazio no
      // caso normal). Elas ficam FORA do veredito em todas as pontas: nao entram
      // como forma, nao julgam o TOTAL e impedem o FECHAMENTO da issue - um
      // numero de outro momento nao e "a medicao de agora" (ver `compareTimings`).
      reused: {},
    },
    summary: {
      guardsCount: guards.length,
      guardsTotalMs,
      doctorMs: doctorResult?.ms ?? null,
      doctorExit: doctorResult?.exit ?? null,
      totalMs,
      lintAddedPerSiteMs: lintCost?.addedPerSiteMs ?? null,
      lintAddedPerFanOutMs: lintCost?.addedPerFanOutMs ?? null,
      typecheckMs: typecheckCost?.canonicalMs ?? null,
      typecheckAddedPerFanOutMs: typecheckCost?.addedPerFanOutMs ?? null,
      testsMs: testsCost?.canonicalMs ?? null,
      testsAddedPerFanOutMs: testsCost?.addedPerFanOutMs ?? null,
      hookOfferComumMs: hookCost?.deltas?.ofertaComumMs ?? null,
      hookEsperaMs: hookCost?.deltas?.esperaMs ?? null,
      hookOfferFalhaMs: hookCost?.deltas?.ofertaFalhaMs ?? null,
      hookRevalidacaoMs: hookCost?.deltas?.revalidacaoMs ?? null,
      hookDetectionMs: hookCost?.detection?.ms ?? null,
    },
    guards,
    doctor: doctorResult
      ? {
          label: "doctor --ci",
          cmd: doctorCmd,
          ms: doctorResult.ms,
          exit: doctorResult.exit,
          ok: doctorResult.ok,
        }
      : null,
    lint: lintCost,
    rulers: { typecheck: typecheckCost, tests: testsCost },
    hook: hookCost,
  }

  return result
}

// ── Relatório legível ─────────────────────────────────────────────────────

/**
 * Imprime uma familia de custo de unificacao: as formas medidas, os call sites
 * (medidos), os pagantes (declarados), o delta por call site e por rodada, o que
 * ela acrescentou ONDE agora roda e as violacoes do contrato.
 *
 * `extra` carrega os fatos que so aquela familia tem (a metade nova, o heap, o
 * exit da regua que morre) — o que e comum as tres nao e reescrito em tres
 * lugares que divergem.
 *
 * @param {string} title
 * @param {object} ruler  resultado de measureLintCost/measureTypecheckCost/measureTestCost
 * @param {string[]} [extra]
 */
function printRulerReport(title, ruler, extra = []) {
  console.log(`  ${title}:`)
  console.log("  ─────────────────────────────────────────────────────")
  for (const form of ruler.forms) {
    const mark = form.ok ? "✅" : "⚠️ "
    const time = `${(form.ms / 1000).toFixed(1)}s`
    const samples = form.runs.map((r) => (r.ms / 1000).toFixed(1)).join("/")
    console.log(
      `    ${mark} ${form.label.padEnd(40)} ${time.padStart(7)}  (${form.runs.length}x: ${samples}s)`,
    )
  }
  console.log("  ─────────────────────────────────────────────────────")
  console.log(
    `    call sites de \`${ruler.canonicalCmd}\`: ${ruler.callSites} em ${ruler.pipelineFiles} pipelines`,
  )
  for (const site of ruler.sites) {
    console.log(`      · ${site.file}${site.count > 1 ? ` (${site.count} call sites)` : ""}`)
  }
  console.log(`    pagaram o custo novo: ${ruler.upgradedSites}`)
  for (const site of ruler.upgraded) console.log(`      · ${site.file} — ${site.where}`)
  console.log()
  // `null` é o delta NÃO medido (o contrafactual é opcional na família da
  // suíte). Imprimi-lo como "0.0s" seria o pior erro possível aqui: diria "não
  // acrescentou nada" onde a resposta é "não foi medido".
  const delta = (ms) =>
    ms === null || ms === undefined ? "nao medido nesta rodada" : signedSeconds(ms)
  console.log(`    acrescentado por call site: ${delta(ruler.addedPerSiteMs)}`)
  console.log(
    `    acrescentado por rodada de CI (${ruler.upgradedSites} call sites): ${delta(ruler.addedPerFanOutMs)}`,
  )
  for (const line of extra) console.log(`    ${line}`)
  if (ruler.whatItAdded) {
    console.log()
    console.log(`    o que acrescentou ONDE agora roda: ${ruler.whatItAdded}`)
  }
  for (const violation of ruler.violations) console.log(`    ❌ ${violation}`)
  console.log()
}

/**
 * Herda as familias que ESTA rodada nao mediu do arquivo anterior (`--merge`).
 *
 * POR QUE ISTO EXISTE: uma rodada completa mede comandos inteiros — um typecheck
 * FRIO e tres suites — e em maquina lenta (ou sob um timeout de runner) isso nao
 * cabe num passo so. Sem o merge, medir em partes significaria APAGAR o que ja
 * estava medido; com ele, a parte de agora entra e o resto e herdado.
 *
 * A HONESTIDADE ESTA NA PROCEDENCIA: cada familia herdada vai para
 * `meta.reused` com o commit e o timestamp de ORIGEM, o relatorio a NOMEIA, e a
 * comparacao a EXCLUI do veredito — um numero de outro momento nao pode passar
 * por "a medicao de agora".
 *
 * Pura em relacao ao relogio e ao disco: recebe os dois relatorios.
 *
 * @param {object} result    o que esta rodada mediu (familias nao medidas = null)
 * @param {object|null} previous  o arquivo anterior
 * @returns {object}
 */
export function reuseFamilies(result, previous) {
  if (!previous) return result
  const reused = {}

  const pick = (family, current, old) => {
    if (current !== null && current !== undefined) return current
    if (old === null || old === undefined) return current ?? null
    reused[family] = {
      commit: previous?.meta?.commit ?? null,
      timestamp: previous?.meta?.timestamp ?? null,
    }
    return old
  }

  const lint = pick("lint", result.lint, previous.lint)
  const typecheck = pick(
    "typecheck",
    result.rulers?.typecheck ?? null,
    previous.rulers?.typecheck ?? null,
  )
  const tests = pick("tests", result.rulers?.tests ?? null, previous.rulers?.tests ?? null)
  // O HOOK e a quarta familia de custo de rodada (barata, mas com o mesmo
  // contrato): numa rodada `--no-hook`/`--only` ela e herdada com procedencia,
  // nunca apagada — o numero de ontem junto do hoje e o que permite comparar.
  const hook = pick("hook", result.hook ?? null, previous.hook ?? null)

  // A BATERIA (guards + doctor): numa rodada de uma familia so (`--only`) ela
  // nao e medida, e gravar vazio apagaria a leitura que ja existia. Herdada, ela
  // vale a mesma regra das familias: marcada em `meta.reused` e fora do veredito.
  const bateriaVazia = (result.guards?.length ?? 0) === 0 && result.doctor === null
  const guardasHerdadas = bateriaVazia && (previous.guards?.length ?? 0) > 0
  const guards = guardasHerdadas ? previous.guards : result.guards
  const doctor = bateriaVazia && previous.doctor ? previous.doctor : result.doctor
  if (guardasHerdadas) {
    reused.battery = {
      commit: previous?.meta?.commit ?? null,
      timestamp: previous?.meta?.timestamp ?? null,
    }
  }
  const guardsTotalMs = (guards ?? []).reduce((acc, g) => acc + (g.ms ?? 0), 0)

  return {
    ...result,
    guards,
    doctor,
    lint,
    rulers: { typecheck, tests },
    hook,
    meta: { ...result.meta, reused },
    // O resumo tem de descrever o arquivo que esta sendo gravado, nao metade
    // dele: um `summary.testsMs: null` ao lado de uma secao `tests` cheia seria
    // uma incoerencia gerada pelo proprio benchmark.
    summary: {
      ...result.summary,
      guardsCount: (guards ?? []).length,
      guardsTotalMs,
      doctorMs: doctor?.ms ?? null,
      doctorExit: doctor?.exit ?? null,
      totalMs: guardsTotalMs + (doctor?.ms ?? 0),
      lintAddedPerSiteMs: lint?.addedPerSiteMs ?? null,
      lintAddedPerFanOutMs: lint?.addedPerFanOutMs ?? null,
      typecheckMs: typecheck?.canonicalMs ?? null,
      typecheckAddedPerFanOutMs: typecheck?.addedPerFanOutMs ?? null,
      testsMs: tests?.canonicalMs ?? null,
      testsAddedPerFanOutMs: tests?.addedPerFanOutMs ?? null,
      hookOfferComumMs: hook?.deltas?.ofertaComumMs ?? null,
      hookEsperaMs: hook?.deltas?.esperaMs ?? null,
      hookOfferFalhaMs: hook?.deltas?.ofertaFalhaMs ?? null,
      hookRevalidacaoMs: hook?.deltas?.revalidacaoMs ?? null,
      hookDetectionMs: hook?.detection?.ms ?? null,
    },
  }
}

/**
 * A secao do lint: as tres formas, os call sites, os pagantes e a atribuicao
 * conferida contra a metade nova (`prettier --check`).
 *
 * @param {object} lint  resultado de measureLintCost
 */
function printLintReport(lint) {
  printRulerReport("Lint — o custo da unificacao (uma regua so nas duas forjas)", lint, [
    `a metade nova isolada (prettier): ${(lint.addedHalfMs / 1000).toFixed(1)}s — atribuicao ${lint.attributionMatches ? "confere" : "NAO confere"} (${(lint.attributionPct * 100).toFixed(0)}% de diferenca)`,
  ])
}

/**
 * A secao do hook: as formas dos DOIS caminhos, os deltas com a direcao de cada um
 * e a deteccao contra a arvore real (com a conferencia de que nao escreveu).
 *
 * @param {object} hook  resultado de measureHookCost
 */
function printHookReport(hook) {
  console.log("  Hook — a oferta de remendo no caminho do commit:")
  console.log("  ─────────────────────────────────────────────────────")
  if (!hook.measured) {
    console.log(`    ⚠️  NÃO MEDIDO: ${hook.reason}`)
    console.log()
    return
  }
  for (const form of hook.forms) {
    const mark = form.ok ? "✅" : "❌"
    const amostras = form.runs.map((r) => formatMs(r.ms)).join("/")
    console.log(
      `    ${mark} ${form.label.padEnd(52)} ${formatMs(form.ms).padStart(7)}  (${form.runs.length}x: ${amostras}, exit ${form.exit})`,
    )
  }
  console.log("  ─────────────────────────────────────────────────────")
  for (const frase of hook.whatItAdded) console.log(`    · ${frase}`)
  if (hook.violations.length > 0) {
    console.log("    CONTRATO DA FAMÍLIA:")
    for (const v of hook.violations) console.log(`    ❌ ${v}`)
  }
  console.log()
}

function printReport(result) {
  const { meta, summary, guards, doctor, lint, rulers } = result
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
  if (doctor) {
    const dMark = doctor.ok ? "✅" : "❌"
    console.log(`  Doctor (--ci): ${dMark} ${(doctor.ms / 1000).toFixed(1)}s (exit ${doctor.exit})`)
  } else {
    console.log("  Doctor (--ci): nao medido nesta rodada (--only)")
  }
  console.log()

  // Lint (custo da unificacao)
  if (lint) printLintReport(lint)

  // Typecheck (o comando inteiro dentro do script)
  const tc = rulers?.typecheck
  if (tc) {
    printRulerReport(
      "Typecheck — o custo da unificacao (o comando inteiro no script do package.json)",
      tc,
      [
        `medicao FRIA: o cache ${tc.cacheFile} (gitignored, gerado) e removido antes de cada amostra`,
        `a regua SEM o heap (${tc.legacyBareCmd}): exit ${tc.legacyBareExit} em ${(tc.legacyBareMs / 1000).toFixed(1)}s (${tc.legacyBareCompleted ? "COMPLETOU" : "morreu"})`,
        `o heap default do node nesta maquina: ${tc.nodeHeapLimitMb === null ? "NAO medido (INDETERMINADO)" : `${tc.nodeHeapLimitMb}MB`} · o heap do script: ${tc.heapMb}MB`,
        `o hook ${tc.heapAddedAt.file}: roda o comando canonico? ${tc.hook?.hasCanonical ? "sim" : "NAO"} · ainda roda a regua sem o heap? ${tc.hook?.hasBare ? "SIM" : "nao"}`,
      ],
    )
  }

  // Suite de testes (a regua mais AMPLA nas duas forjas)
  const ts = rulers?.tests
  if (ts) {
    printRulerReport("Suite — o custo da unificacao (a regua mais AMPLA nas duas forjas)", ts, [
      `a regua anterior (${ts.legacyCmd}) usa \`${ts.legacyConfig}\`, que EXCLUI \`${ts.addedHalfLabel}/**\``,
      ts.attributionPct === null
        ? `a metade nova isolada (${ts.addedHalfLabel}): ${(ts.addedHalfMs / 1000).toFixed(1)}s — o contrafactual NAO foi medido nesta rodada, entao o delta e a atribuicao ficam INDETERMINADOS`
        : `a metade nova isolada (${ts.addedHalfLabel}): ${(ts.addedHalfMs / 1000).toFixed(1)}s — atribuicao ${ts.attributionMatches ? "confere" : "NAO confere"} (${(ts.attributionPct * 100).toFixed(0)}% de diferenca)`,
    ])
  }

  // Hook (a oferta de remendo no caminho do commit)
  if (result.hook) printHookReport(result.hook)

  // Familias herdadas de uma rodada anterior (`--merge`)
  const reusedFamilies = Object.entries(meta.reused ?? {})
  if (reusedFamilies.length > 0) {
    console.log("  Familias HERDADAS (nao medidas nesta rodada — fora do veredito):")
    for (const [family, from] of reusedFamilies) {
      console.log(`    · ${family} — medida em ${from.commit} (${from.timestamp})`)
    }
    console.log()
  }

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

/**
 * O limiar de regressão: 20% de piora numa forma medida já é regressão.
 *
 * É FONTE ÚNICA: o relatório impresso usa este número e o publicador da issue
 * (`guard-timing-issue.mjs`) decide por ele. Duas réguas para a mesma pergunta
 * divergem no dia em que alguém ajustar uma delas — e a divergência passaria a
 * ser "regressão no CI, sem regressão na issue" (ou o inverso), sem teste vermelho.
 */
export const REGRESSION_THRESHOLD_PCT = 0.2

/**
 * O PISO DE RUÍDO, em milissegundos: além do percentual, a piora tem de ser
 * pelo menos isto em absoluto para contar como regressão.
 *
 * POR QUE EXISTE: a bateria de guards é medida com UMA amostra por forma, e os
 * guards baratos rodam em dezenas de ms — 20% de 40ms são 8ms, que é ruído de
 * escalonamento do sistema operacional, não regressão. Sem o piso, o canal
 * semanal (o publicador de issue) abriria dívida para `check:secret-leaks +50%`
 * (40ms → 60ms) toda semana; um alerta que mente é o alerta mudo com outro nome.
 *
 * O piso é da RÉGUA, não do consumidor: o relatório impresso e o publicador da
 * issue leem os dois daqui.
 */
export const REGRESSION_MIN_DELTA_MS = 50

/**
 * O nome HUMANO de cada família que `reuseFamilies` sabe herdar. A comparação
 * que NÃO julgou uma família herdada precisa dizer QUAL — "medição incompleta"
 * sem o nome transfere a investigação para quem lê a issue, que não tem como
 * saber se o que falou foi o lint ou a bateria de guards.
 */
export const REUSED_FAMILY_LABELS = {
  battery: "bateria (guards+doctor)",
  lint: "lint",
  typecheck: "typecheck",
  tests: "suíte",
  hook: "hook (oferta de remendo)",
}

/**
 * A COMPARAÇÃO do run atual contra a baseline, como DADO — não como texto.
 *
 * POR QUE ISTO É UMA FUNÇÃO E NÃO O `console.log` QUE ELE ALIMENTA: o cron
 * semanal precisa da MESMA comparação para decidir se abre (ou fecha) a issue,
 * e um publicador que recalculasse o delta por conta própria teria a sua própria
 * régua. Aqui a régua é uma: o relatório imprime daqui, o publicador consome
 * daqui.
 *
 * `unmeasured` marca a forma que NÃO pode ser julgada: sem número, ou medida por
 * um comando que não terminou (`ok: false` — ele pode ter ficado RÁPIDO por ter
 * morrido antes de fazer o trabalho, que é o pior jeito de "melhorar", e pode
 * ficar LENTO pelo mesmo motivo, que é o pior jeito de "piorar"). Forma não
 * medida nunca é regressão — nem quando o ms dela passa do limiar —, e a
 * comparação inteira fica `measured: false`, que é o `resolution.when` do
 * publicador (não medido ≠ resolvido).
 *
 * `measured` é o veredito INTEIRO, então ele exige mais do que "nenhuma forma
 * não medida": exige COBERTURA. Família herdada por `--merge` (fora do veredito,
 * ver `reuseFamilies`) e família que a baseline tem e esta rodada não mediu nem
 * herdou deixam o veredito PARCIAL, e o motivo NOMEIA qual faltou. Herdar é
 * permitido; dar a dívida por resolvida com número herdado, não.
 *
 * O TOTAL é DERIVADO, não medido: ele só é julgado quando todas as formas que ele
 * soma foram — e quando a BATERIA é desta rodada. Herdada por `--merge`, o total
 * dela é de outro momento, e compará-lo como "agora" publicaria uma regressão sem
 * medição (ver abaixo).
 *
 * @param {object} current   relatório do `runBenchmark`
 * @param {object|null} baseline  relatório salvo como baseline
 * @param {{thresholdPct?: number, minDeltaMs?: number}} [options]
 * @returns {{measured: boolean, reason: string|null, thresholdPct: number, minDeltaMs: number, baselineCommit: string|null, currentCommit: string|null, forms: object[], regressions: object[], total: object|null}}
 */
export function compareTimings(
  current,
  baseline,
  { thresholdPct = REGRESSION_THRESHOLD_PCT, minDeltaMs = REGRESSION_MIN_DELTA_MS } = {},
) {
  const baselineGuards = new Map((baseline?.guards ?? []).map((g) => [g.label, g]))
  const forms = []

  const comparar = ({ kind, label, currentMs, baselineMs, ok = true }) => {
    const temNumero = Number.isFinite(currentMs)
    const temBaseline = Number.isFinite(baselineMs) && baselineMs > 0
    const deltaMs = temNumero && temBaseline ? currentMs - baselineMs : null
    const pct = deltaMs === null ? null : deltaMs / baselineMs
    // Uma forma NÃO JULGÁVEL (sem número, ou medida por um comando que não
    // terminou, ou de uma rodada herdada) não pode ser REGRESSÃO nem quando o
    // número dela passou do limiar: um guard que MORREU no meio tem o ms do
    // pedaço que rodou, e chamar isso de "o gate ficou mais lento" publica uma
    // dívida que ninguém consegue fechar (o número não se reproduz). O piso e o
    // percentual decidem entre as formas JULGÁVEIS; `unmeasured` decide quem
    // entra no julgamento.
    const unmeasured = !temNumero || ok === false
    const form = {
      kind,
      label,
      currentMs: temNumero ? currentMs : null,
      baselineMs: temBaseline ? baselineMs : null,
      deltaMs,
      pct,
      isNew: temNumero && !temBaseline,
      unmeasured,
      // Percentual E piso absoluto: o piso é o que separa regressão de ruído de
      // medição nos guards baratos (uma amostra por forma).
      regression: !unmeasured && pct !== null && pct > thresholdPct && (deltaMs ?? 0) >= minDeltaMs,
    }
    forms.push(form)
    return form
  }

  // Uma familia (ou a bateria) HERDADA de outra rodada nao entra no veredito: o
  // numero e de outro momento, e compara-lo com a baseline como se fosse a
  // medicao de agora esconderia exatamente a regressao que o canal existe para
  // achar. Herdar e permitido; fingir que e de agora, nao.
  const reused = current?.meta?.reused ?? {}
  const isReused = (family) => Boolean(reused[family])

  if (!isReused("battery")) {
    for (const guard of current?.guards ?? []) {
      comparar({
        kind: "guard",
        label: guard.label,
        currentMs: guard.ms,
        baselineMs: baselineGuards.get(guard.label)?.ms,
        ok: guard.ok !== false,
      })
    }

    if (current?.doctor) {
      comparar({
        kind: "doctor",
        label: "doctor --ci",
        currentMs: current.doctor.ms,
        baselineMs: baseline?.doctor?.ms,
        ok: current.doctor.ok !== false,
      })
    }
  }

  // Lint (custo da unificacao). O baseline v1 nao tem a secao: sem ela, a forma
  // sai como NOVA (e o relatorio anota isso) em vez de inventar comparacao.
  if (current?.lint && !isReused("lint")) {
    comparar({
      kind: "lint",
      label: "lint (custo por rodada)",
      currentMs: current.lint.addedPerFanOutMs,
      baselineMs: baseline?.lint?.addedPerFanOutMs,
    })
  }

  // As outras duas familias comparam o COMANDO CANONICO (a regua em si), e nao
  // o delta contra o contrafactual: aqui "regressao de tempo" significa "o gate
  // ficou mais lento", e o contrafactual nao roda mais em pipeline nenhuma.
  if (current?.rulers?.typecheck && !isReused("typecheck")) {
    comparar({
      kind: "typecheck",
      label: "typecheck (script com heap, frio)",
      currentMs: current.rulers.typecheck.canonicalMs,
      baselineMs: baseline?.rulers?.typecheck?.canonicalMs,
    })
  }
  if (current?.rulers?.tests && !isReused("tests")) {
    comparar({
      kind: "tests",
      label: "test:run (a suite do merge)",
      currentMs: current.rulers.tests.canonicalMs,
      baselineMs: baseline?.rulers?.tests?.canonicalMs,
    })
  }

  // O HOOK: cada forma e comparada com a MESMA FORMA da baseline (o papel, nao a
  // posicao na lista) — a forma e o caminho do commit, e comparar `comum-hoje`
  // com o que estiver na linha de cima seria medir outra coisa. O DELTA entre
  // formas nao entra aqui de proposito: ele e diferenca de duas medianas, e
  // julgar regressao sobre ele multiplicaria o ruido; o que a comparacao julga e
  // o custo ABSOLUTO de cada forma, e o delta diz de onde ele veio.
  const hookBaseline = (role) =>
    (baseline?.hook?.forms ?? []).find((form) => form.role === role)?.ms
  if (current?.hook?.measured && !isReused("hook")) {
    for (const form of current.hook.forms ?? []) {
      comparar({
        kind: "hook",
        label: form.label,
        currentMs: form.ms,
        baselineMs: hookBaseline(form.role),
        ok: form.ok !== false,
      })
    }
    const detection = current.hook.detection
    if (detection?.medido) {
      comparar({
        kind: "hook-detection",
        label: "hook: detecção na árvore real",
        currentMs: detection.ms,
        baselineMs: baseline?.hook?.detection?.ms,
        ok: detection.completou !== false,
      })
    }
  }

  // O TOTAL soma as formas acima: ele só é julgável quando TODAS elas foram.
  // Uma bateria com um guard que não terminou tem um total menor por um motivo
  // que não é velocidade (o guard morreu antes de fazer o trabalho), então
  // julgá-lo contra a baseline produziria "melhoria" no agregado e regressão
  // nas partes — duas leituras contraditórias do mesmo run. O total é derivado
  // (não medido independente): se alguma parte não foi medida, ele também não é.
  // A BATERIA HERDADA É O TOTAL: `summary.totalMs` é a soma de guards + doctor,
  // e quando ela vem de outra rodada (`--merge`) esse número é de OUTRO momento.
  // Julgá-lo como "o total de agora" produz exatamente a regressão que o canal
  // não pode publicar: o delta existe, a medição não.
  const partesMedidas = forms.filter((form) => form.unmeasured).length === 0
  const total = comparar({
    kind: "total",
    label: "TOTAL",
    currentMs: current?.summary?.totalMs,
    baselineMs: baseline?.summary?.totalMs,
    ok: partesMedidas && !isReused("battery"),
  })

  const naoMedidas = forms.filter((form) => form.unmeasured)
  // O motivo NOMEIA as formas partes que faltaram; o TOTAL só entra quando é a
  // única coisa não medida (senão o motivo repetiria a bateria que já foi dita).
  const nomeadas = naoMedidas.filter((form) => form.kind !== "total")
  // A FAMÍLIA HERDADA também é medição que não é de AGORA. Ela já sai do veredito
  // (acima), mas `measured` é a guarda de FECHAMENTO da issue de tempo: com ele
  // true, um `--only tests --merge` FECHARIA a dívida de guards que esta rodada
  // nunca mediu. Herdar segue permitido; dar a dívida por resolvida com número
  // herdado, não.
  const herdadas = Object.keys(reused)
  // COBERTURA: se a BASELINE tem uma família que esta rodada NÃO mediu (pulada
  // por `--no-lint`/`--only`), o veredito é PARCIAL — e a dívida pode ser
  // justamente sobre ela. Herdar não cai aqui: a família herdada está presente
  // (com a procedência marcada), o que falta é a que não foi medida NEM herdada.
  const temBateria = (report) => (report?.guards?.length ?? 0) > 0 || report?.doctor != null
  const faltantes = [
    ["lint", baseline?.lint != null, current?.lint != null],
    ["typecheck", baseline?.rulers?.typecheck != null, current?.rulers?.typecheck != null],
    ["tests", baseline?.rulers?.tests != null, current?.rulers?.tests != null],
    ["hook", baseline?.hook != null, current?.hook != null],
    ["battery", temBateria(baseline), temBateria(current)],
  ]
    .filter(([, naBase, agora]) => naBase && !agora)
    .map(([family]) => family)

  const motivos = []
  if (!baseline) motivos.push("sem baseline para comparar")
  if (naoMedidas.length > 0) {
    motivos.push(
      `forma não medida: ${(nomeadas.length > 0 ? nomeadas : naoMedidas).map((f) => f.label).join(", ")}`,
    )
  }
  if (herdadas.length > 0) {
    motivos.push(
      `família herdada de outra rodada (fora do veredito): ${herdadas
        .map((family) => REUSED_FAMILY_LABELS[family] ?? family)
        .join(", ")}`,
    )
  }
  if (faltantes.length > 0) {
    motivos.push(
      `família da baseline não medida nesta rodada: ${faltantes
        .map((family) => REUSED_FAMILY_LABELS[family] ?? family)
        .join(", ")}`,
    )
  }
  const measured = Boolean(baseline) && forms.length > 0 && motivos.length === 0
  const reason = motivos.length > 0 ? motivos.join(" · ") : null

  return {
    measured,
    reason,
    thresholdPct,
    minDeltaMs,
    baselineCommit: baseline?.meta?.commit ?? null,
    currentCommit: current?.meta?.commit ?? null,
    forms,
    regressions: forms.filter((form) => form.regression),
    total,
    reused: Object.keys(reused),
  }
}

function compareReport(current, baseline) {
  const cmp = compareTimings(current, baseline)
  if (!baseline) {
    console.log("  ⚠️  Sem baseline para comparar. Execute com --baseline primeiro.")
    return { regression: false, comparison: cmp }
  }

  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log("   📊 COMPARAÇÃO vs baseline")
  console.log("  ═══════════════════════════════════════════════════════════════")
  console.log()
  console.log(`  baseline: ${baseline.meta?.commit ?? "?"} (${baseline.meta?.timestamp ?? "?"})`)
  console.log(`  atual:    ${current.meta.commit} (${current.meta.timestamp})`)
  console.log()

  const arrowOf = (form) =>
    form.isNew ? "➕" : (form.deltaMs ?? 0) > 0 ? "📈" : (form.deltaMs ?? 0) < 0 ? "📉" : "  "
  const flagOf = (form) => (form.regression ? " ⚠️  REGRESSÃO" : "")
  const deltaOf = (form, pad) => {
    const sign = (form.deltaMs ?? 0) > 0 ? "+" : ""
    return (
      `${arrowOf(form)} ${form.label.padEnd(pad)} ${(form.currentMs / 1000).toFixed(1)}s (` +
      `${sign}${((form.deltaMs ?? 0) / 1000).toFixed(1)}s, ${sign}${((form.pct ?? 0) * 100).toFixed(0)}%)` +
      `${flagOf(form)}`
    )
  }

  console.log("  Guards:")
  console.log("  ─────────────────────────────────────────────────────")
  for (const form of cmp.forms.filter((f) => f.kind === "guard")) {
    console.log(
      form.isNew
        ? `    ➕ ${form.label.padEnd(30)} ${(form.currentMs / 1000).toFixed(1)}s (novo)`
        : `    ${deltaOf(form, 30)}`,
    )
  }
  console.log("  ─────────────────────────────────────────────────────")

  const doctor = cmp.forms.find((f) => f.kind === "doctor")
  if (doctor && !doctor.isNew) {
    const sign = (doctor.deltaMs ?? 0) > 0 ? "+" : ""
    console.log(
      `    ${arrowOf(doctor)} doctor --ci${" ".repeat(20)} ${(doctor.currentMs / 1000).toFixed(1)}s (${sign}${((doctor.deltaMs ?? 0) / 1000).toFixed(1)}s, ${sign}${((doctor.pct ?? 0) * 100).toFixed(0)}%)${flagOf(doctor)}`,
    )
  }

  // As formas de custo de rodada (as tres familias de regua). A primeira vez que
  // elas aparecem elas sao NOVAS (o baseline nao as tinha) — dito no relatorio,
  // em vez de inventar um delta contra um numero que nao existia.
  for (const { kind, label, pad } of [
    { kind: "lint", label: "lint (custo por rodada)", pad: 7 },
    { kind: "typecheck", label: "typecheck (script com heap, frio)", pad: 0 },
    { kind: "tests", label: "test:run (a suite do merge)", pad: 0 },
  ]) {
    const form = cmp.forms.find((f) => f.kind === kind)
    if (!form) continue
    if (form.isNew) {
      console.log(
        `    ➕ ${label}${" ".repeat(pad)} ${(form.currentMs / 1000).toFixed(1)}s (novo no baseline)`,
      )
    } else {
      const sign = (form.deltaMs ?? 0) > 0 ? "+" : ""
      console.log(
        `    ${arrowOf(form)} ${label}${" ".repeat(pad)} ${(form.currentMs / 1000).toFixed(1)}s (${sign}${((form.deltaMs ?? 0) / 1000).toFixed(1)}s, ${sign}${((form.pct ?? 0) * 100).toFixed(0)}%)${flagOf(form)}`,
      )
    }
  }

  // O HOOK: forma por forma (o papel dela e o que a nomeia; a baseline e casada
  // por papel, nao por posicao).
  for (const form of cmp.forms.filter((f) => f.kind === "hook" || f.kind === "hook-detection")) {
    console.log(
      form.isNew
        ? `    ➕ ${deltaOf(form, 52).slice(2)} (novo no baseline)`
        : `    ${deltaOf(form, 52)}`,
    )
  }

  if ((cmp.reused ?? []).length > 0) {
    console.log(`  (familias herdadas, FORA do veredito desta rodada: ${cmp.reused.join(", ")})`)
  }

  const total = cmp.total
  console.log()
  console.log(
    `  TOTAL: ${(total.currentMs / 1000).toFixed(1)}s (${(total.deltaMs ?? 0) > 0 ? "+" : ""}${((total.deltaMs ?? 0) / 1000).toFixed(1)}s vs baseline)`,
  )
  if (total.regression) {
    console.log(`  ⚠️  REGRESSÃO DE TEMPO: +${((total.pct ?? 0) * 100).toFixed(0)}% (limiar: 20%)`)
  }

  console.log()
  return { regression: cmp.regressions.length > 0, comparison: cmp }
}

// ── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    json: false,
    save: false,
    baseline: false,
    compare: false,
    lint: true,
    typecheck: true,
    tests: true,
    hook: true,
    counterfactual: false,
    merge: false,
    only: null,
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
    else if (arg === "--no-typecheck") opts.typecheck = false
    else if (arg === "--no-tests") opts.tests = false
    else if (arg === "--no-hook") opts.hook = false
    else if (arg === "--counterfactual") opts.counterfactual = true
    else if (arg === "--only") {
      const parsed = parseOnly(argv[++i])
      if (parsed.error) {
        opts.error = parsed.error
        return opts
      }
      opts.only = parsed.families
    } else if (arg === "--merge") opts.merge = true
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

/**
 * Roda tambem a BATERIA (guards + doctor)? Numa rodada de UMA familia so, a
 * bateria e ruido — e ela e herdada com `--merge`, nao apagada.
 */
export function runsBattery({ only } = {}) {
  return only === null || only === undefined
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
  node scripts/bench-guard-timing.mjs --no-lint      # sem a família do lint
  node scripts/bench-guard-timing.mjs --no-typecheck # sem a família do typecheck
  node scripts/bench-guard-timing.mjs --no-tests     # sem a família da suíte
  node scripts/bench-guard-timing.mjs --no-hook      # sem a família do hook
  node scripts/bench-guard-timing.mjs --counterfactual # mede também a régua ANTERIOR da suíte (~7min)
  node scripts/bench-guard-timing.mjs --only tests # só a família da suíte (sem a bateria)
  node scripts/bench-guard-timing.mjs --only hook  # só o custo da oferta de remendo no commit
  node scripts/bench-guard-timing.mjs --json --merge # herda as famílias não medidas do arquivo

As famílias typecheck e suíte medem COMANDOS INTEIROS (um typecheck FRIO e as
suítes): uma amostra cada, de propósito. Sem as três, a rodada é a bateria de
guards + doctor (segundos).

A família \`hook\` roda o pre-commit DE VERDADE num repositório git temporário (o
mesmo fixture da prova do hook, com os binários das fases dublados), nos DOIS
caminhos do commit: o comum (nada reprova) e o de falha (defeito mecânico no
índice). O contrafactual é o MESMO hook com o bloco da oferta removido e com o gate
de sintaxe agregado ao \`wait_all\` — transformações ancoradas no texto do hook, e
NÃO MEDIDO quando as âncoras somem. Ela mede também a detecção contra a árvore
real, conferindo que a medição não escreveu nada.

O CONTRAFACTUAL da suíte (bun run test:unit, a régua que o check do GitHub
rodava antes, com maxWorkers 1) leva ~7min sozinho e NÃO roda em pipeline
nenhuma: ele é medido sob demanda (--counterfactual), e sem ele o delta sai null
(INDETERMINADO) em vez de vir de outra rodada. Com --only FAMILIA a rodada mede
só aquelas famílias e PULA a bateria; com --merge, o que esta rodada NÃO mediu é
herdado do arquivo, marcado em meta.reused e deixado FORA do veredito — a família
herdada (ou pulada) NÃO julga o TOTAL e torna a comparação measured: false, o que
recusa o fechamento da issue de tempo (herdar não é medir agora).

Exit codes: 0 sucesso · 1 falha/regressão · 2 argumento inválido`)
    return 0
  }
  if (opts.error) {
    console.error(`bench-guard-timing: ${opts.error}`)
    return 2
  }

  const familias = familiesToRun({ only: opts.only })
  let result = runBenchmark({
    samples: opts.samples,
    lint: opts.lint && familias.lint,
    typecheck: opts.typecheck && familias.typecheck,
    tests: opts.tests && familias.tests,
    hook: opts.hook && familias.hook,
    counterfactual: opts.counterfactual,
    battery: runsBattery({ only: opts.only }),
  })
  if (opts.merge) {
    const previous = existsSync(join(BENCH_DIR, LATEST_FILE))
      ? JSON.parse(readFileSync(join(BENCH_DIR, LATEST_FILE), "utf8"))
      : null
    result = reuseFamilies(result, previous)
  }
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
