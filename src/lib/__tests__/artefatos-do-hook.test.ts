/**
 * artefatos-do-hook.test.ts
 *
 * Prova que os ARTEFATOS do fixture do pre-commit são DERIVADOS do que os guards do
 * hook LEEM — e não de uma lista à mão.
 *
 * O DEFEITO QUE ISTO FECHA: a lista era `ARTEFATOS_DO_FIXTURE = [GITEA_COMPOSE]`,
 * escrita à mão. Quem acrescentasse uma guarda que abre um arquivo do repositório
 * teria de LEMBRAR de vir aqui, e o sintoma de esquecer é o pior possível — na
 * cópia o guard lê o ramo de INFRA (fail-closed) e o vermelho passa a ser do
 * FIXTURE, não do defeito. Foi o que aconteceu com o `check-runner-tag` (o compose
 * ausente é INFRA), que por isso ficou declarado em `HOOK_NOT_RUN`.
 *
 * O que este arquivo mede (e por que cada parte é necessária):
 *
 *   1. a derivação, na árvore REAL: a lista contém o compose que motivou a régua, e
 *      cada entrada sai com o COMANDO que a abriu (`porComando`) — uma sobra sem
 *      leitor deixa de passar em silêncio;
 *   2. o MATERIALIZADO: `artefatosDoFixture()` é o que o `novoRepo()` copia, então a
 *      lista derivada é a lista usada — um fixture de verdade traz cada entrada;
 *   3. o ARTEFATO NOVO SEM EDIÇÃO: uma guarda que não existe no repositório, num
 *      hook mutado, faz o artefato dela entrar na lista SOZINHO — e o par
 *      contra-prova (o mesmo root com um hook que NÃO chama a guarda) mostra que a
 *      derivação segue o HOOK, não uma varredura de diretório;
 *   4. o fail-closed: um comando citado pelo hook e ausente do checkout NÃO vira uma
 *      lista parcial — a derivação LEVANTA (a cópia não se monta com meio fecho);
 *   5. a recusa DECLARADA: o que um guard abre e a derivação NÃO leva sai nomeado
 *      (`recusados`), com o motivo e com quem o abriu;
 *   6. a CLI: `--json` publica a derivação inteira, `--root` deriva de outra árvore;
 *   7. a ÁRVORE, e não só o processo: um guard que DELEGA a leitura a um filho de
 *      node entra na lista do mesmo jeito — e o par contra-prova mostra que um filho
 *      com ambiente PRÓPRIO fica fora (o limite que resta, declarado no cabeçalho da
 *      derivação).
 *
 * Sem rede e sem docker: o instrumento é o próprio node, e o que se mede são as
 * TENTATIVAS de abertura dos guards.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/artefatos-do-hook.test.ts
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { afterAll, describe, expect, it } from "vitest"

import {
  EXIT,
  NAO_SAO_ARTEFATOS,
  envDaArvore,
  extrairComandos,
  artefatosDoHook,
} from "../../../scripts/artefatos-do-hook.mjs"
import {
  EXIT as EXIT_DO_GUARD,
  julgaArtefatosDoHook,
} from "../../../scripts/check-artefatos-do-hook.mjs"
import { GITEA_COMPOSE } from "../../../scripts/check-bun-mirror.mjs"
import { REPO_ROOT } from "../../../scripts/hook-simulator.mjs"
import { artefatosDoFixture } from "../../../scripts/pre-commit-proof.mjs"

const ROOT = process.cwd()
const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "artefatos-do-hook-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * O GUARD que não existe no repositório: abre o artefato dele por CAMINHO e é
 * fail-closed (ausente = INFRA), como o `check-runner-tag` é.
 *
 * Sem import nenhum: o que a derivação tem de ver é a LEITURA, e não uma aresta.
 */
const GUARD_NOVO = [
  "#!/usr/bin/env node",
  'import { existsSync, readFileSync } from "node:fs"',
  'import { join } from "node:path"',
  'const ALVO = "deploy/artefato-novo.yml"',
  "const caminho = join(process.cwd(), ALVO)",
  "if (!existsSync(caminho)) {",
  "  console.error(`${ALVO} ausente: INFRA (fail-closed)`)",
  "  process.exit(2)",
  "}",
  'readFileSync(caminho, "utf8")',
  "process.exit(0)",
  "",
].join("\n")

/** O outro guard — que NÃO lê artefato nenhum (a contra-prova do hook). */
const GUARD_SEM_ARTEFATO = ["#!/usr/bin/env node", "process.exit(0)", ""].join("\n")

