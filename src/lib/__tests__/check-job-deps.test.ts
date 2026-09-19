/**
 * check-job-deps.test.ts
 *
 * A prova do guard `scripts/check-job-deps.mjs`: um job que RODA um comando cujo
 * veredito exige `node_modules` tem de INSTALAR as dependencias — ou a isencao
 * tem de estar DECLARADA (com data e janela), e a declaracao tem de ser
 * VERDADEIRA.
 *
 * POR QUE A SUITE EXISTE: a classe e INVISIVEL no workflow. A mesma linha
 * `node scripts/X.mjs` produz dois desfechos sem dependencias — o CRASH
 * (`import` de topo) e o fail-closed de quem pergunta ao `js-yaml` se o YAML e
 * valido (exit 2, "NAO JULGAVEL") — e a prosa dos jobs dizia "node puro, sem bun
 * install" nos dois casos. Um guard que nunca falhou nao protege nada: cada
 * regra que ele promete tem um caso aqui, com o CONTROLE na direcao oposta (o
 * mesmo fixture sem o defeito sai verde), que e o que desmente um nao-zero
 * vindo do FIXTURE (package.json ausente, YAML de mentira, guard lendo outro
 * diretorio).
 *
 * A metade que quase passou em silencio e a do GRAU: `passa` (o comando termina
 * 0 sem `node_modules`) e `falha-fechado` sao verdades diferentes, e uma isencao
 * que diz `passa` sobre um `import` de TOPO ou um BINARIO de dependencia e
 * provadamente falsa — os dois carregam no START, sem caminho alternativo.
 *
 * Usage:
 *   bunx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-job-deps.test.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { afterAll, describe, expect, it } from "vitest"
import {
  EXIT,
  JOB_DEPS_ALLOWLIST,
  JOB_DEPS_REVIEW_DAYS,
  MAX_PROFUNDIDADE,
  auditaForjas,
  comandosDeTexto,
  ehShell,
  exigeDeps,
  grafoDoModulo,
  importsEstaticos,
  resolveRelativo,
} from "../../../scripts/check-job-deps.mjs"

const GUARD = join(process.cwd(), "scripts", "check-job-deps.mjs")

const fixtures: string[] = []
afterAll(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface FixtureSpec {
  workflows: Record<string, string>
  arquivos?: Record<string, string>
  scripts?: Record<string, string>
  deps?: string[]
}

/** Um repositorio minimo: os workflows, o `package.json` e os arquivos citados. */
function fixture(spec: FixtureSpec): string {
  const dir = mkdtempSync(join(tmpdir(), "jobdeps-"))
  fixtures.push(dir)
  for (const [rel, conteudo] of Object.entries(spec.workflows)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), conteudo, "utf8")
  }
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-job-deps",
        private: true,
        scripts: spec.scripts ?? {},
        dependencies: {},
        devDependencies: Object.fromEntries((spec.deps ?? []).map((d) => [d, "1.0.0"])),
      },
      null,
      2,
    ),
    "utf8",
  )
  for (const [rel, conteudo] of Object.entries(spec.arquivos ?? {})) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), conteudo, "utf8")
  }
  return dir
}

