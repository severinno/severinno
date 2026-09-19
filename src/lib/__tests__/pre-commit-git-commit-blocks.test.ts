/**
 * pre-commit-git-commit-blocks.test.ts
 *
 * O elo que faltava do contrato: um `git commit` de VERDADE, com `core.hooksPath`
 * apontando para os hooks, e o veredito medido no OBJETO — com o corpo `run:`
 * quebrado no índice, o commit NÃO EXISTE no banco do repositório.
 *
 * Por que a prova que SUMA o hook não bastava: `pre-commit-run-syntax-blocks
 * .test.ts` prova o exit code DO HOOK (o veredito dele). O que o git FAZ com esse
 * exit code é outro elo, e é o que se promete a quem commita — "o commit não
 * acontece". Entre os dois ficam decisões que só o git toma:
 *
 *   - um hook SEM bit de execução é IGNORADO em silêncio (o commit entra com o
 *     defeito, e nada no output do teste fica vermelho);
 *   - um hook que o git não procura (nome ou diretório fora do `hooksPath`) é o
 *     mesmo caso: o contrato vira decoração;
 *   - e o commit recusado não pode deixar OBJETO nenhum para trás — é o que o
 *     `git cat-file` mede aqui, não a prosa do hook.
 *
 * O que é REAL e o que é DUBLÊ: o hook é o ARQUIVO REAL (`.husky/pre-commit`,
 * byte a byte), o git é o de verdade, o repositório é um `git init`, o guard roda
 * com o `node` REAL lendo o ÍNDICE de verdade. O dublê é o declarado no fixture
 * compartilhado (os irmãos de fase e o `bun` devolvem 0; o stdin é vazio para o
 * remédio não perguntar) — e quem impede o dublê de esconder um falso positivo é
 * o CONTROLE: com o corpo válido o commit ACONTECE, e o hook imprime a manchete
 * do guard no modo `--staged`.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-git-commit-blocks.test.ts
 */

import { chmodSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
// A máquina de simular o hook (repo git temporário, dublê declarado, medições no
// banco do git) vem do simulador COMPARTILHADO; as CONSTANTES do hook sob teste
// vêm da camada do `.husky/pre-commit`.
import {
  COMPLETOU,
  HOOK_UNDER_TEST,
  cleanupFixtures,
  commitObjects,
  committedContent,
  gitConfig,
  gitConfigSet,
  headExists,
  indexPaths,
  isExecutable,
  shellParses,
  stage,
  touch,
} from "@/lib/__tests__/helpers/hook-simulator"
import {
  GUARD,
  GUARD_COMMAND,
  HOOK_SOURCE,
  HOOKS_DIR,
  SHELL_QUEBRADO,
  SHELL_SCRIPT,
  WORKFLOW,
  WORKFLOW_QUEBRADO,
  WORKFLOW_VALIDO,
  novoRepo,
  runCommit,
  writeHooksShim,
} from "@/lib/__tests__/helpers/pre-commit-fixture"

afterAll(() => {
  cleanupFixtures()
})

/** Um repo do fixture com o hook do git instalado (o `hooksPath` já apontado). */
function repoComHook(hookSource: string = HOOK_SOURCE): string {
  const dir = novoRepo()
  writeHooksShim(dir, hookSource)
  return dir
}

// ── premissa: o git PROCURA e HONRA o hook ───────────────────────────────

describe("a premissa do git: o hook é encontrado, é executável e é o arquivo real", () => {
  it("o `core.hooksPath` do fixture aponta para os hooks, e o hook ali é EXECUTÁVEL", () => {
    const dir = repoComHook()
    // Sem o caminho apontado git procura em `.git/hooks` (vazio) e o commit
    // entra com o defeito; sem o bit de execução git IGNORA o arquivo e faz o
    // mesmo. As duas metades são a premissa desta prova — medidas, não supostas.
    expect(gitConfig(dir, "core.hooksPath")).toBe(HOOKS_DIR)
    expect(isExecutable(join(dir, HOOKS_DIR, "pre-commit"))).toBe(true)
  })

  it("o hook que o git executa é o ARQUIVO REAL do repositório (byte a byte)", () => {
    const dir = repoComHook()
    expect(readFileSync(join(dir, HOOK_UNDER_TEST), "utf8")).toBe(HOOK_SOURCE)
    // O shim é a régua compartilhada com o irmão (mesmo dublê, mesmo caminho de
    // hook) + o shebang: se ele divergir, as duas provas medem hooks diferentes.
    const shim = readFileSync(join(dir, HOOKS_DIR, "pre-commit"), "utf8")
    expect(shim).toContain(`. "$HOOK_UNDER_TEST"`)
    expect(shim).toContain(GUARD)
    expect(shim.startsWith("#!")).toBe(true)
  })

  it.skipIf(process.platform === "win32")(
    "SEM o bit de execução o git IGNORA o hook: o commit com o defeito ENTRA",
    () => {
      // A mutação da própria premissa — e o motivo de o modo ser aplicado (e
      // conferido) no fixture: um hook não-executável não falha, ele SOME
      // (git avisa num `hint:` e segue com o commit).
      const dir = repoComHook()
      const shim = join(dir, HOOKS_DIR, "pre-commit")
      chmodSync(shim, 0o644)
      stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)

      const res = runCommit(dir)

      expect(isExecutable(shim)).toBe(false)
      expect(res.status).toBe(0)
      expect(commitObjects(dir)).toBe(1)
    },
  )

  it("o CONTROLE: corpo válido ⇒ o commit ACONTECE e o guard RODOU no índice", () => {
    const dir = repoComHook()
    stage(dir, WORKFLOW, WORKFLOW_VALIDO)

    const res = runCommit(dir)

    // As duas metades: o objeto existe (1 commit) E o hook atravessou a fase de
    // sintaxe chamando o GUARD real no modo do índice. Sem a segunda, "0" seria
    // compatível com um hook que nunca rodou.
    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).toContain("DO ÍNDICE")
    expect(res.output).toContain("1 workflow(s)")
    expect(commitObjects(dir)).toBe(1)
    expect(headExists(dir)).toBe(true)
    expect(committedContent(dir, WORKFLOW)).toBe(WORKFLOW_VALIDO)
  })
})

