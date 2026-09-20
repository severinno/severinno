/**
 * mirror-coverage.test.ts
 *
 * O CONTRATO do `scripts/check-mirror-coverage.mjs`: a cobertura do recorte do commit,
 * derivada das TABELAS-FONTE dos espelhos — e a tabela nova do `env-mirror`, que
 * traz para a conta a variável que nenhuma outra tabela cobria (o segredo).
 *
 * Duas metades:
 *
 *  1. PURA — a derivação (as QUATRO tabelas), o dedup por espelho FÍSICO (o
 *     mesmo arquivo declarado por três tabelas é UM espelho, com três decisões),
 *     o resumo POR TABELA (a resposta literal de "quais espelhos de cada tabela
 *     ficam sem regra"), e o contrato fail-closed (espelho sem decisão, mutação
 *     ignorada sem motivo, medível com as duas mutações puladas, decisão de
 *     recorte que a medição não confirma, ausência declarada que a medição
 *     contradiz).
 *
 *  2. POR EXECUÇÃO — `medirCobertura` contra um repositório git REAL temporário,
 *     com um hook de mentira e DOIS guards de mentira que se distinguem pelo que
 *     pegam (um só a TROCA do valor, outro só a REMOÇÃO da linha). É o que prova
 *     que a medição mede o defeito, e não a estrutura: o veredito por mutação
 *     tem de cair no guard CERTO, e a declaração de recorte tem de ser conferida
 *     contra esse resultado.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/mirror-coverage.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { MIRROR_VARIABLE_RULES } from "../../../scripts/check-actrc-sync.mjs"
import { ENV_MIRROR_TABELA, envMirrors } from "../../../scripts/check-env-mirror.mjs"
import {
  espelhosDeclarados,
  espelhosFisicos,
  medirCobertura,
  renderCobertura,
  resumoTabelas,
  violacoesDeCobertura,
} from "../../../scripts/check-mirror-coverage.mjs"

const RAIZ = resolve(process.cwd())
const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
})

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "mirror-coverage-test-"))
  tmpDirs.push(dir)
  return dir
}

/** Um repo git real (é dele que `medirCobertura` tira o worktree do HEAD). */
function repoGit(): string {
  const dir = tmp()
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir })
  return dir
}

/**
 * Um par de guards de mentira com vereditos SEPARADOS: um só morde a REMOÇÃO da
 * linha, o outro só a TROCA do valor. Sem essa separação o teste não conseguiria
 * dizer se a medição atribuiu a detecção ao comando certo.
 */
function guardasDeMentira(dir: string): void {
  mkdirSync(join(dir, "scripts"), { recursive: true })
  writeFileSync(
    join(dir, "scripts", "check-removal.mjs"),
    [
      "import { readFileSync } from 'node:fs'",
      "const t = readFileSync('mirror.env', 'utf8')",
      "if (!/^KEY=/m.test(t)) { console.error('linha ausente'); process.exit(1) }",
    ].join("\n"),
    "utf8",
  )
  writeFileSync(
    join(dir, "scripts", "check-swap.mjs"),
    [
      "import { readFileSync } from 'node:fs'",
      "const t = readFileSync('mirror.env', 'utf8')",
      "const m = t.match(/^KEY=(.*)$/m)",
      "if (m && m[1] !== '1.0') { console.error('valor trocado'); process.exit(1) }",
    ].join("\n"),
    "utf8",
  )
  writeFileSync(join(dir, "mirror.env"), "KEY=1.0\n", "utf8")
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })
}

/** A linha do hook de onde os comandos do recorte são derivados. */
const HOOK_FIXTURE = [
  "#!/usr/bin/env bash",
  "node scripts/check-removal.mjs --staged &",
  "node scripts/check-swap.mjs --staged &",
].join("\n")

const ESPELHO_FIXTURE = {
  variavel: "KEY",
  arquivo: "mirror.env",
  medivel: true,
  recorte: null,
  motivo: null,
}