/**
 * O CÓDIGO QUE O FILHO executa — a leitura do artefato, e nada mais.
 *
 * Ele não mora em arquivo nenhum do fixture: o guard o passa por `-e`, então não há
 * aresta de import que o `fecho-imports` possa seguir. É o limite que o rastreio da
 * ÁRVORE fechou — quem lê é um processo SEPARADO.
 */
const CODIGO_FILHO = [
  'const { existsSync, readFileSync } = require("node:fs")',
  'const { join } = require("node:path")',
  'const ALVO = "deploy/artefato-delegado.yml"',
  "const caminho = join(process.cwd(), ALVO)",
  "if (!existsSync(caminho)) {",
  "  console.error(`${ALVO} ausente: INFRA (fail-closed)`)",
  "  process.exit(2)",
  "}",
  'readFileSync(caminho, "utf8")',
  "process.exit(0)",
  "",
].join("\n")

/**
 * O GUARD que DELEGA: ele NÃO abre o artefato (o nome dele não aparece no fonte) e
 * lança um filho de node que o abre. Rastrear só o processo do guard devolveria
 * lista vazia — e o artefato dele ficaria fora da cópia, com o guard lendo INFRA.
 */
const GUARD_DELEGADO = [
  "#!/usr/bin/env node",
  'import { spawnSync } from "node:child_process"',
  `const CODIGO = ${JSON.stringify(CODIGO_FILHO)}`,
  'const r = spawnSync(process.execPath, ["-e", CODIGO], { stdio: "inherit" })',
  "process.exit(r.status ?? 2)",
  "",
].join("\n")

/**
 * O MESMO guard delegado, mas o filho recebe um ambiente PRÓPRIO (`env: {}`): sem o
 * `NODE_OPTIONS` herdado não há pré-carregador lá, e a leitura dele não é medida —
 * é o limite que RESTA (declarado no cabeçalho da derivação), e este par o mede.
 */
const GUARD_DELEGADO_SEM_ENV = [
  "#!/usr/bin/env node",
  'import { spawnSync } from "node:child_process"',
  `const CODIGO = ${JSON.stringify(CODIGO_FILHO)}`,
  'const r = spawnSync(process.execPath, ["-e", CODIGO], { stdio: "inherit", env: {} })',
  "process.exit(r.status ?? 2)",
  "",
].join("\n")

/**
 * Uma raiz com o MÍNIMO para a derivação: o hook do TEXTO passado, os guards que
 * ele chama e o artefato que um deles lê. Nada de `scripts/` inteiro: o que a
 * derivação precisa é o fecho dos COMANDOS do hook, e o hook aqui é o do teste.
 *
 * @param {{comando: string, guard: string, arquivo?: string, artefato?: string}} opts
 *   `arquivo` é o NOME do guard em `scripts/` (o hook cita o caminho, então o nome
 *   é do teste) e `artefato` é o caminho que ele lê.
 */
function raizComHook({
  comando,
  guard,
  arquivo = "check-artefato-novo.mjs",
  artefato = "deploy/artefato-novo.yml",
}: {
  comando: string
  guard: string
  arquivo?: string
  artefato?: string
}): string {
  const dir = makeDir()
  mkdirSync(join(dir, ".husky"), { recursive: true })
  mkdirSync(join(dir, "scripts"), { recursive: true })
  mkdirSync(join(dir, "deploy"), { recursive: true })
  writeFileSync(join(dir, ".husky", "pre-commit"), `set -eu\n${comando} &\nwait\n`, "utf8")
  writeFileSync(join(dir, "scripts", arquivo), guard, "utf8")
  writeFileSync(join(dir, "scripts", "check-sem-artefato.mjs"), GUARD_SEM_ARTEFATO, "utf8")
  writeFileSync(join(dir, artefato), "novo: sim\n", "utf8")
  return dir
}

// ── a derivação, na árvore real ──────────────────────────────────────────

