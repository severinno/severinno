/**
 * pre-commit-compose-arg-removal-blocks.test.ts
 *
 * Prova, EXECUTANDO o arquivo real do hook `.husky/pre-commit`, que o commit que
 * **REMOVE o `BUN_VERSION` de um build site de compose** é recusado — medindo a
 * régua onde o hook a mede (o `--staged` do `check-bun-mirror`, que compara o
 * bloco do ÍNDICE com o de HEAD).
 *
 * O BURACO QUE ESTA PROVA FECHA: o recorte das linhas ADICIONADAS julga os blocos
 * que o diff TOCA, e um bloco que só PERDE uma linha não ganha linha adicionada
 * nenhuma. Remover o arg de um build site passava pelo commit e só encontrava a
 * varredura GLOBAL — que roda no PR, quando roda. Era a mesma cegueira do defeito
 * original da invariante 18(b), na direção oposta: o build site deixava de ter
 * valor escrito, e "nenhum valor" não aparece em nenhuma linha nova.
 *
 * O que a prova monta (e o que ela NÃO monta):
 *
 *   - o hook é o ARQUIVO REAL, somado, então a fase, a agregação (`wait_all`) e a
 *     linha de comando são as de produção;
 *   - o repositório é um `git init` de verdade, com o estado BASE COMITADO (o HEAD
 *     de que a remoção sai — sem ele não há "bloco anterior" com que comparar) e o
 *     defeito `git add`ado: o recorte lê o índice de verdade (`git diff --cached`
 *     + `git show :path` + `git show HEAD:path`), o que um fixture em memória não
 *     reproduziria;
 *   - o guard do Bun roda com o `node` REAL (o fecho transitivo já o copia — ele é
 *     a régua do que é um COMPOSE para o guard de sintaxe), então o veredito é do
 *     guard de verdade e não de um dublê dele.
 *
 * O que é DUBLÊ, e por quê: os irmãos de fase (que não são o assunto) devolvem 0
 * por função no wrapper. Quem impede que o dublê esconda um falso positivo é o
 * CONTROLE: com o arg no lugar, o hook sai 0 **e** imprime a manchete do guard no
 * modo `--staged` — se o guard não rodasse de verdade, não haveria manchete.
 *
 * A MESMA régua (repositório, dublê, fecho) é a de
 * `pre-commit-run-syntax-blocks.test.ts` / `pre-commit-git-commit-blocks.test.ts`:
 * aqui ela é pedida com `passthrough: [BUN_GUARD]`, e nada muda no fixture dos
 * irmãos (um guard a mais rodando de verdade reprovaria controles que não são o
 * assunto deles).
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-compose-arg-removal-blocks.test.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  COMPLETOU,
  REPO_ROOT,
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
//
// O espelho declarado (`.actrc`) entra porque o guard compara por VALOR: sem ele
// toda menção seria violação por "nenhum espelho declara a versão", e o
// CONTROLE mediria outra coisa.

const ACTRC = "--var BUN_VERSION=1.3.14\n"
const DOCKERFILE = "Dockerfile.worker"
const COMPOSE = "docker-compose.yml"

const DOCKERFILE_FONTE = "ARG BUN_VERSION\nFROM oven/bun:${BUN_VERSION}\n"

/** O build site do fixture PASSANDO o arg (o estado do bloco em HEAD). */
const COMPOSE_COM_ARG = [
  "services:",
  "  web:",
  "    build:",
  "      context: .",
  `      dockerfile: ${DOCKERFILE}`,
  "      args:",
  "        BUN_VERSION: ${BUN_VERSION:-1.3.14}",
  "",
].join("\n")

/** O MESMO serviço, com o bloco sem o arg — o commit que o hook tem de recusar. */
const COMPOSE_SEM_ARG = COMPOSE_COM_ARG.split("\n").slice(0, 5).join("\n") + "\n"

/**
 * Um fixture com o estado BASE comitado e o hook do repositório disponível para
 * ser executado somado.
 *
 * O commit base vai com `--no-verify` de propósito: ele é a PREMISSA da medição
 * (o "antes" com o arg), e um base que já dependesse do veredito do hook mediria
 * outra coisa.
 */
function repoComBase() {
  const dir = novoRepo({ passthrough: [BUN_GUARD], prefix: "pre-commit-compose-arg-" })
  stage(dir, ".actrc", ACTRC)
  stage(dir, DOCKERFILE, DOCKERFILE_FONTE)
  stage(dir, COMPOSE, COMPOSE_COM_ARG)
  const base = runCommit(dir, {}, ["commit", "-q", "-m", "base do fixture", "--no-verify"])
  expect(base.status).toBe(0)
  expect(headExists(dir)).toBe(true)
  return dir
}

// ── premissa ─────────────────────────────────────────────────────────────

