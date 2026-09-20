/**
 * required-checks-applied.test.ts
 *
 * O OUTRO LADO do required check: quem bloqueia o merge não é o manifesto, é a
 * proteção APLICADA na forja. `scripts/check-required-checks.mjs` julga as duas
 * metades — o manifesto contra os workflows e a DECLARAÇÃO da reaplicação
 * (`ci/required-checks-applied.json`, escrito pelo `apply-required-checks.mjs
 * --apply`) contra os contextos que o repositório deriva AGORA.
 *
 * O defeito que estes testes prendem: renomear o `name:` de um job que é required
 * check (ou entrar/sair da lista) muda o CONTEXTO exigido, e a forja continua
 * exigindo o antigo — o PR trava num check que nunca mais roda, sem nenhuma linha
 * de gate parecer errada. A régua é "a mudança veio COM a reaplicação declarada":
 * sem ela o PR fica vermelho nomeando o job e os dois contextos; com ela (o
 * applier reescreve o arquivo) fica verde.
 *
 * Os fixtures rodam a CLI de verdade (`--root`): quem julga é o processo que o CI
 * executa, e não uma segunda implementação do julgamento.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

import {
  APPLIED_PATH,
  MANIFEST_PATH,
  buildAppliedRecord,
  declaredWithoutGate,
  defaultIo,
  loadApplied,
  loadManifest,
  resolveManifestContexts,
  validateApplied,
  validateManifest,
  writeAppliedRecord,
} from "../../../scripts/check-required-checks.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const GUARD = join(ROOT, "scripts", "check-required-checks.mjs")
const io = defaultIo(ROOT)
const manifest = loadManifest(ROOT, io)
const resolved = resolveManifestContexts(manifest, io) as Resolvidos
const applied = loadApplied(ROOT, io)

const temporarios: string[] = []
afterAll(() => {
  for (const dir of temporarios) rmSync(dir, { recursive: true, force: true })
})

const GITHUB_WF = ".github/workflows/pr.yml"
const GITEA_WF = ".gitea/workflows/ci.yml"

/** O que `resolveManifestContexts` devolve (o tipo mora no JSDoc do módulo .mjs). */
type Resolvidos = Record<
  string,
  { workflow: string; branches: string[]; contexts: { jobId: string; context: string }[] }
>

/** O manifesto do fixture: o job `lint` (nome parametrizável) e o `tests`. */
function manifesto(githubJobs: string[], giteaJobs: string[], branches: string[]): string {
  return `${JSON.stringify(
    {
      version: 1,
      branches,
      forges: {
        github: { workflow: GITHUB_WF, jobs: githubJobs },
        gitea: { workflow: GITEA_WF, jobs: giteaJobs },
      },
    },
    null,
    2,
  )}\n`
}

/** Um workflow com os jobs pedidos (o `name:` é o CONTEXTO; null = sem name). */
function yml(jobs: Array<[string, string | null]>): string {
  const corpo = jobs
    .map(
      ([id, nome]) =>
        `  ${id}:\n${nome === null ? "" : `    name: ${nome}\n`}    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`,
    )
    .join("")
  return `name: Fixture\non: [push]\njobs:\n${corpo}`
}

/** O workflow do GitHub do fixture, com o `name:` do `lint` parametrizável. */
function workflows(lintName: string | null, extras: Record<string, string | null> = {}) {
  return yml([["lint", lintName], ["tests", null], ...Object.entries(extras)])
}

