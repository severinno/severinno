// =============================================================================
// workflow-yaml-guards-cobertura.test.ts
//
// A PROVA DE COBERTURA dos OUTROS guards que leem YAML de workflow — a MESMA
// doutrina de `check-pipefail-sigpipe-cobertura.test.ts`, aplicada a
// `check-forge-parity`, `check-mutation-jobs` e `check-workflow-refs`.
//
// POR QUE A MESMA PROVA, E NÃO MAIS UM CASO POR GUARD: o valor destes gates não
// é o que eles acusam — é o que eles NÃO acusam. Um gate que leia MENOS do que
// diz fica verde pelo mesmo motivo que um gate honesto: nada falhou. E os
// quatro compartilham o mesmo ponto cego, porque os quatro leem o MESMO texto
// (o YAML de workflow) com a mesma classe de erro:
//
//     julgados + fora do escopo (NOMEADOS) = declarados
//
// O lado direito é o que o arquivo DECLARA; o esquerdo tem de fechar. Quando uma
// forma nova de escrever um passo/job/ref não entra em nenhum dos dois, ela não
// aparece como violação — ela SOME, e o denominador encolhe em silêncio. É o
// defeito que este arquivo trava, um por guard:
//
//   PARIDADE — um gate que a descoberta não acha nunca precisa de classificação,
//     então um gate novo pula a forja sem que nada falhe. A forma que enganava a
//     leitura era a DECLARAÇÃO (`defaults: run:`): lida como passo, ela FABRICA
//     um gate que a pipeline não executa (`defaults: run: node scripts/check-x.mjs`
//     satisfazia a invariante por uma declaração de shell).
//
//   MUTATION-JOBS — a cobertura é transitiva (master → orquestrador → cenário),
//     e o risco é a cobertura FALSA: um `defaults: run:` ou um comentário bash
//     dentro de um bloco citando um mutation test que NÃO roda ali. A direção do
//     erro é o guard AFIRMANDO cobertura onde não há. E o outro lado: um script
//     que existe em `scripts/` e não é referenciado por NADA tem de sair
//     NOMEADO (órfão), não sumir da conta.
//
//   WORKFLOW-REFS — cada referência tem de ter desfecho: resolvida ou reportada
//     (nome, linha, tipo). O que o guard DELIBERADAMENTE não julga é o que ele
//     não pode medir (comentário, linha só com `${{ }}`, a declaração
//     `defaults: run:`) — e cada uma dessas linhas tem de sair do escopo SEM
//     virar referência: uma `ref` fabricada a partir de uma linha que a pipeline
//     não executa é pior que uma ref não validada, porque VALIDA o que não roda.
//
// O FIXTURE É DIFERENCIAL, como no arquivo irmão: cada elemento DECLARA o que é
// (que tipo de gate/ref/cobertura ele é, e se está dentro ou fora do escopo), e
// o teste cobra do guard exatamente isso. As contas não são números mágicos —
// são derivadas do fixture, e é isso que faz a soma fechar como PROVA.
//
// Sem docker, sem rede, sem rodar gate: funções puras + fixtures em tmpdir.
// =============================================================================

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  CORE_INVARIANTS,
  GITHUB_ONLY,
  classifyGate,
  discoverGates,
  findParityViolations,
  missingInvariants,
} from "../../../scripts/check-forge-parity.mjs"
import {
  checkMutationJobs,
  computeCoverage,
  extractMatrixRefs,
  extractWorkflowRunRefs,
} from "../../../scripts/check-mutation-jobs.mjs"
import {
  checkWorkflowFile,
  extractActionUses,
  extractPkgScriptRefs,
  extractScriptRefs,
  extractWorkflowUses,
  scanWorkflows,
} from "../../../scripts/check-workflow-refs.mjs"
import { defaultsRunLines } from "../../../scripts/forge-workflows.mjs"

const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A árvore de fixture (nome relativo → conteúdo), em disco e em memória. */
function arvore(arquivos: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "yaml-cobertura-"))
  tmpDirs.push(root)
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, conteudo)
  }
  return { root, conteudo: (rel: string) => arquivos[rel] ?? null }
}

// ── 1. check-forge-parity: todo gate DESCOBERTO tem classificação ───────────

/**
 * Um elemento do fixture de paridade, com o que ele DECLARA ser.
 *
 * `escopo: "declaracao"` é o passo FANTASMA da classe: uma linha que existe no
 * arquivo e que a pipeline NÃO executa. Ela tem de ficar fora da descoberta (e
 * nomeada como declaração), senão vira um gate que satisfaz a invariante sem
 * rodar.
 */
