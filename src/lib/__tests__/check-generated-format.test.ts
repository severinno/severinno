// =============================================================================
// check-generated-format.test.ts
//
// Testes do par que faz o GERADO sair dentro do lint:
// `scripts/prettier-format.mjs` (o formatador do repositório, por onde todo
// gerador de arquivo versionado grava) e `scripts/check-generated-format.mjs` (o
// guard que mede o produto e a tabela de geradores).
//
// O que precisa ser provado (a promessa pode "parecer" certa e mentir):
//   1. o helper GRAVA e FORMATA com o binário do repositório: o payload que o
//      `JSON.stringify` expande e que o prettier colapsa (`[1, 2, 3]`, dois
//      caminhos de `staged`) sai na forma que o `lint` aceita — é o defeito
//      MEDIDO que originou o módulo;
//   2. sem o binário o helper DIZ (`formatado: false` + motivo) em vez de fingir
//      que formatou, e `formatar: false` é a saída declarada de quem grava cru de
//      propósito;
//   3. o guard reprova o artefato que o prettier reformataria, o que está fora
//      dos globs do `lint` e o que não existe na árvore;
//   4. o guard reprova o gerador que grava sem o helper, a escrita CRUA não
//      declarada e a declaração STALE;
//   5. o guard cobra a COBERTURA nos dois sentidos: candidato fora da tabela e
//      entrada que não declara saída nenhuma e não é candidata.
//
// Fixtures em tmpdir com um repo git de verdade (o guard lê `git ls-files`) e
// nenhuma escrita no repositório: o `root` é a fixture.
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  EXIT,
  analyze,
  artefatoNoLint,
  caminhosCitados,
  escritasDe,
} from "../../../scripts/check-generated-format.mjs"
import {
  caminhoDoFormatador,
  escreverFormatado,
  escreverJsonFormatado,
  formatadorDisponivel,
  versaoDoFormatador,
} from "../../../scripts/prettier-format.mjs"

const ROOT = process.cwd()
const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Um repo git de verdade no tmpdir — o guard mede a árvore por `git ls-files`. */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "generated-format-"))
  tmpDirs.push(dir)
  for (const [rel, conteudo] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, conteudo, "utf8")
  }
  // O `node_modules` é LINKADO (como no simulador de hook): o formatador do
  // repositório é a régua do guard, e a fixture precisa da MESMA versão pinada.
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir")
  const init = spawnSync("git", ["init", "-q", "."], { cwd: dir, encoding: "utf8" })
  if (init.status !== 0) throw new Error(`fixture: git init falhou (${init.stderr})`)
  const add = spawnSync("git", ["add", "-A"], { cwd: dir, encoding: "utf8" })
  if (add.status !== 0) throw new Error(`fixture: git add falhou (${add.stderr})`)
  return dir
}

/** O `package.json` da fixture: o guard lê os globs do comando `lint`. */
const PKG = JSON.stringify(
  { scripts: { lint: "prettier --check 'scripts/**' 'docs/**'" } },
  null,
  2,
)

/** Uma fixture mínima: o gen que grava, o artefato e o `lint`. */
function fixtureDoGerador({
  fonteGerador,
  artefato = '{\n  "a": [1, 2, 3]\n}\n',
}: {
  fonteGerador: string
  artefato?: string
}): string {
  const dir = repo({
    "package.json": PKG,
    "scripts/gen.mjs": fonteGerador,
    "docs/gerado.json": artefato,
  })
  return dir
}

/** A tabela default das fixtures: o `scripts/gen.mjs` e a saída `docs/gerado.json`. */
const TABELA_FIXTURE = [{ script: "scripts/gen.mjs", saidas: ["docs/gerado.json"] }]

const FONTE_FORMATADA = [
  'import { escreverJsonFormatado } from "./prettier-format.mjs"',
  "const dados = { a: [1, 2, 3] }",
  'escreverJsonFormatado("docs/gerado.json", dados)',
  "",
].join("\n")

// ── 1. o helper: gravar é gravar FORMATADO ─────────────────────────────────