/** Roda a medição real no repo de fixture, com o espelho pedido. */
function medirNoFixture(espelho: Record<string, unknown>) {
  const dir = repoGit()
  guardasDeMentira(dir)
  const out = medirCobertura({
    root: dir,
    hookSource: HOOK_FIXTURE,
    // A tabela de fixture não existe nas tabelas reais: a regex vem da forma
    // `KEY=valor`, injetada pelo teste (o resto do motor é o de produção).
    regexDe: () => /^KEY=(.+)$/m,
    espelhos: [{ tabela: "fixture", ...ESPELHO_FIXTURE, ...espelho }],
  })
  return out
}

// ── a quarta tabela: o env-mirror, derivado do COMPOSE ─────────────────────

describe("envMirrors — a tabela derivada do compose", () => {
  it("cobre TODO nome que o compose do Gitea consome, e o segredo entra pela primeira vez", () => {
    const espelhos = envMirrors({ cwd: RAIZ })
    const nomes = espelhos.map((e) => e.variavel).sort()
    expect(nomes).toEqual([
      "BUN_VERSION",
      "GITEA__registry__ENABLED",
      "IMAGE_NAMESPACE",
      "IMAGE_REGISTRY",
      "RUNNER_TOKEN",
    ])
    // O SEGREDO é o que nenhuma outra tabela cobria: ele é o motivo de a tabela
    // existir, e ele tem de estar declarado (não pode sair da conta por ser
    // incomparável no commit).
    const segredo = espelhos.find((e) => e.variavel === "RUNNER_TOKEN") as Record<string, unknown>
    expect(segredo).toBeTruthy()
    expect(segredo.medivel).toBe(true)
    expect(segredo.recorte).toBe(null)
    expect(String(segredo.motivo)).toContain("SEGREDO")
  })

  it("NÃO reescreve a regra de valor de quem já a tem: lê a decisão do dono", () => {
    const porNome = new Map(envMirrors({ cwd: RAIZ }).map((e) => [e.variavel, e]))
    for (const nome of ["BUN_VERSION", "IMAGE_REGISTRY", "IMAGE_NAMESPACE"]) {
      const doDono = (MIRROR_VARIABLE_RULES as Record<string, { env?: Record<string, unknown> }>)[
        nome
      ]?.env
      expect(doDono).toBeTruthy()
      expect(porNome.get(nome)?.recorte).toEqual(doDono?.recorte ?? null)
      expect(porNome.get(nome)?.motivo).toEqual(doDono?.motivo ?? null)
    }
  })

  it("declara (sem medir) a variável que o compose consome e o template NÃO declara", () => {
    const dir = tmp()
    mkdirSync(join(dir, "deploy"), { recursive: true })
    // Os caminhos são os REAIS (o dono é lido das constantes do guard): o
    // compose declarado e o template declarado, num cwd de fixture.
    writeFileSync(
      join(dir, "deploy", "docker-compose.gitea.yml"),
      "services:\n  x:\n    environment:\n      - SO_NO_COMPOSE=${SO_NO_COMPOSE}\n      - BUN_VERSION=${BUN_VERSION}\n",
      "utf8",
    )
    writeFileSync(join(dir, "deploy", "env.gitea.example"), "BUN_VERSION=1.3.14\n", "utf8")
    const espelhos = envMirrors({ cwd: dir, read: (p) => readFileSync(p, "utf8") })
    const fora = espelhos.find((e) => e.variavel === "SO_NO_COMPOSE")
    expect(fora?.medivel).toBe(false)
    expect(String(fora?.motivoNaoMedivel)).toContain("não o declara")
  })

  it("o segredo ignora a mutação que NÃO é defeito (a troca do placeholder) e mantém a que é (remoção)", () => {
    const segredo = envMirrors({ cwd: RAIZ }).find((e) => e.variavel === "RUNNER_TOKEN")
    expect(Object.keys(segredo?.mutacoesIgnoradas ?? {})).toEqual(["swap"])
    expect(String(segredo?.mutacoesIgnoradas?.swap ?? "")).toContain("PLACEHOLDER")
  })
})

// ── a derivação e o dedup por espelho físico ────────────────────────────────

