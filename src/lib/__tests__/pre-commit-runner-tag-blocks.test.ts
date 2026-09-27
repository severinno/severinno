/**
 * pre-commit-runner-tag-blocks.test.ts
 *
 * Prova, EXECUTANDO o arquivo real do hook `.husky/pre-commit`, que o commit que
 * deixa a imagem do act_runner SEM versão — tag flutuante (`latest`), valor
 * interpolado (`${…}`), `image:` ausente — é RECUSADO antes de virar commit.
 *
 * O DEFEITO, medido em 22/09/2026: o compose declarava `gitea/act_runner:latest`,
 * e o act_runner NÃO se auto-atualiza — quem decide a versão do binário é a
 * IMAGEM. Com uma tag flutuante, o `docker compose pull` de outro dia troca a
 * versão que a forja RODA sem que uma linha do repositório mude e SEM SINTOMA: o
 * setup do Bun funciona, os testes passam, e o único sinal seria o dia em que
 * algo quebrasse.
 *
 * O SEGUNDO ASSUNTO é o que este arquivo mede ALÉM da guarda: que ela consegue
 * RODAR no hook. Ela julga um ARTEFATO do repositório (`deploy/docker-compose.gitea.yml`)
 * e é fail-closed (artefato ausente = INFRA, exit 2). O fixture do hook copiava só
 * o fecho de `scripts/` — a guarda rodava no CI e não podia rodar no hook, e era
 * essa a razão de ela estar declarada em `HOOK_NOT_RUN`. Agora o fixture
 * MATERIALIZA os artefatos que os guards do hook LEEM (`artefatosDoFixture()`, a
 * lista DERIVADA por execução) e a linha do hook é a MESMA do CI, sem recorte.
 *
 * O que é DUBLÊ, e por quê: os irmãos de fase devolvem 0 por função no wrapper (o
 * assunto é a guarda da tag). Quem impede que o dublê esconda um falso positivo é
 * o CONTROLE: com a tag pinada o hook sai 0 E imprime a manchete da guarda REAL —
 * se ela não rodasse, não haveria manchete.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-runner-tag-blocks.test.ts
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  COMPLETOU,
  REPO_ROOT,
  cleanupFixtures,
  novoRepo as novoRepoSim,
  shellParses,
  wrapperSource,
} from "@/lib/__tests__/helpers/hook-simulator"
import {
  HOOK_SOURCE,
  RUNNER_TAG_COMMAND,
  RUNNER_TAG_GUARD,
  artefatosDoFixture,
  novoRepo,
  runHook,
} from "@/lib/__tests__/helpers/pre-commit-fixture"
import { GITEA_COMPOSE } from "../../../scripts/check-bun-mirror.mjs"

afterAll(() => {
  cleanupFixtures()
})

// ── o defeito, na forma que o hook mede ──────────────────────────────────

/** O compose REAL do repositório — a mesma declaração que o CI julga. */
const COMPOSE_PINADO = readFileSync(join(REPO_ROOT, GITEA_COMPOSE), "utf8")

/** A linha do pin (a âncora das mutações: sem ela a mutação é no-op silencioso). */
const IMAGEM_PINADA = "image: gitea/act_runner:0.6.1"

/** O mesmo compose com OUTRA tag no serviço do runner — o defeito do commit. */
function composeComTag(tag: string): string {
  const mutado = COMPOSE_PINADO.replace(IMAGEM_PINADA, `image: gitea/act_runner:${tag}`)
  expect(
    mutado,
    `a âncora '${IMAGEM_PINADA}' saiu do compose: a mutação não mediria nada`,
  ).not.toBe(COMPOSE_PINADO)
  return mutado
}

/** O compose com o `image:` do runner APAGADO (o serviço fica sem imagem). */
function composeSemImagem(): string {
  const mutado = COMPOSE_PINADO.replace(`${IMAGEM_PINADA}\n`, "")
  expect(mutado).not.toBe(COMPOSE_PINADO)
  return mutado
}

/**
 * Um fixture com o dublê do hook e a guarda da tag REAL (é o `passthrough` que a
 * torna real: o wrapper executa o processo, em vez de devolver 0 por função).
 * O artefato já está na cópia — é o que `artefatosDoFixture()` derivou —, e é isso
 * que a guarda lê.
 */
function repoComGuarda() {
  return novoRepo({ passthrough: [RUNNER_TAG_GUARD], prefix: "pre-commit-runner-tag-" })
}

/** Escreve um compose mutado na cópia do fixture (o guard lê o ARQUIVO). */
function comCompose(dir: string, conteudo: string) {
  writeFileSync(join(dir, GITEA_COMPOSE), conteudo, "utf8")
}

// ── premissa ─────────────────────────────────────────────────────────────