type GateDeclarado = {
  rotulo: string
  linha: number
  escopo: "executado" | "declaracao"
  /** O que `classifyGate` tem de responder (null = NÃO classificado). */
  classe: "core" | "github-only" | null
  pipeline: "gitea" | "github"
}

/** Um arquivo de workflow montado linha a linha, com os marcadores. */
function fixture(linhas: string[] = []) {
  return {
    linhas,
    add: (...ls: string[]) => void linhas.push(...ls),
    /** A linha (1-based) da PRIMEIRA ocorrência EXATA de `l`. */
    linhaDe: (l: string) => {
      const i = linhas.indexOf(l)
      if (i === -1) throw new Error(`o fixture não tem a linha exata: ${JSON.stringify(l)}`)
      return i + 1
    },
    conteudo: () => linhas.join("\n"),
  }
}

/**
 * AS DUAS PIPELINES, com os três desfechos de classificação no MESMO par:
 * um gate do CORE (roda nas duas), um gate SEM classificação (violação nas
 * duas) e um GITHUB_ONLY (só no espelho). Mais o `- uses:` externo (não é
 * gate: a descoberta só pega reusable LOCAL) e a DECLARAÇÃO fantasma.
 */
function montarParidade() {
  const gitea = fixture()
  gitea.add("on:", "  pull_request:")
  // A DECLARAÇÃO (fora do escopo). `defaults.run` é shell default, não passo:
  // lida como passo, esta linha FABRICA um gate que a pipeline não executa.
  gitea.add("defaults:", "  run: node scripts/check-fantasma.mjs")
  gitea.add("jobs:", "  guards:", "    steps:")
  const lCoreGitea = gitea.linhaDe("  guards:")
  gitea.add("      - run: node scripts/check-registry-source.mjs")
  const linhaCore = gitea.linhaDe("      - run: node scripts/check-registry-source.mjs")
  gitea.add("      - run: bun run lint")
  const linhaLint = gitea.linhaDe("      - run: bun run lint")
  gitea.add("      - run: node scripts/check-inventado-xyz.mjs")
  const linhaNaoClassificado = gitea.linhaDe("      - run: node scripts/check-inventado-xyz.mjs")
  gitea.add("      - uses: actions/checkout@v4")
  const linhaUsesExterno = gitea.linhaDe("      - uses: actions/checkout@v4")
  void lCoreGitea

  const github = fixture()
  github.add("on:", "  pull_request:", "jobs:", "  fast:", "    steps:")
  github.add("      - run: node scripts/check-registry-source.mjs")
  const ghCore = github.linhaDe("      - run: node scripts/check-registry-source.mjs")
  github.add("      - run: bun run lint")
  const ghLint = github.linhaDe("      - run: bun run lint")
  github.add("      - run: node scripts/check-inventado-xyz.mjs")
  const ghNaoClassificado = github.linhaDe("      - run: node scripts/check-inventado-xyz.mjs")
  // Reusable LOCAL: ponto de entrada de gates → É descoberto (e é GITHUB_ONLY).
  github.add("      - uses: ./.github/workflows/seed-guards.yml")
  const ghGithubOnly = github.linhaDe("      - uses: ./.github/workflows/seed-guards.yml")

  const declarados: GateDeclarado[] = [
    {
      rotulo: "bun run lint",
      linha: linhaLint,
      escopo: "executado",
      classe: "core",
      pipeline: "gitea",
    },
    {
      rotulo: "scripts/check-inventado-xyz.mjs",
      linha: linhaNaoClassificado,
      escopo: "executado",
      classe: null,
      pipeline: "gitea",
    },
    {
      rotulo: "scripts/check-registry-source.mjs",
      linha: linhaCore,
      escopo: "executado",
      classe: "core",
      pipeline: "gitea",
    },
    {
      rotulo: "bun run lint",
      linha: ghLint,
      escopo: "executado",
      classe: "core",
      pipeline: "github",
    },
    {
      rotulo: "scripts/check-inventado-xyz.mjs",
      linha: ghNaoClassificado,
      escopo: "executado",
      classe: null,
      pipeline: "github",
    },
    {
      rotulo: "scripts/check-registry-source.mjs",
      linha: ghCore,
      escopo: "executado",
      classe: "core",
      pipeline: "github",
    },
    {
      rotulo: "uses: ./.github/workflows/seed-guards.yml",
      linha: ghGithubOnly,
      escopo: "executado",
      classe: "github-only",
      pipeline: "github",
    },
  ]

  /** Fora do escopo, NOMEADOS: a declaração e o `uses:` externo. */
  const foraDoEscopo = [
    {
      linha: gitea.linhaDe("  run: node scripts/check-fantasma.mjs"),
      pipeline: "gitea" as const,
      motivo: "declaração `defaults.run` — o SHELL default do escopo, não um passo",
    },
    {
      linha: linhaUsesExterno,
      pipeline: "gitea" as const,
      motivo: "`uses:` EXTERNO (`actions/...`) — não é reusable local, não é gate desta forja",
    },
  ]

  const arquivos = {
    "W/gitea.yml": gitea.conteudo(),
    "W/github.yml": github.conteudo(),
  }
  const pipelines = [
    { forge: "gitea", file: "W/gitea.yml", mergeOwner: true },
    { forge: "github", file: "W/github.yml", mergeOwner: false },
  ]
  const { conteudo } = arvore(arquivos)
  return {
    arquivos,
    pipelines,
    declarados,
    foraDoEscopo,
    gitea: gitea.conteudo(),
    github: github.conteudo(),
    readFile: (p: string) => conteudo(p),
  }
}