describe("artefatosDoHook — a lista sai da EXECUÇÃO dos guards do hook", () => {
  it("deriva os artefatos do hook REAL, e cada entrada tem um DONO nomeado", () => {
    const { artefatos, porComando, problemas } = artefatosDoHook({ root: ROOT })

    expect(problemas).toEqual([])
    // O artefato que motivou a régua: sem ele o `check-runner-tag` lê INFRA na
    // cópia, e o vermelho passa a ser do FIXTURE.
    expect(artefatos).toContain(GITEA_COMPOSE)
    // E o dono: quem abriu o compose é a guarda da tag — não uma lista anônima.
    const leitores = Object.keys(porComando).filter((c) => porComando[c].includes(GITEA_COMPOSE))
    expect(leitores.join(" | ")).toContain("check-runner-tag")
    // Nenhuma entrada sem leitor (é o que a lista à mão podia esconder).
    for (const rel of artefatos) {
      expect(
        Object.values(porComando).some((lidos) => lidos.includes(rel)),
        `${rel}: derivado sem comando que o abra`,
      ).toBe(true)
    }
  }, 60000)

  it("o fixture MATERIALIZA a lista derivada (o que o teste mede é o que o hook usa)", () => {
    const derivada = artefatosDoFixture()
    const { artefatos } = artefatosDoHook({ root: ROOT })
    expect(derivada).toEqual(artefatos)
    expect(derivada).toContain(GITEA_COMPOSE)
  }, 60000)

  it("a recusa é PUBLICADA: o que um guard abre e a derivação não leva sai nomeado", () => {
    const { artefatos, recusados } = artefatosDoHook({ root: ROOT })
    // O par (`.husky/`, `package.json`) é o caso medido: materializá-lo faz o remédio
    // julgar o HOOK DUBÊ da cópia. A decisão é declarada — e o `package.json` NÃO
    // entra na lista.
    expect(recusados.map((r) => r.rel)).toEqual(["package.json"])
    expect(artefatos).not.toContain("package.json")
    expect(recusados[0].porque).toContain("HOOK DUBÊ")
    // Quem o abriu também é publicado: a recusa não esconde o leitor.
    expect(recusados[0].comandos.join(" | ")).toContain("check-mutation-jobs")
  }, 60000)

  it("extrairComandos lê o TEXTO do hook (a linha e as flags), e deduplica", () => {
    const comandos = extrairComandos(
      [
        "set -eu",
        "  node scripts/check-bun-mirror.mjs --staged &",
        "  node scripts/check-bun-mirror.mjs --staged &",
        "node scripts/check-runner-tag.mjs &",
        "bun run lint &",
        "node scripts/pre-commit-remedy.mjs && REMEDIO=0 || true",
        "",
      ].join("\n"),
    )
    expect(comandos.map((c) => `${c.script} ${c.flags.join(" ")}`.trim())).toEqual([
      "scripts/check-bun-mirror.mjs --staged",
      "scripts/check-runner-tag.mjs",
      "scripts/pre-commit-remedy.mjs",
    ])
  })
})

// ── o artefato NOVO entra sem edição ─────────────────────────────────────

