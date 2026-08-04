#!/usr/bin/env node

// =============================================================================
// check-mutation-jobs.mjs
//
// CI guard (fast gate, <1s, node-puro) que valida que TODO mutation test de
// guard (scripts/test-mutation-*.sh) tem o job correspondente no CI —
// falhando se um NOVO script de mutation test for adicionado sem ser wireado
// em nenhum job (o drift que este guard existe para prevenir: um PR adiciona
// test-mutation-<guard>.sh mas esquece de referenciá-lo num workflow ou na
// matriz do master — o mutation test nunca roda no CI e o guard que ele
// prova fica sem cobertura end-to-end).
//
// Cobertura é TRANSITIVA, espelhando a arquitetura de orquestração:
//   1. refs DIRETAS: `run:` de QUALQUER .github/workflows/*.yml que invoque
//      `bash scripts/test-mutation-X.sh` (ou `bun run test:mutation-X`
//      mapeado via package.json scripts → o .sh). Ex.: pr-check.yml roda o
//      master (test-mutation-guards.sh) e seed-guards.yml roda o
//      seed-dev-e2e.
//   2. matriz MASTER: se test-mutation-guards.sh está coberto, TODOS os
//      scripts da sua matriz SUBTESTS=(...) estão cobertos transitivamente.
//   3. matriz ANINHADA: se test-mutation-readme-guards.sh está coberto (via
//      SUBTESTS do master), TODOS os scripts da sua matriz SCENARIOS=(...)
//      (anchors + toc + images) estão cobertos.
//
// A validação é BIDIRECIONAL:
//   → (forward)  script test-mutation-*.sh SEM cobertura (direta ou
//                transitiva) = mutation test órfão — exit 1.
//   ← (reverse)  ref de MATRIZ (SUBTESTS/SCENARIOS) OU de WORKFLOW (run:
//                direto num .github/workflows/*.yml) apontando para script
//                INEXISTENTE em scripts/ = ref quebrada — exit 1. O par
//                fecha nos DOIS lados: script sem job falha (forward) e
//                job sem script falha (reverse).
//
// Modo --staged (espelho do check-bun-mirror --staged): avalia SÓ o diff em
// questão (git diff --cached local, ou --base <ref> → git diff <ref>...HEAD
// no CI) e falha se ele INTRODUZIR um test-mutation-*.sh NOVO sem cobertura
// (sem ref direta num workflow run: nem na matriz do master). Violações
// pré-existentes do base não poluem o PR; um script novo sem wire falha
// ANTES do merge mesmo que o working tree global já esteja consistente.
// Reusa DIFF_CONTEXT/isValidGitRef do check-bun-mirror.mjs (fonte única).
//
// Usage:
//   node scripts/check-mutation-jobs.mjs                   # scan global
//   node scripts/check-mutation-jobs.mjs --staged          # git diff --cached
//   node scripts/check-mutation-jobs.mjs --staged --base origin/main  # diff PR
//
// Exit codes:
//   0 — todo mutation test tem job correspondente (pass)
//   1 — mutation test órfão OU ref quebrada (matriz ou workflow) (global);
//       test-mutation-*.sh NOVO sem job (--staged)
//   2 — infra: scripts/ ou .github/workflows/ ausente (fail-closed);
//       --base inválido ou git diff indisponível (--staged)
// =============================================================================

import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { DIFF_CONTEXT, isValidGitRef } from "./check-bun-mirror.mjs"

/**
 * Invocação com PREFIXO de comando (`bash scripts/test-mutation-X.sh`): exige
 * o verbo antes de `scripts/` para NÃO casar menções em texto (ex.: um
 * `echo "usa scripts/test-mutation-x.sh"` não é cobertura — espelha o
 * check-workflow-refs.mjs). Usada SÓ para refs de workflow.
 */
const CMD_SCRIPT_RE = /(?:bash|sh|node|bun x|bun run)\s+scripts\/(test-mutation-[a-z0-9._-]+\.sh)/
/** Invocação sem prefixo: linha de matriz `...|scripts/test-mutation-X.sh`. */
const SCRIPT_IN_CMD_RE = /scripts\/(test-mutation-[a-z0-9._-]+\.sh)/
/** Invocação via package.json: `bun run test:mutation-X`. */
const BUN_RUN_RE = /\bbun run (test:mutation-[a-z0-9_-]+)/
/** Path de um script de mutation test no diff (scripts/test-mutation-X.sh). */
const MUTATION_SCRIPT_PATH_RE = /^scripts\/(test-mutation-[a-z0-9._-]+\.sh)$/
/**
 * Início de um step run single-line no YAML. O `-` (marker de lista) fica na
 * linha do `name:`/`uses:` — o `run:` é uma linha própria (`        run: bash
 * scripts/test-mutation-guards.sh`), mas `- run: cmd` (dash na MESMA linha)
 * também é YAML válido. O prefixo `- ` é OPCIONAL: exigir `- run:` no MESMO
 * line quebraria o formato real dos workflows (bug pego em teste real).
 */