describe("paridade — a soma dos gates descobertos FECHA com os declarados", () => {
  it("o fixture mistura os três desfechos (senão a prova não prova nada)", () => {
    const { declarados } = montarParidade()
    const classes = new Set(declarados.map((d) => d.classe))
    expect(classes).toEqual(new Set(["core", "github-only", null]))
    expect(new Set(declarados.map((d) => d.pipeline))).toEqual(new Set(["gitea", "github"]))
  })

  it("o `defaults: run:` NÃO é gate — e fica NOMEADO como declaração, não sumido", () => {
    const { gitea, foraDoEscopo } = montarParidade()
    const fantasma = foraDoEscopo.find((f) => f.motivo.includes("defaults.run"))!
    // A prova de que o guard VIU a linha e a pôs fora do escopo: ela é uma linha
    // de DECLARAÇÃO (a mesma leitura que o resto do repositório usa).
    expect(defaultsRunLines(gitea).has(fantasma.linha)).toBe(true)
    // E ela não pode entrar na descoberta: um gate fabricado por uma declaração
    // satisfaria a invariante sem nenhum job rodar.
    expect(discoverGates(gitea)).not.toContain("scripts/check-fantasma.mjs")
  })

  it("a soma FECHA: classificados + NÃO classificados = gates descobertos", () => {
    const { declarados, gitea, github } = montarParidade()
    for (const [forja, conteudo] of [
      ["gitea", gitea],
      ["github", github],
    ] as const) {
      const descobertos = discoverGates(conteudo)
      const esperados = declarados.filter((d) => d.pipeline === forja).map((d) => d.rotulo)
      // Descoberta == declaração (nas duas direções: nada a mais, nada a menos).
      expect(descobertos, forja).toEqual([...esperados].sort())
      const classificados = descobertos.filter((g) => classifyGate(g) !== null)
      const semClasse = descobertos.filter((g) => classifyGate(g) === null)
      // O invariante que um gate invisível quebra: todo gate descoberto tem
      // desfecho — classificado, ou NOMEADO como não classificado.
      expect(classificados.length + semClasse.length, forja).toBe(descobertos.length)
      expect(semClasse.length, forja).toBe(esperados.length - classificados.length)
      expect(semClasse.sort(), forja).toEqual(
        declarados
          .filter((d) => d.pipeline === forja && d.classe === null)
          .map((d) => d.rotulo)
          .sort(),
      )
    }
  })

  it("cada gate tem a CLASSIFICAÇÃO que ele mesmo declara", () => {
    for (const d of montarParidade().declarados) {
      expect(classifyGate(d.rotulo), `${d.pipeline}: ${d.rotulo}`).toBe(d.classe)
    }
  })

  it("a violação NOMEIA cada gate não classificado — e nenhum gate fora do fixture", () => {
    const { declarados, pipelines, readFile, gitea, github } = montarParidade()
    const violacoes = findParityViolations(readFile, pipelines) as string[]
    // Duas categorias por construção (o fixture não tem CORE ausente de GITHUB_ONLY
    // rodando na forja): a classificação e a completude do CORE.
    const naoClassificado = violacoes.filter((v) => v.includes("NAO CLASSIFICADO"))
    const naoInventado = violacoes.filter((v) => !v.includes("NAO CLASSIFICADO"))
    expect(naoClassificado.length).toBe(declarados.filter((d) => d.classe === null).length)
    expect(naoInventado.length).toBe(
      missingInvariants(gitea).length + missingInvariants(github).length,
    )
    // A ATRIBUIÇÃO: cada violação nomeia um gate que o fixture declara. Um gate
    // citado que não existe no arquivo é o passo FANTASMA do lado do
    // diagnóstico — apontar para o lugar errado é pior que calar.
    for (const v of naoClassificado) {
      expect(declarados.some((d) => v.includes(`gate '${d.rotulo}'`))).toBe(true)
    }
    // E o id citado numa violação de CORE tem de ser um id DECLARADO — nunca um
    // inventado pela régua.
    const ids = new Set(CORE_INVARIANTS.map((i) => i.id))
    for (const v of naoInventado) {
      const m = v.match(/invariante do CORE '([^']+)'/)
      expect(m, v).not.toBeNull()
      expect(ids.has(m![1]), v).toBe(true)
    }
  })

  it("GITHUB_ONLY é uma classificação DECLARADA (com razão escrita), não uma lista de nomes", () => {
    // A entrada que o fixture usa para o desfecho `github-only` tem de vir da
    // lista do repositório, com a razão escrita — a prova de que a isenção é uma
    // decisão registrada, e não o silêncio de um gate que ninguém classificou.
    const declarado = GITHUB_ONLY.find((g: { matches: RegExp }) =>
      g.matches.test("uses: ./.github/workflows/seed-guards.yml"),
    ) as { id: string; reason: string }
    expect(declarado).toBeTruthy()
    expect(declarado.reason.length).toBeGreaterThan(20)
  })
})

