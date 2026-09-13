/**
 * forge-doctor-issue.test.ts
 *
 * Prova que o VEREDITO do `forge-doctor.mjs` vira uma ISSUE ACIONÁVEL quando não
 * é PRONTA — e que o cron da forja (.gitea/workflows/forge-doctor.yml) publica
 * essa issue ANTES de falhar.
 *
 * POR QUE ESTE TESTE EXISTE: o doctor responde a pergunta inteira ("esta forja
 * pode bloquear o merge?") e é o único lugar onde o estado VIVO da forja aparece
 * — branch protection registrada, registro do runner, o que a tag do registry
 * serve hoje. Sem um canal acionável, esse veredito só é lido por quem lembrou
 * de rodar o comando; num cron, ele vira alerta mudo (ninguém abre o log de algo
 * que rodou sozinho). A issue é o canal, e o dedup por assinatura é o que
 * impede a dívida de virar ruído semanal.
 *
 * QUATRO camadas, de propósito:
 *
 *   1. FUNÇÕES PURAS — a assinatura (o contrato do dedup), o corpo, a decisão
 *      de "há o que reportar". INDETERMINADA conta como acionável: ela não é
 *      violação, mas é dívida de PROVA, e é onde o drift se esconde.
 *   2. CONTRATO ENTRE OS MÓDULOS — roda o doctor REAL (todas as `--no-*`, sem
 *      rede) e passa o relatório pelo publicador. É o que pega a quebra
 *      silenciosa: renomear uma chave do relatório (`verdict.blockers`) deixaria
 *      o publicador publicando um corpo vazio, com o teste puro ainda verde.
 *   3. CLI CONTRA UM GITEA DUBLÊ (HTTP de verdade, estado em memória) — o ciclo
 *      que importa: run 1 cria, run 2 deduplica, veredito NOVO comenta. O CLI é
 *      chamado de forma ASSÍNCRONA (`execFile`): `spawnSync` bloquearia o event
 *      loop e o servidor deste processo nunca responderia (o defeito que já
 *      travou o teste irmão do drift por timeout).
 *   4. O CONTRATO DO WORKFLOW — a ORDEM dos steps é a invariante que faz o
 *      alerta existir: publicar ANTES de falhar. Invertida, o step da issue
 *      nunca roda no run que dá errado — exatamente o cron vermelho sem ticket
 *      que este workflow elimina.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { execFile, spawnSync } from "node:child_process"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import yaml from "js-yaml"

import { VERDICT } from "../../../scripts/forge-doctor.mjs"
import { markerOf } from "../../../scripts/issue-publish.mjs"
import {
  ISSUE_LABEL,
  ISSUE_LABEL_COLOR,
  VERDICT_MARKER_ID,
  doctorIssueBody,
  doctorIssueTitle,
  isActionable,
  loadDoctorReport,
  parseArgs,
  verdictOf,
  verdictSignatureOf,
} from "../../../scripts/forge-doctor-issue.mjs"
import {
  BUN_VERSION_VAR,
  extractEnvVersion,
  findBunLiteralInScript,
} from "../../../scripts/check-bun-mirror.mjs"

const execFileAsync = promisify(execFile)

const CWD = process.cwd()
const SCRIPT = resolve(CWD, "scripts", "forge-doctor-issue.mjs")
const DOCTOR = resolve(CWD, "scripts", "forge-doctor.mjs")
const WORKFLOW = join(CWD, ".gitea", "workflows", "forge-doctor.yml")
const MANIFEST = join(CWD, "ci", "required-checks.json")
const REPO = "org/repo"

// ── relatório do doctor (mesma FORMA do `--json`) ───────────────────────────

function doctorReport(verdict: Record<string, unknown> = {}) {
  return {
    facts: { skippedGuards: true },
    verdict: {
      verdict: VERDICT.BLOCKED,
      blockers: ["gate 'check:registry-source' FALHOU (exit 1)"],
      unknowns: [],
      unproven: ["os guards da forja (pulados por --no-guards)"],
      ...verdict,
    },
  }
}

// ── dublê do Gitea (estado em memória, rotas reais) ─────────────────────────

interface FakeLabel {
  id: number
  name: string
  color: string
}
interface FakeIssue {
  number: number
  title: string
  body: string
  labels: FakeLabel[]
  comments: { body: string }[]
}

function makeFakeGitea() {
  const labels: FakeLabel[] = []
  const issues: FakeIssue[] = []
  const requests: { method: string; path: string; body: unknown }[] = []
  let nextLabelId = 1
  let nextIssueNumber = 1

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      let body: unknown = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = raw
      }
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname
      requests.push({ method: req.method ?? "", path, body })

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" })
        res.end(payload === null ? "" : JSON.stringify(payload))
      }

      const labelsPath = `/api/v1/repos/${REPO}/labels`
      const issuesPath = `/api/v1/repos/${REPO}/issues`
      const commentMatch = path.match(new RegExp(`^/api/v1/repos/${REPO}/issues/(\\d+)/comments$`))

      if (req.method === "GET" && path === labelsPath) return json(200, labels)

      if (req.method === "POST" && path === labelsPath) {
        const payload = (body ?? {}) as { name?: string; color?: string }
        if (labels.some((l) => l.name === payload.name)) return json(409, null)
        const label = { id: nextLabelId++, name: payload.name ?? "", color: payload.color ?? "" }
        labels.push(label)
        return json(201, label)
      }

      if (req.method === "GET" && path === issuesPath) return json(200, issues)

      if (req.method === "POST" && path === issuesPath) {
        const payload = (body ?? {}) as { title?: string; body?: string; labels?: number[] }
        const issue: FakeIssue = {
          number: nextIssueNumber++,
          title: payload.title ?? "",
          body: payload.body ?? "",
          labels: labels.filter((l) => (payload.labels ?? []).includes(l.id)),
          comments: [],
        }
        issues.push(issue)
        return json(201, {
          number: issue.number,
          html_url: `http://fake/${REPO}/issues/${issue.number}`,
        })
      }

      if (req.method === "POST" && commentMatch) {
        const issue = issues.find((i) => i.number === Number(commentMatch[1]))
        if (!issue) return json(404, null)
        issue.comments.push({ body: (body as { body?: string })?.body ?? "" })
        return json(201, { id: issue.comments.length })
      }

      return json(404, null)
    })
  })

  return {
    labels,
    issues,
    requests,
    listen: () =>
      new Promise<string>((resolveUrl) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address()
          const port = typeof address === "object" && address ? address.port : 0
          resolveUrl(`http://127.0.0.1:${port}`)
        })
      }),
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

// ── 1. FUNÇÕES PURAS ───────────────────────────────────────────────────────

describe("forge-doctor-issue — a decisão de publicar", () => {
  it("PRONTA não é acionável; BLOQUEADA e INDETERMINADA são", () => {
    expect(isActionable(doctorReport({ verdict: VERDICT.READY, blockers: [] }))).toBe(false)
    expect(isActionable(doctorReport({ verdict: VERDICT.BLOCKED }))).toBe(true)
    // INDETERMINADA não é violação, mas é dívida de PROVA — e é exatamente onde
    // um drift se esconde (fato não medido não pode estar certo nem errado).
    expect(isActionable(doctorReport({ verdict: VERDICT.UNKNOWN }))).toBe(true)
  })

  it("relatório sem veredito é tratado como acionável (fail-closed)", () => {
    expect(verdictOf(undefined)).toBe("?")
    expect(isActionable({})).toBe(true)
  })

  it("o título é ESTÁVEL (um título por veredito abriria issue toda semana)", () => {
    const a = doctorIssueTitle()
    const b = doctorIssueTitle()
    expect(a).toBe(b)
    expect(a).not.toMatch(/bloqueada|indeterminada/i)
  })
})

describe("forge-doctor-issue — a assinatura (contrato do dedup)", () => {
  it("o MESMO veredito dá a MESMA assinatura, independente da ordem", () => {
    const one = doctorReport({ blockers: ["b", "a"], unknowns: ["z", "y"] })
    const reordered = doctorReport({ blockers: ["a", "b"], unknowns: ["y", "z"] })
    expect(verdictSignatureOf(one)).toBe(verdictSignatureOf(reordered))
  })

  it("assinaturas diferentes para vereditos diferentes", () => {
    const blocked = verdictSignatureOf(doctorReport({ blockers: ["b"] }))
    const unknown = verdictSignatureOf(doctorReport({ verdict: VERDICT.UNKNOWN, blockers: [] }))
    expect(blocked).not.toBe(unknown)
    expect(blocked).toContain("verdict:bloqueada")
    expect(unknown).toContain("verdict:indeterminada")
  })

  it("`unproven` fica FORA da assinatura (ela é constante entre runs)", () => {
    // Se entrasse, um run com --no-proof e outro com a prova completa teriam
    // assinaturas diferentes para o mesmo problema — e o dedup deixaria de
    // reconhecer a dívida já reportada.
    const withList = doctorReport({ unproven: ["x", "y"] })
    const withoutList = doctorReport({ unproven: [] })
    expect(verdictSignatureOf(withList)).toBe(verdictSignatureOf(withoutList))
  })
})

describe("forge-doctor-issue — o corpo da issue", () => {
  it("nomeia o veredito, cada bloqueador e o que ficou sem prova", () => {
    const body = doctorIssueBody(
      doctorReport({
        blockers: ["porta 3000 ocupada"],
        unknowns: ["a branch protection REGISTRADA nao foi lida"],
        unproven: ["a prova do bloqueio da imagem (pulada por --no-proof)"],
      }),
    )
    expect(body).toContain("**VEREDITO: BLOQUEADA**")
    expect(body).toContain("porta 3000 ocupada")
    expect(body).toContain("a branch protection REGISTRADA nao foi lida")
    expect(body).toContain("a prova do bloqueio da imagem (pulada por --no-proof)")
    // O remédio concreto (o comando), não só "não está pronta".
    expect(body).toContain("bun run doctor")
  })

  it("INDETERMINADA explica que não é violação (para não consertar o que não quebrou)", () => {
    const body = doctorIssueBody(doctorReport({ verdict: VERDICT.UNKNOWN, blockers: [] }))
    expect(body).toContain("INDETERMINADA não é violação")
    const blocked = doctorIssueBody(doctorReport({ verdict: VERDICT.BLOCKED }))
    expect(blocked).not.toContain("INDETERMINADA não é violação")
  })

  it("carrega o marcador com a assinatura (sem ele o dedup não existe)", () => {
    const report = doctorReport()
    // O marcador esperado sai da MESMA função da mecânica compartilhada: se o
    // formato mudasse num lado só, o dedup pararia de reconhecer a dívida —
    // este teste atravessa os dois módulos de propósito.
    const marker = markerOf(VERDICT_MARKER_ID, verdictSignatureOf(report))
    expect(doctorIssueBody(report)).toContain(marker)
  })
})

describe("forge-doctor-issue — argumentos", () => {
  it("as flags do doctor são REPASSADAS (uma flag nova não exige mexer aqui)", () => {
    const options = parseArgs(["--backend", "gitea", "--expected", "1.3.14", "--no-proof"])
    expect(options.backend).toBe("gitea")
    expect(options.doctorArgs).toEqual(["--expected", "1.3.14", "--no-proof"])
  })

  it("--report / --repo / --dry-run são deste publicador (não do doctor)", () => {
    const options = parseArgs(["--report", "/tmp/x.json", "--repo", "a/b", "--dry-run"])
    expect(options.report).toBe("/tmp/x.json")
    expect(options.repo).toBe("a/b")
    expect(options.dryRun).toBe(true)
    expect(options.doctorArgs).toEqual([])
  })

  it("recusa backend inválido e argumento solto (nada é engolido em silêncio)", () => {
    expect(() => parseArgs(["--backend", "gitlab"])).toThrow(/--backend/)
    expect(() => parseArgs(["surpresa"])).toThrow(/desconhecido/i)
    expect(() => parseArgs(["--report"])).toThrow(/valor/)
  })
})

// ── 2. CONTRATO ENTRE OS MÓDULOS (doctor real → publicador) ─────────────────

describe("forge-doctor-issue — o relatório REAL do doctor", () => {
  /**
   * Todas as `--no-*`: sem rede, sem docker, sem credencial — o relatório sai em
   * menos de um segundo e o veredito é INDETERMINADA (o que NÃO foi medido),
   * que é justamente o caso acionável que precisa de prova de ponta a ponta.
   */
  const HERMETIC = [
    "--json",
    "--no-guards",
    "--no-proof",
    "--no-protection",
    "--no-runner-labels",
    "--no-image-contract",
    "--no-compose-render",
    "--no-registry-probe",
    "--no-open-debt",
  ]

  function runDoctor(): { status: number; stdout: string; stderr: string } {
    const res = spawnSync(process.execPath, [DOCTOR, ...HERMETIC], { encoding: "utf8" })
    return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
  }

  it("o doctor produz o relatório que o publicador consome (as chaves não divergiram)", () => {
    const res = runDoctor()
    const report = JSON.parse(res.stdout) as Record<string, any>

    expect(Object.keys(report).sort()).toEqual(["facts", "verdict"])
    for (const key of ["verdict", "blockers", "unknowns", "unproven"]) {
      expect(report.verdict, `o relatório perdeu 'verdict.${key}'`).toHaveProperty(key)
    }
    expect(Object.values(VERDICT)).toContain(report.verdict.verdict)
    expect(isActionable(report)).toBe(true)
  })

  it("o CORPO da issue carrega os não-provados do relatório real", () => {
    const report = JSON.parse(runDoctor().stdout)
    const body = doctorIssueBody(report)

    // O que o doctor não mediu tem de aparecer: é a única pista do leitor sobre
    // onde o veredito termina.
    for (const unknown of report.verdict.unknowns.slice(0, 3)) {
      expect(body).toContain(unknown)
    }
    expect(body).toContain(markerOf(VERDICT_MARKER_ID, verdictSignatureOf(report)))
  })

  it("loadDoctorReport roda o doctor sem --report e devolve o JSON", () => {
    const seen: string[][] = []
    const report = loadDoctorReport(
      { report: null, doctorArgs: ["--no-guards"] },
      {
        run: ((_bin: string, args: string[]) => {
          seen.push(args)
          return { status: 2, stdout: JSON.stringify(doctorReport()), stderr: "" }
        }) as unknown as typeof spawnSync,
      },
    )
    expect(seen).toEqual([[DOCTOR, "--json", "--no-guards"]])
    expect(verdictOf(report)).toBe(VERDICT.BLOCKED)
  })

  it("doctor que não produz relatório é ERRO, não 'verde' (fail-closed)", () => {
    expect(() =>
      loadDoctorReport(
        { report: null, doctorArgs: [] },
        {
          run: (() => ({
            status: 3,
            stdout: "",
            stderr: "uso inválido",
          })) as unknown as typeof spawnSync,
        },
      ),
    ).toThrow(/não produziu relatório/)
  })
})

