/**
 * check-archived-pipeline.test.ts
 *
 * A prova do guard `scripts/check-archived-pipeline.mjs`: as CONDIÇÕES
 * (`when:`/`branch:`/`event:`) de cada passo do retrato arquivado
 * (`.woodpecker.yml`) têm de ser as que a forja DONA DO MERGE (`.gitea/workflows/`)
 * aplica ao trabalho daquele passo.
 *
 * A suíte existe porque a régua tem DUAS metades que podem mentir em silêncio:
 *   - o retrato pode declarar uma condição que a forja não usa (a classe que
 *     motivou o guard: um retrato que diz "roda no PR" onde a forja só roda no
 *     push);
 *   - o casamento pode errar de CONTRAparte (o mesmo comando em dois jobs, um
 *     marcador apontando para o job que faz outro trabalho) e a comparação
 *     virar um verde sobre o job errado.
 *
 * Cada classe tem o seu CONTROLE na direção oposta (o MESMO fixture, sem o
 * defeito, sai verde) — é o que desmente um não-zero que veio do fixture
 * (package.json ausente, diretório errado, arquivo vazio) e não da régua.
 *
 * Usage:
 *   bunx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-archived-pipeline.test.ts
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { afterAll, describe, expect, it } from "vitest"
import {
  EVENTO_FORJA_PARA_RETRATO,
  EVENTO_RETRATO_PARA_FORJA,
  FORJA_DIR,
  RETRATO_REL,
  avaliaTermo,
  chavesDaCondicao,
  clausulasDoOn,
  clausulasDoWhen,
  condicaoDoJob,
  julgaRetrato,
  lerRetrato,
  rotulosDeTexto,
  textoDaCondicao,
} from "../../../scripts/check-archived-pipeline.mjs"
import { EXIT_UNJUDGEABLE } from "../../../scripts/forge-workflows.mjs"

const GUARD = join(process.cwd(), "scripts", "check-archived-pipeline.mjs")

const fixtures: string[] = []
afterAll(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Spec {
  retrato?: string
  workflows?: Record<string, string>
  scripts?: Record<string, string>
}

/** Escreve um repositório sintético e devolve a raiz. */
function fixture(spec: Spec): string {
  const root = mkdtempSync(join(tmpdir(), "archived-pipeline-"))
  fixtures.push(root)
  if (spec.retrato !== undefined) {
    writeFileSync(join(root, RETRATO_REL), spec.retrato)
  }
  for (const [nome, texto] of Object.entries(spec.workflows ?? {})) {
    const abs = join(root, FORJA_DIR, nome)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, texto)
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", scripts: spec.scripts ?? {} }, null, 2),
  )
  return root
}

/** O exit code do CLI (o que os pipelines leem). */
function roda(root: string): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [GUARD, "--root", root], { encoding: "utf8" })
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" }
}

const CI = `name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
jobs:
  guards:
    name: Repo Guards
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-alpha.mjs
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - run: bun run lint
  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - run: bun run build
`

/** O retrato mínimo saudável: um passo casado por comando e um por marcador. */
const RETRATO_OK = `pipeline:
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
  publica:
    image: plugins/docker
    # espelha: ${FORJA_DIR}/ci.yml#build
    settings:
      repo: alguem/algo
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
`