// ── 2. check-mutation-jobs: cobertura real, nunca FALSA ────────────────────

/**
 * O workflow de mutation tests, com cada referência DECLARADA — inclusive as
 * duas que NÃO podem contar: a declaração `defaults.run:` (que faria o guard
 * AFIRMAR cobertura de um teste que não roda ali) e o comentário bash dentro do
 * bloco (mesma classe, dentro do corpo).
 */
function montarMutationJobs() {
  const f = fixture()
  f.add("on:", "  pull_request:")
  f.add("defaults:", "  run: bash scripts/test-mutation-fantasma.sh")
  const linhaFantasma = f.linhaDe("  run: bash scripts/test-mutation-fantasma.sh")
  f.add("jobs:", "  guards:", "    steps:")
  f.add("      - run: bash scripts/test-mutation-a.sh")
  const linhaA = f.linhaDe("      - run: bash scripts/test-mutation-a.sh")
  f.add("      - run: bun run test:mutation-c")
  const linhaC = f.linhaDe("      - run: bun run test:mutation-c")
  f.add("      - run: |")
  const bloco = f.linhaDe("      - run: |")
  f.add("          set -e", "          bash scripts/test-mutation-b.sh")
  const linhaB = f.linhaDe("          bash scripts/test-mutation-b.sh")
  f.add("          # cita scripts/test-mutation-comentario.sh sem rodar")
  const linhaComentario = f.linhaDe(
    "          # cita scripts/test-mutation-comentario.sh sem rodar",
  )
  f.add("      - run: bash scripts/test-mutation-master.sh")
  const linhaMaster = f.linhaDe("      - run: bash scripts/test-mutation-master.sh")
  f.add("      - run: bash scripts/test-mutation-inexistente.sh")
  const linhaQuebrada = f.linhaDe("      - run: bash scripts/test-mutation-inexistente.sh")

  // `bun run test:mutation-c` só é cobertura pelo MAPEAMENTO do package.json.
  const pkgScripts = { "test:mutation-c": "bash scripts/test-mutation-c.sh" }
  const conteudo = f.conteudo()

  /** Os scripts que EXISTEM (o `scripts/` do repositório, derivado do fixture). */
  const scripts = [
    "test-mutation-a.sh",
    "test-mutation-b.sh",
    "test-mutation-c.sh",
    "test-mutation-master.sh",
    "test-mutation-readme.sh",
    "test-mutation-orfao.sh",
  ]
  /** O master cobre o readme por MATRIZ (a cobertura transitiva). */
  const matrixRefs = { "test-mutation-master.sh": ["test-mutation-readme.sh"] }
  const directRefs = [
    ...extractWorkflowRunRefs(conteudo, pkgScripts),
    "test-mutation-master.sh",
  ].filter((r, i, all) => all.indexOf(r) === i)

  return {
    conteudo,
    pkgScripts,
    scripts,
    matrixRefs,
    directRefs,
    linhaFantasma,
    linhaComentario,
    bloco,
    refs: { linhaA, linhaC, linhaB, linhaQuebrada, linhaMaster },
  }
}