const RUN_SINGLE_RE = /^\s*(?:-\s+)?run:\s*(.+)$/
/** Início de um step run em bloco (run: | ...). */
const RUN_BLOCK_RE = /^\s*(?:-\s+)?run:\s*\|/

/**
 * Extrai as refs a scripts de mutation test dos `run:` de um workflow
 * (single-line E bloco), mapeando `bun run test:mutation-X` via package.json.
 * Comentários do workflow NÃO contam — só o que está em `run:` é cobertura.
 *
 * @param {string} content  conteúdo do workflow
 * @param {Record<string,string>} pkgScripts  scripts de package.json
 * @returns {string[]} nomes de arquivos test-mutation-*.sh (sem duplicatas)
 */
export function extractWorkflowRunRefs(content, pkgScripts = {}) {
  const refs = new Set()
  const collect = (cmd) => {
    // linha de comentário bash DENTRO de um bloco run não é executada — não
    // pode gerar cobertura falsa (ex.: um `# usa scripts/test-mutation-x.sh`)
    if (cmd.trim().startsWith("#")) return
    const m = cmd.match(CMD_SCRIPT_RE)
    if (m) {
      refs.add(m[1])
      return
    }
    const b = cmd.match(BUN_RUN_RE)
    if (b) {
      const mapped = pkgScripts[b[1]] ?? ""
      const mm = mapped.match(SCRIPT_IN_CMD_RE)
      if (mm) refs.add(mm[1])
    }
  }

  const lines = content.split(/\r?\n/)
  let blockIndent = -1
  for (const line of lines) {
    if (blockIndent >= 0) {
      const indent = (line.match(/^\s*/) ?? [""])[0].length
      if (line.trim() === "" || indent > blockIndent) {
        collect(line)
        continue
      }
      blockIndent = -1 // dedentou → fim do bloco run
    }
    // run:| DEVE ser checado ANTES de run single-line: o RUN_SINGLE_RE casa
    // `run: |` capturando `|` como comando, então o modo bloco nunca entraria
    // (bug real: extractWorkflowRunRefs retornava [] no seed-guards.yml)
    if (RUN_BLOCK_RE.test(line)) {
      blockIndent = (line.match(/^\s*/) ?? [""])[0].length
      continue
    }
    const single = line.match(RUN_SINGLE_RE)
    if (single) {
      collect(single[1])
      continue
    }
  }
  return [...refs]
}

/**
 * Extrai as refs de uma matriz de orquestração (SUBTESTS/SCENARIOS) de um
 * script bash — SOMENTE dentro do bloco `NOME=( ... )` (comentários do header
 * que citam os mesmos scripts NÃO contam: cobertura falsa por comentário).
 *
 * @param {string} content  conteúdo do script orquestrador
 * @param {string} arrayName  nome do array (ex.: "SUBTESTS", "SCENARIOS")
 * @returns {string[]} nomes de arquivos test-mutation-*.sh (sem duplicatas)
 */
export function extractMatrixRefs(content, arrayName) {
  const refs = new Set()
  let inBlock = false
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!inBlock) {
      if (line.startsWith(`${arrayName}=(`)) inBlock = true
      continue
    }
    if (line === ")") {
      inBlock = false
      continue
    }
    const m = line.match(SCRIPT_IN_CMD_RE)
    if (m) refs.add(m[1])
  }
  return [...refs]
}

/**
 * Calcula a cobertura TRANSITIVA: diretas ∪ (matrizes de orquestradores
 * cobertos, em fixpoint — o master cobre o readme-guards, que cobre
 * anchors/toc/images).
 *
 * @param {{ scripts: string[], directRefs: string[], matrixRefs: Record<string,string[]> }} input
 * @returns {{ covered: Set<string>, uncovered: string[] }}
 */
export function computeCoverage({ scripts, directRefs, matrixRefs }) {
  const covered = new Set(directRefs)
  let changed = true
  while (changed) {
    changed = false
    for (const [orchestrator, refs] of Object.entries(matrixRefs)) {
      if (!covered.has(orchestrator)) continue
      for (const r of refs) {
        if (!covered.has(r)) {
          covered.add(r)
          changed = true
        }
      }
    }
  }
  const uncovered = scripts.filter((s) => !covered.has(s))
  return { covered, uncovered }
}

/**
 * Validação bidirecional da cobertura de mutation tests.
 *
 * @param {{ scripts: string[], directRefs: string[], matrixRefs: Record<string,string[]> }} input
 * @returns {string[]} violações (vazio = tudo coberto)
 */