describe("a tradução retrato → forja", () => {
  it("é uma tabela DECLARADA, e a volta dela existe para a mensagem", () => {
    expect(EVENTO_RETRATO_PARA_FORJA).toEqual({
      push: "push",
      pull_request: "pull_request",
      cron: "schedule",
      manual: "workflow_dispatch",
    })
    expect(EVENTO_FORJA_PARA_RETRATO.schedule).toBe("cron")
    expect(EVENTO_FORJA_PARA_RETRATO.workflow_dispatch).toBe("manual")
  })

  it("o `when` é uma LISTA de cláusulas (qualquer entrada que case dispara)", () => {
    const r = clausulasDoWhen(
      [
        { event: "push", branch: ["main", "develop"] },
        { event: "pull_request", branch: "main" },
      ],
      {
        arquivo: RETRATO_REL,
        linha: 1,
        onde: "fixture",
      },
    )
    expect(r.violacoes).toEqual([])
    expect(chavesDaCondicao(r.clausulas)).toEqual(["pull_request@[main]", "push@[develop,main]"])
  })

  it("o mapa único também vale (a forma curta do Woodpecker)", () => {
    const r = clausulasDoWhen(
      { event: "cron" },
      { arquivo: RETRATO_REL, linha: 1, onde: "fixture" },
    )
    expect(r.clausulas).toEqual([{ evento: "schedule" }])
  })

  it("`event` como lista abre uma cláusula por evento, cada uma com o mesmo branch", () => {
    const r = clausulasDoWhen([{ event: ["push", "pull_request"], branch: "main" }], {
      arquivo: RETRATO_REL,
      linha: 1,
      onde: "fixture",
    })
    expect(chavesDaCondicao(r.clausulas)).toEqual(["pull_request@[main]", "push@[main]"])
  })

  it("evento sem tradução é VIOLAÇÃO nomeada (não é condição presumida)", () => {
    const r = clausulasDoWhen([{ event: "tag" }], {
      arquivo: RETRATO_REL,
      linha: 3,
      onde: "fixture",
    })
    expect(r.clausulas).toEqual([])
    expect(r.violacoes.join("\n")).toContain("evento `tag` do retrato não tem tradução declarada")
  })

  it("`branch:` num evento que a forja não filtra por branch é VIOLAÇÃO", () => {
    const r = clausulasDoWhen([{ event: "cron", branch: "main" }], {
      arquivo: RETRATO_REL,
      linha: 3,
      onde: "fixture",
    })
    expect(r.violacoes.join("\n")).toContain("não tem filtro de branch")
  })

  it("chave desconhecida no `when` é VIOLAÇÃO (o guard não julga o que não leu)", () => {
    const r = clausulasDoWhen([{ event: "push", path: "docs/**" }], {
      arquivo: RETRATO_REL,
      linha: 3,
      onde: "fixture",
    })
    expect(r.violacoes.join("\n")).toContain("sem tradução declarada para a forja")
    expect(r.violacoes.join("\n")).toContain("`path:`")
  })

  it("`status:` não é descartado: sai à parte, para quem o carrega se declarar fora da forja", () => {
    const r = clausulasDoWhen([{ status: ["failure", "success"] }], {
      arquivo: RETRATO_REL,
      linha: 3,
      onde: "fixture",
    })
    expect(r.clausulas).toEqual([])
    expect(r.status).toEqual(["failure", "success"])
    expect(r.violacoes).toEqual([])
  })
})

describe("a condição derivada da forja", () => {
  it("cada gatilho vira uma cláusula, com o filtro de `branches:`", () => {
    const on = { push: { branches: ["main", "develop"] }, pull_request: { branches: ["main"] } }
    const r = clausulasDoOn(on, { arquivo: "ci.yml", linha: 2 })
    expect(chavesDaCondicao(r.clausulas)).toEqual(["pull_request@[main]", "push@[develop,main]"])
    expect(r.violacoes).toEqual([])
  })

  it("`schedule` e `workflow_dispatch` não têm branch", () => {
    const r = clausulasDoOn(
      { schedule: [{ cron: "41 6 * * 1" }], workflow_dispatch: null },
      {
        arquivo: "drift.yml",
        linha: 2,
      },
    )
    expect(chavesDaCondicao(r.clausulas)).toEqual(["schedule", "workflow_dispatch"])
  })

  it("evento da forja sem tradução é VIOLAÇÃO nomeada", () => {
    const r = clausulasDoOn({ release: { types: ["published"] } }, { arquivo: "x.yml", linha: 2 })
    expect(r.violacoes.join("\n")).toContain("evento `release:` sem tradução declarada")
  })

  it("o `if:` do job ESTREITA as cláusulas — e é isso que a contraparte prova", () => {
    const base = clausulasDoOn(
      { push: { branches: ["main", "develop"] }, pull_request: { branches: ["main"] } },
      {
        arquivo: "ci.yml",
        linha: 2,
      },
    ).clausulas
    const r = condicaoDoJob(base, "github.ref == 'refs/heads/main' && github.event_name == 'push'")
    expect(r.indecidivel).toBeNull()
    expect(chavesDaCondicao(r.clausulas)).toEqual(["push@[main]"])
  })

  it("o `||` com `workflow_dispatch` mantém as duas metades (o `if:` real do deploy.yml)", () => {
    const base = clausulasDoOn(
      { push: { branches: ["main"] }, workflow_dispatch: null },
      {
        arquivo: "deploy.yml",
        linha: 2,
      },
    ).clausulas
    const r = condicaoDoJob(
      base,
      "github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'",
    )
    expect(chavesDaCondicao(r.clausulas)).toEqual(["push@[main]", "workflow_dispatch"])
  })

  it("um `if:` fora da gramática NÃO é adivinhado: a condição sai indecidível", () => {
    const base = clausulasDoOn(
      { push: { branches: ["main"] } },
      { arquivo: "ci.yml", linha: 2 },
    ).clausulas
    const r = condicaoDoJob(base, "startsWith(github.ref, 'refs/tags/')")
    expect(r.indecidivel).toContain("não é decidível")
    expect(r.clausulas).toEqual([])
  })

  it("o branch sem filtro (`null`) torna um termo de `ref` INDECIDÍVEL, nunca falso", () => {
    const pushMain = { evento: "push", ramo: "main" }
    const semFiltro = { evento: "push", ramo: null }
    expect(avaliaTermo("github.event_name == 'push'", pushMain)).toBe(true)
    expect(avaliaTermo("github.event_name == 'pull_request'", pushMain)).toBe(false)
    expect(avaliaTermo("github.ref == 'refs/heads/main'", pushMain)).toBe(true)
    expect(avaliaTermo("github.ref == 'refs/heads/develop'", pushMain)).toBe(false)
    expect(avaliaTermo("github.ref != 'refs/heads/develop'", pushMain)).toBe(true)
    expect(
      avaliaTermo("github.event_name == 'workflow_dispatch'", {
        evento: "workflow_dispatch",
        ramo: null,
      }),
    ).toBe(true)
    expect(avaliaTermo("github.ref == 'refs/heads/main'", semFiltro)).toBeUndefined()
    expect(avaliaTermo("startsWith(github.ref, 'refs/tags/')", pushMain)).toBeUndefined()
  })
})

