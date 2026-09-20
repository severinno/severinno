/**
 * check-github-dependencies.test.ts
 *
 * O CONTRATO do guard que mede o que o GitHub sustenta no repositório e funciona
 * como CATRACA: nenhuma dependência nova entra sem etapa e substituto escritos, e
 * nenhuma declaração pode envelhecer em silêncio.
 *
 * As metades:
 *
 *  1. A MEDIÇÃO — os `uses:` (com a régua compartilhada, que descarta comentário),
 *     as ocorrências (`ghcr.io`) com o escopo de código que roda — e o PRÓPRIO
 *     auditor de fora dele (a prosa que descreve a classe não é dependência) —,
 *     o `gh` com o escopo dos scripts, e os SERVIÇOS com a regra de presença de
 *     cada um.
 *  2. O CONTRATO — as duas direções da catraca (item novo / declaração
 *     envelhecida; contador a mais / a menos), a classe sem etapa, a classe sem
 *     substituto, e a divergência entre a lista de classes do guard e o dado.
 *  3. O REAL — a árvore deste repositório: o inventário declarado confere com o
 *     medido (o guard verde hoje) e os 7 serviços declarados existem de verdade.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-github-dependencies.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CLASSES,
  ROOT,
  SERVICOS,
  chamaGh,
  contarOcorrencias,
  inventario,
  lerDeclaracao,
  usosDosWorkflows,
  violacoesDeGitHub,
} from "../../../scripts/check-github-dependencies.mjs"

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
})

/** Um repo git real (as varreduras por ocorrência partem de `git ls-files`). */
function repoFixture(arquivos: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ghtest-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, conteudo, "utf8")
  }
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: dir })
  return dir
}

const WORKFLOW_BASE = [
  "name: fixtura",
  "on:",
  "  schedule:",
  '    - cron: "0 3 * * 0"',
  "jobs:",
  "  a:",
  "    runs-on: self-hosted",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - uses: ./.github/workflows/reuso.yml",
  "      # - uses: actions/github-script@v7   <- COMENTADO: não é dependência",
  "      - run: echo ok",
].join("\n")

// ── a medição ───────────────────────────────────────────────────────────────