describe("artefatosDoHook — um artefato novo entra SEM EDIÇÃO", () => {
  it("uma guarda que não existe no repositório (e lê um arquivo novo) entra sozinha", () => {
    const dir = raizComHook({
      comando: "node scripts/check-artefato-novo.mjs",
      guard: GUARD_NOVO,
    })

    const { artefatos, porComando, problemas } = artefatosDoHook({ root: dir })

    // Nada foi declarado em lugar nenhum: o guard ABRIU, não achou na cópia e o
    // arquivo existe na raiz — é isto, e só isto, que o põe na lista.
    expect(problemas).toEqual([])
    expect(artefatos).toEqual(["deploy/artefato-novo.yml"])
    expect(porComando["scripts/check-artefato-novo.mjs"]).toEqual(["deploy/artefato-novo.yml"])
    // E o FIXTURE passa a materializá-lo pelo MESMO caminho que o hook usa.
    expect(artefatosDoFixture({ root: dir })).toEqual(["deploy/artefato-novo.yml"])
  }, 60000)

  it("CONTRA-PROVA: o mesmo root com um hook que NÃO chama a guarda não traz o artefato", () => {
    const dir = raizComHook({
      comando: "node scripts/check-sem-artefato.mjs",
      guard: GUARD_NOVO,
    })

    const { artefatos, problemas } = artefatosDoHook({ root: dir })

    // O artefato ESTÁ na árvore e a guarda que o lê TAMBÉM: o que falta é o hook
    // chamá-la. Se a derivação fosse uma varredura de diretório, ele apareceria.
    expect(problemas).toEqual([])
    expect(artefatos).toEqual([])
    expect(existsSync(join(dir, "deploy", "artefato-novo.yml"))).toBe(true)
    expect(existsSync(join(dir, "scripts", "check-artefato-novo.mjs"))).toBe(true)
  }, 60000)

  it("um guard que DELEGA a leitura a um FILHO de node entra na lista (a ÁRVORE, não só o processo)", () => {
    const dir = raizComHook({
      comando: "node scripts/check-delegado.mjs",
      guard: GUARD_DELEGADO,
      arquivo: "check-delegado.mjs",
      artefato: "deploy/artefato-delegado.yml",
    })

    const { artefatos, porComando, problemas } = artefatosDoHook({ root: dir })

    expect(problemas).toEqual([])
    expect(artefatos).toEqual(["deploy/artefato-delegado.yml"])
    expect(porComando["scripts/check-delegado.mjs"]).toEqual(["deploy/artefato-delegado.yml"])
    // E a PROVA de quem abriu: o guard NÃO importa `node:fs` — o processo dele não
    // tem como abrir o artefato (as chamadas existem só como TEXTO do `-e`, que
    // outro processo executa). Quem o abriu foi o FILHO, e o rastreio desceu pela
    // árvore para achá-lo.
    const imports = GUARD_DELEGADO.split("\n").filter((l) => l.startsWith("import "))
    expect(imports).toEqual(['import { spawnSync } from "node:child_process"'])
  }, 60000)

  it("LIMITE declarado: um filho com ambiente PRÓPRIO não é alcançado (e o par o mede)", () => {
    const dir = raizComHook({
      comando: "node scripts/check-delegado.mjs",
      guard: GUARD_DELEGADO_SEM_ENV,
      arquivo: "check-delegado.mjs",
      artefato: "deploy/artefato-delegado.yml",
    })

    const { artefatos, problemas } = artefatosDoHook({ root: dir })

    // A derivação NÃO acusa problema (o guard rodou): o que ela não vê é a leitura
    // do filho, porque ele nasceu com `env: {}` e sem `NODE_OPTIONS` não há
    // pré-carregador do outro lado. O limite é este, e ele está escrito.
    expect(problemas).toEqual([])
    expect(artefatos).toEqual([])
    expect(existsSync(join(dir, "deploy", "artefato-delegado.yml"))).toBe(true)
  }, 60000)

  it("FAIL-CLOSED: comando citado pelo hook e ausente do checkout não vira lista parcial", () => {
    const dir = raizComHook({
      comando: "node scripts/check-que-nao-existe.mjs",
      guard: GUARD_NOVO,
    })

    const { artefatos, problemas } = artefatosDoHook({ root: dir })

    expect(artefatos).toEqual([])
    expect(problemas.join(" | ")).toContain("check-que-nao-existe.mjs")
    expect(problemas.join(" | ")).toContain("ausente do checkout")
    // E quem monta o fixture LEVANTA: a cópia não se monta com um comando que não
    // existe (o não-zero seria do FIXTURE, não do guard).
    expect(() => artefatosDoFixture({ root: dir })).toThrow(/NÃO FECHA/)
  }, 60000)
})

// ── a CLI ────────────────────────────────────────────────────────────────

describe("a CLI de artefatos-do-hook", () => {
  const SCRIPT = join(REPO_ROOT, "scripts", "artefatos-do-hook.mjs")

  function roda(args: string[]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 120000 })
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
  }

  it("--json publica a lista, os donos e as recusas", () => {
    const r = roda(["--json"])
    expect(r.status).toBe(EXIT.OK)
    const dados = JSON.parse(r.out)
    expect(dados.artefatos).toContain(GITEA_COMPOSE)
    expect(dados.porComando).toBeTruthy()
    expect(dados.recusados.map((x: { rel: string }) => x.rel)).toContain("package.json")
    expect(dados.problemas).toEqual([])
  }, 120000)

  it("--root deriva de outra árvore, e argumento desconhecido é uso inválido", () => {
    const dir = raizComHook({ comando: "node scripts/check-artefato-novo.mjs", guard: GUARD_NOVO })
    const r = roda(["--root", dir, "--json"])
    expect(r.status).toBe(EXIT.OK)
    expect(JSON.parse(r.out).artefatos).toEqual(["deploy/artefato-novo.yml"])

    const invalido = roda(["--turbo"])
    expect(invalido.status).toBe(EXIT.USO)
    expect(invalido.out).toContain("desconhecido")
  }, 120000)

  it("envDaArvore põe o pré-carregador CITADO no NODE_OPTIONS e preserva o do operador", () => {
    // O caminho entre aspas: o tokenizador do `NODE_OPTIONS` respeita aspas, e um
    // tmpdir com espaço continua sendo um argumento só (a razão de o caminho ser
    // CITADO em vez de cru).
    const comAnterior = envDaArvore("/tmp/a b/fs-trace.cjs", {
      NODE_OPTIONS: "--no-warnings",
      PATH: "/x",
    })
    expect(comAnterior.NODE_OPTIONS).toBe('--no-warnings --require "/tmp/a b/fs-trace.cjs"')
    expect(comAnterior.PATH).toBe("/x")
    // Sem nada antes, a flag vai sozinha (e o ambiente de origem não é mutado).
    const base: Record<string, string> = {}
    expect(envDaArvore("/tmp/x.cjs", base).NODE_OPTIONS).toBe('--require "/tmp/x.cjs"')
    expect(base.NODE_OPTIONS).toBeUndefined()
  })

  it("as recusas são uma DECISÃO com motivo escrito (não um filtro mudo)", () => {
    for (const r of NAO_SAO_ARTEFATOS) {
      expect(r.porque.length, `${r.rel}: recusa sem motivo`).toBeGreaterThan(20)
    }
    // E o único caminho recusado hoje é o do par (.husky/, package.json) medido.
    expect(NAO_SAO_ARTEFATOS.map((r) => r.rel)).toEqual(["package.json"])
    // A lista antiga NÃO existe mais no fonte: quem acrescenta uma guarda não tem
    // lista nenhuma para editar.
    const fonte = readFileSync(join(REPO_ROOT, "scripts", "pre-commit-proof.mjs"), "utf8")
    expect(fonte).not.toContain("ARTEFATOS_DO_FIXTURE =")
  })
})

