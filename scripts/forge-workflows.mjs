#!/usr/bin/env node

// =============================================================================
// forge-workflows.mjs
//
// FONTE UNICA dos diretorios de workflow/actions das forjas do projeto.
//
// POR QUE: os guards do repositorio cravavam `.github/workflows` no escopo. No
// momento em que a forja self-hosted (Gitea/Forgejo) passou a ser DONA DO MERGE,
// esse escopo virou ponto cego: a pipeline que decide o merge ficou FORA da
// cobertura dos invariantes (versao unica do Bun, proibicao do
// oven-sh/setup-bun, hooks de seed, referencias workflow->script, sentinels...).
//
// Nao e hipotetico — foi assim que viveram na forja, sem nenhum guard reclamar:
//   - `BUN_VERSION: "1.4.0"` literal em 2 workflows (o repo proibe literais);
//   - `oven-sh/setup-bun@v2` em 3 call sites (o repo migrou para o composite
//     local justamente para eliminar esse action);
//   - `check:ts-nocheck` ausente da pipeline dona do merge.
//
// REGRA: um guard NUNCA escreve `.github/workflows` (como DIRETORIO) nem
// `.gitea/workflows`. Importe daqui. Quem fiscaliza essa regra e o
// `scripts/check-forge-workflow-scope.mjs`.
//
// A SEGUNDA FONTE UNICA: a leitura de `defaults: run: shell:`.
//
// Todo guard que extrai um `run:` de YAML de workflow precisa saber que a
// declaracao `defaults:` NAO e um passo. Sem isso, um workflow que declara o
// shell (`defaults: {run: {shell: bash}}`, ou a forma que o YAML aceita
// `defaults:\n  run: bash`) produz um passo FANTASMA — e o pior caso nao e o
// ruido: e o gate FALSO. `defaults:\n  run: node scripts/check-x.mjs` faz
// `runCommands`/`discoverGates`/`firstRunLine` relatarem um gate que a pipeline
// nao executa, e o guard de paridade satisfaz a invariante com uma declaracao
// de shell.
//
//   defaultsBlocks(content)   → as declaracoes de shell (escopo e valor)
//   defaultsRunLines(content) → as LINHAS da declaracao (`defaults.run`), que
//                               nenhum guard pode tratar como passo
//
// Usage:
//   import { existingWorkflowDirs, allWorkflowFiles } from "./forge-workflows.mjs"
//   for (const dir of existingWorkflowDirs(process.cwd())) { ... }
//
// Exit codes:
//   (modulo puro — nao possui CLI nem exit code proprio)
// =============================================================================

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

/** Workflows do GitHub (espelho / origem historica). */
export const GITHUB_WORKFLOW_DIR = ".github/workflows"

/**
 * Workflows da forja self-hosted (Gitea/Forgejo) — a DONA DO MERGE.
 * O Gitea e o Forgejo compartilham o diretorio `.gitea/workflows`.
 */
export const GITEA_WORKFLOW_DIR = ".gitea/workflows"

/**
 * Diretorios de workflow das forjas, na ORDEM canonica (dona do merge primeiro).
 * Este array e a unica declaracao de "quais forjas existem" no repositorio.
 */
export const FORGE_WORKFLOW_DIRS = [GITHUB_WORKFLOW_DIR, GITEA_WORKFLOW_DIR]

/**
 * Diretorios de composite actions locais, VARRIDOS pelos guards para que uma
 * action local em qualquer forja deixe de ser invisivel. Hoje so
 * `.github/actions` e referenciado.
 *
 * NAO use esta lista para "consertar" resolucao de action local. O act_runner
 * resolve `uses: ./<path>` como `filepath.Join(Config.Workdir, <path>)`
 * (gitea/act, pkg/runner/step_action_local.go) — o NOME do diretorio nao entra
 * na conta. Ou seja: `.gitea/actions/setup-bun` NAO resolve onde
 * `.github/actions/setup-bun` falha; com o mesmo Workdir, ambos resolvem ou
 * nenhum resolve. A lista existe para COBERTURA dos guards, nao como plano B de
 * resolucao. Remedios reais em deploy/GITEA.md, secao "Smoke test da forja".
 */
export const FORGE_ACTIONS_DIRS = [".github/actions", ".gitea/actions"]

/** Arquivo de workflow: `.yml`/`.yaml` (mesmo contrato dos guards atuais). */
export const WORKFLOW_FILE_RE = /\.ya?ml$/

/**
 * Diretorios de workflow que EXISTEM no checkout, na ordem canonica. Um repo
 * sem `.gitea/` simplesmente nao devolve essa entrada — ausencia de forja nao
 * e violacao.
 *
 * @param {string} root  raiz do repositorio
 * @returns {string[]} ex.: [".github/workflows", ".gitea/workflows"]
 */