describe("mutation-jobs — a cobertura dos mutation tests FECHA, e nunca é FALSA", () => {
  it("o fixture realmente contém a classe que o guard existe para não contar", () => {
    const { conteudo, linhaFantasma, linhaComentario } = montarMutationJobs()
    // As duas linhas existem no arquivo, e as duas são do escopo certo:
    // a primeira é uma DECLARAÇÃO (o shell default), a segunda é um comentário
    // bash DENTRO de um bloco `run:`.
    expect(defaultsRunLines(conteudo).has(linhaFantasma)).toBe(true)
    expect(conteudo.split("\n")[linhaComentario - 1]!.trim().startsWith("#")).toBe(true)
  })

  it("a extração do workflow é a DECLARADA — a declaração e o comentário ficam de fora", () => {
    const { conteudo, pkgScripts } = montarMutationJobs()
    expect(extractWorkflowRunRefs(conteudo, pkgScripts).sort()).toEqual([
      // a, b (bloco) e c (via o MAPEAMENTO do package.json) — as que rodam.
      "test-mutation-a.sh",
      "test-mutation-b.sh",
      "test-mutation-c.sh",
      // a inexistente é extraída de propósito: é o par REVERSO do guard.
      "test-mutation-inexistente.sh",
      "test-mutation-master.sh",
    ])
    // O que NÃO pode virar cobertura, em nenhum dos dois disfarces (afirmar
    // cobertura onde não há é o erro que este guard não pode cometer).
    expect(extractWorkflowRunRefs(conteudo, pkgScripts)).not.toContain("test-mutation-fantasma.sh")
    expect(extractWorkflowRunRefs(conteudo, pkgScripts)).not.toContain(
      "test-mutation-comentario.sh",
    )
  })

  it("a matriz do orquestrador é lida SÓ do bloco do array (comentário do header não conta)", () => {
    // A mesma doutrina, do lado do bash: um header que CITA os cenários para
    // documentá-los não é cobertura de ninguém.
    const master = [
      "#!/usr/bin/env bash",
      "# SUBTESTS=( comentario que cita scripts/test-mutation-a.sh )",
      "SUBTESTS=(",
      '  "cenario um|scripts/test-mutation-a.sh"',
      '  "cenario dois|scripts/test-mutation-b.sh"',
      ")",
      "echo scripts/test-mutation-c.sh   # fora do bloco: não conta",
      "",
    ].join("\n")
    expect(extractMatrixRefs(master, "SUBTESTS").sort()).toEqual([
      "test-mutation-a.sh",
      "test-mutation-b.sh",
    ])
  })

  it("a soma FECHA: cobertos + órfãos NOMEADOS = scripts declarados", () => {
    const { scripts, directRefs, matrixRefs } = montarMutationJobs()
    const { covered, uncovered } = computeCoverage({ scripts, directRefs, matrixRefs }) as {
      covered: Set<string>
      uncovered: string[]
    }
    const cobertos = scripts.filter((s) => covered.has(s))
    // O invariante: todo script tem DESFECHO — coberto, ou órfão nomeado. Um
    // script que não esteja em nenhum dos dois sumiu do denominador (o guard
    // estaria medindo menos do que diz).
    expect(cobertos.length + uncovered.length).toBe(scripts.length)
    expect(new Set([...cobertos, ...uncovered])).toEqual(new Set(scripts))
    // E o órfão é exatamente o que NADA referencia (nem direto, nem por matriz).
    expect(uncovered).toEqual(["test-mutation-orfao.sh"])
    // A cobertura TRANSITIVA conta: o readme só é coberto pela matriz do master.
    expect(covered.has("test-mutation-readme.sh")).toBe(true)
    expect(directRefs).not.toContain("test-mutation-readme.sh")
  })

  it("todo órfão e toda ref quebrada saem NOMEADOS — e nenhum nome inventado", () => {
    const { scripts, directRefs, matrixRefs } = montarMutationJobs()
    const violacoes = checkMutationJobs({ scripts, directRefs, matrixRefs }) as string[]
    const semJob = violacoes.filter((v) => v.includes("SEM job correspondente"))
    const quebradas = violacoes.filter((v) => v.includes("NÃO existe em scripts/"))
    // Um órfão por violação: nenhum some em silêncio (é o lado do denominador).
    expect(semJob.length).toBe(1)
    expect(semJob[0]).toContain("test-mutation-orfao.sh")
    // O par REVERSO: a ref quebrada do workflow é reportada, uma vez.
    expect(quebradas.length).toBe(1)
    expect(quebradas[0]).toContain("test-mutation-inexistente.sh")
    // A ATRIBUIÇÃO: toda violação cita um script que existe (órfão) ou que o
    // fixture referencia (quebrada) — nada de nome fantasma.
    const conhecidos = new Set([...scripts, "test-mutation-inexistente.sh"])
    for (const v of violacoes) {
      const m = v.match(/'([^']+\.sh)'/)
      expect(m, v).not.toBeNull()
      expect(conhecidos.has(m![1]!), v).toBe(true)
    }
  })
})