interface Opcoes {
  /** As branches do manifesto (default: `["main"]`). */
  branches?: string[]
  /** O `name:` do job `lint` (null = sem `name:` → o contexto é o id). */
  lint?: string | null
  /** Jobs extras do manifesto do GitHub (com o `name:` em `nomesExtras`). */
  jobsExtras?: string[]
  nomesExtras?: Record<string, string | null>
  /** Os contextos DECLARADOS como aplicados. `null` = fixture sem a declaração. */
  declarados?: string[] | null
  /** Forjas que a declaração cobre (para o caso da forja sem entrada). */
  forjasDeclaradas?: string[]
  /** Contextos órfãos acrescentados à declaração (a forja exige o que não existe). */
  orfaos?: string[]
  /**
   * O valor CRU escrito em `unsupported` na entrada do GitHub: `undefined` = sem
   * marcador (a forja respondeu), e qualquer outra coisa (objeto incompleto, um
   * booleano) é o que o guard tem de recusar.
   */
  marcaSemPortao?: unknown
  /** Conteúdo cru da declaração (JSON inválido, versão errada, contexts não-lista). */
  recordCru?: string
}

/** Um repositório temporário com manifesto, workflows e a declaração da reaplicação. */
function montar(opcoes: Opcoes = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "required-applied-"))
  temporarios.push(dir)
  mkdirSync(join(dir, "ci"), { recursive: true })
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  mkdirSync(join(dir, ".gitea", "workflows"), { recursive: true })

  const lint = opcoes.lint === undefined ? "Lint guard" : opcoes.lint
  const extras = opcoes.jobsExtras ?? []
  writeFileSync(
    join(dir, MANIFEST_PATH),
    manifesto(["lint", "tests", ...extras], ["guards"], opcoes.branches ?? ["main"]),
    "utf8",
  )
  writeFileSync(
    join(dir, GITHUB_WF),
    workflows(lint, Object.fromEntries(extras.map((j) => [j, opcoes.nomesExtras?.[j] ?? null]))),
    "utf8",
  )
  writeFileSync(join(dir, GITEA_WF), yml([["guards", "Repo Guards"]]), "utf8")

  if (opcoes.recordCru !== undefined) {
    writeFileSync(join(dir, APPLIED_PATH), opcoes.recordCru, "utf8")
    return dir
  }
  if (opcoes.declarados === null) return dir

  const githubContextos = opcoes.declarados ?? [
    lint ?? "lint",
    "tests",
    ...extras.map((j) => opcoes.nomesExtras?.[j] ?? j),
  ]
  const forges: Record<string, Record<string, unknown>> = {}
  if ((opcoes.forjasDeclaradas ?? ["github", "gitea"]).includes("github")) {
    forges.github = {
      workflow: GITHUB_WF,
      branches: ["main"],
      contexts: [...githubContextos, ...(opcoes.orfaos ?? [])],
      ...(opcoes.marcaSemPortao === undefined ? {} : { unsupported: opcoes.marcaSemPortao }),
    }
  }
  if ((opcoes.forjasDeclaradas ?? ["github", "gitea"]).includes("gitea")) {
    forges.gitea = { workflow: GITEA_WF, branches: ["main"], contexts: ["Repo Guards"] }
  }
  writeFileSync(
    join(dir, APPLIED_PATH),
    `${JSON.stringify({ version: 1, appliedAt: "2026-01-01", forges }, null, 2)}\n`,
    "utf8",
  )
  return dir
}

