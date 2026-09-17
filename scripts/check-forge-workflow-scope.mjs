#!/usr/bin/env node

// =============================================================================
// check-forge-workflow-scope.mjs
//
// Guard META: nenhum script pode CRAVAR um diretorio de workflow de forja.
//
// POR QUE: o buraco que este guard fecha nao foi um bug pontual — foi uma
// CLASSE. 14 guards do repositorio tinham `.github/workflows` cravado no
// escopo; quando a forja Gitea/Forgejo virou dona do merge, a pipeline que
// decide o merge ficou fora da cobertura de TODOS eles de uma vez. O resultado
// observado: `BUN_VERSION: "1.4.0"` literal, `oven-sh/setup-bun@v2` em 6 call
// sites e `check:ts-nocheck` ausente na forja, sem um unico guard reclamar.
//
// Corrigir os 14 casos um a um resolve o sintoma. Este guard resolve a classe:
// a lista de forjas vive em scripts/forge-workflows.mjs (FONTE UNICA) e
// cravar um diretorio passa a ser uma violacao DETECTAVEL — inclusive para a
// proxima forja que nascer.
//
// O QUE E PERMITIDO: referenciar um ARQUIVO especifico de uma forja
// (`".github/workflows/pr-check.yml"`), porque ha guards legitimamente sobre UM
// workflow (os snapshots de estrutura, por exemplo). O que e proibido e o
// DIRETORIO — que e o que faz um guard varrer uma forja so.
//
// Invariantes:
//   1. Nenhum `scripts/*.mjs` (fora do modulo da fonte unica) contem o literal
//      de um diretorio de forja: `".github/workflows"` / `".gitea/workflows"`.
//   2. Nenhum monta o caminho por segmentos: `join(..., ".github", "workflows")`.
//   3. Comentarios sao ignorados (documentar a regra nao e viola-la).
//
// Usage:
//   node scripts/check-forge-workflow-scope.mjs
//
// Exit codes:
//   0 — a fonte unica e a unica declaracao de diretorio de forja
//   1 — algum script cravou um diretorio de forja
// =============================================================================

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { FORGE_WORKFLOW_DIRS, isCommentLine as reguaDeComentario } from "./forge-workflows.mjs"

/** Modulo da fonte unica — unico lugar que PODE declarar os diretorios. */
export const SOURCE_OF_TRUTH = "forge-workflows.mjs"

/** Este proprio guard menciona os diretorios na prosa e nos testes de regra. */
export const SELF = "check-forge-workflow-scope.mjs"

/**
 * Scripts isentos, com a razao. Uma isencao aqui e uma decisao consciente de
 * que o script NÃO varre workflows de forja (ele apenas cita o caminho como
 * texto de exemplo/manual). Isencao sem razao nao entra.
 */
export const EXEMPT = new Map([[SELF, "o proprio guard (documenta e testa a regra)"]])

/**
 * Uma linha de codigo (comentario removido) crava um diretorio de forja?
 * Retorna a descricao da forma encontrada, ou null.
 *
 * @param {string} line
 * @returns {string|null}
 */
export function hardcodedForgeDir(line) {
  // Forma 1: o literal do diretorio inteiro, terminando ali
  //   `".github/workflows"`  → violacao
  //   `".github/workflows/pr-check.yml"` → arquivo, PERMITIDO
  for (const dir of FORGE_WORKFLOW_DIRS) {
    const re = new RegExp(`["'\`]${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`)
    if (re.test(line)) return `literal do diretorio "${dir}"`
  }

  // Forma 2: montagem por segmentos em que o diretorio E O ULTIMO argumento
  //   join(root, ".github", "workflows")                  → violacao
  //   join(root, ".github", "workflows", "pr-check.yml")   → ARQUIVO, permitido
  const seg = /join\s*\([^)]*["'`]\.(github|gitea)["'`][^)]*["'`]workflows["'`]\s*\)/
  if (seg.test(line)) return 'caminho montado por segmentos (join(..., ".<forge>", "workflows"))'

  return null
}

/**
 * Linha e comentario? (`//`, `/*`, `*` no inicio) — o guard protege o codigo
 * que EXECUTA; a prosa que documenta a regra nao pode ser violacao dela.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isCommentLine(line) {
  // A REGUA e uma so (`forge-workflows.mjs`); o que este call site DECLARA e a
  // SINTAXE que ele varre. Antes de unificar, cada guard tinha a sua copia, e
  // as tres respostas para a mesma pergunta eram diferentes (uma sem `/*`,
  // outra sem `//`): a diferenca era acidente de copia, nao decisao.
  return reguaDeComentario(line, { slash: true })
}

/**
 * Varre os scripts de um diretorio e devolve as violacoes.
 *
 * @param {string} scriptsDir
 * @returns {string[]}
 */
export function findScopeViolations(scriptsDir) {
  const violations = []
  let names
  try {
    names = readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"))
  } catch (e) {
    return [`nao foi possivel ler ${scriptsDir}: ${e.message}`]
  }
  for (const name of names.sort()) {
    if (name === SOURCE_OF_TRUTH || EXEMPT.has(name)) continue
    const lines = readFileSync(join(scriptsDir, name), "utf8").split(/\r?\n/)
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return
      const why = hardcodedForgeDir(line)
      if (why) {
        violations.push(
          `scripts/${name}:${i + 1}: ${why} — o diretorio de forja vem de scripts/forge-workflows.mjs (FONTE UNICA); cravar o diretorio deixa as OUTRAS forjas fora da varredura (foi assim que a pipeline dona do merge ficou fora da cobertura dos guards)`,
        )
      }
    })
  }
  return violations
}

// ── modo CLI (so quando invocado diretamente, nao quando importado) ────────
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-forge-workflow-scope.mjs"

if (isMain) {
  const violations = findScopeViolations(join(process.cwd(), "scripts"))
  if (violations.length === 0) {
    console.log(
      `check-forge-workflow-scope: ✅ diretorios de forja declarados so em scripts/${SOURCE_OF_TRUTH} (forjas: ${FORGE_WORKFLOW_DIRS.join(", ")}).`,
    )
    process.exit(0)
  }
  console.error("check-forge-workflow-scope: ❌ diretorio de forja cravado fora da fonte unica:")
  for (const v of violations) console.error(`  - ${v}`)
  console.error(
    "\nImporte de scripts/forge-workflows.mjs. Se o script referencia UM arquivo de workflow especifico (e nao o diretorio), use o caminho completo do arquivo — isso e permitido.",
  )
  process.exit(1)
}
