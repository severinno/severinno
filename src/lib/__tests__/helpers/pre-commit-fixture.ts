/**
 * pre-commit-fixture.ts
 *
 * A PORTA tipada dos testes para a camada do hook `.husky/pre-commit`, que vive
 * em `scripts/pre-commit-proof.mjs` — as constantes do hook (o guard, o remédio,
 * o fecho transitivo), os defeitos do fixture e as duas formas de executá-lo:
 * SOMADO (`runHook`) e PELO GIT (`writeHooksShim` + `runCommit`).
 *
 * Ela mora em `scripts/` porque tem DOIS consumidores: estes testes e o
 * `forge-doctor`, que publica a prova de ponta a ponta (o corpo `run:` quebrado
 * no índice é BLOQUEADO, o corpo fechado ENTRA) como fato próprio do relatório
 * de prontidão — com o mesmo `proveCommitBlocks()`, e não com uma segunda
 * implementação da mesma medição.
 *
 * Os dois testes do hook medem o MESMO contrato por ângulos diferentes:
 * `pre-commit-run-syntax-blocks.test.ts` (o hook somado, com o stdout do guard no
 * veredito) e `pre-commit-git-commit-blocks.test.ts` (um `git commit` de verdade
 * com `core.hooksPath`, e o veredito lido no OBJETO).
 *
 * Usage:
 *   import { novoRepo, stage, runHook, cleanupFixtures } from "@/lib/__tests__/helpers/pre-commit-fixture"
 *
 *   afterAll(() => cleanupFixtures())
 *   const dir = novoRepo()
 *   stage(dir, WORKFLOW, WORKFLOW_VALIDO)
 *   expect(runHook(dir).status).toBe(EXIT.OK)
 */

import { hookSource } from "../../../../scripts/pre-commit-proof.mjs"
import {
  runCommit as runCommitBase,
  runHook as runHookBase,
} from "../../../../scripts/pre-commit-proof.mjs"

export {
  GUARD,
  GUARD_CLOSURE,
  GUARD_COMMAND,
  HOOK,
  HOOKS_DIR,
  REMEDY,
  REMEDY_COMMAND,
  SHELL_QUEBRADO,
  SHELL_SCRIPT,
  WORKFLOW,
  WORKFLOW_CICATRIZ,
  WORKFLOW_QUEBRADO,
  WORKFLOW_VALIDO,
  WRAPPER_SOURCE,
  closureProblems,
  hookSource,
  naoRelativos,
  novoRepo,
  proveCommitBlocks,
  writeHooksShim,
} from "../../../../scripts/pre-commit-proof.mjs"

/** O corpo do hook REAL do repositório (a régua que os dois testes executam). */
export const HOOK_SOURCE = hookSource() ?? ""

/**
 * Roda o hook (real ou mutado) somado pelo dublê. Sem `hookSource` explícito,
 * roda o hook REAL do repositório — é o default que faz o teste medir o arquivo
 * que o git executa, e não uma cópia do fixture.
 */
export function runHook(
  dir: string,
  hookSourceTexto: string = HOOK_SOURCE,
  extraEnv: Record<string, string> = {},
) {
  return runHookBase(dir, hookSourceTexto, extraEnv)
}

/** Um `git commit` de verdade (o git invoca o hook do `hooksPath`). */
export function runCommit(dir: string, extraEnv: Record<string, string> = {}, args?: string[]) {
  return runCommitBase(dir, extraEnv, args)
}