// ── 3. CLI CONTRA O GITEA DUBLÊ ────────────────────────────────────────────

describe("forge-doctor-issue — CLI real contra Gitea dublê", () => {
  let gitea: ReturnType<typeof makeFakeGitea>
  let baseUrl = ""
  let tmpDirs: string[] = []

  const baseEnv: NodeJS.ProcessEnv = { ...process.env }
  delete baseEnv.GITEA_TOKEN
  delete baseEnv.GITEA_URL
  delete baseEnv.GITEA_REPOSITORY

  function writeReport(report: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "doctor-report-"))
    tmpDirs.push(dir)
    const path = join(dir, "doctor.json")
    writeFileSync(path, JSON.stringify(report, null, 2), "utf8")
    return path
  }

  async function runCli(args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
    const options = {
      cwd: CWD,
      encoding: "utf8" as const,
      env: {
        ...baseEnv,
        GITEA_URL: baseUrl,
        GITEA_TOKEN: "token-de-teste",
        GITEA_REPOSITORY: REPO,
        ...env,
      },
    }
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT, ...args], options)
      return { status: 0, stdout, stderr }
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string }
      return { status: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
    }
  }

  const publish = (reportPath: string, extra: string[] = []) =>
    runCli(["--report", reportPath, "--backend", "gitea", ...extra])

  beforeAll(async () => {
    gitea = makeFakeGitea()
    baseUrl = await gitea.listen()
  })

  afterAll(async () => {
    await gitea.close()
  })

  beforeEach(() => {
    gitea.labels.length = 0
    gitea.issues.length = 0
    gitea.requests.length = 0
  })

  afterEach(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
    tmpDirs = []
  })

  it("cria o label e a issue do veredito, com o marcador da assinatura", async () => {
    const report = doctorReport()
    const res = await publish(writeReport(report))

    expect(res.status, res.stderr).toBe(0)
    expect(gitea.labels).toEqual([{ id: 1, name: ISSUE_LABEL, color: `#${ISSUE_LABEL_COLOR}` }])
    expect(gitea.issues).toHaveLength(1)

    const issue = gitea.issues[0]
    expect(issue.title).toBe(doctorIssueTitle())
    expect(issue.labels.map((l) => l.name)).toEqual([ISSUE_LABEL])
    expect(issue.body).toContain("check:registry-source")
    expect(issue.body).toContain(markerOf(VERDICT_MARKER_ID, verdictSignatureOf(report)))
    // A API cria issue por ID de label (nome não é aceito).
    const create = gitea.requests.find((r) => r.method === "POST" && r.path.endsWith("/issues"))
    expect((create?.body as { labels?: number[] })?.labels).toEqual([1])
  })

  it("a run 2 com o MESMO veredito não abre outra issue nem comenta (dedup)", async () => {
    const reportPath = writeReport(doctorReport())
    expect((await publish(reportPath)).status).toBe(0)
    const afterFirst = gitea.requests.length

    const second = await publish(reportPath)

    expect(second.status, second.stderr).toBe(0)
    expect(second.stdout).toContain("já reportado")
    expect(gitea.issues).toHaveLength(1)
    expect(gitea.issues[0].comments).toEqual([])
    expect(gitea.requests.slice(afterFirst).filter((r) => r.method === "POST")).toEqual([])
  })

  it("veredito DIFERENTE comenta na issue aberta em vez de criar uma segunda", async () => {
    expect((await publish(writeReport(doctorReport()))).status).toBe(0)

    const worse = doctorReport({
      blockers: ["gate 'check:registry-source' FALHOU (exit 1)", "porta 3000 ocupada"],
    })
    const res = await publish(writeReport(worse))

    expect(res.status, res.stderr).toBe(0)
    expect(gitea.issues).toHaveLength(1)
    expect(gitea.issues[0].comments).toHaveLength(1)
    expect(gitea.issues[0].comments[0].body).toContain("porta 3000 ocupada")
  })

  it("veredito PRONTA sai 0 SEM tocar a API (nem label, nem listagem)", async () => {
    const res = await publish(
      writeReport(doctorReport({ verdict: VERDICT.READY, blockers: [], unknowns: [] })),
    )

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("nada a reportar")
    expect(gitea.requests).toEqual([])
    expect(gitea.issues).toEqual([])
  })

  it("dry-run imprime o corpo e não escreve nada, nem exige credencial", async () => {
    const res = await runCli(
      ["--report", writeReport(doctorReport()), "--backend", "gitea", "--dry-run"],
      { GITEA_TOKEN: "", GITEA_URL: "" },
    )

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("dry-run")
    expect(res.stdout).toContain("gate 'check:registry-source' FALHOU")
    expect(gitea.requests).toEqual([])
  })

  it("sem GITEA_TOKEN falha com mensagem acionável (não vira alerta mudo)", async () => {
    const res = await runCli(["--report", writeReport(doctorReport()), "--backend", "gitea"], {
      GITEA_TOKEN: "",
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("GITEA_TOKEN")
    expect(gitea.requests).toEqual([])
  })

  it("relatório ausente ou inválido é ERRO (fail-closed), não sucesso silencioso", async () => {
    const missing = await publish(join(tmpdir(), "nao-existe-doctor.json"))
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain("não existe")

    const dir = mkdtempSync(join(tmpdir(), "doctor-bad-"))
    tmpDirs.push(dir)
    const bad = join(dir, "bad.json")
    writeFileSync(bad, "{ isso não é json", "utf8")
    const invalid = await publish(bad)
    expect(invalid.status).toBe(1)
  })

  it("--backend inválido é recusado antes de qualquer requisição", async () => {
    const res = await runCli(["--report", writeReport(doctorReport()), "--backend", "gitlab"])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("--backend")
    expect(gitea.requests).toEqual([])
  })
})