describe("o casamento por comando (descoberta, não lista à mão)", () => {
  it("uma entrada do package.json que resolve para UMA invocação vale pela invocação", () => {
    const r = rotulosDeTexto("bun run check:alpha", {
      "check:alpha": "node scripts/check-alpha.mjs",
    })
    expect([...r]).toEqual(["scripts/check-alpha.mjs"])
  })

  it("uma entrada que é uma CADEIA de shell vale por si mesma (o rótulo não some)", () => {
    const r = rotulosDeTexto("bun run lint", {
      lint: "prettier --check . && eslint . --max-warnings 0",
    })
    expect([...r]).toEqual(["bun run lint"])
  })

  it("`bun run typecheck` casa com o `tsc --noEmit` que ele roda", () => {
    const r = rotulosDeTexto("bun run typecheck", {
      typecheck: "NODE_OPTIONS=--max-old-space-size=4096 tsc --noEmit",
    })
    expect([...r]).toEqual(["tsc --noEmit"])
    expect([...rotulosDeTexto("bunx tsc --noEmit", {})]).toEqual(["tsc --noEmit"])
  })

  it("o mesmo comando em dois jobs de MESMA sobreposição é AMBÍGUO e exige `# espelha:`", () => {
    const root = fixture({
      retrato: `pipeline:
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: [main, develop]
`,
      workflows: {
        "ci.yml": CI,
        "manual.yml": `name: Manual
on:
  workflow_dispatch:
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-alpha.mjs
`,
      },
      scripts: { "check:alpha": "node scripts/check-alpha.mjs" },
    })
    const r = julgaRetrato(root)
    expect(r.violacoes.join("\n")).toContain("ambíguo: declare a contraparte com `# espelha:`")
    expect(roda(root).code).toBe(1)
  })

  it("CONTROLE: com o `# espelha:` declarado, o mesmo fixture sai provado", () => {
    const root = fixture({
      retrato: `pipeline:
  alpha:
    image: oven/bun:1.3.14
    # espelha: ${FORJA_DIR}/ci.yml#guards
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
`,
      workflows: {
        "ci.yml": CI,
        "manual.yml": `name: Manual
on:
  workflow_dispatch:
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-alpha.mjs
`,
      },
      scripts: { "check:alpha": "node scripts/check-alpha.mjs" },
    })
    const r = julgaRetrato(root)
    expect(r.violacoes).toEqual([])
    expect(r.provados.map((p: any) => p.contraparte)).toEqual([`${FORJA_DIR}/ci.yml#guards`])
    expect(roda(root).code).toBe(0)
  })

  it("o fixture saudável é PROVADO nas duas formas de contraparte (comando e marcador)", () => {
    const root = fixture({
      retrato: RETRATO_OK,
      workflows: { "ci.yml": CI },
      scripts: { "check:alpha": "node scripts/check-alpha.mjs" },
    })
    const r = julgaRetrato(root)
    expect(r.violacoes).toEqual([])
    expect(r.provados).toHaveLength(2)
    expect(r.provados.map((p: any) => p.contraparte).sort()).toEqual([
      `${FORJA_DIR}/ci.yml#build`,
      `${FORJA_DIR}/ci.yml#guards`,
    ])
    expect(roda(root).code).toBe(0)
  })
})