// ── 3. check-workflow-refs: toda ref tem desfecho, e o não-julgado é NOMEADO ─

/** Uma referência declarada no fixture de refs, com o desfecho que ela declara. */
type RefDeclarada = {
  linha: number
  tipo: "script" | "package.json" | "workflow" | "action"
  ref: string
  /** Resolve contra o contexto? (`false` = a violação esperada.) */
  resolvida: boolean
  escopo: "executado" | "fora"
  motivo?: string
}

function montarRefs() {
  const f = fixture()
  f.add("on:", "  pull_request:")
  // Declaração: `defaults.run` é o SHELL default, não um passo — uma ref daqui
  // valida um script que a pipeline NUNCA executa.
  f.add("defaults:", "  run: node scripts/fantasma.mjs")
  const linhaFantasma = f.linhaDe("  run: node scripts/fantasma.mjs")
  f.add("jobs:", "  a:", "    steps:")

  f.add("      - run: node scripts/existe.mjs")
  const linhaScriptOk = f.linhaDe("      - run: node scripts/existe.mjs")
  f.add("      - run: bash scripts/nao-existe.sh")
  const linhaScriptQuebrada = f.linhaDe("      - run: bash scripts/nao-existe.sh")
  // O corpo do BLOCO é lido linha a linha: a ref de dentro conta (a pipeline a
  // executa), e o comentário bash de dentro NÃO.
  f.add("      - run: |", "          set -e", "          node scripts/no-bloco.mjs")
  const linhaNoBloco = f.linhaDe("          node scripts/no-bloco.mjs")
  f.add("          # node scripts/comentario-no-bloco.mjs")
  const linhaComentarioBloco = f.linhaDe("          # node scripts/comentario-no-bloco.mjs")
  // Linha só com expressão dinâmica: o guard não pode resolver (nem inventar)
  // uma ref a partir dela.
  f.add("      - run: ${{ vars.COMANDO_DE_VERIFICACAO }}")
  const linhaDinamica = f.linhaDe("      - run: ${{ vars.COMANDO_DE_VERIFICACAO }}")
  f.add("      - run: # node scripts/comentario-solto.mjs")
  const linhaComentario = f.linhaDe("      - run: # node scripts/comentario-solto.mjs")

  f.add("      - run: bun run check:coisa")
  const linhaPkgOk = f.linhaDe("      - run: bun run check:coisa")
  f.add("      - run: bun run check:inexistente")
  const linhaPkgQuebrada = f.linhaDe("      - run: bun run check:inexistente")
  f.add("      - uses: ./.github/workflows/reusavel.yml")
  const linhaWorkflow = f.linhaDe("      - uses: ./.github/workflows/reusavel.yml")
  f.add("      - uses: ./.github/actions/setup-bun")
  const linhaAction = f.linhaDe("      - uses: ./.github/actions/setup-bun")

  const conteudo = f.conteudo()
  const ctx = {
    scripts: new Set(["existe.mjs", "no-bloco.mjs", "coisa.mjs"]),
    pkgScripts: new Set(["check:coisa"]),
    pkgTargets: new Map([["check:coisa", "coisa.mjs"]]),
    workflows: new Set(["reusavel.yml"]),
    workflowCall: new Set(["reusavel.yml"]),
    actions: new Set(["setup-bun"]),
  }

  const declaradas: RefDeclarada[] = [
    {
      linha: linhaScriptOk,
      tipo: "script",
      ref: "existe.mjs",
      resolvida: true,
      escopo: "executado",
    },
    {
      linha: linhaScriptQuebrada,
      tipo: "script",
      ref: "nao-existe.sh",
      resolvida: false,
      escopo: "executado",
    },
    {
      linha: linhaNoBloco,
      tipo: "script",
      ref: "no-bloco.mjs",
      resolvida: true,
      escopo: "executado",
    },
    {
      linha: linhaPkgOk,
      tipo: "package.json",
      ref: "check:coisa",
      resolvida: true,
      escopo: "executado",
    },
    {
      linha: linhaPkgQuebrada,
      tipo: "package.json",
      ref: "check:inexistente",
      resolvida: false,
      escopo: "executado",
    },
    {
      linha: linhaWorkflow,
      tipo: "workflow",
      ref: "reusavel.yml",
      resolvida: true,
      escopo: "executado",
    },
    {
      linha: linhaAction,
      tipo: "action",
      ref: "setup-bun",
      resolvida: true,
      escopo: "executado",
    },
  ]

  /** Fora do escopo, NOMEADAS: a declaração, o comentário (solto e no bloco) e a dinâmica. */
  const foraDoEscopo: RefDeclarada[] = [
    {
      linha: linhaFantasma,
      tipo: "script",
      ref: "fantasma.mjs",
      resolvida: false,
      escopo: "fora",
      motivo: "declaração `defaults.run` — não é passo, não executa nada",
    },
    {
      linha: linhaComentarioBloco,
      tipo: "script",
      ref: "comentario-no-bloco.mjs",
      resolvida: false,
      escopo: "fora",
      motivo: "comentário bash DENTRO de um bloco `run:` — não é executado",
    },
    {
      linha: linhaComentario,
      tipo: "script",
      ref: "comentario-solto.mjs",
      resolvida: false,
      escopo: "fora",
      motivo: "comentário de FIM DE LINHA (`run: # ...`) — o passo não executa nada",
    },
    {
      linha: linhaDinamica,
      tipo: "script",
      ref: "COMANDO_DE_VERIFICACAO",
      resolvida: false,
      escopo: "fora",
      motivo: "linha só com `${{ }}`: o guard não pode resolver a ref (nem inventá-la)",
    },
  ]

  return { conteudo, ctx, declaradas, foraDoEscopo, linhaDinamica }
}