function rodaCli(dir: string, extra: string[] = []): { status: number | null; saida: string } {
  const r = spawnSync(process.execPath, [GUARD, "--root", dir, ...extra], { encoding: "utf8" })
  return { status: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

const ctxDe = (root: string, extra: Record<string, unknown> = {}) => ({
  root,
  pacotes: new Set(["vitest", "prisma", "pg"]),
  scripts: {},
  ...extra,
})

const comando = (texto: string) => comandosDeTexto(texto, { root: process.cwd() })[0]

// ── o grafo: o que carrega no START x o que so aparece em caminho tardio ──

describe("o grafo de dependencias de um modulo", () => {
  it("o `import` de TOPO e estatico; o `require` dentro de funcao e tardio", () => {
    const conteudo = [
      'import { readFileSync } from "node:fs"',
      'import pg from "pg"',
      "export function carrega() {",
      '  const yaml = require("js-yaml")',
      "  return yaml.load('a: 1')",
      "}",
    ].join("\n")

    const estaticos = importsEstaticos(conteudo)

    expect([...estaticos]).toEqual(["pg"])
    // builtin nao e dependencia de node_modules (a fonte unica do que e bare
    // specifier e o `check-no-leaked-imports`).
    expect(estaticos.has("node:fs")).toBe(false)
  })

  it("PROVA: o texto de um `import` dentro de STRING nao vira dependencia", () => {
    const conteudo = [
      "// a doc abaixo descreve o que o modulo faz, e cita o pacote",
      "const DOC = 'import pg from \"pg\"'",
      "export const ok = true",
    ].join("\n")

    expect(importsEstaticos(conteudo).size).toBe(0)
  })

  it("o grafo segue o RELATIVO e separa os dois graus (o guard ve o que o modulo alcanca)", () => {
    const dir = fixture({
      workflows: {},
      arquivos: {
        "scripts/entrada.mjs": 'import { helper } from "./lib/helper.mjs"\nhelper()\n',
        "scripts/lib/helper.mjs": 'export function helper() {\n  return require("js-yaml")\n}\n',
        "scripts/db.mjs": 'import pg from "pg"\nexport const pool = pg\n',
      },
    })

    const viaRelativo = grafoDoModulo(join(dir, "scripts/entrada.mjs"))

    expect(viaRelativo.estatico).toEqual([])
    expect(viaRelativo.tardio).toEqual(["js-yaml"])
    expect(viaRelativo.arquivos).toBe(2)

    const comTopo = grafoDoModulo(join(dir, "scripts/db.mjs"))

    expect(comTopo.estatico).toEqual(["pg"])
    expect(comTopo.tardio).toEqual([])
  })

  it("o relativo resolve pela escada do ESM (extensao literal, .mjs/.js, index)", () => {
    const dir = fixture({
      workflows: {},
      arquivos: {
        "scripts/a.mjs": "export const a = 1\n",
        "scripts/b.mjs": "export const b = 1\n",
        "scripts/lib/index.mjs": "export const l = 1\n",
      },
    })

    expect(resolveRelativo("./a.mjs", join(dir, "scripts", "b.mjs"))).toBe(
      join(dir, "scripts", "a.mjs"),
    )
    expect(resolveRelativo("./a", join(dir, "scripts", "b.mjs"))).toBe(
      join(dir, "scripts", "a.mjs"),
    )
    expect(resolveRelativo("./lib", join(dir, "scripts", "b.mjs"))).toBe(
      join(dir, "scripts", "lib", "index.mjs"),
    )
    expect(resolveRelativo("./nao-existe.mjs", join(dir, "scripts", "b.mjs"))).toBe(null)
  })

  it("o script de shell e reconhecido pela extensao E pelo shebang (os hooks nao tem extensao)", () => {
    const dir = fixture({
      workflows: {},
      arquivos: {
        "scripts/x.sh": "#!/usr/bin/env bash\necho ok\n",
        ".husky/pre-commit": "#!/bin/sh\necho ok\n",
        "scripts/no-shebang": "echo ok\n",
      },
    })

    expect(ehShell(join(dir, "scripts/x.sh"))).toBe(true)
    expect(ehShell(join(dir, ".husky/pre-commit"))).toBe(true)
    expect(ehShell(join(dir, "scripts/no-shebang"))).toBe(false)
  })
})

// ── o veredito por COMANDO: o grau e um fato do repositorio ───────────────

describe("cada comando tem um grau de dependencia (fato, nao suposicao)", () => {
  const dir = () =>
    fixture({
      workflows: {},
      arquivos: {
        "scripts/topo.mjs": 'import pg from "pg"\nexport const pool = pg\n',
        "scripts/tardio.mjs": 'export function y() {\n  return require("js-yaml")\n}\n',
        "scripts/puro.mjs": "export const ok = 1\n",
        "scripts/corpo.sh": "set -eu\nnode scripts/topo.mjs\n",
        "scripts/entrada-pkg.mjs": 'import pg from "pg"\n',
      },
      scripts: { "check:x": "node scripts/entrada-pkg.mjs" },
    })

  it("`node <script>` com import de topo e `estatico` (sem deps o processo MORRE)", () => {
    const root = dir()
    const d = exigeDeps(comando("node scripts/topo.mjs"), ctxDe(root))
    expect(d).toMatchObject({ precisa: true, grau: "estatico", pacotes: ["pg"] })
  })

  it("`node <script>` que so alcanca o pacote em funcao e `tardio` (o desfecho depende do caminho)", () => {
    const root = dir()
    const d = exigeDeps(comando("node scripts/tardio.mjs"), ctxDe(root))
    expect(d).toMatchObject({ precisa: true, grau: "tardio", pacotes: ["js-yaml"] })
  })

  it("o CONTROLE: o script node-puro nao exige nada", () => {
    const root = dir()
    expect(exigeDeps(comando("node scripts/puro.mjs"), ctxDe(root)).precisa).toBe(false)
  })

  it("`bash <script>` segue o CORPO (o node de dentro conta)", () => {
    const root = dir()
    const d = exigeDeps(comando("bash scripts/corpo.sh"), ctxDe(root))
    expect(d.precisa).toBe(true)
    expect(d.internos!.map((i) => i.texto)).toContain("node scripts/topo.mjs")
  })

  it("`bun run <entrada>` segue a entrada do package.json", () => {
    const root = dir()
    const d = exigeDeps(comando("bun run check:x"), {
      ...ctxDe(root),
      scripts: { "check:x": "node scripts/entrada-pkg.mjs" },
    })
    expect(d.precisa).toBe(true)
    expect(d.alvo).toBe("package.json scripts.check:x")
  })

  it("binario de dependencia (`vitest`, `tsc`, `prisma`) e `binario`: sem install ele nem existe", () => {
    const root = dir()
    for (const b of ["vitest run", "tsc --noEmit", "prisma generate", "bunx prisma generate"])
      expect(exigeDeps(comando(b), ctxDe(root))).toMatchObject({ grau: "binario", precisa: true })
  })

  it("o `bun install` do proprio job NAO e consumo de dependencia", () => {
    const root = dir()
    expect(exigeDeps(comando("bun install --frozen-lockfile"), ctxDe(root)).precisa).toBe(false)
    expect(exigeDeps(comando("npm ci"), ctxDe(root)).precisa).toBe(false)
  })

  it("fora do escopo DECLARADO: python, ferramenta do sistema, payload inline e pacote de rede", () => {
    const root = dir()
    const casos: [string, string][] = [
      ["python3 scripts/check_crlf.py", "fora-do-node"],
      ["docker compose config", "ferramenta-do-sistema"],
      ["node -e 'console.log(1)'", "payload-inline"],
      ["npx lhci autorun", "resolvido-pela-rede"],
      ["scripts/run-benchmark.mjs", "nome-em-lista"],
    ]
    for (const [texto, categoria] of casos) {
      const d = exigeDeps(comando(texto), ctxDe(root))
      expect(d.precisa, texto).toBe(false)
      expect(d.foraDoEscopo?.categoria ?? "ferramenta-do-sistema", texto).toBe(categoria)
    }
  })

  it("PROVA (regressao): o NOME de arquivo dentro de uma lista nao vira dependencia", () => {
    // O defeito REAL: o `EXPECTED_SCRIPTS=(scripts/geo-benchmark-real.mjs ...)`
    // do job `smoke` — o guard seguia o item da lista como se o job o executasse
    // e acusava `pg` num job que so confere a EXISTENCIA dos arquivos.
    const root = fixture({
      workflows: {},
      arquivos: {
        "scripts/geo-benchmark-real.mjs": 'import pg from "pg"\nexport const p = pg\n',
      },
    })
    const d = exigeDeps(comando("scripts/geo-benchmark-real.mjs"), ctxDe(root))
    expect(d.precisa).toBe(false)
    expect(d.foraDoEscopo?.categoria).toBe("nome-em-lista")
  })
})

// ── o veredito por JOB: install, isencao declarada ou violacao ────────────

const WORKFLOW_BASE = (passos: string) => `name: fixture
on: pull_request
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${passos}
`

describe("o contrato por job", () => {
  it("PROVA: job que roda guard de YAML sem instalar e VIOLACAO (exit 1)", () => {
    const root = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE("      - run: node scripts/le-yaml.mjs"),
      },
      arquivos: {
        "scripts/le-yaml.mjs": 'export function v() {\n  return require("js-yaml")\n}\n',
      },
    })

    const auditoria = auditaForjas(root, { isencoes: [], now: Date.now() })
    expect(auditoria.violacoes).toHaveLength(1)
    expect(auditoria.violacoes[0].job.id).toBe(".github/workflows/pr.yml::guard")
    expect(auditoria.violacoes[0].job.graus).toEqual(["tardio"])

    const { status, saida } = rodaCli(root)
    expect(status).toBe(EXIT.VIOLACAO)
    expect(saida).toContain(".github/workflows/pr.yml::guard")
    expect(saida).toContain("js-yaml")
    expect(saida).toContain("bun install --frozen-lockfile") // o REMEDIO nomeado
  })

  it("o CONTROLE: o MESMO job com `bun install` sai verde (exit 0)", () => {
    const root = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE(
          "      - run: bun install --frozen-lockfile\n      - run: node scripts/le-yaml.mjs",
        ),
      },
      arquivos: {
        "scripts/le-yaml.mjs": 'export function v() {\n  return require("js-yaml")\n}\n',
      },
    })

    expect(auditaForjas(root, { isencoes: [] }).violacoes).toEqual([])
    expect(rodaCli(root).status).toBe(EXIT.OK)
  })

  it("o CONTROLE: job que so roda script node-puro sai verde sem install", () => {
    const root = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE("      - run: node scripts/puro.mjs"),
      },
      arquivos: { "scripts/puro.mjs": "export const ok = 1\n" },
    })

    expect(rodaCli(root).status).toBe(EXIT.OK)
  })

  it("a isencao DECLARADA (com data e motivo) torna o job verde — e a razao aparece no relatorio", () => {
    const root = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE("      - run: node scripts/le-yaml.mjs"),
      },
      arquivos: {
        "scripts/le-yaml.mjs": 'export function v() {\n  return require("js-yaml")\n}\n',
      },
    })
    const isencoes = [
      {
        job: ".github/workflows/pr.yml::guard",
        addedAt: "2026-09-17",
        semDeps: "falha-fechado",
        reason: "fixture: o job depende do node_modules do ambiente",
      },
    ]

    expect(auditaForjas(root, { isencoes }).violacoes).toEqual([])
    expect(rodaCli(root).status).toBe(EXIT.VIOLACAO) // sem a isencao real, segue violacao
  })

  it("FAIL-CLOSED: isencao SEM `addedAt` e violacao nos dois modos", () => {
    const root = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE("      - run: node scripts/le-yaml.mjs"),
      },
      arquivos: {
        "scripts/le-yaml.mjs": 'export function v() {\n  return require("js-yaml")\n}\n',
      },
    })
    const isencoes = [{ job: ".github/workflows/pr.yml::guard", reason: "sem data" }]

    const auditoria = auditaForjas(root, { isencoes })
    expect(auditoria.isencoes.invalid).toHaveLength(1)
    expect(auditoria.isencoes.invalid[0].why).toContain("addedAt")
    expect(rodaCli(root).status).toBe(EXIT.VIOLACAO)
  })

  it("PROVA: a isencao que NAO pode ser verdadeira (`passa` com import de topo) e violacao", () => {
    const root = fixture({
      workflows: { ".github/workflows/pr.yml": WORKFLOW_BASE("      - run: node scripts/db.mjs") },
      arquivos: { "scripts/db.mjs": 'import pg from "pg"\nexport const pool = pg\n' },
    })
    const isencoes = [
      {
        job: ".github/workflows/pr.yml::guard",
        addedAt: "2026-09-17",
        semDeps: "passa",
        reason: "afirmacao falsa: import de TOPO nao tem caminho alternativo",
      },
    ]

    const auditoria = auditaForjas(root, { isencoes })
    expect(auditoria.isencoes.mentirosas).toHaveLength(1)
    expect(auditoria.isencoes.mentirosas[0].motivos[0]).toContain("pg")
    expect(rodaCli(root).status).toBe(EXIT.VIOLACAO)
  })

  it("a MESMA afirmacao `passa` e aceita quando o grau e TARDIO (o caso medido do env-mirror)", () => {
    const root = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE("      - run: node scripts/le-yaml.mjs"),
      },
      arquivos: {
        "scripts/le-yaml.mjs": 'export function v() {\n  return require("js-yaml")\n}\n',
      },
    })
    const isencoes = [
      {
        job: ".github/workflows/pr.yml::guard",
        addedAt: "2026-09-17",
        semDeps: "passa",
        reason: "medido: o comando termina 0 sem node_modules",
      },
    ]

    const auditoria = auditaForjas(root, { isencoes })
    expect(auditoria.isencoes.mentirosas).toEqual([])
    expect(auditoria.violacoes).toEqual([])
  })

  it("PROVA: isencao SEM OBJETO (o job passou a instalar, ou nao exige nada) e violacao", () => {
    const comInstall = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE(
          "      - run: bun install --frozen-lockfile\n      - run: node scripts/le-yaml.mjs",
        ),
      },
      arquivos: {
        "scripts/le-yaml.mjs": 'export function v() {\n  return require("js-yaml")\n}\n',
      },
    })
    const semExigencia = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE("      - run: node scripts/puro.mjs"),
      },
      arquivos: { "scripts/puro.mjs": "export const ok = 1\n" },
    })
    const entrada = {
      job: ".github/workflows/pr.yml::guard",
      addedAt: "2026-09-17",
      semDeps: "falha-fechado",
      reason: "fixture",
    }

    expect(auditaForjas(comInstall, { isencoes: [entrada] }).isencoes.semObjeto).toHaveLength(1)
    expect(auditaForjas(semExigencia, { isencoes: [entrada] }).isencoes.semObjeto).toHaveLength(1)
    // O CLI usa a allowlist do REPOSITORIO — e o job deste fixture nao esta
    // nela (e o arquivo do fixture nem e um dos varridos pelo repositorio): o
    // job instala, entao o veredito e verde. E a declaracao injetada aqui vive
    // na API do modulo, que e como a prova por mutacao mede cada regra.
    expect(rodaCli(comInstall).status).toBe(EXIT.OK)
  })

  it("isencao de um job que NAO existe em nenhum workflow e violacao (a declaracao mente)", () => {
    const root = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE("      - run: node scripts/puro.mjs"),
      },
      arquivos: { "scripts/puro.mjs": "export const ok = 1\n" },
    })
    const auditoria = auditaForjas(root, {
      isencoes: [{ job: ".github/workflows/pr.yml::fantasma", addedAt: "2026-09-17", reason: "x" }],
    })

    expect(auditoria.isencoes.semObjeto).toHaveLength(1)
    expect(auditoria.isencoes.semObjeto[0].motivo).toContain("nao existe")
  })

  it("a janela de revisao: AVISA no run normal e BLOQUEIA no --review", () => {
    const root = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE("      - run: node scripts/le-yaml.mjs"),
      },
      arquivos: {
        "scripts/le-yaml.mjs": 'export function v() {\n  return require("js-yaml")\n}\n',
      },
    })
    const isencoes = [
      {
        job: ".github/workflows/pr.yml::guard",
        addedAt: "2020-01-01",
        semDeps: "falha-fechado",
        reason: "x",
      },
    ]
    const agora = Date.now()

    const normal = auditaForjas(root, { isencoes, now: agora })
    expect(normal.isencoes.aged).toHaveLength(1)
    expect(normal.isencoes.aged[0].days).toBeGreaterThan(JOB_DEPS_REVIEW_DAYS)
    expect(normal.violacoes).toEqual([]) // o run normal nao bloqueia por data

    const review = auditaForjas(root, { isencoes, now: agora })
    expect(review.isencoes.aged).toHaveLength(1) // o --review escala (ver o CLI abaixo)
    expect(rodaCli(root).status).toBe(EXIT.VIOLACAO) // sem a isencao, o job segue violacao
  })

  it("o --review escala a decisao vencida a VIOLACAO (o canal do job semanal)", () => {
    // O fixture precisa da isencao REAL da arvore para o job nao ser violacao por
    // outro motivo: entao ele usa um workflow cujo id esta na allowlist de
    // verdade, com a data reafirmada — e o `--review` de uma data vencida e
    // medido no modulo puro (acima).
    const root = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE("      - run: node scripts/le-yaml.mjs"),
      },
      arquivos: {
        "scripts/le-yaml.mjs": 'export function v() {\n  return require("js-yaml")\n}\n',
      },
    })

    const vencida = rodaCli(root)
    expect(vencida.status).toBe(EXIT.VIOLACAO)
    const semReview = rodaCli(root, ["--json"])
    expect(JSON.parse(semReview.saida.split("\n").slice(0).join("\n")).resumo.violacoes).toBe(1)
  })
})