export function existingWorkflowDirs(root) {
  return FORGE_WORKFLOW_DIRS.filter((dir) => existsSync(join(root, dir)))
}

/**
 * Nomes de workflow (apenas o basename, ordenados) de UM diretorio de forja.
 * O basename e o que o allowlist dos guards usa (ex.:
 * ALLOWED_SEED_TEST_WORKFLOWS lista `seed-guards.yml`).
 *
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
export function workflowFileNames(root, dir) {
  const abs = join(root, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((f) => WORKFLOW_FILE_RE.test(f))
    .sort()
}

/**
 * Todos os workflows de todas as forjas, com o caminho RELATIVO a raiz (que e
 * o que a mensagem de violacao deve mostrar, para o leitor saber em qual
 * pipeline o problema esta).
 *
 * @param {string} root
 * @returns {{ dir: string, name: string, path: string }[]}
 */
export function allWorkflowFiles(root) {
  const out = []
  for (const dir of existingWorkflowDirs(root)) {
    for (const name of workflowFileNames(root, dir)) {
      out.push({ dir, name, path: `${dir}/${name}` })
    }
  }
  return out
}

/**
 * O caminho relativo e um workflow de alguma forja? Usado pelo guard de escopo
 * e por quem precisa decidir se um arquivo entra na varredura.
 *
 * @param {string} relPath  caminho relativo a raiz
 * @returns {boolean}
 */
export function isForgeWorkflowPath(relPath) {
  if (!WORKFLOW_FILE_RE.test(relPath)) return false
  return FORGE_WORKFLOW_DIRS.some((dir) => relPath.startsWith(`${dir}/`))
}

/**
 * Um caminho e um DIRETORIO de forja (nao um arquivo dentro dele)? Usado pelo
 * guard de escopo para distinguir `".github/workflows"` (proibido cravar) de
 * `".github/workflows/pr-check.yml"` (referencia a um arquivo especifico, que e
 * legitima quando o guard fala de UM workflow).
 *
 * @param {string} relPath
 * @returns {boolean}
 */
export function isForgeWorkflowDir(relPath) {
  return FORGE_WORKFLOW_DIRS.includes(relPath)
}

// ── Layout de YAML: as primitivas de linha (indentacao MEDIDA, nao presumida)

/**
 * O LAYOUT de `jobs:` de um workflow: onde comeca e qual a indentacao das
 * chaves de job.
 *
 * A indentacao e MEDIDA, nao presumida `2`: um workflow escrito com outro
 * recuo faria o guard classificar passos no job errado — e a classificacao e o
 * que decide se um `| grep -q` e a classe SIGPIPE.
 *
 * @param {string[]} lines
 * @returns {{jobsIdx: number, jobIndent: number | null}}
 */
export function jobsLayout(lines) {
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (jobsIdx === -1) return { jobsIdx: -1, jobIndent: null }
  for (let k = jobsIdx + 1; k < lines.length; k++) {
    const l = lines[k]
    if (l.trim() === "" || l.trim().startsWith("#")) continue
    if (!/^\s/.test(l)) return { jobsIdx, jobIndent: null }
    return { jobsIdx, jobIndent: l.match(/^[ \t]*/)[0].length }
  }
  return { jobsIdx, jobIndent: null }
}

/** O nome do job que uma linha de CHAVE de job (`  guardas:`) declara. */
export function jobKeyName(line, jobIndent) {
  const m = new RegExp(`^\\s{${jobIndent}}([^\\s:#][^:]*):\\s*(?:#.*)?$`).exec(line)
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null
}

/**
 * A CHAVE filha direta de um bloco YAML (o primeiro nivel abaixo do cabecalho).
 *
 * @param {string[]} lines
 * @param {number} headIdx
 * @param {number} headIndent
 * @param {string} key
 * @returns {number | null}
 */
export function yamlChildKey(lines, headIdx, headIndent, key) {
  let childIndent = null
  for (let k = headIdx + 1; k < lines.length; k++) {
    const l = lines[k]
    if (l.trim() === "" || l.trim().startsWith("#")) continue
    const ind = l.match(/^[ \t]*/)[0].length
    if (ind <= headIndent) return null
    const m = /^\s*([A-Za-z_][A-Za-z0-9_.-]*):/.exec(l)
    if (!m) continue
    if (childIndent === null) childIndent = ind
    if (ind !== childIndent) continue
    if (m[1] === key) return k
  }
  return null
}

// ── `defaults: run: shell:` — o que e declaracao nao pode ser lido como passo

/** A indentacao da linha (a coluna, nao a largura do recuo do arquivo). */
const indentOf = (line) => /^[ \t]*/.exec(line)[0].length