/** Todas as refs que os quatro extratores devolvem, numa lista só. */
function extrairTudo(conteudo: string) {
  return [
    ...extractScriptRefs(conteudo),
    ...extractPkgScriptRefs(conteudo),
    ...extractWorkflowUses(conteudo),
    ...extractActionUses(conteudo),
  ] as { line: number; ref: string; text: string }[]
}

describe("workflow-refs — toda referência tem DESFECHO, e o que não é julgado é NOMEADO", () => {
  it("a soma FECHA: refs extraídas = refs declaradas (uma por linha)", () => {
    const { conteudo, declaradas } = montarRefs()
    const extraidas = extrairTudo(conteudo)
    expect(extraidas.length).toBe(declaradas.length)
    expect(new Set(extraidas.map((r) => r.line))).toEqual(new Set(declaradas.map((r) => r.linha)))
  })

  it("as linhas FORA do escopo não produzem ref nenhuma (nenhuma ref fabricada)", () => {
    const { conteudo, foraDoEscopo } = montarRefs()
    const extraidas = extrairTudo(conteudo)
    for (const fora of foraDoEscopo) {
      expect(
        extraidas.some((r) => r.line === fora.linha),
        fora.motivo ?? fora.ref,
      ).toBe(false)
    }
    // E a declaração é VISTA como declaração (a leitura compartilhada) — fora do
    // escopo por decisão medida, não por esquecimento.
    const declaracao = foraDoEscopo.find((f) => (f.motivo ?? "").includes("defaults.run"))!
    expect(defaultsRunLines(conteudo).has(declaracao.linha)).toBe(true)
  })

  it("julgadas + quebradas = extraídas: cada ref tem desfecho, e o quebrado é NOMEADO", () => {
    const { conteudo, ctx, declaradas } = montarRefs()
    const violacoes = checkWorkflowFile("pr-check.yml", conteudo, ctx) as {
      file: string
      line: number
      kind: string
      ref: string
    }[]
    const esperadasQuebradas = declaradas.filter((d) => !d.resolvida)
    expect(violacoes.length).toBe(esperadasQuebradas.length)
    expect(violacoes.map((v) => `${v.kind}:${v.ref}`).sort()).toEqual(
      esperadasQuebradas.map((d) => `${d.tipo}:${d.ref}`).sort(),
    )
    // A ATRIBUIÇÃO: nenhuma violação aponta para uma linha que não declara uma
    // ref — uma violação fantasma faria o autor caçar um defeito onde não há.
    for (const v of violacoes) {
      expect(
        declaradas.some((d) => d.linha === v.line),
        `${v.kind}:${v.ref}`,
      ).toBe(true)
      expect(v.file).toBe("pr-check.yml")
    }
  })

  it("o corpo do BLOCO é lido (a ref de dentro conta), e o comentário de dentro não", () => {
    const { conteudo, ctx, declaradas, foraDoEscopo } = montarRefs()
    const doBloco = declaradas.find((d) => d.ref === "no-bloco.mjs")!
    const comentario = foraDoEscopo.find((f) => f.ref === "comentario-no-bloco.mjs")!
    // A ref do corpo do bloco é VISTA (a pipeline a executa) e não é acusada:
    // ela existe no contexto.
    expect(extrairTudo(conteudo).some((r) => r.line === doBloco.linha)).toBe(true)
    const quebradas = (checkWorkflowFile("pr-check.yml", conteudo, ctx) as { ref: string }[]).map(
      (v) => v.ref,
    )
    expect(quebradas).not.toContain("no-bloco.mjs")
    // O comentário bash DENTRO do bloco é da mesma classe do comentário solto:
    // não é executado, não é visto e não vira violação.
    expect(extrairTudo(conteudo).some((r) => r.line === comentario.linha)).toBe(false)
    expect(quebradas).not.toContain("comentario-no-bloco.mjs")
  })

  it("`scanWorkflows` é a soma por arquivo (nenhum arquivo some do escopo)", () => {
    const { conteudo } = montarRefs()
    const outro = [
      "on:",
      "  pull_request:",
      "jobs:",
      "  b:",
      "    steps:",
      "      - run: echo ok",
      "      - run: node scripts/quebrada-no-outro.mjs",
      "",
    ].join("\n")
    const ctx = {
      scripts: new Set<string>(),
      pkgScripts: new Set<string>(),
      workflows: new Set<string>(),
      workflowCall: new Set<string>(),
      actions: new Set<string>(),
    }
    const arquivos = [
      { name: "pr-check.yml", content: conteudo },
      { name: "outro.yml", content: outro },
    ]
    const todas = scanWorkflows(arquivos, ctx) as { file: string }[]
    const porArquivo = arquivos.flatMap(
      (f) => checkWorkflowFile(f.name, f.content, ctx) as { file: string }[],
    )
    expect(todas.length).toBe(porArquivo.length)
    expect(new Set(todas.map((v) => v.file))).toEqual(new Set(["pr-check.yml", "outro.yml"]))
  })
})