describe("a premissa do harness", () => {
  it("o hook roda a guarda da tag com o comando do CI, e o fixture torna esse comando real", () => {
    expect(HOOK_SOURCE).toContain(RUNNER_TAG_COMMAND)
    expect(existsSync(join(REPO_ROOT, "scripts", RUNNER_TAG_GUARD))).toBe(true)
  })

  it("o fixture MATERIALIZA o artefato que a guarda lê (é o que a deixa rodar no hook)", () => {
    expect(artefatosDoFixture()).toContain(GITEA_COMPOSE)
    const dir = repoComGuarda()
    const copiado = join(dir, GITEA_COMPOSE)
    expect(existsSync(copiado)).toBe(true)
    expect(readFileSync(copiado, "utf8")).toBe(COMPOSE_PINADO)
  })

  it("o simulador LEVANTA quando o artefato declarado não existe no repositório", () => {
    // Fail-closed: montar a cópia com o artefato de fora seria montar um fixture
    // cujo não-zero é do FIXTURE, não do defeito.
    expect(() =>
      novoRepoSim({ wrapper: wrapperSource([]), artefatos: ["deploy/compose-que-nao-existe.yml"] }),
    ).toThrow(/não existe no repositório/)
  })

  it("o simulador LEVANTA com caminho absoluto ou com `..` (o artefato é do repositório)", () => {
    for (const rel of ["/etc/hostname", "../fora.yml"]) {
      expect(() => novoRepoSim({ wrapper: wrapperSource([]), artefatos: [rel] })).toThrow(
        /caminho RELATIVO dentro do repositório/,
      )
    }
  })
})

// ── o hook real ──────────────────────────────────────────────────────────

describe("o hook real recusa o commit que deixa a imagem do act_runner sem versão", () => {
  it("CONTROLE: a tag pinada ⇒ exit 0, o hook termina e a guarda RODOU", () => {
    const dir = repoComGuarda()

    const res = runHook(dir)

    // As duas metades: o hook atravessa tudo (0) E a guarda real executou (a
    // manchete é dela, com o veredito do pin). Sem a segunda, "0" poderia ser um
    // hook que nunca a chamou.
    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).toContain("PINA uma versão")
    expect(res.output).toContain("gitea/act_runner:0.6.1")
  }, 120_000)

  it("a tag `latest` no compose ⇒ exit não-zero, nomeando o arquivo e a tag", () => {
    const dir = repoComGuarda()
    comCompose(dir, composeComTag("latest"))

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).not.toContain(COMPLETOU) // o veredito da fase encerra o hook
    expect(res.output).toContain(GITEA_COMPOSE)
    expect(res.output).toContain("'latest' não é uma versão")
    expect(res.output).toContain("NÃO pina versão")
  }, 120_000)

  it("o `image:` do runner APAGADO ⇒ exit não-zero (o serviço fica sem pin nenhum)", () => {
    const dir = repoComGuarda()
    comCompose(dir, composeSemImagem())

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).not.toContain(COMPLETOU)
    expect(res.output).toContain("não declara `image:`")
  }, 120_000)

  it("o valor INTERPOLADO ⇒ exit não-zero (o pin sairia do texto do repositório)", () => {
    const dir = repoComGuarda()
    comCompose(dir, composeComTag("${ACT_RUNNER_VERSION}"))

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).not.toContain(COMPLETOU)
    expect(res.output).toContain("NÃO é literal")
  }, 120_000)

  it("o artefato AUSENTE da cópia ⇒ exit não-zero por INFRA (o fail-closed, medido)", () => {
    // É a razão pela qual o artefato precisa estar na cópia: sem ele a guarda não
    // cunha veredito nenhum — e o hook BLOQUEIA (fail-closed), em vez de deixar
    // passar um commit que ele não conseguiu julgar.
    const dir = repoComGuarda()
    rmSync(join(dir, GITEA_COMPOSE))

    const res = runHook(dir)

    expect(res.status).not.toBe(0)
    expect(res.output).not.toContain(COMPLETOU)
    expect(res.output).toContain("não existe em")
    expect(res.output).toContain("sem o artefato não há veredito a cunhar")
  }, 120_000)
})

// ── mutação: é a LINHA do hook que recusa ────────────────────────────────

describe("mutação: a recusa é da LINHA do hook (a régua da guarda tem a sua própria suíte)", () => {
  it("M1 — o hook deixa de CHAMAR a guarda: o commit com `latest` passa", () => {
    const mutado = HOOK_SOURCE.replace(`${RUNNER_TAG_COMMAND} &`, "true &")
    expect(mutado).not.toBe(HOOK_SOURCE) // a mutação precisa aplicar de fato
    expect(shellParses(mutado)).toBe(true) // e não quebrar a sintaxe do hook

    const dir = repoComGuarda()
    comCompose(dir, composeComTag("latest"))

    const res = runHook(dir, mutado)

    expect(res.status).toBe(0)
    expect(res.output).toContain(COMPLETOU)
  }, 120_000)
})
