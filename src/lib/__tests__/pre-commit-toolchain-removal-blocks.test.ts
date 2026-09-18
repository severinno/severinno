/**
 * pre-commit-toolchain-removal-blocks.test.ts
 *
 * Prova, EXECUTANDO o arquivo real do hook `.husky/pre-commit`, que o commit que
 * **REMOVE a declaração de TOOLCHAIN** (`"packageManager"` do `package.json`) é
 * recusado — medindo a régua onde o hook a mede (o `--staged` do
 * `check-bun-mirror`, que compara o arquivo do ÍNDICE com o de HEAD).
 *
 * O BURACO QUE ESTA PROVA FECHA: a 18(c) só existia na varredura GLOBAL, e o
 * `package.json` não era alvo de NENHUMA pathspec do recorte do commit. Apagar o
 * `packageManager` — a única declaração escrita de qual Bun este repositório usa,
 * e a primeira coisa que alguém lê para descobrir isso — passava pelo commit e só
 * encontrava a varredura global do PR. É a mesma cegueira do irmão de compose: o
 * que o commit TIRA não aparece em nenhuma linha adicionada, então uma régua que
 * julga só as linhas novas não tem o que julgar.
 *
 * O que a prova monta (e o que ela NÃO monta):
 *
 *   - o hook é o ARQUIVO REAL, somado, então a fase, a agregação (`wait_all`) e a
 *     linha de comando são as de produção;
 *   - o repositório é um `git init` de verdade, com o estado BASE COMITADO (o HEAD
 *     de que a remoção sai — sem ele não há "arquivo anterior" com que comparar) e
 *     o defeito `git add`ado: o recorte lê o índice de verdade (`git diff --cached`
 *     + `git show :path` + `git show HEAD:path`), o que um fixture em memória não
 *     reproduziria;
 *   - o guard do Bun roda com o `node` REAL (o fecho transitivo já o copia), então
 *     o veredito é do guard de verdade e não de um dublê dele;
 *   - o `.actrc` declarado entra porque o guard compara por VALOR: sem ele, toda
 *     menção seria violação por "nenhum espelho declara a versão" e o CONTROLE
 *     mediria outra coisa.
 *
 * O que é DUBLÊ, e por quê: os irmãos de fase (que não são o assunto) devolvem 0
 * por função no wrapper. Quem impede que o dublê esconda um falso positivo é o
 * CONTROLE: com o campo no lugar, o hook sai 0 **e** imprime a manchete do guard
 * no modo `--staged` — se o guard não rodasse de verdade, não haveria manchete.
 *
 * A MESMA régua (repositório, dublê, fecho) é a de
 * `pre-commit-compose-arg-removal-blocks.test.ts`: a classe é outra (o toolchain,
 * não o arg do build site), o caminho até o veredito é o mesmo.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-toolchain-removal-blocks.test.ts
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  COMPLETOU,
  cleanupFixtures,
  headExists,
  stage,
} from "@/lib/__tests__/helpers/hook-simulator"
import {
  BUN_GUARD,
  BUN_GUARD_COMMAND,
  HOOK_SOURCE,
  novoRepo,
  runCommit,
  runHook,
} from "@/lib/__tests__/helpers/pre-commit-fixture"

afterAll(() => {
  cleanupFixtures()
})

// ── o fixture ────────────────────────────────────────────────────────────

const ACTRC = "--var BUN_VERSION=1.3.14\n"
const PKG = "package.json"

/** O `package.json` do fixture com a declaração (o estado do arquivo em HEAD). */
const PKG_COM_TOOLCHAIN = [
  "{",
  '  "name": "fixture",',
  '  "packageManager": "bun@1.3.14",',
  '  "version": "1.0.0"',
  "}",
  "",
].join("\n")

/** O MESMO arquivo sem o campo — o commit que o hook tem de recusar. */
const PKG_SEM_TOOLCHAIN = [
  PKG_COM_TOOLCHAIN.split("\n")[0],
  '  "name": "fixture",',
  '  "version": "1.0.0"',
  "}",
  "",
].join("\n")

/**
 * Um fixture com o estado BASE comitado e o hook do repositório disponível para
 * ser executado somado.
 *
 * O commit base vai com `--no-verify` de propósito: ele é a PREMISSA da medição
 * (o "antes" com a declaração), e um base que já dependesse do veredito do hook
 * mediria outra coisa.
 */
function repoComBase() {
  const dir = novoRepo({ passthrough: [BUN_GUARD], prefix: "pre-commit-toolchain-" })
  stage(dir, ".actrc", ACTRC)
  stage(dir, PKG, PKG_COM_TOOLCHAIN)
  const base = runCommit(dir, {}, ["commit", "-q", "-m", "base do fixture", "--no-verify"])
  expect(base.status).toBe(0)
  expect(headExists(dir)).toBe(true)
  return dir
}

// ── premissa ─────────────────────────────────────────────────────────────