/**
 * As DECLARACOES de `defaults:` de um workflow — o shell default no nivel do
 * ARQUIVO e no nivel de cada JOB.
 *
 * Tres formas chegam aqui, e as tres sao DECLARACAO (nunca passo):
 *
 *   1. em bloco (`defaults:\n  run:\n    shell: bash`) — o `shell:` e lido;
 *   2. em linha (`defaults: {run: {shell: bash}}`) — o guard NAO a le, e diz
 *      `unparsed`: nao ler NAO e o mesmo que nao haver, e presumir "sem shell
 *      declarado" ali seria a aposta que este modulo existe para acabar;
 *   3. valor escalar no `run:` (`defaults:\n  run: bash`) — NAO e YAML valido
 *      como `defaults.run` (que e um mapa de `shell`/`working-directory`), mas
 *      e a forma que os scaners de `run:` por regex leem como COMANDO: e a
 *      origem do passo fantasma, e por isso tambem sai `unparsed`.
 *
 * @param {string} content
 * @returns {{scope: "workflow"|"job", job: string | null, shell: string,
 *   line: number, runLine: number | null, inline: boolean, unparsed?: true}[]}
 */
export function defaultsBlocks(content) {
  const lines = String(content ?? "").split(/\r?\n/)
  const { jobsIdx, jobIndent } = jobsLayout(lines)
  const out = []
  let jobAtual = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === "" || l.trim().startsWith("#")) continue
    const indent = indentOf(l)
    const escopo = indent === 0 ? "workflow" : "job"
    const dono = indent === 0 ? null : jobAtual
    if (jobsIdx !== -1 && jobIndent !== null && i > jobsIdx && indent === jobIndent) {
      jobAtual = jobKeyName(l, jobIndent) ?? jobAtual
      continue
    }
    const inline = /^(\s*)defaults:\s*(\S.*)$/.exec(l)
    if (inline) {
      out.push({
        scope: escopo,
        job: dono,
        shell: inline[2].trim(),
        line: i + 1,
        runLine: i + 1,
        inline: true,
        unparsed: true,
      })
      continue
    }
    const header = /^(\s*)defaults:\s*$/.exec(l)
    if (!header) continue
    const dup = header[1].length
    const runIdx = yamlChildKey(lines, i, dup, "run")
    if (runIdx === null) continue
    const runIndent = indentOf(lines[runIdx])
    const restoRun = lines[runIdx]
      .replace(/^\s*run:\s*/, "")
      .replace(/\s+#.*$/, "")
      .trim()
    if (restoRun !== "" && !/^[|>]/.test(restoRun)) {
      out.push({
        scope: escopo,
        job: dono,
        shell: restoRun,
        line: runIdx + 1,
        runLine: runIdx + 1,
        inline: false,
        unparsed: true,
      })
      continue
    }
    const shellIdx = yamlChildKey(lines, runIdx, runIndent, "shell")
    if (shellIdx === null) continue
    const shell = lines[shellIdx]
      .replace(/^\s*shell:\s*/, "")
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^['"]|['"]$/g, "")
    out.push({
      scope: escopo,
      job: dono,
      shell,
      line: shellIdx + 1,
      runLine: runIdx + 1,
      inline: false,
    })
  }
  return out
}

/**
 * As LINHAS (1-based) da declaracao `defaults.run` — a chave `run:`, o valor
 * escalar dela, e os filhos diretos (`shell:`, `working-directory:`).
 *
 * E o que TODO guard que extrai `run:` de YAML consulta antes de ler a linha
 * como passo. Um workflow que declara o shell deixa de produzir:
 *
 *   - passo FANTASMA (o `run: bash` de `defaults:` virando comando);
 *   - gate FALSO (`defaults: run: node scripts/check-x.mjs` satisfazendo uma
 *     invariante que a pipeline nao executa);
 *   - ref FALSA para `check-workflow-refs` (o nome de um script que nunca roda).
 *
 * O escopo terminado no PRIMEIRO nivel abaixo do `run:` e de proposito: as
 * duas unicas chaves validas de `defaults.run` sao `shell` e
 * `working-directory`, entao nada executavel vive mais fundo que isso.
 *
 * @param {string} content
 * @returns {Set<number>} linhas 1-based da declaracao
 */
export function defaultsRunLines(content) {
  const lines = String(content ?? "").split(/\r?\n/)
  const out = new Set()
  for (const bloco of defaultsBlocks(content)) {
    if (bloco.runLine === null) continue
    if (bloco.inline) {
      out.add(bloco.runLine)
      continue
    }
    out.add(bloco.runLine)
    const runIndent = indentOf(lines[bloco.runLine - 1])
    for (let k = bloco.runLine; k < lines.length; k++) {
      const l = lines[k]
      if (l.trim() === "" || l.trim().startsWith("#")) continue
      if (indentOf(l) <= runIndent) break
      out.add(k + 1)
    }
  }
  return out
}