describe("as classes de mentira que o guard converte em vermelho", () => {
  const comRetrato = (corpo: string) =>
    fixture({
      retrato: corpo,
      workflows: { "ci.yml": CI },
      scripts: { "check:alpha": "node scripts/check-alpha.mjs" },
    })

  it("passo SEM `when:` é violação (o silêncio vira promessa que ninguém conferiu)", () => {
    const root = comRetrato(`pipeline:
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
`)
    const r = julgaRetrato(root)
    expect(r.violacoes.join("\n")).toContain("NÃO declara `when:`")
    expect(roda(root).code).toBe(1)
  })

  it("condição DIVERGENTE: o retrato diz push@main, a forja roda push@[main, develop]", () => {
    const root = comRetrato(`pipeline:
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: main
`)
    const r = julgaRetrato(root)
    const msg = r.violacoes.join("\n")
    expect(msg).toContain("o retrato declara push@[main]")
    expect(msg).toContain("pull_request@[main] ∪ push@[develop, main]")
    expect(msg).toContain("mente sobre QUANDO este passo roda")
  })

  it("o `if:` da forja é load-bearing: a mesma declaração passa e reprova conforme o job", () => {
    const retrato = `pipeline:
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: main
`
    const estreitado = `name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
jobs:
  guards:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - run: node scripts/check-alpha.mjs
`
    const ok = fixture({
      retrato,
      workflows: { "ci.yml": estreitado },
      scripts: { "check:alpha": "node scripts/check-alpha.mjs" },
    })
    expect(julgaRetrato(ok).violacoes).toEqual([])
    expect(roda(ok).code).toBe(0)

    const reprovado = fixture({
      retrato,
      workflows: { "ci.yml": CI },
      scripts: { "check:alpha": "node scripts/check-alpha.mjs" },
    })
    expect(roda(reprovado).code).toBe(1)
  })

  it("passo sem contraparte é violação que ENSINA a declarar", () => {
    const root = comRetrato(`pipeline:
  orfao:
    image: oven/bun:1.3.14
    commands:
      - node scripts/check-fantasma.mjs
    when:
      - event: push
        branch: main
`)
    const r = julgaRetrato(root)
    expect(r.violacoes.join("\n")).toContain("sem contraparte na forja")
    expect(r.violacoes.join("\n")).toContain("# espelha:")
    expect(r.violacoes.join("\n")).toContain("# fora da forja: <motivo>")
  })

  it("marcador com arquivo INEXISTENTE é violação (o typo vira passo que nunca é julgado)", () => {
    const root = comRetrato(`pipeline:
  alpha:
    image: oven/bun:1.3.14
    # espelha: ${FORJA_DIR}/ci-nao-existe.yml#guards
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: main
`)
    expect(julgaRetrato(root).violacoes.join("\n")).toContain(
      "aponta para um arquivo que NÃO existe",
    )
  })

  it("marcador com job INEXISTENTE é violação e nomeia os jobs que existem", () => {
    const root = comRetrato(`pipeline:
  alpha:
    image: oven/bun:1.3.14
    # espelha: ${FORJA_DIR}/ci.yml#guardas
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: main
`)
    const msg = julgaRetrato(root).violacoes.join("\n")
    expect(msg).toContain("aponta para um job que NÃO existe")
    expect(msg).toContain("guards, lint")
  })

  it("marcador apontando para o job que faz OUTRO trabalho é violação", () => {
    const root = comRetrato(`pipeline:
  alpha:
    image: oven/bun:1.3.14
    # espelha: ${FORJA_DIR}/ci.yml#lint
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
`)
    expect(julgaRetrato(root).violacoes.join("\n")).toContain("não roda nenhum comando deste passo")
  })

  it("`# fora da forja:` sem motivo é violação", () => {
    const root = comRetrato(`pipeline:
  telegram:
    image: plugins/telegram
    # fora da forja:
    when:
      - event: push
        branch: main
`)
    expect(julgaRetrato(root).violacoes.join("\n")).toContain("sem motivo escrito")
  })

  it("CONTROLE: `# fora da forja:` com motivo e sem comando casado é aceito e NOMEADO", () => {
    const root = comRetrato(`pipeline:
  telegram:
    image: plugins/telegram
    # fora da forja: a forja não publica notificação em passo de pipeline.
    when:
      - event: push
        branch: main
`)
    const r = julgaRetrato(root)
    expect(r.violacoes).toEqual([])
    expect(r.foraDaForja).toHaveLength(1)
    const cli = roda(root)
    expect(cli.code).toBe(0)
    expect(cli.out).toContain("fora da forja")
  })

  it("declarar-se fora da forja quando a forja RODA o comando é violação (o disco contradiz)", () => {
    const root = comRetrato(`pipeline:
  alpha:
    image: oven/bun:1.3.14
    # fora da forja: não tenho contraparte.
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: main
`)
    expect(julgaRetrato(root).violacoes.join("\n")).toContain("contradita pelo disco")
  })

  it("`when` por `status:` sem declaração de ausência é violação de contraparte inexistente", () => {
    const root = comRetrato(`pipeline:
  telegram:
    image: plugins/telegram
    when:
      status: [failure, success]
`)
    expect(julgaRetrato(root).violacoes.join("\n")).toContain("não tem passo de status")
  })

  it("`when` nos DOIS níveis (pipeline e passo) é violação: o guard não combina os dois", () => {
    const root = comRetrato(`pipeline:
  when:
    - event: push
      branch: main
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: main
`)
    expect(julgaRetrato(root).violacoes.join("\n")).toContain("tem `when` no passo E no pipeline")
  })

  it("chave de topo que não é pipeline nem declaração conhecida é violação", () => {
    const root = comRetrato(`pipeline:
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: main
coisa-estranha:
  qualquer: valor
`)
    expect(julgaRetrato(root).violacoes.join("\n")).toContain("não parece pipeline")
    expect(julgaRetrato(root).violacoes.join("\n")).toContain("nem é declaração conhecida")
  })
})