describe("a medição das classes", () => {
  it("os `uses:` separam terceiro de reusável local, e comentário não conta", () => {
    const dir = repoFixture({
      ".github/workflows/a.yml": WORKFLOW_BASE,
      ".github/workflows/reuso.yml": "name: reuso\non: workflow_call\n",
    })
    const { terceiros, locais } = usosDosWorkflows(dir)
    expect(terceiros).toEqual(["actions/checkout@v4"])
    expect(locais).toEqual(["./.github/workflows/reuso.yml"])
  })

  it("o cron é lido com a expressão INTEIRA (os espaços fazem parte dela)", () => {
    const dir = repoFixture({ ".github/workflows/a.yml": WORKFLOW_BASE })
    const classe = CLASSES.find((c) => c.id === "crons") as { medir: (r: string) => string[] }
    expect(classe.medir(dir)).toEqual([".github/workflows/a.yml#0 3 * * 0"])
  })

  it("a contagem de `ghcr.io` fica no CÓDIGO QUE RODA: docs, testes e provas ficam fora", () => {
    const dir = repoFixture({
      "deploy/compose.yml": "image: ghcr.io/x/y\n",
      Dockerfile: "FROM ghcr.io/x/y\n",
      "docs/guia.md": "puxe de ghcr.io/x/y\n",
      "src/lib/__tests__/t.test.ts": 'const s = "ghcr.io/x/y"\n',
      "scripts/test-mutation-z.sh": 'padrao="ghcr.io/x/y"\n',
    })
    // As duas de código contam (compose + Dockerfile); doc, teste e payload não.
    expect(contarOcorrencias(dir, /ghcr\.io\//g)).toBe(2)
  })

  it("o PRÓPRIO auditor não conta a si mesmo (a prosa dele DESCREVE a classe)", () => {
    // O defeito que a execução revelou: o cabeçalho do guard e o `porque` da
    // declaração CITAM o padrão para explicar a classe — e contá-los subia o
    // medido de 50 para 52 no próprio commit que declarou a classe (o auditor
    // inflando a si mesmo ao se documentar). O `--update` para 52 congelaria a
    // inflação numa catraca que só pode ANDAR PARA BAIXO: o número mede o
    // repositório, e documentar a classe é editar doc, não introduzir
    // dependência. Sem a exclusão este fixture mede 3 — e o repositório real
    // reprova com "(2 a mais)".
    const dir = repoFixture({
      "deploy/compose.yml": "image: ghcr.io/x/y\n",
      "scripts/check-github-dependencies.mjs":
        "//   ghcr-images        — as referencias a `ghcr.io/` versionados\n",
      "ci/github-dependencies.json":
        '{ "id": "ghcr-images", "porque": "Referencias a `ghcr.io/` em codigo" }\n',
    })
    expect(contarOcorrencias(dir, /ghcr\.io\//g)).toBe(1)
  })

  it("o `gh` só conta em script que EXECUTA, e não confunde `gist`/`length`", () => {
    const dir = repoFixture({
      "scripts/fala.mjs": "await run('gh api /repos/x')\n",
      "scripts/nao-fala.mjs": "// gh api (comentário)\nconst gist = 1\nconst length = 2\n",
      "src/lib/__tests__/dubla.test.ts": "stub('gh api /x')\n",
    })
    expect(chamaGh(dir, "scripts/fala.mjs")).toBe(true)
    expect(chamaGh(dir, "scripts/nao-fala.mjs")).toBe(false)
    // Fora de scripts/ e dos hooks não é a dependência do repositório.
    expect(chamaGh(dir, "src/lib/__tests__/dubla.test.ts")).toBe(false)
  })

  it("os serviços têm regra de PRESENÇA própria (e o real bate com o declarado)", () => {
    const dir = repoFixture({
      ".github/workflows/a.yml": WORKFLOW_BASE,
      ".github/workflows/b.yml":
        "jobs:\n  x:\n    steps:\n      - uses: actions/github-script@v7\n",
      ".github/dependabot.yml": "version: 2\n",
      "scripts/benchmark-gist.mjs": "export const x = 1\n",
    })
    const presentes = SERVICOS.filter((s) => s.presente(dir)).map((s) => s.id)
    expect(presentes).toEqual(["dependabot", "github-script", "self-hosted-runner", "gist"])
    // No repositório REAL, os sete declarados existem de verdade.
    const declarado = lerDeclaracao(ROOT)
    const reais = SERVICOS.filter((s) => s.presente(ROOT))
      .map((s) => s.id)
      .sort()
    const servicos = (declarado.classes ?? []).find((c) => c.id === "github-services")
    // Conjunto, não sequência: a ORDEM de uma lista declarada é decisão de quem
    // a escreveu (o guard compara por presença — `novos`/`sumidos`).
    const lista = servicos?.declarado
    expect(Array.isArray(lista)).toBe(true)
    const declaradosServicos = (Array.isArray(lista) ? [...lista] : []).sort()
    expect(declaradosServicos).toEqual(reais)
  })
})

// ── o contrato (a catraca) ─────────────────────────────────────────────────

describe("violacoesDeGitHub — a catraca nos dois sentidos", () => {
  const classeBase = {
    id: "workflows",
    titulo: "workflows do GitHub",
    kind: "lista",
    unidade: "arquivo",
    papel: "p",
    estagio: 5,
    substituto: "as pipelines da forja",
    porque: "porque sim",
  }

  /** Um inventário sintético: as classes de código + a declaração passada. */
  function inv(over: Record<string, unknown>, declarado: Record<string, unknown> = {}) {
    return {
      estagios: [{ id: 5, titulo: "t", entrega: "e" }],
      faltando: [],
      classes: [
        {
          ...classeBase,
          medido: [".github/workflows/a.yml"],
          declarado: [".github/workflows/a.yml"],
          ...declarado,
          ...over,
        },
      ],
    }
  }

  it("item NOVO numa lista é violação, e ela NOMEIA o item", () => {
    const v = violacoesDeGitHub(
      inv({ medido: [".github/workflows/a.yml", ".github/workflows/novo.yml"] }) as never,
    )
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("dependencia NOVA do GitHub — .github/workflows/novo.yml")
  })

  it("item declarado que SUMIU é declaração envelhecida (o corte não pode ficar invisível)", () => {
    const v = violacoesDeGitHub(inv({ medido: [] }) as never)
    expect(v[0]).toContain("declaracao ENVELHECIDA")
  })

  it("contador: medido a mais é dependência nova, a menos é declaração envelhecida", () => {
    const base = { ...classeBase, kind: "contador" as const, medido: 10, declarado: 10 }
    expect(violacoesDeGitHub(inv(base) as never)).toEqual([])
    expect(violacoesDeGitHub(inv({ ...base, medido: 11 }) as never)[0]).toContain("1 a mais")
    expect(violacoesDeGitHub(inv({ ...base, medido: 9 }) as never)[0]).toContain(
      "declaracao ENVELHECIDA",
    )
  })

  it("contador declarado NÃO numérico é violação própria (NaN não é 'sem dependência')", () => {
    // Sem esta metade, `Number.isInteger` some e as DUAS comparações ficam
    // falsas (NaN não é maior nem menor que nada): a classe inteira passa a ser
    // julgada por um valor que ninguém escreveu. A violação tem de NOMEAR o
    // valor inválido — é ele que quem lê precisa ver para corrigir a declaração.
    const base = { ...classeBase, kind: "contador" as const, medido: 10 }
    const v = violacoesDeGitHub(inv({ ...base, declarado: "muitos" }) as never)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("contador declarado invalido (muitos)")
  })

  it("classe sem ETAPA e classe sem SUBSTITUTO são violações próprias", () => {
    const semEtapa = violacoesDeGitHub(inv({ estagio: 99 }) as never)
    expect(semEtapa[0]).toContain("sem ETAPA do corte")
    const semSubstituto = violacoesDeGitHub(inv({ substituto: "   " }) as never)
    expect(semSubstituto[0]).toContain("sem SUBSTITUTO declarado")
  })

  it("a lista de classes do guard e o dado versionado não podem divergir", () => {
    const v = violacoesDeGitHub({ ...inv({}), faltando: ["crons"] } as never)
    expect(v[0]).toContain("classe 'crons': declarada e medida de forma DIVERGENTE")
  })
})

// ── o real ─────────────────────────────────────────────────────────────────

describe("o inventario REAL deste repositorio", () => {
  it("confere com o medido (o guard verde hoje) e cobre as 8 classes", () => {
    const i = inventario({ root: ROOT })
    expect(violacoesDeGitHub(i)).toEqual([])
    expect(i.classes.map((c) => c.id).sort()).toEqual(CLASSES.map((c) => c.id).sort())
  })

  it("o dado versionado é FAIL-CLOSED: ausente e ilegível LANÇAM (o CLI sai 2, não um veredito)", () => {
    // A ausência/ilegibilidade NÃO pode virar "nada declarado": sem esta
    // metade, um dado que não foi lido passa a valer como veredito — e o
    // `--update` (que lê antes de escrever) gravaria por cima do que não leu.
    const semDado = mkdtempSync(join(tmpdir(), "ghtest-"))
    tmpDirs.push(semDado)
    expect(() => lerDeclaracao(semDado)).toThrow(/nao existe/)

    const quebrado = mkdtempSync(join(tmpdir(), "ghtest-"))
    tmpDirs.push(quebrado)
    mkdirSync(join(quebrado, "ci"), { recursive: true })
    writeFileSync(join(quebrado, "ci", "github-dependencies.json"), '{ "version": 1, "classes": [')
    expect(() => lerDeclaracao(quebrado)).toThrow(/nao e JSON valido/)
  })

  it("toda classe declara etapa válida e substituto escrito", () => {
    for (const c of inventario({ root: ROOT }).classes) {
      expect(typeof c.estagio).toBe("number")
      expect(typeof c.substituto).toBe("string")
      expect((c.substituto ?? "").trim().length).toBeGreaterThan(30)
      expect((c.porque ?? "").trim().length).toBeGreaterThan(30)
    }
  })
})