export function checkMutationJobs({ scripts, directRefs, matrixRefs }) {
  const violations = []
  const { uncovered } = computeCoverage({ scripts, directRefs, matrixRefs })
  for (const s of uncovered) {
    violations.push(
      `mutation script '${s}' SEM job correspondente em NENHUM workflow (nem via matriz do master) — wire-o num job de .github/workflows/*.yml ou adicione à matriz do test-mutation-guards.sh`,
    )
  }
  const scriptSet = new Set(scripts)
  // reverse — refs de WORKFLOW (run: direto) para script INEXISTENTE em
  // scripts/ (par fechado com o forward): um run: que invoca um script
  // removido/renomeado deixa o job invocando um arquivo fantasma — o CI
  // falharia no runtime; o guard pega no review. Espelho do loop de
  // matrixRefs abaixo.
  for (const r of directRefs) {
    if (!scriptSet.has(r)) {
      violations.push(
        `workflow referencia '${r}' que NÃO existe em scripts/ — ref quebrada de workflow (renomeou/removeu o script?)`,
      )
    }
  }
  // reverse — refs de MATRIZ (SUBTESTS/SCENARIOS) para script INEXISTENTE.
  for (const [orchestrator, refs] of Object.entries(matrixRefs)) {
    for (const r of refs) {
      if (!scriptSet.has(r)) {
        violations.push(
          `matriz de '${orchestrator}' referencia '${r}' que NÃO existe em scripts/ — matriz quebrada (renomeou/removeu o script?)`,
        )
      }
    }
  }
  return violations
}

/**
 * Roda `git diff --cached` (staged local) ou `git diff <base>...HEAD`
 * (CI — PR vs base) limitado a scripts/ — espelho do gitDiffWorkflows do
 * check-bun-mirror. Retorna null se git indisponível / sem repositório /
 * ref base inválida (o caller decide o exit code).
 *
 * @param {string|null} base  ref base (ex.: "origin/main"); null = staged
 * @returns {string|null} texto do diff ou null (infra failure)
 */
export function gitDiffMutationScripts(base) {
  if (base !== null && !isValidGitRef(base)) return null
  const args = base
    ? ["diff", `-U${DIFF_CONTEXT}`, `${base}...HEAD`, "--", "scripts/"]
    : ["diff", `-U${DIFF_CONTEXT}`, "--cached", "--", "scripts/"]
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
  } catch {
    return null
  }
}

/**
 * Extrai os NOMES dos test-mutation-*.sh NOVOS (arquivos adicionados) de um
 * diff — só arquivos com `new file mode` contam (modificação de um script
 * já existente não é "novo introduzido pelo PR").
 *
 * @param {string} diffText  saída de git diff (--cached ou base...HEAD)
 * @returns {string[]} nomes de arquivos test-mutation-*.sh novos (sorted)
 */
export function parseDiffAddedMutationScripts(diffText) {
  const added = new Set()
  // quebra em blocos por arquivo (diff --git a/X b/X ...)
  for (const block of diffText.split(/^diff --git /m).slice(1)) {
    if (!/^new file mode /m.test(block)) continue // só arquivos NOVOS
    // extrai o path do arquivo novo (+++ b/<path>) e valida contra a FONTE
    // única do path de mutation test (MUTATION_SCRIPT_PATH_RE — mesma regex
    // usada pelo scan de blocos; sem drift entre o path e o parse do diff).
    const m = block.match(/^\+\+\+ b\/(scripts\/test-mutation-[a-z0-9._-]+\.sh)$/m)
    if (m && MUTATION_SCRIPT_PATH_RE.test(m[1])) added.add(m[1].slice("scripts/".length))
  }
  return [...added].sort()
}

/**
 * Checa os test-mutation-*.sh NOVOS de um diff contra a cobertura ATUAL
 * (refs diretas + matrizes transitivas): um script novo introduzido pelo PR
 * precisa de job — sem isso o mutation test nunca roda no CI. Violações
 * pré-existentes do base NÃO poluem o PR (só o que o diff ADICIONA é
 * avaliado — espelho do checkStagedCacheKeys).
 *
 * @param {string} diffText  saída de git diff
 * @param {{scripts: string[], directRefs: string[], matrixRefs: Record<string,string[]>}} state
 * @returns {string[]} violações (vazio = ok)
 */
export function checkStagedMutationJobs(diffText, state) {
  const newScripts = parseDiffAddedMutationScripts(diffText)
  if (newScripts.length === 0) return []
  const { covered } = computeCoverage(state)
  const violations = []
  for (const s of newScripts) {
    if (!covered.has(s)) {
      violations.push(
        `mutation script '${s}' NOVO neste diff SEM job correspondente em NENHUM workflow (nem via matriz do master) — wire-o num job de .github/workflows/*.yml ou adicione à matriz do test-mutation-guards.sh ANTES do merge`,
      )
    }
  }
  return violations
}