describe("a premissa do harness", () => {
  it("o hook chama o guard do Bun com --staged, e o fixture torna esse comando real", () => {
    expect(HOOK_SOURCE).toContain(BUN_GUARD_COMMAND)
    expect(existsSync(join(REPO_ROOT, "scripts", BUN_GUARD))).toBe(true)
  })

  it("o fecho copiado traz o guard do Bun e o resolvedor da fonte única", () => {
    // Sem o fecho, o guard morreria com "module not found" e o não-zero do hook
    // seria do FIXTURE, não do defeito (o falso positivo clássico).
    const dir = repoComBase()
    expect(existsSync(join(dir, "scripts", BUN_GUARD))).toBe(true)
    expect(existsSync(join(dir, "scripts", "bun-version.mjs"))).toBe(true)
  })
})

// ── o hook real ──────────────────────────────────────────────────────────

describe("o hook real recusa o commit que REMOVE o arg do build site", () => {
  it("CONTROLE: o arg no lugar ⇒ exit 0, o hook termina e o guard RODOU", () => {
    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_COM_ARG) // mesma forma: o diff é vazio para o bloco

    const res = runHook(dir)

    // As duas metades: o hook atravessa tudo (0) E o guard real executou no modo
    // do índice. Sem a segunda, "0" poderia ser um hook que nunca chamou o guard.
    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).toContain("Diff ok")
    expect(res.output).toContain("staged")
  }, 60_000)

  it("o arg REMOVIDO no índice ⇒ exit não-zero, nomeando arquivo, linha e serviço", () => {
    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_SEM_ARG)

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).not.toContain(COMPLETOU) // o hook PAROU na fase A
    expect(res.output).toContain(`${COMPOSE}:3`)
    expect(res.output).toContain("'web'")
    expect(res.output).toContain(DOCKERFILE)
    expect(res.output).toContain("REMOVE o arg do bloco")
  }, 60_000)

  it("o defeito que SÓ o commit carrega (índice sem o arg, árvore com ele) bloqueia", () => {
    // É o caso que a árvore esconde: alguém re-adiciona o arg no editor e esquece
    // de `git add`. O commit leva a remoção; a árvore parece saudável.
    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_SEM_ARG)
    // A árvore volta a ter o arg (o índice fica como está).
    const caminho = join(dir, COMPOSE)
    const composto = readFileSync(caminho, "utf8")
    expect(composto).toBe(COMPOSE_SEM_ARG)
    writeFileSync(caminho, COMPOSE_COM_ARG, "utf8")

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).toContain(`${COMPOSE}:3`)
  }, 60_000)

  it("o arquivo NOVO (sem HEAD com que comparar) não é julgado pela remoção", () => {
    // Num repositório sem o estado base, o compose entra pela PRIMEIRA vez: não
    // existe "bloco anterior" de onde o arg tenha saído, e a régua da remoção não
    // tem o que comparar. O veredito do arquivo novo continua sendo o de sempre
    // (o build site que passa o arg passa).
    const dir = novoRepo({ passthrough: [BUN_GUARD], prefix: "pre-commit-compose-novo-" })
    stage(dir, ".actrc", ACTRC)
    stage(dir, DOCKERFILE, DOCKERFILE_FONTE)
    stage(dir, COMPOSE, COMPOSE_COM_ARG) // primeiro commit: o arquivo é NOVO

    const res = runHook(dir)

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)
})

// ── mutação ──────────────────────────────────────────────────────────────
//
// A mutação é aplicada onde o defeito é medido: no guard COPIADO do fixture (o
// repositório real nunca é tocado) e no hook somado.

describe("mutação: a remoção só é recusada porque o hook chama o guard, e o guard compara os blocos", () => {
  it("M1 — o hook deixa de CHAMAR o guard do Bun: o commit com a remoção passa", () => {
    const mutado = HOOK_SOURCE.replace(BUN_GUARD_COMMAND, "true &")
    expect(mutado).not.toBe(HOOK_SOURCE) // a mutação precisa aplicar de fato

    const dir = repoComBase()
    stage(dir, COMPOSE, COMPOSE_SEM_ARG)

    const res = runHook(dir, mutado)

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)

  it("M2 — o guard perde a comparação ÍNDICE×HEAD: a remoção passa pelo mesmo hook", () => {
    const dir = repoComBase()
    // A metade mutada é a REGISTRADA no recorte; o resto do guard segue igual.
    const caminho = join(dir, "scripts", BUN_GUARD)
    const fonte = readFileSync(caminho, "utf8")
    const mutada = fonte.replace(
      "...argsRemovidos.violations,",
      "// M2: a comparação ÍNDICE×HEAD cegada",
    )
    expect(mutada).not.toBe(fonte)
    writeFileSync(caminho, mutada, "utf8")

    stage(dir, COMPOSE, COMPOSE_SEM_ARG)
    const res = runHook(dir)

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)
})