// ── o escopo: o que o guard NAO julga e contado, nunca escondido ──────────

describe("os comandos fora do escopo do grafo sao CONTADOS (e o YAML ilegivel nao vira 'nada a julgar')", () => {
  it("as categorias saem no `--json` com contagem, e nao geram violacao", () => {
    const root = fixture({
      workflows: {
        ".github/workflows/pr.yml": WORKFLOW_BASE(
          [
            "      - run: docker compose config",
            "      - run: python3 scripts/x.py",
            "      - run: node -e 'console.log(1)'",
          ].join("\n"),
        ),
      },
      arquivos: { "scripts/x.py": "print(1)\n" },
    })

    const { status, saida } = rodaCli(root, ["--json"])
    expect(status).toBe(EXIT.OK)
    const json = JSON.parse(saida)
    expect(json.resumo.violacoes).toBe(0)
    expect(json.resumo.foraDoEscopoPorCategoria["ferramenta-do-sistema"]).toBe(1)
    expect(json.resumo.foraDoEscopoPorCategoria["fora-do-node"]).toBe(1)
    expect(json.resumo.foraDoEscopoPorCategoria["payload-inline"]).toBe(1)
  })

  it("FAIL-CLOSED: workflow com YAML INVALIDO nao vira 'nenhum job exige dependencias' (exit 2)", () => {
    const root = fixture({
      workflows: {
        ".github/workflows/ok.yml": WORKFLOW_BASE("      - run: node scripts/puro.mjs"),
        ".github/workflows/quebrado.yml": "name: x\njobs:\n  a:\n   - run: [isso nao e valido\n",
      },
      arquivos: { "scripts/puro.mjs": "export const ok = 1\n" },
    })

    const { status, saida } = rodaCli(root)
    expect(status).toBe(EXIT.NAOJULGAVEL)
    expect(saida).toContain("NÃO JULGÁVEL")
  })

  it("FAIL-CLOSED: `--root` inexistente e exit 2 (nao um verde sobre nada)", () => {
    const { status } = rodaCli(join(tmpdir(), "jobdeps-nao-existe-9f3a"))
    expect(status).toBe(EXIT.NAOJULGAVEL)
  })
})