describe("espelhosDeclarados / espelhosFisicos", () => {
  it("declara as QUATRO tabelas — bun-version, registry-source, actrc-sync e env-mirror", () => {
    const tabelas = new Set(espelhosDeclarados().map((e) => e.tabela))
    expect([...tabelas].sort()).toEqual([
      "actrc-sync",
      "bun-version",
      ENV_MIRROR_TABELA,
      "registry-source",
    ])
  })

  it("o mesmo arquivo declarado por três tabelas é UM espelho físico, e cada tabela mantém a sua decisão", () => {
    const fisicos = espelhosFisicos(espelhosDeclarados())
    const chave = "BUN_VERSION|deploy/env.gitea.example"
    const fisico = fisicos.find((f) => f.chave === chave)
    expect(fisico).toBeTruthy()
    expect(fisico?.tabelas.sort()).toEqual(["actrc-sync", "bun-version", ENV_MIRROR_TABELA])
    expect(fisico?.decisoes).toHaveLength(3)
    // E a medição acontece UMA vez para os três (medir o mesmo arquivo três
    // vezes seria custo sem informação).
    expect(fisicos.filter((f) => f.chave === chave)).toHaveLength(1)
  })
})

// ── o resumo por tabela (a pergunta literal do contrato) ────────────────────

describe("resumoTabelas — quais espelhos de cada tabela ficam sem regra", () => {
  it("nomeia, por tabela, os espelhos sem regra no recorte e os fora do commit", () => {
    const resumo = resumoTabelas(espelhosDeclarados())
    const env = resumo.find((t) => t.tabela === ENV_MIRROR_TABELA)
    expect(env?.total).toBe(5)
    expect(env?.mediveis).toBe(5)
    expect(env?.comRegra).toBe(0)
    expect(env?.semRegra).toContain("RUNNER_TOKEN@deploy/env.gitea.example")
    // O espelho do HOST (gitignored) não some da conta: ele aparece como
    // fora-do-commit, e não como "sem regra" (que é outra coisa).
    const actrc = resumo.find((t) => t.tabela === "actrc-sync")
    expect(actrc?.foraDoCommit).toContain("BUN_VERSION@deploy/.env.gitea")
  })

  it("o relatório em texto publica o resumo por tabela com os nomes", () => {
    const todos = espelhosDeclarados()
    const texto = renderCobertura({ medicoes: [], todos })
    expect(texto).toContain("por tabela:")
    expect(texto).toContain("env-mirror — 5 espelho(s) · 0 com regra no recorte")
    expect(texto).toContain("sem regra: BUN_VERSION@deploy/env.gitea.example")
  })
})

// ── o contrato fail-closed ─────────────────────────────────────────────────

