#!/usr/bin/env node
/**
 * run-precommit-guards.mjs - batch runner dos 10 guards node do pre-commit
 * (2026-08, secao 11.13/11.16): uma UNICA invocacao node em vez de 10 spawns.
 *
 * WHY: o boot do node (~0.14s) dominava cada guard isolado (0.14-0.63s
 * medido); os spawns sequenciais do hook custavam ~0.54-0.81s por commit.
 * Este runner importa os 10 guards no MESMO processo (1 boot) e roda os scans
 * em sequencia, agregando os exit codes: medido ~0.22-0.26s - ~2.7x mais
 * rapido que o sequencial e mais deterministico que o paralelo (saida
 * ORDENADA, sem interleave de stdout num hook set -euo pipefail; o paralelo
 * ficou em ~0.24-0.34s mas embaralharia os veredictos). Todos os guards
 * rodam SEMPRE (agregacao reporta todas as falhas de uma vez - o hook antigo
 * com `set -e` parava no 1o, escondendo as demais).
 *
 * Os guards importados (todos exportam main() com entry-point guard proprio,
 * entao importar NAO executa):
 *   1. check-node-modules-integrity.mjs  (sec 8.5/8.6): node_modules
 *      divergente do bun.lock -> falha com o comando de cura.
 *   2. scan-push-full-suite.mjs          (sec 8.4/11.9/11.11): Gate 3 mapeado
 *      NAO suite completa + fuzz mapeado pre-push-only + encoding unico.
 *   3. scan-lint-staged-loader.mjs       (sec 11.7): o lint-staged nao volta
 *      ao loader bun sem secao 11.x ADOTADO datada; o gate eslint nao sai.
 *   4. scan-guard-gates.mjs              (sec 8.4/11.11): o push net
 *      guard-gates.yml roda incondicionalmente com test:guard completo.
 *   5. scan-fuzz-precommit.mjs           (sec 11.11): o run-mapped-fuzz NAO
 *      ganha --scope cached no .husky/pre-commit sem nota 11.x ADOTADO
 *      datada (o veredito fuzz pre-push-only, padrao do 11.7).
 *   6. scan-batch-coverage.mjs           (sec 11.16): o CONTRATO DE
 *      CRESCIMENTO do proprio batch - todo node guard novo no pre-commit
 *      deve entrar AQUI (o guard de cobertura e ele proprio batchado; a
 *      lista vem dos imports vivos, nao de regex fixo).
 *   7. scan-prepush-batch.mjs            (sec 11.17): o pre-push NAO e
 *      batchado - o batch so passa a valer se o pre-push ganhar um SEGUNDO
 *      node guard (<0.2s cada). Este guard trava a condicao: um node guard
 *      novo no .husky/pre-push falha com o caminho exato (ate uma secao
 *      11.x ADOTADO datada reverter o veredito) e o integrity segue como
 *      spawn individual la. Ele roda NO BATCH do pre-commit (a validacao
 *      do working tree do pre-push, mesmo padrao do scan-push-full-suite).
 *   8. scan-exit-claims.mjs              (sec 11.42, REFINAMENTO 2026-08-11
 *      - o tripwire do hook): o CLI do CONTRATO 'claim de doc sem pin'
 *      roda como guard do pre-commit - uma claim de exit code nova numa
 *      secao 11.x do gates-proofs.md sem registro no EXIT_CLAIMS falha
 *      ANTES do commit. O gap fechado: o pre-commit:test mapeia docs para
 *      NADA (pre-commit-tests.mjs), entao o SELF-GUARD original dependia
 *      de rodar a suite (test:unit no CI). O batch roda incondicional
 *      (invariante do repo: guards baratos nao ganham condicao) - o
 *      incremento medido e ~15-25ms (boot compartilhado).
 *   9. scan-proof-helpers.mjs             (sec 11.93, 2026-08-12 - o 9o
 *      guard): o CONTRATO de fail-loud dos helpers de prova (sec 11.72)
 *      executado no batch - a suite da 11.72 so rodava via test:unit (no
 *      CI/push), entao a edicao acidental do bloco 'Exit codes:' do
 *      docblock de um helper (hook-proof-run/ci-proof-run) passava o
 *      commit local e so falhava no push. As Provas 44/48 provaram o
 *      contrato ao vivo; este guard o executa NO PRE-COMMIT (o mesmo
 *      padrao do tripwire do exit-claims). Roda INCONDICIONAL (a
 *      invariante da sec 11.42 supersede a premisa da condicao por
 *      arquivo do pedido: guards baratos nao ganham condicao; ~15-25ms de
 *      fs + regex, boot compartilhado).
 *  10. scan-unit-config.mjs               (sec 11.96, 2026-08-12 - o 10o
 *      guard): o CONTRATO da nota SERIALIZED POOL do vitest.config.unit.ts
 *      (sec 11.80 poolNotePresent + sec 11.95 a citacao da planura vs a
 *      sec 8.1) executado no batch - a suite da 11.80/11.95 so rodava via
 *      test:unit (no CI/push), entao editar o config (reescrever a
 *      justificativa, remover a nota, dessincronizar a citacao) passava o
 *      commit local e so falharia no push. Roda INCONDICIONAL (a mesma
 *      invariante - ~10-20ms de fs + regex, boot compartilhado); as 4
 *      funcoes extratoras vivem NO GUARD (a fonte unica que a suite da
 *      sec 11.80/11.95 importa, a regra dos 2 usos).
 * O scan-guard-gates main() e ASYNC (override WORKFLOW_CONTRACTS_MODULE via
 * import dinamico) - o runner o aguarda antes de agregar.
 *
 * Exit: 0 = todos os 10 limpos; 1 = pelo menos um falhou (worst-exit - os
 * exit codes dos guards sao 0/1 puros, entao o agregado e o OR logico).
 * Env overrides dos guards sao herdados (PUSH_SUITE_SCAN_ROOT,
 * LINT_LOADER_SCAN_ROOT, GUARD_GATES_SCAN_ROOT, NODE_MODULES_ROOT) - os
 * testes vitest apontam UM deles para um repo sintetico e provam agregacao
 * + isolamento sem tocar o repo real. Saida ASCII pura (gate file). Puro
 * node, sem deps.
 *
 * ESCOPO (asimetria deliberada): este batch e do PRE-COMMIT. O pre-push
 * continua spawnando check-node-modules-integrity INDIVIDUALMENTE (antes do
 * fuzz mapeado - o guard precisa rodar antes do fuzz gastar ~53s num
 * node_modules divergente; o contrato 'guards node batchados' cobre so o
 * .husky/pre-commit).
 */
