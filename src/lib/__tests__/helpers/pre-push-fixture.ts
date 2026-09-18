/**
 * pre-push-fixture.ts
 *
 * A PORTA tipada dos testes para a camada do hook `.husky/pre-push`, que vive em
 * `scripts/pre-push-proof.mjs` — as constantes do hook (os comandos das fases, o
 * smart-skip), as árvores do fixture e as duas formas de executá-lo: SOMADO
 * (`runHook`) e PELO GIT (`writeHooksShim` + `runPush`).
 *
 * Ela mora em `scripts/` porque tem DOIS consumidores: estes testes e o
 * `forge-doctor`, que publica a prova de ponta a ponta (a árvore vermelha é
 * BLOQUEADA com ZERO objeto no remoto, a verde CHEGA) como fato próprio do
 * relatório de prontidão — com o mesmo `provePushBlocks()`, e não com uma segunda
 * implementação da mesma medição. É o OUTRO ELO do contrato local: o primeiro é o
 * `pre-commit` (`helpers/pre-commit-fixture`).
 *
 * Usage:
 *   import { montaPushFixture, runPush, cleanupFixtures } from "@/lib/__tests__/helpers/pre-push-fixture"
 *
 *   afterAll(() => cleanupFixtures())
 *   const { dir, remoto } = montaPushFixture({ arvore: "vermelha" })
 *   expect(runPush(dir, "origin").status).not.toBe(0)
 */

import { hookSource } from "../../../../scripts/pre-push-proof.mjs"
import { runPush as runPushBase } from "../../../../scripts/pre-push-proof.mjs"

export {
  ARVORE_ARQUIVO,
  ARVORE_BASE,
  ARVORE_BOA,
  ARVORE_RUIM,
  ENCODING_GUARDS_COMMAND,
  FRASE_DA_REPROVACAO,
  HOOK,
  HOOKS_DIR,
  HOOK_NAME,
  LOG,
  MARCADOR,
  PACKAGE_JSON,
  PAYLOAD,
  PAYLOAD_FILE,
  TYPECHECK_COMMAND,
  WRAPPER_SOURCE,
  hookSource,
  invocacoesDoPayload,
  montaPushFixture,
  novoRepo,
  provePushBlocks,
  runHook,
  writeHooksShim,
} from "../../../../scripts/pre-push-proof.mjs"

/** O corpo do hook REAL do repositório (a régua que o teste executa). */
export const HOOK_SOURCE = hookSource() ?? ""

/** Um `git push` de verdade (o git invoca o hook do `hooksPath`). */
export function runPush(
  dir: string,
  remoto: string = "origin",
  extraEnv: Record<string, string> = {},
  args?: string[],
) {
  return runPushBase(dir, remoto, extraEnv, args)
}