/** Roda o guard como o CI o roda. */
function guardar(dir: string) {
  const r = spawnSync(process.execPath, [GUARD, "--root", dir], { encoding: "utf8" })
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

/** Os contextos derivados do PRÓPRIO fixture (a fonte da comparação). */
function derivadosDoFixture(dir: string): Resolvidos {
  const ioFixture = defaultIo(dir)
  return resolveManifestContexts(loadManifest(dir, ioFixture), ioFixture) as Resolvidos
}

// ── o repositório real ─────────────────────────────────────────────────────

describe("o repositório real declara a proteção aplicada", () => {
  it("a declaração cobre as DUAS forjas do manifesto, com os contextos derivados agora", () => {
    expect(validateApplied(applied, resolved)).toEqual([])
    for (const forge of Object.keys(resolved)) {
      const derivados = resolved[forge].contexts.map((c) => c.context)
      expect(applied.forges[forge]).toBeDefined()
      expect(applied.forges[forge].workflow).toBe(resolved[forge].workflow)
      expect([...applied.forges[forge].contexts].sort()).toEqual([...derivados].sort())
    }
  })

  it("a declaração carrega a data da reaplicação e se explica (quem lê o arquivo não tem contexto)", () => {
    expect(applied.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const cru = readFileSync(join(ROOT, APPLIED_PATH), "utf8")
    expect(cru).toContain("DECLARAÇÃO da proteção APLICADA")
    expect(cru).toContain("-- --apply")
  })

  it("o guard do CI sai 0 (as duas metades julgadas juntas)", () => {
    const r = guardar(ROOT)
    expect(r.out).toContain("Required checks consistentes")
    expect(r.out).toContain("Proteção APLICADA declarada")
    expect(r.status).toBe(0)
  })
})

// ── o defeito: a mudança de contexto SEM a reaplicação declarada ───────────

describe("renomear um required check exige a reaplicação DECLARADA", () => {
  it("CONTROLE: a declaração em sincronia passa (não há falso positivo)", () => {
    const r = guardar(montar())
    expect(r.out).toContain("Required checks consistentes")
    expect(r.status).toBe(0)
  })

  it("sem a declaração, o rename falha nomeando o JOB e os DOIS contextos", () => {
    const dir = montar({ lint: "Lint Guard (v2)", declarados: ["Lint guard", "tests"] })
    const r = guardar(dir)
    expect(r.status).toBe(1)
    // O contexto NOVO que a forja passaria a exigir e o job de onde ele vem...
    expect(r.out).toContain('"Lint Guard (v2)"')
    expect(r.out).toContain('job "lint"')
    // ...e o contexto ANTIGO, que é o que a proteção aplicada tem e ficaria órfão.
    expect(r.out).toContain('exige "Lint guard"')
    // O remédio é a reaplicação, nomeada com o comando e o arquivo.
    expect(r.out).toContain("-- --apply")
    expect(r.out).toContain(APPLIED_PATH)
  })

  it("a MESMA mudança com a declaração reaplicada passa — é a declaração que decide", () => {
    const r = guardar(montar({ lint: "Lint Guard (v2)", declarados: ["Lint Guard (v2)", "tests"] }))
    expect(r.status).toBe(0)
  })

  it("um required check NOVO no manifesto sem reaplicação falha", () => {
    // A declaração é a de ANTES: o job novo entrou no manifesto sem reaplicação.
    const dir = montar({
      jobsExtras: ["extra"],
      nomesExtras: { extra: "Extra guard" },
      declarados: ["Lint guard", "tests"],
    })
    const r = guardar(dir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('"Extra guard"')
    expect(r.out).toContain('job "extra"')
  })

  it("um contexto ÓRFÃO declarado (a forja exige o que o repo não produz) falha", () => {
    const r = guardar(montar({ orfaos: ["Guard antigo"] }))
    expect(r.status).toBe(1)
    expect(r.out).toContain('exige "Guard antigo"')
    expect(r.out).toContain("check órfão")
  })

  it("uma forja do manifesto SEM entrada na declaração falha (ausência não é sincronia)", () => {
    const r = guardar(montar({ forjasDeclaradas: ["github"] }))
    expect(r.status).toBe(1)
    expect(r.out).toContain('forja "gitea" do manifesto não tem entrada')
  })

  it("uma BRANCH nova no manifesto sem reaplicação falha (o merge ali não exige gate nenhum)", () => {
    const dir = montar({ branches: ["main", "release"] })
    const r = guardar(dir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('branch "release"')
    expect(r.out).toContain("não foi reaplicada")
  })
})

// ── fail-closed: o que não pôde ser lido não é "nada a comparar" ───────────

describe("a declaração ausente ou ilegível é PROBLEMA (fail-closed)", () => {
  it("sem o arquivo, o guard falha com o remédio (nunca 'nada a declarar')", () => {
    const r = guardar(montar({ declarados: null }))
    expect(r.status).toBe(1)
    expect(r.out).toContain(APPLIED_PATH)
    expect(r.out).toContain("não existe")
    expect(r.out).toContain("-- --apply")
  })

  it("JSON inválido no arquivo falha nomeando o arquivo", () => {
    const r = guardar(montar({ recordCru: "{ isso não é json" }))
    expect(r.status).toBe(1)
    expect(r.out).toContain("JSON inválido")
  })

  it("`version` errada, `contexts` não-lista e contexto duplicado são violações próprias", () => {
    const base = {
      version: 1,
      appliedAt: "2026-01-01",
      forges: { github: { workflow: GITHUB_WF, branches: ["main"], contexts: ["Lint guard"] } },
    }

    const versao = validateApplied({ ...base, version: 9 }, resolved)
    expect(versao.map((v) => v.problem).join(" ")).toMatch(/version deve ser 1/)

    const naoLista = validateApplied(
      {
        ...base,
        forges: { github: { workflow: GITHUB_WF, branches: ["main"], contexts: "Lint guard" } },
      },
      resolved,
    )
    expect(naoLista.map((v) => v.problem).join(" ")).toMatch(
      /contexts de "github" deve ser uma lista/,
    )

    const branchesNaoLista = validateApplied(
      {
        ...base,
        forges: { github: { workflow: GITHUB_WF, branches: "main", contexts: ["Lint guard"] } },
      },
      resolved,
    )
    expect(branchesNaoLista.map((v) => v.problem).join(" ")).toMatch(
      /branches de "github" deve ser uma lista/,
    )

    const duplicado = validateApplied(
      {
        ...base,
        forges: {
          github: {
            workflow: GITHUB_WF,
            branches: ["main"],
            contexts: ["Lint guard", "Lint guard"],
          },
        },
      },
      { github: resolved.github },
    )
    expect(duplicado.map((v) => v.problem).join(" ")).toMatch(/declarado duas vezes/)
  })

  it("a declaração de OUTRA pipeline (workflow diferente) é violação", () => {
    const r = guardar(
      montar({
        recordCru: `${JSON.stringify(
          {
            version: 1,
            appliedAt: "2026-01-01",
            forges: {
              github: {
                workflow: ".github/workflows/outro.yml",
                branches: ["main"],
                contexts: ["Lint guard", "tests"],
              },
            },
          },
          null,
          2,
        )}\n`,
      }),
    )
    expect(r.status).toBe(1)
    expect(r.out).toContain("é de OUTRA pipeline")
  })
})

// ── o caminho mecânico: quem reaplica é quem escreve a declaração ──────────

describe("o applier escreve a declaração (a reaplicação declara-se sozinha)", () => {
  it("depois do `--apply`, a declaração é escrita com os contextos derivados e o guard fica verde", () => {
    const dir = montar({ declarados: null })
    const { escrito, path } = writeAppliedRecord(dir, derivadosDoFixture(dir), {
      forges: ["github", "gitea"],
      hoje: "2026-09-18",
    })
    expect(escrito).toBe(true)
    expect(path).toBe(APPLIED_PATH)

    const escritoJson = JSON.parse(readFileSync(join(dir, APPLIED_PATH), "utf8"))
    expect(escritoJson.appliedAt).toBe("2026-09-18")
    expect(escritoJson.forges.github.contexts).toEqual(["Lint guard", "tests"])
    expect(escritoJson.forges.gitea.contexts).toEqual(["Repo Guards"])
    expect(escritoJson.forges.github.branches).toEqual(["main"])
    expect(escritoJson.$comment.join(" ")).toContain("DECLARAÇÃO da proteção APLICADA")

    expect(guardar(dir).status).toBe(0)
  })

  it("o fluxo do rename: renomear + reaplicar (que reescreve a declaração) deixa o PR verde", () => {
    const dir = montar({ lint: "Lint guard", declarados: ["Lint guard", "tests"] })
    expect(guardar(dir).status).toBe(0)

    // O rename acontece no workflow...
    writeFileSync(join(dir, GITHUB_WF), workflows("Lint Guard (v2)"), "utf8")
    expect(guardar(dir).status).toBe(1)

    // ...e a reaplicação reescreve a declaração (é o mesmo `writeAppliedRecord` do `--apply`).
    const { escrito } = writeAppliedRecord(dir, derivadosDoFixture(dir), {
      forges: ["github", "gitea"],
      hoje: "2026-09-18",
    })
    expect(escrito).toBe(true)
    expect(guardar(dir).status).toBe(0)
  })

  it("um apply SEM mudança de contexto não reescreve o arquivo (o carimbo não gera churn)", () => {
    const dir = montar()
    const antes = readFileSync(join(dir, APPLIED_PATH), "utf8")
    const { escrito } = writeAppliedRecord(dir, derivadosDoFixture(dir), {
      forges: ["github", "gitea"],
      hoje: "2026-12-31",
    })
    expect(escrito).toBe(false)
    expect(readFileSync(join(dir, APPLIED_PATH), "utf8")).toBe(antes)
  })

  it("uma forja FORA do alvo mantém a declaração anterior (a proteção dela não foi tocada)", () => {
    const atual = {
      version: 1,
      appliedAt: "2026-01-01",
      forges: {
        gitea: { workflow: GITEA_WF, branches: ["main"], contexts: ["Repo Guards", "guards"] },
      },
    }
    const { record } = buildAppliedRecord(atual, resolved, ["github"], "2026-09-18")
    expect(record.forges.github.contexts).toEqual(resolved.github.contexts.map((c) => c.context))
    expect(record.forges.gitea.contexts).toEqual(["Repo Guards", "guards"])
  })
})

// ── a forja que RECUSA a feature: estado DECLARADO, nunca mudo ────────────
//
// A forja pode recusar a feature de branch protection inteira (repo privado num
// plano sem ela): ali nenhum required check pode ser aplicado nem LIDO. O estado
// existe, e a declaração o carrega com MOTIVO e DATA — o manifesto segue dizendo
// a INTENÇÃO, e o veredito publica a forja sem portão em toda rodada.

describe("a forja SEM PORTÃO (recusa a feature) é um estado DECLARADO", () => {
  it("o repositório real publica a forja sem portão com motivo, data e o remédio de plano", () => {
    const r = guardar(ROOT)
    expect(r.status).toBe(0)
    const marca = applied.forges.github.unsupported
    expect(marca.reason.length).toBeGreaterThan(0)
    expect(marca.readAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(r.out).toContain("SEM PORTÃO DE MERGE")
    expect(r.out).toContain(`lido em ${marca.readAt}`)
    expect(r.out).toContain("PLANO/VISIBILIDADE")
    expect(declaredWithoutGate(applied).map((d) => d.forge)).toEqual(["github"])
  })

  it("o marcador bem formado passa e o veredito o publica com o motivo da forja", () => {
    const r = guardar(
      montar({
        marcaSemPortao: { reason: "HTTP 403: Upgrade to GitHub Pro", readAt: "2026-09-20" },
      }),
    )
    expect(r.status).toBe(0)
    expect(r.out).toContain("SEM PORTÃO DE MERGE (lido em 2026-09-20)")
    expect(r.out).toContain("Upgrade to GitHub Pro")
  })

  it("sem o MOTIVO o guard reprova — 'sem portão' mudo é o verde que esconde o fato", () => {
    const r = guardar(montar({ marcaSemPortao: { readAt: "2026-09-20" } }))
    expect(r.status).toBe(1)
    expect(r.out).toContain("SEM PORTÃO sem o MOTIVO")
  })

  it("sem a DATA da leitura o guard reprova (não distingue 'medi agora' de 'medi um dia')", () => {
    const r = guardar(montar({ marcaSemPortao: { reason: "HTTP 403 de plano" } }))
    expect(r.status).toBe(1)
    expect(r.out).toContain("sem a DATA da leitura")
  })

  it("o marcador que não é objeto {reason, readAt} é violação (estado declarado, não booleano solto)", () => {
    const r = guardar(montar({ marcaSemPortao: true }))
    expect(r.status).toBe(1)
    expect(r.out).toContain("deve ser um objeto {reason, readAt}")
  })

  it("o marcador NÃO absolve a régua do contexto: o rename continua exigindo a reaplicação", () => {
    const dir = montar({
      lint: "Lint Guard (v2)",
      declarados: ["Lint guard", "tests"],
      marcaSemPortao: { reason: "HTTP 403 de plano", readAt: "2026-09-20" },
    })
    const r = guardar(dir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('job "lint"')
    expect(r.out).toContain("-- --apply")
  })

  it("o applier grava o marcador quando a forja RECUSA — e o SAI quando ela responde", () => {
    const dir = montar({
      marcaSemPortao: { reason: "HTTP 403 de plano", readAt: "2026-09-01" },
    })
    const derivados = derivadosDoFixture(dir)
    const atual = loadApplied(dir, defaultIo(dir))

    // A forja RESPONDEU nesta rodada: o marcador sai (ele descreve o estado lido,
    // não um histórico — manter um marcador velho declararia o contrário).
    const respondeu = buildAppliedRecord(atual, derivados, ["github", "gitea"], "2026-09-20")
    expect(respondeu.record.forges.github.unsupported).toBeUndefined()

    // A forja RECUSOU: o marcador entra com o motivo e a data da leitura.
    const recusou = buildAppliedRecord(null, derivados, ["github", "gitea"], "2026-09-20", {
      github: { reason: "HTTP 403: Upgrade to GitHub Pro" },
    })
    expect(recusou.record.forges.github.unsupported).toEqual({
      reason: "HTTP 403: Upgrade to GitHub Pro",
      readAt: "2026-09-20",
    })
    expect(recusou.record.forges.github.contexts).toEqual(
      derivados.github.contexts.map((c) => c.context),
    )
  })

  it("uma forja FORA do alvo CONSERVA o marcador lido antes (esta rodada não a leu)", () => {
    const atual = {
      version: 1,
      appliedAt: "2026-09-01",
      forges: {
        github: {
          workflow: GITHUB_WF,
          branches: ["main"],
          contexts: ["Lint guard", "tests"],
          unsupported: { reason: "HTTP 403 de plano", readAt: "2026-09-01" },
        },
      },
    }
    const { record } = buildAppliedRecord(atual, resolved, ["gitea"], "2026-09-20")
    expect(record.forges.github.unsupported).toEqual({
      reason: "HTTP 403 de plano",
      readAt: "2026-09-01",
    })
  })

  it("uma forja NUNCA LIDA não é declarada (o verde por omissão desta classe)", () => {
    // `--forge gitea` num repo sem declaração anterior: o GitHub não foi lido, e
    // a entrada dele não pode nascer dos contextos DERIVADOS — isso declararia
    // como aplicado o que ninguém leu. A entrada fica de fora, e o guard reprova
    // a ausência com o remédio certo (é o `montar` sem a entrada do GitHub).
    const { record } = buildAppliedRecord(null, resolved, ["gitea"], "2026-09-20")
    expect(record.forges.github).toBeUndefined()

    const r = guardar(montar({ forjasDeclaradas: ["gitea"] }))
    expect(r.status).toBe(1)
    expect(r.out).toContain('a forja "github" do manifesto não tem entrada')
  })
})

// ── a metade do manifesto continua sendo julgada junto ────────────────────

describe("as duas metades são o mesmo gate", () => {
  it("o manifesto divergente continua falhando (a metade antiga não foi trocada)", () => {
    const dir = montar({ declarados: ["Lint guard", "tests"] })
    writeFileSync(
      join(dir, GITHUB_WF),
      workflows("Lint guard").replace("  tests:", "  outro:"),
      "utf8",
    )
    const r = guardar(dir)
    expect(r.status).toBe(1)
    expect(r.out).toContain('job "tests" não existe')
    const ioFixture = defaultIo(dir)
    expect(validateManifest(loadManifest(dir, ioFixture), ioFixture).length).toBeGreaterThan(0)
  })
})