// ── 4. O CONTRATO DO WORKFLOW ──────────────────────────────────────────────

interface Step {
  name?: string
  id?: string
  uses?: string
  if?: string
  env?: Record<string, string>
  run?: string
}

const content = readFileSync(WORKFLOW, "utf8")
const parsed = yaml.load(content) as {
  name: string
  on: Record<string, unknown>
  env: Record<string, string>
  jobs: Record<string, { "runs-on": string; "timeout-minutes": number; steps: Step[] }>
}

const job = parsed.jobs["doctor"]
const stepIndex = (match: (s: Step) => boolean) => job.steps.findIndex(match)
const idxOf = (needle: string) =>
  job.steps.findIndex((s) => (s.run ?? "").includes(needle) || (s.uses ?? "").includes(needle))

describe("forge-doctor.yml — contrato do workflow agendado", () => {
  it("YAML válido com o job esperado (na imagem que roda os jobs da forja)", () => {
    expect(Object.keys(parsed.jobs)).toEqual(["doctor"])
    expect(job["runs-on"]).toBe("ubuntu-latest")
    expect(job["timeout-minutes"]).toBeGreaterThanOrEqual(15)
  })

  it("trigger é cron + dispatch (job agendado não reporta status em PR)", () => {
    expect(Object.keys(parsed.on).sort()).toEqual(["schedule", "workflow_dispatch"])
    expect((parsed.on.schedule as { cron: string }[])[0].cron).toMatch(/^\d+ \d+ \* \* \d$/)
  })

  it("não pode virar required check (o manifesto REAL não exige este job)", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      forges: Record<string, { jobs: string[] }>
    }
    for (const forge of Object.values(manifest.forges)) {
      expect(forge.jobs).not.toContain("doctor")
    }
  })

  it("faz checkout e setup do Bun pelo script, com a versão da variable", () => {
    expect(job.steps.map((s) => s.uses)).toContain("actions/checkout@v4")
    expect(idxOf("scripts/setup-bun-ci.sh")).toBeGreaterThan(-1)
    expect(parsed.env.BUN_VERSION).toBe(BUN_VERSION_VAR)
    expect(extractEnvVersion(content)).toBe(BUN_VERSION_VAR)
    expect(findBunLiteralInScript(content)).toBeNull()
  })

  it("provê o mesmo pré-requisito do job `guards` (o doctor EXECUTA aquela fatia)", () => {
    // Sem node_modules, todo gate que precisa de dependências vira um
    // BLOQUEADOR falso na issue — e um alerta que sempre acende é um alerta que
    // ninguém lê. O comando é o MESMO da ci.yml, e isso é conferido aqui.
    const install = job.steps.find((s) => (s.run ?? "").includes("bun install --frozen-lockfile"))
    expect(install, "o doctor rodaria gates que precisam de deps").toBeTruthy()
    const ci = readFileSync(join(CWD, ".gitea", "workflows", "ci.yml"), "utf8")
    expect(ci).toContain("bun install --frozen-lockfile")
  })

  it("roda o doctor REAL, com --json, e o exit code É o veredito", () => {
    const doctorStep = job.steps[idxOf("forge-doctor.mjs")]
    expect(doctorStep.run).toContain("--json")
    expect(doctorStep.run).toContain('--expected "$BUN_VERSION"')
    // O step do relatório não pode falhar: se falhasse, o step da issue nunca
    // rodaria e o alerta viraria cron vermelho sem ticket.
    expect(doctorStep.run).toContain("set +e")
    expect(doctorStep.run).toContain("exit_code=")
    expect(doctorStep.run).not.toMatch(/^\s*exit 1\s*$/m)
  })

  it("publica a issue pela API do Gitea, com o relatório gravado", () => {
    const publishStep = job.steps[idxOf("forge-doctor-issue.mjs")]
    expect(publishStep, "o step que publica a issue sumiu").toBeTruthy()
    expect(publishStep.run).toContain("--report /tmp/forge-doctor.json")
    expect(publishStep.run).toContain("--backend gitea")
    // Sem token, a escrita falha — e falhar é o certo: um veredito que não pôde
    // ser publicado é o silêncio de antes, só que parecendo verde.
    expect(publishStep.env?.GITEA_TOKEN).toBe("${{ secrets.GITEA_TOKEN }}")
  })

  it("A ORDEM É A INVARIANTE: publicar ANTES de falhar", () => {
    const runDoctor = stepIndex((s) => (s.run ?? "").includes("forge-doctor.mjs"))
    const publishIssue = stepIndex((s) => (s.run ?? "").includes("forge-doctor-issue.mjs"))
    const failStep = stepIndex((s) => (s.run ?? "").includes("exit 1"))

    expect(runDoctor).toBeGreaterThan(-1)
    expect(publishIssue).toBeGreaterThan(runDoctor)
    expect(failStep).toBeGreaterThan(publishIssue)
  })

  it("só publica quando o veredito NÃO é PRONTA (exit 0 não abre issue)", () => {
    const publishStep = job.steps[idxOf("forge-doctor-issue.mjs")]
    expect(publishStep.if).toBe("steps.doctor.outputs.exit_code != '0'")
  })

  it("o erro final carrega o remédio e o nome da issue", () => {
    expect(content).toContain("bun run doctor")
    expect(content).toContain(ISSUE_LABEL)
  })
})