// ── 4. O invariante COMPARTILHADO: os quatro guards usam a MESMA leitura ───

describe("a leitura de YAML é UMA SÓ: os quatro guards veem o mesmo `defaults.run:`", () => {
  it("a declaração é a mesma linha para todos — e nenhum deles a lê como passo", () => {
    const conteudo = [
      "on:",
      "  pull_request:",
      "defaults:",
      "  run: node scripts/check-fantasma.mjs",
      "jobs:",
      "  a:",
      "    steps:",
      "      - run: node scripts/check-registry-source.mjs",
      "",
    ].join("\n")
    const declaracao = defaultsRunLines(conteudo)
    expect(declaracao.size).toBe(1)
    // PARIDADE — não vira gate.
    expect(discoverGates(conteudo)).not.toContain("scripts/check-fantasma.mjs")
    // MUTATION-JOBS — não vira cobertura.
    expect(extractWorkflowRunRefs(conteudo, {})).not.toContain("test-mutation-fantasma.sh")
    // WORKFLOW-REFS — não vira ref.
    expect(extractScriptRefs(conteudo).some((r) => r.line === 4)).toBe(false)
    // ...e a linha que EXECUTA continua sendo vista por todos.
    expect(discoverGates(conteudo)).toContain("scripts/check-registry-source.mjs")
    expect(extractScriptRefs(conteudo).map((r) => r.ref)).toContain("check-registry-source.mjs")
  })
})