describe("prettier-format — o formatador do repositório no caminho de escrita", () => {
  it("`escreverJsonFormatado` deixa o payload na forma que o PRETTIER mantém (o defeito medido)", () => {
    const dir = mkdtempSync(join(tmpdir(), "prettier-format-"))
    tmpDirs.push(dir)
    const alvo = join(dir, "gerado.json")
    // O payload do defeito: o `JSON.stringify` expande TODO array; o prettier
    // colapsa o que cabe na largura. É o par exato que reprovava o lint.
    const r = escreverJsonFormatado(
      alvo,
      { staged: ["a.sh", "b.sh"], runs: [1, 2, 3] },
      { root: ROOT },
    )
    expect(r).toEqual({ escrito: true, formatado: true, motivo: null })
    expect(readFileSync(alvo, "utf8")).toBe(
      '{\n  "staged": ["a.sh", "b.sh"],\n  "runs": [1, 2, 3]\n}\n',
    )
    // A prova independente: o binário do repositório aprova o que ele gravou.
    const check = spawnSync(caminhoDoFormatador(ROOT), ["--check", alvo], {
      cwd: ROOT,
      encoding: "utf8",
    })
    expect(check.status).toBe(0)
    // E a régua publica a versão pinada (o número não é digitado no módulo).
    expect(formatadorDisponivel(ROOT)).toBe(true)
    expect(versaoDoFormatador(ROOT)).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("sem o binário do repositório o helper DIZ que não formatou — nunca finge", () => {
    const raizVazia = mkdtempSync(join(tmpdir(), "sem-prettier-"))
    tmpDirs.push(raizVazia)
    const alvo = join(raizVazia, "gerado.json")
    const r = escreverJsonFormatado(alvo, { a: 1 }, { root: raizVazia })
    expect(r.escrito).toBe(true)
    expect(r.formatado).toBe(false)
    expect(r.motivo).toContain("prettier do repositório ausente")
    // O arquivo FOI gravado (a medição não é bloqueada) e o desfecho é dito.
    expect(JSON.parse(readFileSync(alvo, "utf8"))).toEqual({ a: 1 })
  })

  it("`formatar: false` é a saída declarada de quem grava cru de propósito", () => {
    const dir = mkdtempSync(join(tmpdir(), "cru-"))
    tmpDirs.push(dir)
    const alvo = join(dir, "cru.txt")
    const r = escreverFormatado(alvo, "texto  cru\n", { root: ROOT, formatar: false })
    expect(r.formatado).toBe(false)
    expect(readFileSync(alvo, "utf8")).toBe("texto  cru\n")
  })
})

// ── 2. as funções puras do guard ───────────────────────────────────────────

describe("escritasDe — a varredura do caminho de escrita", () => {
  it("separa a escrita CRUA da chamada ao FORMATADOR (as duas são escritas; só a primeira é cobrada)", () => {
    const fonte = [
      'import { writeFileSync } from "node:fs"',
      'writeFileSync("docs/x.json", texto)',
      "array.push({ conteudo }); writeFileSync(destino, conteudo)",
      'appendFileSync(join(dir, "log"), linha)',
      'escreverJsonFormatado("docs/y.json", dados)',
    ].join("\n")
    const escritas = escritasDe(fonte)
    expect(escritas.map((e) => e.alvo)).toEqual([
      '"docs/x.json"',
      "destino",
      'join(dir, "log")',
      '"docs/y.json"',
    ])
    expect(escritas.filter((e) => e.formatado).map((e) => e.alvo)).toEqual(['"docs/y.json"'])
  })

  it("não confunde prosa nem `fs.writeFileSync` de outro módulo", () => {
    const fonte = [
      "// writeFileSync(não sou eu)",
      " * writeFileSync(nem eu, é comentário de bloco? não: linha de prosa)",
      'fs.writeFileSync("docs/z.json")',
    ].join("\n")
    expect(escritasDe(fonte)).toEqual([])
  })

  it("a chamada que abre a linha e desce o argumento traz o alvo da linha seguinte", () => {
    const fonte = ["escrever: writeFileSync(", '  join(dir, "arquivo"),', "  conteudo,", ")"].join(
      "\n",
    )
    expect(escritasDe(fonte)[0]?.alvo).toBe('→ join(dir, "arquivo")')
  })
})

describe("caminhosCitados — a matéria-prima da derivação", () => {
  it("extrai os literais de artefato (json/md/yml/txt) e ignora o resto", () => {
    const fonte = [
      'const A = "docs/GUARDS.md";',
      'const B = "ci/x.json";',
      'const C = "src/app.ts";',
    ].join("\n")
    expect(caminhosCitados(fonte).sort()).toEqual(["ci/x.json", "docs/GUARDS.md"])
  })
})

describe("artefatoNoLint — o escopo e a forma do artefato", () => {
  const GLOBS = ["scripts/**", "docs/**"]

  it("arquivo ausente, fora dos globs e reformatável são as três reprovações", () => {
    const dir = mkdtempSync(join(tmpdir(), "artefato-"))
    tmpDirs.push(dir)
    // A régua do artefato é o formato do REPOSITÓRIO: a fixture usa o mesmo
    // binário (linkado), senão a reprovação seria "sem prettier", não "fora do
    // lint" — e o teste mediria a ausência errada.
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir")
    mkdirSync(join(dir, "docs"), { recursive: true })
    // Fora do prettier de propósito: o que o prettier REFORMATARIA.
    writeFileSync(
      join(dir, "docs", "expandido.json"),
      '{\n  "a": [\n    1,\n    2\n  ]\n}\n',
      "utf8",
    )
    writeFileSync(join(dir, "docs", "limpo.json"), '{\n  "a": [1, 2]\n}\n', "utf8")
    writeFileSync(join(dir, "fora.json"), '{\n  "a": [1]\n}\n', "utf8")

    expect(artefatoNoLint("docs/nao-existe.json", { cwd: dir, globs: GLOBS }).motivo).toContain(
      "NÃO existe na árvore",
    )
    expect(artefatoNoLint("fora.json", { cwd: dir, globs: GLOBS }).motivo).toContain(
      "fora dos globs",
    )
    expect(artefatoNoLint("docs/expandido.json", { cwd: dir, globs: GLOBS }).ok).toBe(false)
    expect(artefatoNoLint("docs/limpo.json", { cwd: dir, globs: GLOBS }).ok).toBe(true)
  })
})

// ── 3. o veredito: o que o guard reprova ───────────────────────────────────

describe("analyze — o veredito do gerado", () => {
  it("tabela completa e artefato estável → exit 0", async () => {
    const dir = fixtureDoGerador({ fonteGerador: FONTE_FORMATADA })
    const r = await analyze({ cwd: dir, geradores: TABELA_FIXTURE })
    expect(r.violations).toEqual([])
    expect(r.exit).toBe(EXIT.OK)
    expect(r.saidas).toBe(1)
    expect(r.artefatos).toEqual([
      { saida: "docs/gerado.json", gerador: "scripts/gen.mjs", ok: true },
    ])
  })

  it("artefato que o prettier REFORMATARIA reprova (o gerado fora do lint)", async () => {
    const dir = fixtureDoGerador({
      fonteGerador: FONTE_FORMATADA,
      artefato: '{\n  "a": [\n    1,\n    2,\n    3\n  ]\n}\n',
    })
    const r = await analyze({ cwd: dir, geradores: TABELA_FIXTURE })
    expect(r.exit).toBe(EXIT.VIOLATIONS)
    expect(r.violations[0]).toContain("docs/gerado.json")
    expect(r.violations[0]).toContain("NÃO sai como o prettier o deixa")
  })

  it("gerador que grava SEM o formatador reprova, e a escrita CRUA não declarada também", async () => {
    const fonteCrua = [
      'import { writeFileSync } from "node:fs"',
      "const dados = { a: [1, 2, 3] }",
      'writeFileSync("docs/gerado.json", JSON.stringify(dados, null, 2) + "\\n")',
      "",
    ].join("\n")
    // O artefato é estável de propósito: a reprovação é do CAMINHO, não do produto.
    const dir = repo({
      "package.json": PKG,
      "scripts/gen.mjs": fonteCrua,
      "docs/gerado.json": '{\n  "a": [1, 2, 3]\n}\n',
    })
    const r = await analyze({ cwd: dir, geradores: TABELA_FIXTURE })
    expect(r.exit).toBe(EXIT.VIOLATIONS)
    expect(r.violations.some((v) => v.includes("SEM passar pelo formatador"))).toBe(true)
    expect(r.violations.some((v) => v.includes("escrita CRUA não declarada"))).toBe(true)
  })

  it("declaração STALE de escrita crua reprova (a tabela que ninguém revisa)", async () => {
    const dir = fixtureDoGerador({ fonteGerador: FONTE_FORMATADA })
    const r = await analyze({
      cwd: dir,
      geradores: [
        ...TABELA_FIXTURE,
        { script: "scripts/gen.mjs", saidas: ["docs/gerado.json"], escritasCruas: ["destino"] },
      ],
    })
    expect(r.violations.some((v) => v.includes("declaração STALE"))).toBe(true)
  })

  it("COBERTURA: candidato fora da tabela reprova, e entrada sem saída e sem candidato é STALE", async () => {
    const dir = fixtureDoGerador({ fonteGerador: FONTE_FORMATADA })
    const semTabela = await analyze({ cwd: dir, geradores: [] })
    expect(semTabela.violations.some((v) => v.includes("NÃO está na tabela GERADORES"))).toBe(true)

    const stale = await analyze({ cwd: dir, geradores: [{ script: "scripts/nao-existe.mjs" }] })
    expect(stale.violations.some((v) => v.includes("entrada STALE"))).toBe(true)
  })

  it("saída declarada que NÃO é versionada reprova (declarar o que não entra no commit não mede)", async () => {
    const dir = fixtureDoGerador({ fonteGerador: FONTE_FORMATADA })
    const r = await analyze({
      cwd: dir,
      geradores: [
        { script: "scripts/gen.mjs", saidas: ["docs/gerado.json", "docs/nao-versionado.json"] },
      ],
    })
    expect(r.violations.some((v) => v.includes("não é versionada"))).toBe(true)
  })

  it("`reescreve` fora dos globs do lint reprova (o que ele reescreve tem de ser julgado)", async () => {
    const dir = fixtureDoGerador({ fonteGerador: FONTE_FORMATADA })
    const r = await analyze({
      cwd: dir,
      geradores: [{ script: "scripts/gen.mjs", saidas: [], reescreve: ["outro/"] }],
    })
    expect(r.violations.some((v) => v.includes("fora dos globs"))).toBe(true)
  })

  it("sem `git` a árvore não é lida e o veredito é INFRA (nunca '0 violações')", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sem-git-"))
    tmpDirs.push(dir)
    writeFileSync(join(dir, "package.json"), PKG, "utf8")
    mkdirSync(join(dir, "scripts"), { recursive: true })
    const run = (cmd: string) =>
      cmd === "git"
        ? { status: 128, stdout: "", stderr: "fatal: not a git repository\n" }
        : undefined
    const r = await analyze({ cwd: dir, geradores: TABELA_FIXTURE, run: run as never })
    expect(r.exit).toBe(EXIT.UNAVAILABLE)
    expect(r.error).toContain("git ls-files indisponível")
  })
})

// ── 4. o repositório real ──────────────────────────────────────────────────

describe("o repositório real", () => {
  it("o guard sai verde hoje: os geradores declarados e as saídas versionadas estão dentro do lint", async () => {
    const r = await analyze({ cwd: ROOT })
    expect(r.error).toBeNull()
    expect(r.violations).toEqual([])
    expect(r.exit).toBe(EXIT.OK)
    // Números MEDIDOS, não um piso frouxo: um gerador novo que entre na tabela
    // sem saída declarada não muda `saidas`, mas um que perca a saída muda — e é
    // isso que o teste prende junto com o veredito.
    expect(r.geradores).toBeGreaterThanOrEqual(30)
    expect(r.saidas).toBeGreaterThanOrEqual(10)
    expect(r.artefatos.every((a) => a.ok)).toBe(true)
    // A tabela cobre TODOS os candidatos derivados: a lista não é à mão.
    expect(r.candidatos.length).toBeGreaterThan(10)
    const declarados = new Set(r.escritasCruas.map((e) => e.script))
    for (const c of r.candidatos) expect(declarados.has(c)).toBe(true)
  })
})

// ── 5. a CLI: o contrato de exit code (0/1/2/3) ───────────────────────────

const CLI = join(ROOT, "scripts", "check-generated-format.mjs")

describe("a CLI do guard", () => {
  it("--help sai 0 e publica o uso (sem medir nada)", () => {
    const r = spawnSync("node", [CLI, "--help"], { cwd: ROOT, encoding: "utf8" })
    expect(r.status).toBe(EXIT.OK)
    expect(r.stdout).toContain("check-generated-format")
  })

  it("argumento desconhecido sai 3 (uso inválido)", () => {
    const r = spawnSync("node", [CLI, "--nao-existe"], { cwd: ROOT, encoding: "utf8" })
    expect(r.status).toBe(EXIT.USAGE)
  })

  it("numa árvore sem `package.json` sai 2 (INFRA, nunca '0 violações')", () => {
    const dir = mkdtempSync(join(tmpdir(), "sem-pkg-"))
    tmpDirs.push(dir)
    const r = spawnSync("node", [CLI], { cwd: dir, encoding: "utf8" })
    expect(r.status).toBe(EXIT.UNAVAILABLE)
    expect(r.stderr).toContain("INFRA")
  })

  it("no repositório real o --json publica os números medidos e sai 0", () => {
    const r = spawnSync("node", [CLI, "--json"], { cwd: ROOT, encoding: "utf8" })
    expect(r.status).toBe(EXIT.OK)
    const dados = JSON.parse(r.stdout)
    expect(dados.exit).toBe(EXIT.OK)
    expect(dados.violations).toEqual([])
    expect(dados.geradores).toBeGreaterThanOrEqual(30)
    expect(dados.saidas).toBeGreaterThanOrEqual(10)
  })
})