describe("violacoesDeCobertura — o contrato do indecidido", () => {
  const espelho = (extra: Record<string, unknown>) => ({
    tabela: "fixture",
    variavel: "KEY",
    arquivo: "mirror.env",
    medivel: true,
    motivo: null,
    recorte: null,
    ...extra,
  })
  const medicao = (detectadoPor: string[], swap = detectadoPor, remocao = detectadoPor) => ({
    espelho: {
      tabela: "fixture",
      variavel: "KEY",
      arquivo: "mirror.env",
      medivel: true,
      recorte: null,
      motivo: null,
    },
    detectadoPor,
    mutacoes: { swap, remocao },
  })
  /** A regex que a tabela de fixture resolve (a forma `KEY=valor`). */
  const comRegex = () => /^KEY=(.+)$/m
  /** O caso em que a tabela NÃO sabe localizar a linha que ela declara. */
  const semRegex = () => null

  it("espelho SEM DECISÃO (nem regra, nem motivo) é violação", () => {
    const v = violacoesDeCobertura([], [espelho({})], { regexDe: comRegex })
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("SEM DECISÃO")
  })

  it("mutação IGNORADA sem motivo é violação (um pulo silencioso esconde a lacuna)", () => {
    const v = violacoesDeCobertura(
      [],
      [espelho({ motivo: "x", mutacoesIgnoradas: { swap: "  " } })],
      {
        regexDe: comRegex,
      },
    )
    expect(v.some((x) => x.includes("IGNORADA sem motivo"))).toBe(true)
  })

  it("MEDÍVEL com as duas mutações puladas é violação (verde por vazio)", () => {
    const v = violacoesDeCobertura(
      [],
      [espelho({ motivo: "x", mutacoesIgnoradas: { swap: "não é defeito", remocao: "idem" } })],
      { regexDe: comRegex },
    )
    expect(v.some((x) => x.includes("não sobrou nada a medir"))).toBe(true)
  })

  it("declarar uma regra do recorte que a medição NÃO confirma é violação (decisão envelhecida)", () => {
    const declarado = espelho({ recorte: { comando: "check-removal", regra: "recusa a remoção" } })
    const confirmado = violacoesDeCobertura([medicao(["check-removal"])], [declarado], {
      regexDe: comRegex,
    })
    expect(confirmado).toEqual([])
    const envelhecido = violacoesDeCobertura([medicao(["check-swap"])], [declarado], {
      regexDe: comRegex,
    })
    expect(envelhecido[0]).toContain("a MEDIÇÃO não a encontrou")
  })

  it("declarar que NENHUMA regra o julga e a medição encontrá-lo é violação", () => {
    const declarado = espelho({ motivo: "nenhuma regra do recorte o julga" })
    expect(violacoesDeCobertura([medicao([])], [declarado], { regexDe: comRegex })).toEqual([])
    const contradito = violacoesDeCobertura([medicao(["check-swap"])], [declarado], {
      regexDe: comRegex,
    })
    expect(contradito[0]).toContain("a medição o encontrou em check-swap")
  })

  it("um espelho medível que a tabela não sabe LOCALIZAR é violação (cobertura declarada maior que a real)", () => {
    const v = violacoesDeCobertura([], [espelho({ motivo: "x" })], { regexDe: semRegex })
    expect(v[0]).toContain("não resolve a forma da linha")
  })
})

// ── a medição POR EXECUÇÃO (o defeito, não a estrutura) ────────────────────

