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
 * Diretorios de composite actions locais. O Gitea/Forgejo resolve actions
 * locais a partir do workspace, entao `.github/actions` vale para as duas
 * forjas; `.gitea/actions` existe como espelho opcional (caso a runner nao
 * resolva o caminho do GitHub).
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