import { fileURLToPath } from "node:url"
import path from "node:path"
import { main as integrityMain } from "./check-node-modules-integrity.mjs"
import { main as pushSuiteMain } from "./scan-push-full-suite.mjs"
import { main as lintLoaderMain } from "./scan-lint-staged-loader.mjs"
import { main as guardGatesMain } from "./scan-guard-gates.mjs"
import { main as fuzzPrecommitMain } from "./scan-fuzz-precommit.mjs"
import { main as batchCoverageMain } from "./scan-batch-coverage.mjs"
import { main as prepushBatchMain } from "./scan-prepush-batch.mjs"
import { main as exitClaimsMain } from "./scan-exit-claims.mjs"
import { main as proofHelpersMain } from "./scan-proof-helpers.mjs"
import { main as unitConfigMain } from "./scan-unit-config.mjs"

/**
 * Run the 10 guards in hook order and aggregate the exit codes. Every guard
 * ALWAYS runs (worst-exit reporting: one failure does not hide the others -
 * the reason the batch exists over the old `set -e`-short-circuit hook).
 * Returns the aggregated exit code (0 | 1). Not exported: the test suite
 * exercises the CLI entry point (the real wiring), never an in-process
 * call - an in-process import would run the 10 guards against the real repo
 * AND mutate process.exitCode as a side effect.
 */
async function runPrecommitGuards() {
  const codes = [
    integrityMain(),
    pushSuiteMain(),
    lintLoaderMain(),
    await guardGatesMain(),
    fuzzPrecommitMain(),
    batchCoverageMain(),
    prepushBatchMain(),
    exitClaimsMain(),
    proofHelpersMain(),
    unitConfigMain(),
  ]
  const worst = codes.some((c) => c !== 0) ? 1 : 0
  process.exitCode = worst
  return worst
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// runPrecommitGuards for unit tests without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPrecommitGuards().then((code) => {
    process.exitCode = code
  })
}