// ── o guard do COMMIT: lista vazia é RECUSA ───────────────────────────────

/**
 * O vínculo da derivação com o HOOK (fase B do `.husky/pre-commit`).
 *
 * Até ele, a lista vazia só era medida pela MATRIZ de mutação — no CI, no PR,
 * DEPOIS do commit. O que este bloco mede é a decisão do CHAMADOR: a derivação
 * devolve `{artefatos: [], problemas: []}` (a resposta honesta dela para uma raiz
 * em que ninguém lê artefato, e é o que as contra-provas acima fixam) e o guard
 * RECUSA — porque, neste repositório, o fixture do pre-commit depende da lista.
 */
describe("check-artefatos-do-hook — a lista vazia RECUSA o commit", () => {
  const SCRIPT = join(REPO_ROOT, "scripts", "check-artefatos-do-hook.mjs")

  function roda(args: string[]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 120000 })
    return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" }
  }

  it("a raiz REAL passa: a lista tem artefato e a derivação fechou", () => {
    const r = julgaArtefatosDoHook()
    expect(r.recusas).toEqual([])
    expect(r.artefatos).toContain(GITEA_COMPOSE)
  }, 120000)

  it("a lista vazia é recusa — e a derivação, sozinha, não acusa problema nenhum", () => {
    const dir = raizComHook({ comando: "node scripts/check-sem-artefato.mjs", guard: GUARD_NOVO })

    // O que a derivação devolve aqui: lista vazia e NENHUM problema (a contra-prova
    // dela, medida acima). É por isso que o julgamento tem de existir no CHAMADOR.
    expect(artefatosDoHook({ root: dir }).problemas).toEqual([])

    const r = julgaArtefatosDoHook({ root: dir })
    expect(r.recusas).toHaveLength(1)
    expect(r.recusas[0]).toContain("VAZIA")
    // A consequência nomeada: sem artefato o fixture não materializa nada.
    expect(r.recusas[0]).toContain("FIXTURE")
  }, 120000)

  it("a derivação ABERTA é recusa nomeada — e a lista vazia não esconde a causa", () => {
    const dir = raizComHook({ comando: "node scripts/check-que-nao-existe.mjs", guard: GUARD_NOVO })

    const r = julgaArtefatosDoHook({ root: dir })
    expect(r.recusas.join(" | ")).toContain("ausente do checkout")
    // A lista sai vazia TAMBÉM aqui — recusar pelo TAMANHO esconderia o problema
    // que explica a lista vazia (a ordem das recusas é a decisão).
    expect(r.recusas.join(" | ")).not.toContain("VAZIA")
  }, 120000)

  it("a CLI: exit 1 na árvore da lista vazia, exit 0 no checkout", () => {
    const dir = raizComHook({ comando: "node scripts/check-sem-artefato.mjs", guard: GUARD_NOVO })
    const recusa = roda(["--root", dir])
    expect(recusa.status).toBe(EXIT_DO_GUARD.LISTA_VAZIA)
    expect(recusa.err).toContain("VAZIA")

    const ok = roda(["--json"])
    expect(ok.status).toBe(EXIT_DO_GUARD.OK)
    expect(JSON.parse(ok.out).artefatos).toContain(GITEA_COMPOSE)
  }, 120000)
})