// ── as constantes do contrato ────────────────────────────────────────────

describe("as constantes do contrato", () => {
  it("os exit codes sao os da casa (1 violacao, 2 nao julgavel)", () => {
    expect(EXIT).toEqual({ OK: 0, VIOLACAO: 1, NAOJULGAVEL: 2 })
    expect(MAX_PROFUNDIDADE).toBeGreaterThan(0)
    expect(JOB_DEPS_REVIEW_DAYS).toBeGreaterThan(0)
  })

  it("a allowlist REAL do repositorio tem data valida em toda entrada e um `semDeps` conhecido", () => {
    for (const entrada of JOB_DEPS_ALLOWLIST) {
      expect(entrada.job, JSON.stringify(entrada)).toMatch(
        /^(\.github|\.gitea)\/workflows\/.+\.[a-z]+::.+$/,
      )
      expect(entrada.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(["passa", "falha-fechado"]).toContain(entrada.semDeps)
      expect(String(entrada.reason ?? "").length).toBeGreaterThan(20)
    }
  })

  it("a allowlist REAL nao pode ser verdadeira por engano: nada de `passa` onde o grafo tem binario", () => {
    const auditoria = auditaForjas(process.cwd())
    expect(auditoria.isencoes.mentirosas).toEqual([])
    expect(auditoria.isencoes.semObjeto).toEqual([])
    expect(auditoria.isencoes.invalid).toEqual([])
  })
})