describe("medirCobertura — por execução, num repo de verdade", () => {
  it("o recorte derivado do hook roda de verdade e cada mutação cai no guard certo", () => {
    const out = medirNoFixture({})
    expect(out.comandos.map((c) => c.nome)).toEqual(["check-removal", "check-swap"])
    const m = out.medicoes[0]
    expect(m.erro).toBeUndefined()
    // A TROCA do valor só é vista pelo guard do valor…
    expect(m.mutacoes.swap).toEqual(["check-swap"])
    // …e a REMOÇÃO da linha só pelo guard da existência: é essa separação que
    // prova que a medição atribui a detecção ao comando CERTO.
    expect(m.mutacoes.remocao).toEqual(["check-removal"])
    expect(m.detectadoPor.sort()).toEqual(["check-removal", "check-swap"])
  })

  it("a decisão declarada é CONFERIDA contra a medição real (as duas direções)", () => {
    // Declarar o guard da remoção: confirmado.
    const ok = medirNoFixture({ recorte: { comando: "check-removal", regra: "recusa a remoção" } })
    const espelho = ok.medicoes[0].espelho
    expect(
      violacoesDeCobertura(
        ok.medicoes,
        [
          {
            tabela: "fixture",
            ...ESPELHO_FIXTURE,
            recorte: { comando: "check-removal", regra: "r" },
          },
        ],
        { regexDe: () => /^KEY=(.+)$/m },
      ),
    ).toEqual([])
    // A declaração de que NENHUMA regra o julga, contra a medição que achou as
    // duas: violação — é o caso do espelho que entra na tabela sem dono.
    const declarado = { tabela: "fixture", ...ESPELHO_FIXTURE, motivo: "nenhuma regra o julga" }
    const contra = violacoesDeCobertura(ok.medicoes, [declarado], { regexDe: () => /^KEY=(.+)$/m })
    expect(contra[0]).toContain("a medição o encontrou em")
    expect(contra[0]).toContain("check-removal")
    expect(contra[0]).toContain("check-swap")
    // E os tipos do relatório seguem coerentes com a medição real.
    expect(espelho.arquivo).toBe("mirror.env")
  })

  it("um comando que falha SEM MUTAÇÃO (ambiente) sai da medição e é medido como INDETERMINADO", () => {
    const dir = repoGit()
    guardasDeMentira(dir)
    // Um guard que falha SEMPRE — o caso "suíte vermelha de ambiente dentro de um
    // job sem dependências": sem o controle, ele contaria como detector de TODAS
    // as mutações e a cobertura sairia verde por acidente.
    writeFileSync(
      join(dir, "scripts", "check-quebrado.mjs"),
      "import 'dependencia-que-nao-existe'\n",
      "utf8",
    )
    execFileSync("git", ["add", "-A"], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "quebrado"], { cwd: dir })
    const out = medirCobertura({
      root: dir,
      hookSource: HOOK_FIXTURE + "\nnode scripts/check-quebrado.mjs --staged",
      regexDe: () => /^KEY=(.+)$/m,
      espelhos: [
        {
          tabela: "fixture",
          ...ESPELHO_FIXTURE,
          recorte: { comando: "check-quebrado", regra: "x" },
        },
      ],
    })
    expect(out.controle).toEqual(["check-quebrado"])
    // Ele não é atribuído a NENHUMA mutação (os outros dois guards continuam
    // julgando o que eles julgam)…
    expect(out.medicoes[0].detectadoPor).not.toContain("check-quebrado")
    expect(out.medicoes[0].detectadoPor.sort()).toEqual(["check-removal", "check-swap"])
    // …e a declaração que depende dele NÃO pode ser confirmada (nem refutada).
    const v = violacoesDeCobertura(
      out.medicoes,
      [
        {
          tabela: "fixture",
          ...ESPELHO_FIXTURE,
          recorte: { comando: "check-quebrado", regra: "x" },
        },
      ],
      { regexDe: () => /^KEY=(.+)$/m, controle: out.controle },
    )
    expect(v[0]).toContain("FALHA SEM MUTAÇÃO")
  })

  it("a base é o COMMIT PENDENTE: a linha que só existe no working tree AINDA é medida", () => {
    // O cenário real de quem roda a bateria antes de commitar: a tabela (lida
    // VIVA, do módulo) já declara o espelho, e o arquivo JÁ tem a linha — mas o
    // HEAD não. Medindo o HEAD, o relatório diria "a tabela declara um espelho
    // que o arquivo não tem", que é falso sobre o arquivo: ele tem.
    const dir = repoGit()
    guardasDeMentira(dir)
    // HEAD fica SEM a linha (o espelho foi declarado depois deste commit)…
    writeFileSync(join(dir, "mirror.env"), "# sem a linha\n", "utf8")
    execFileSync("git", ["add", "-A"], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "sem a linha"], { cwd: dir })
    // …e a linha entra no working tree, NÃO commitada.
    writeFileSync(join(dir, "mirror.env"), "KEY=1.0\n", "utf8")

    // O que o HEAD tem — a asserção que dá sentido ao resto do teste.
    const noHead = execFileSync("git", ["show", "HEAD:mirror.env"], { cwd: dir, encoding: "utf8" })
    expect(noHead).not.toContain("KEY=")

    const out = medirCobertura({
      root: dir,
      hookSource: HOOK_FIXTURE,
      regexDe: () => /^KEY=(.+)$/m,
      espelhos: [{ tabela: "fixture", ...ESPELHO_FIXTURE }],
    })
    const m = out.medicoes[0]
    expect(m.erro).toBeUndefined()
    // A linha PENDENTE foi encontrada e a mutação dela caiu no guard do defeito.
    expect(m.mutacoes.remocao).toEqual(["check-removal"])
    expect(m.mutacoes.swap).toEqual(["check-swap"])
  })

  it("o relatório em texto diz, por mutação, quem julgou — e quem foi ignorado e por quê", () => {
    const out = medirNoFixture({})
    const texto = renderCobertura({
      medicoes: out.medicoes.map((m) => ({
        ...m,
        espelho: { ...m.espelho, tabelas: ["fixture"], decisoes: [], mutacoesIgnoradas: {} },
      })),
      todos: [],
    })
    expect(texto).toContain("swap: check-swap")
    expect(texto).toContain("remocao: check-removal")
  })
})