/** Coleta o estado atual do repo (scripts + refs diretas + matrizes). */
function collectRepoState() {
  const cwd = process.cwd()
  const scriptsDir = join(cwd, "scripts")
  const workflowsDir = join(cwd, ".github", "workflows")
  const pkgPath = join(cwd, "package.json")

  for (const [label, p] of [
    ["scripts/", scriptsDir],
    [".github/workflows/", workflowsDir],
    ["package.json", pkgPath],
  ]) {
    if (!existsSync(p)) {
      console.error(`❌ ${label} ausente: ${p}`)
      process.exit(2)
    }
  }

  const scripts = readdirSync(scriptsDir)
    .filter((f) => f.startsWith("test-mutation-") && f.endsWith(".sh"))
    .sort()

  const pkgScripts = JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {}

  const directRefs = new Set()
  for (const wf of readdirSync(workflowsDir)) {
    if (!/\.ya?ml$/i.test(wf)) continue
    for (const ref of extractWorkflowRunRefs(
      readFileSync(join(workflowsDir, wf), "utf8"),
      pkgScripts,
    )) {
      directRefs.add(ref)
    }
  }

  const matrixRefs = {}
  for (const [name, arrayName] of [
    ["test-mutation-guards.sh", "SUBTESTS"],
    ["test-mutation-readme-guards.sh", "SCENARIOS"],
  ]) {
    const p = join(scriptsDir, name)
    if (existsSync(p)) matrixRefs[name] = extractMatrixRefs(readFileSync(p, "utf8"), arrayName)
  }

  return { scripts, directRefs: [...directRefs], matrixRefs }
}

function main() {
  const args = process.argv.slice(2)
  const staged = args.includes("--staged")
  const baseIdx = args.indexOf("--base")
  const base = baseIdx !== -1 ? args[baseIdx + 1] : null

  if (base && !staged) {
    console.error(
      `⚠️  --base ${base} sem --staged — o --base só tem efeito no modo --staged (diff base...HEAD). Rodando o scan global.`,
    )
  }

  // ── Modo --staged: só o que o diff em questão INTRODUZ ──────────────
  // Local/pre-commit: git diff --cached (o que está staged). CI: o job
  // passa --base origin/main → git diff origin/main...HEAD. Só arquivos
  // test-mutation-*.sh NOVOS são avaliados — violações pré-existentes do
  // base não poluem o PR, e um script novo sem wire falha ANTES do merge.
  if (staged) {
    const diffText = gitDiffMutationScripts(base)
    if (diffText === null) {
      console.error(
        `❌ Modo --staged: git diff indisponível` +
          (base ? ` (base ${base})` : ` (nada staged? rode 'git add' primeiro)`),
      )
      process.exit(2)
    }
    const state = collectRepoState()
    const violations = checkStagedMutationJobs(diffText, state)
    if (violations.length > 0) {
      console.error(`❌ Diff com ${violations.length} mutation test(s) NOVO(s) sem job:\n`)
      for (const v of violations) console.error(`   - ${v}`)
      console.error(
        `\n   Um test-mutation-*.sh NOVO precisa de cobertura: ref direta (run:) num` +
          `\n   workflow OU entrada na matriz do master — sem isso o mutation test` +
          `\n   nunca roda no CI e o guard que ele prova fica sem cobertura end-to-end.`,
      )
      process.exit(1)
    }
    console.log(
      `✅ Diff ok — nenhum test-mutation-*.sh novo sem job` +
        (base ? ` (vs base ${base})` : ` (staged)`),
    )
    process.exit(0)
  }

  // ── Modo padrão: invariantes globais do repositório ─────────────────
  const state = collectRepoState()
  const violations = checkMutationJobs(state)

  if (violations.length > 0) {
    console.error(`❌ Cobertura de mutation tests no CI inconsistente (${violations.length}):\n`)
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   A cobertura é TRANSITIVA: um mutation test está coberto se um workflow` +
        `\n   o invoca diretamente (run:) OU se ele está na matriz do master` +
        `\n   (SUBTESTS/SCENARIOS do test-mutation-guards.sh), que o pr-check roda.` +
        `\n   Adicionar um mutation test novo = wireá-lo num job OU na matriz;` +
        `\n   remover um script citado na matriz OU num run: de workflow = ref` +
        `\n   quebrada (também falha — o par fecha nos dois lados).`,
    )
    process.exit(1)
  }

  console.log(
    `✅ Todos os ${state.scripts.length} mutation tests têm job correspondente no CI (${state.directRefs.length} refs diretas + matrizes do master).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