describe("o fail-closed: 'não consegui ler' nunca é 'nada a julgar'", () => {
  it("retrato AUSENTE sai 2 nomeando o arquivo que falta", () => {
    const root = fixture({ workflows: { "ci.yml": CI } })
    const r = roda(root)
    expect(r.code).toBe(EXIT_UNJUDGEABLE)
    expect(r.err).toContain("não existe")
  })

  it("retrato com YAML INVÁLIDO sai 2 (um arquivo que não faz parsing não é lido por gate nenhum)", () => {
    const root = fixture({
      retrato: "pipeline:\n  alpha:\n   commands:\n  - [isso\n",
      workflows: { "ci.yml": CI },
    })
    const r = roda(root)
    expect(r.code).toBe(EXIT_UNJUDGEABLE)
    expect(r.err).toContain("YAML INVALIDO")
  })

  it("workflow da forja com YAML inválido sai 2 nomeando o workflow", () => {
    const root = fixture({
      retrato: RETRATO_OK,
      workflows: { "ci.yml": "on:\n  push:\n   branches: [main\n" },
      scripts: {},
    })
    const r = roda(root)
    expect(r.code).toBe(EXIT_UNJUDGEABLE)
    expect(r.err).toContain(`${FORJA_DIR}/ci.yml`)
  })

  it("contraparte com `if:` fora da gramática sai 2 e mostra a EXPRESSÃO", () => {
    const root = fixture({
      retrato: `pipeline:
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: main
`,
      workflows: {
        "ci.yml": `name: CI
on:
  push:
    branches: [main]
jobs:
  guards:
    runs-on: ubuntu-latest
    if: failure()
    steps:
      - run: node scripts/check-alpha.mjs
`,
      },
      scripts: { "check:alpha": "node scripts/check-alpha.mjs" },
    })
    const r = roda(root)
    expect(r.code).toBe(EXIT_UNJUDGEABLE)
    expect(r.err).toContain("failure()")
    expect(r.err).toContain("não é decidível")
  })

  it("CONTROLE: o `if:` que o guard ENTENDE não vira `2`", () => {
    const root = fixture({
      retrato: `pipeline:
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: main
`,
      workflows: {
        "ci.yml": `name: CI
on:
  push:
    branches: [main, develop]
jobs:
  guards:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - run: node scripts/check-alpha.mjs
`,
      },
      scripts: { "check:alpha": "node scripts/check-alpha.mjs" },
    })
    expect(julgaRetrato(root).naoJulgaveis).toEqual([])
    expect(roda(root).code).toBe(0)
  })
})