// ── a prova: nenhum objeto de commit quando o corpo está quebrado ────────

describe("`git commit` real com o corpo `run:` quebrado no índice: ZERO objeto de commit", () => {
  it("PROVA: o commit falha, o objeto de commit NÃO é criado e o índice fica intacto", () => {
    const dir = repoComHook()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)
    // O banco já tem blobs/árvores do `git add` — o que não pode existir é
    // COMMIT. É essa a asserção (`commitObjects` conta só `commit`).
    expect(commitObjects(dir)).toBe(0)

    const res = runCommit(dir)

    expect(res.status).not.toBe(0)
    expect(commitObjects(dir)).toBe(0)
    expect(headExists(dir)).toBe(false)
    // A prova é a medida do OBJETO; o relatório do hook entra como diagnóstico.
    expect(res.output).toContain(`${WORKFLOW}:7`)
    expect(res.output).toContain("syntax error")
    expect(res.output).not.toContain(COMPLETOU)
    // O índice continua com o defeito: o commit recusado não mexe no staged.
    expect(indexPaths(dir)).toEqual([WORKFLOW])
  })

  it("PROVA: o defeito que SÓ o commit carrega (índice quebrado, árvore consertada) também não cria objeto", () => {
    const dir = repoComHook()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)
    touch(dir, WORKFLOW, WORKFLOW_VALIDO)

    const res = runCommit(dir)

    expect(res.status).not.toBe(0)
    expect(commitObjects(dir)).toBe(0)
    expect(headExists(dir)).toBe(false)
  })

  it("PROVA: a outra metade do guard (arquivo de shell quebrado) também não cria objeto", () => {
    const dir = repoComHook()
    stage(dir, SHELL_SCRIPT, SHELL_QUEBRADO)

    const res = runCommit(dir)

    expect(res.status).not.toBe(0)
    expect(commitObjects(dir)).toBe(0)
    expect(res.output).toContain(SHELL_SCRIPT)
  })

  it("o MESMO repo aceita o commit quando o defeito é corrigido — a recusa era do hook", () => {
    // O par do CONTROLE, no mesmo repositório: se a recusa viesse do ambiente
    // (identidade, hooks, índice) o commit corrigido também falharia — e é esse
    // o falso positivo que uma prova de "não commitou" corre o risco de medir.
    const dir = repoComHook()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)
    expect(runCommit(dir).status).not.toBe(0)
    expect(commitObjects(dir)).toBe(0)

    stage(dir, WORKFLOW, WORKFLOW_VALIDO)
    const res = runCommit(dir)

    expect(res.status).toBe(0)
    expect(commitObjects(dir)).toBe(1)
    expect(committedContent(dir, WORKFLOW)).toBe(WORKFLOW_VALIDO)
  })
})

// ── mutação: o bloqueio é do HOOK (e do recorte), não do git ─────────────

describe("mutação: sem o guard, ou sem o recorte, o commit ENTRA com o defeito", () => {
  it("M1 — o hook deixa de CHAMAR o guard: o commit com o corpo quebrado é CRIADO", () => {
    const mutado = HOOK_SOURCE.replace(GUARD_COMMAND, "true &")
    expect(mutado).not.toBe(HOOK_SOURCE)
    expect(shellParses(mutado)).toBe(true)

    const dir = repoComHook(mutado)
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)

    const res = runCommit(dir)

    expect(res.status).toBe(0)
    expect(commitObjects(dir)).toBe(1)
    // O defeito ENTROU no objeto — não é "houve commit", é o corpo quebrado
    // gravado no histórico (o que o hook existe para impedir).
    expect(committedContent(dir, WORKFLOW)).toBe(WORKFLOW_QUEBRADO)
  })

  it("M0 — o `hooksPath` aponta para OUTRO diretório: o hook não é procurado e o defeito ENTRA", () => {
    // A premissa da premissa: se o caminho não apontasse para os hooks, nenhuma
    // das asserções acima mediria o hook — mediriam git ignorando-o em silêncio.
    const dir = repoComHook()
    gitConfigSet(dir, "core.hooksPath", ".git/hooks")
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)

    const res = runCommit(dir)

    expect(res.status).toBe(0)
    expect(res.output).not.toContain(COMPLETOU) // o hook real NÃO rodou
    expect(commitObjects(dir)).toBe(1)
  })

  it("M2 — o recorte perde o `--staged`: o defeito que só o índice carrega é COMMITADO", () => {
    const mutado = HOOK_SOURCE.replace(
      `node scripts/${GUARD} --staged &`,
      `node scripts/${GUARD} &`,
    )
    expect(mutado).not.toBe(HOOK_SOURCE)
    expect(shellParses(mutado)).toBe(true)

    const dir = repoComHook(mutado)
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)
    touch(dir, WORKFLOW, WORKFLOW_VALIDO)

    const res = runCommit(dir)

    expect(res.status).toBe(0)
    expect(commitObjects(dir)).toBe(1)
    expect(committedContent(dir, WORKFLOW)).toBe(WORKFLOW_QUEBRADO)
  })
})
