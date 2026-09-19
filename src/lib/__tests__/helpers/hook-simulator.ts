/**
 * hook-simulator.ts
 *
 * A PORTA tipada dos testes para o simulador de hook do repositório, que vive em
 * `scripts/hook-simulator.mjs` — node PURO, porque tem dois consumidores de
 * naturezas diferentes: estes testes (que precisam das duas formas de executar o
 * hook — somada e pelo git) e o `forge-doctor`, que roda sem bundler e precisa
 * EXECUTAR a mesma prova para publicá-la como fato do relatório.
 *
 * Ele era TS aqui e foi portado: duas cópias da máquina divergem no dia em que
 * uma delas for ajustada, e a divergência apareceria como uma prova que mede
 * outra coisa (um fixture que não sabe commitar, um dublê que mente). O que fica
 * aqui é só o TIPO — a implementação é uma só.
 *
 * Usage:
 *   import { novoRepo, stage, runSourcedHook, cleanupFixtures } from "@/lib/__tests__/helpers/hook-simulator"
 *
 *   afterAll(() => cleanupFixtures())
 *   const dir = novoRepo({ wrapper: wrapperSource(STUBS) })
 *   stage(dir, "src/foo.ts", "…")
 *   expect(runSourcedHook(dir, hookSource).status).toBe(0)
 */

export {
  COMPLETOU,
  HOOK_UNDER_TEST,
  MODULES,
  REPO_ROOT,
  WRAPPER_FILE,
  bareRemote,
  cleanupFixtures,
  commitObjects,
  contentAtRef,
  committedContent,
  copiaDoCheckout,
  countObjects,
  gitConfig,
  gitConfigSet,
  harnessPath,
  headExists,
  indexPaths,
  isExecutable,
  novoRepo,
  refsOf,
  resolveBash,
  runGit,
  runSourcedHook,
  shellParses,
  stage,
  tempDir,
  touch,
  writeHook,
  wrapperSource,
} from "../../../../scripts/hook-simulator.mjs"
export type {
  HookFile,
  RepoOptions,
  RunResult,
  StubSpec,
} from "../../../../scripts/hook-simulator.mjs"
