#!/usr/bin/env node
/**
 * guard-remeasure-fake-cmd.mjs - fake do subprocesso do ci-proof-run para
 * guard-remeasure.test.ts (hermetic).
 *
 * O guard-remeasure spawna o ci-proof-run via GUARD_REMEASURE_CIPROOF_CMD
 * (env override - o mesmo padrao do DOC_REVALIDATE_CLI_CMD da sec
 * 8.37/11.61). Este fixture imprime o DONE line que o helper espera
 * (`DONE run=<id> url=<url> conclusion=<c> log=<path>`) apontando para um
 * log que o TESTE escreve - a extracao REAL (stepSpan + bandVerdict) roda
 * sobre o log scriptado, provando o ciclo completo sem um run de CI real.
 *
 * Env:
 *   GUARD_REMEASURE_FAKE_LOG   o path do log (o conteudo vem do arquivo
 *                              que o teste escreve).
 *   GUARD_REMEASURE_FAKE_RUN   o databaseId do run (default 777).
 *   GUARD_REMEASURE_FAKE_CONCLUSION  "success" (default) | "failure".
 *
 * Puro node, sem deps, ASCII puro.
 */
import fs from "node:fs"

const logPath = process.env.GUARD_REMEASURE_FAKE_LOG
if (!logPath) {
  process.stderr.write("fake cmd: GUARD_REMEASURE_FAKE_LOG nao definido\n")
  process.exit(9)
}
const run = process.env.GUARD_REMEASURE_FAKE_RUN || "777"
const conclusion = process.env.GUARD_REMEASURE_FAKE_CONCLUSION || "success"
if (!fs.existsSync(logPath)) {
  process.stderr.write(`fake cmd: log nao encontrado: ${logPath}\n`)
  process.exit(9)
}
process.stdout.write(
  `ci-proof-run: DONE run=${run} url=https://github.com/severinno/severinno/actions/runs/${run} conclusion=${conclusion} log=${logPath}\n`,
)