describe("o repositório REAL", () => {
  it("o `.woodpecker.yml` declara a condição de todos os passos, e ela é a da forja", () => {
    const r = julgaRetrato(process.cwd())
    expect(r.naoJulgaveis).toEqual([])
    expect(r.violacoes).toEqual([])
    expect(r.passos.length).toBeGreaterThanOrEqual(15)
    expect(r.provados.length + r.foraDaForja.length).toBe(r.passos.length)
    // as contrapartes são jobs reais da forja, derivadas de `.gitea/workflows/`
    for (const p of r.provados) {
      expect(p.contraparte.startsWith(`${FORJA_DIR}/`)).toBe(true)
    }
  })

  it("o passo de notificação está NOMEADO como fora da forja (não some do veredito)", () => {
    const r = julgaRetrato(process.cwd())
    expect(r.foraDaForja.map((f: any) => `${f.passo.pipeline}.${f.passo.nome}`)).toContain(
      "notify.telegram",
    )
  })

  it("o CLI sai 0 no repositório real e imprime passo → contraparte → condição", () => {
    const r = spawnSync(process.execPath, [GUARD], { encoding: "utf8", cwd: process.cwd() })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("retrato arquivado")
    expect(r.stdout).toContain("deploy.deploy-vps → .gitea/workflows/deploy.yml#deploy")
  })

  it("MUTAÇÃO por fixture: trocar SÓ o `on:` da forja derruba o retrato real", () => {
    const real = readFileSync(join(process.cwd(), RETRATO_REL), "utf8")
    const ci = readFileSync(join(process.cwd(), FORJA_DIR, "ci.yml"), "utf8")
    const scripts = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).scripts
    const root = fixture({
      retrato: real,
      workflows: { "ci.yml": ci.replace("branches: [main, develop]", "branches: [main]") },
      scripts,
    })
    const r = julgaRetrato(root)
    expect(r.violacoes.length).toBeGreaterThan(0)
    expect(r.violacoes.join("\n")).toContain("mente sobre QUANDO este passo roda")
    expect(roda(root).code).toBe(1)
  })

  it("`--tabela` imprime a prova inteira (o que o log do CI mostra)", () => {
    const r = spawnSync(process.execPath, [GUARD, "--tabela"], {
      encoding: "utf8",
      cwd: process.cwd(),
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("pipeline.lint → .gitea/workflows/ci.yml#lint")
  })

  it("`--help` sai 0 sem julgar nada", () => {
    const r = spawnSync(process.execPath, [GUARD, "--help"], {
      encoding: "utf8",
      cwd: process.cwd(),
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Exit codes")
  })
})

describe("a leitura do retrato não engole pipeline", () => {
  it("um pipeline novo com passos entra na conta (não some por não estar numa lista)", () => {
    const root = fixture({
      retrato: `pipeline:
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
novo:
  beta:
    image: oven/bun:1.3.14
    commands:
      - node scripts/check-beta.mjs
    when:
      - event: push
        branch: [main, develop]
      - event: pull_request
        branch: main
`,
      workflows: {
        "ci.yml": `${CI}  beta:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-beta.mjs
`,
      },
      scripts: { "check:alpha": "node scripts/check-alpha.mjs" },
    })
    const lido = lerRetrato(root)
    expect(lido.pipelines).toEqual(["pipeline", "novo"])
    expect(lido.passos).toHaveLength(2)
    expect(julgaRetrato(root).violacoes).toEqual([])
  })

  it("as linhas do diagnóstico apontam para a chave do passo", () => {
    const root = fixture({
      retrato: `pipeline:
  alpha:
    image: oven/bun:1.3.14
    commands:
      - bun run check:alpha
`,
      workflows: { "ci.yml": CI },
      scripts: { "check:alpha": "node scripts/check-alpha.mjs" },
    })
    const r = julgaRetrato(root)
    expect(r.violacoes[0]).toContain(`${RETRATO_REL}:2`)
    expect(r.violacoes[0]).toContain("`alpha`")
  })

  it("`textoDaCondicao` escreve a lista vazia como o passo que NUNCA roda", () => {
    expect(textoDaCondicao([])).toContain("NUNCA roda")
    expect(textoDaCondicao([{ evento: "push", ramos: ["main", "develop"] }])).toBe(
      "push@[develop, main]",
    )
  })
})