describe("a premissa do harness", () => {
  it("o hook chama o guard do Bun com --staged, e o fixture torna esse comando real", () => {
    expect(HOOK_SOURCE).toContain(BUN_GUARD_COMMAND)
  })

  it("o fecho copiado traz o guard do Bun, para o não-zero não ser do FIXTURE", () => {
    const dir = repoComBase()
    expect(readFileSync(join(dir, "scripts", BUN_GUARD), "utf8")).toContain(
      "checkStagedPackageManagerVersion",
    )
  })
})

// ── o hook real ──────────────────────────────────────────────────────────

describe("o hook real recusa o commit que REMOVE a declaração de toolchain", () => {
  it("CONTROLE: o campo no lugar ⇒ exit 0, o hook termina e o guard RODOU", () => {
    const dir = repoComBase()
    stage(dir, PKG, PKG_COM_TOOLCHAIN) // mesma forma: o diff é vazio

    const res = runHook(dir)

    // As duas metades: o hook atravessa tudo (0) E o guard real executou no modo
    // do índice. Sem a segunda, "0" poderia ser um hook que nunca chamou o guard.
    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).toContain("Diff ok")
    expect(res.output).toContain("staged")
  }, 60_000)

  it("o campo REMOVIDO no índice ⇒ exit não-zero, nomeando o arquivo e o campo", () => {
    const dir = repoComBase()
    stage(dir, PKG, PKG_SEM_TOOLCHAIN)

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).not.toContain(COMPLETOU) // o hook PAROU na fase A
    expect(res.output).toContain(PKG)
    expect(res.output).toContain("packageManager")
    expect(res.output).toContain("REMOVIDA")
    expect(res.output).toContain("bun@1.3.14") // o remédio nomeia o valor declarado
  }, 60_000)

  it("o defeito que SÓ o commit carrega (índice sem o campo, árvore com ele) bloqueia", () => {
    // É o caso que a árvore esconde: alguém re-adiciona a declaração no editor e
    // esquece de `git add`. O commit leva a remoção; a árvore parece saudável.
    const dir = repoComBase()
    stage(dir, PKG, PKG_SEM_TOOLCHAIN)
    const caminho = join(dir, PKG)
    expect(readFileSync(caminho, "utf8")).toBe(PKG_SEM_TOOLCHAIN)
    writeFileSync(caminho, PKG_COM_TOOLCHAIN, "utf8")

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).toContain("REMOVIDA")
  }, 60_000)

  it("o arquivo NOVO (sem HEAD com que comparar) não é julgado pela remoção", () => {
    // Num repositório sem estado base, o `package.json` entra pela PRIMEIRA vez:
    // não existe "arquivo anterior" de onde o campo tenha saído. O veredito dele
    // continua sendo o do valor (a declaração alinhada passa).
    const dir = novoRepo({ passthrough: [BUN_GUARD], prefix: "pre-commit-toolchain-novo-" })
    stage(dir, ".actrc", ACTRC)
    stage(dir, PKG, PKG_COM_TOOLCHAIN)

    const res = runHook(dir)

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)

  it("o campo TROCADO por outro valor numa linha nova é recusado (a outra metade do recorte)", () => {
    const dir = repoComBase()
    stage(dir, PKG, PKG_COM_TOOLCHAIN.replace("bun@1.3.14", "bun@1.4.0"))

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).toContain(`${PKG}:3`)
    expect(res.output).toContain("1.4.0")
  }, 60_000)
})

// ── mutação ──────────────────────────────────────────────────────────────
//
// A mutação é aplicada onde o defeito é medido: no guard COPIADO do fixture (o
// repositório real nunca é tocado) e no hook somado.

describe("mutação: a remoção só é recusada porque o hook chama o guard, e o guard compara índice×HEAD", () => {
  it("M1 — o hook deixa de CHAMAR o guard do Bun: o commit com a remoção passa", () => {
    const mutado = HOOK_SOURCE.replace(BUN_GUARD_COMMAND, "true &")
    expect(mutado).not.toBe(HOOK_SOURCE) // a mutação precisa aplicar de fato

    const dir = repoComBase()
    stage(dir, PKG, PKG_SEM_TOOLCHAIN)

    const res = runHook(dir, mutado)

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)

  it("M2 — o guard perde o recorte do toolchain: a remoção passa pelo mesmo hook", () => {
    const dir = repoComBase()
    // A metade mutada é a REGISTRADA no recorte; o resto do guard segue igual.
    const caminho = join(dir, "scripts", BUN_GUARD)
    const fonte = readFileSync(caminho, "utf8")
    const mutada = fonte.replace("...toolchain.violations,", "// M2: o recorte do toolchain cegado")
    expect(mutada).not.toBe(fonte)
    writeFileSync(caminho, mutada, "utf8")

    stage(dir, PKG, PKG_SEM_TOOLCHAIN)
    const res = runHook(dir)

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)
})
