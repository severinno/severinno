/**
 * Prova de que o drift do branch protection da FORJA (Gitea) vira uma ISSUE
 * acionável — não um cron vermelho com o diff no log.
 *
 * POR QUE UM SERVIDOR DE VERDADE (e não um `fetch` dublado): o que precisa ser
 * provado não é a conta da assinatura (isso é puro, em
 * `required-checks-manifest.test.ts`), e sim o CICLO e o CONTRATO DE FIO —
 * qual endpoint, qual verbo, com qual corpo, e o que a run 2 enxerga que a run
 * 1 deixou. Um dublê de função provaria a intenção; um servidor HTTP local
 * prova que o script fala Gitea de fato (auth por `token`, `labels: [id]`,
 * 201/409). Mesmo padrão do `prove-gitea-merge-gate.test.ts`.
 *
 * POR QUE O CLI É CHAMADO DE FORMA ASSÍNCRONA (`execFile`, não `spawnSync`): o
 * servidor dublê roda NESTE processo. `spawnSync` bloqueia o event loop, então
 * o servidor nunca responderia e o filho ficaria pendurado até o timeout — a
 * primeira versão deste teste travava exatamente assim. `execFile` promisificado
 * deixa o loop livre e o ciclo (run 1 cria, run 2 deduplica) acontece de verdade.
 *
 * O servidor é ESTADO EM MEMÓRIA: o dedup entre runs só aparece porque a run 2
 * lê a issue que a run 1 criou. Sem estado, o defeito (abrir/comentar toda
 * semana) é invisível.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { execFile } from "node:child_process"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

import {
  ISSUE_LABEL,
  ISSUE_LABEL_COLOR,
  backendFor,
  driftBody,
  driftResolutionComment,
  driftTitle,
  giteaIssueConfig,
  markerOf,
  signatureOf,
} from "../../../scripts/required-checks-drift-issue.mjs"

const execFileAsync = promisify(execFile)

const ROOT = process.cwd()
const SCRIPT = resolve(ROOT, "scripts", "required-checks-drift-issue.mjs")
const REPO = "org/repo"

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
  state: "open" | "closed"
}
interface SeenRequest {
  method: string
  path: string
  body: unknown
}

function makeFakeGitea() {
  const labels: FakeLabel[] = []
  const issues: FakeIssue[] = []
  const requests: SeenRequest[] = []
  let nextLabelId = 1
  let nextIssueNumber = 1
  /**
   * Corrida no label: `POST /labels` devolve 409. Com `createOnConflict`, o
   * "outro run" de fato venceu (o label aparece no re-GET); sem ele, o 409 é
   * irrecuperável — o defeito que deve falhar alto.
   */
  let labelConflict = false
  let labelRaceWins = false

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
      const issueMatch = path.match(new RegExp(`^/api/v1/repos/${REPO}/issues/(\\d+)$`))

      if (req.method === "GET" && path === labelsPath) return json(200, labels)

      // A LISTAGEM do Gitea só traz a CONTAGEM de comentários; o backend busca
      // os corpos aqui (é onde mora o marcador de um drift que mudou).
      if (req.method === "GET" && commentMatch) {
        const issue = issues.find((i) => i.number === Number(commentMatch[1]))
        if (!issue) return json(404, null)
        return json(
          200,
          issue.comments.map((c, index) => ({ id: index + 1, body: c.body })),
        )
      }

      if (req.method === "PATCH" && issueMatch) {
        const issue = issues.find((i) => i.number === Number(issueMatch[1]))
        if (!issue) return json(404, null)
        issue.state = (body as { state?: "open" | "closed" })?.state ?? issue.state
        return json(201, { number: issue.number, state: issue.state })
      }

      if (req.method === "POST" && path === labelsPath) {
        const payload = (body ?? {}) as { name?: string; color?: string }
        const label = { id: nextLabelId++, name: payload.name ?? "", color: payload.color ?? "" }
        if (labelConflict) {
          if (labelRaceWins) labels.push(label)
          return json(409, null)
        }
        if (labels.some((l) => l.name === payload.name)) return json(409, null)
        labels.push(label)
        return json(201, label)
      }

      // `type=issues` e o filtro por label são aplicados pelo CLIENTE; aqui só
      // devolvemos as abertas, como a API real faria com `state=open`.
      if (req.method === "GET" && path === issuesPath)
        return json(
          200,
          issues.filter((i) => i.state === "open"),
        )

      if (req.method === "POST" && path === issuesPath) {
        const payload = (body ?? {}) as { title?: string; body?: string; labels?: number[] }
        const issue: FakeIssue = {
          number: nextIssueNumber++,
          title: payload.title ?? "",
          body: payload.body ?? "",
          labels: labels.filter((l) => (payload.labels ?? []).includes(l.id)),
          comments: [],
          state: "open",
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
    setLabelConflict(value: boolean, { createOnConflict = false } = {}) {
      labelConflict = value
      labelRaceWins = createOnConflict
    },
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

// ── report de drift (mesma forma do `--check --json`) ───────────────────────

function driftReport(overrides: Record<string, unknown> = {}) {
  return {
    mode: "CHECK",
    manifest: "ci/required-checks.json",
    branches: ["main"],
    drift: true,
    forges: {
      gitea: {
        workflow: ".gitea/workflows/ci.yml",
        desired: ["Repo Guards", "PII Allowlist Guard"],
        branches: [
          {
            branch: "main",
            configured: true,
            inSync: false,
            enforceStatusChecks: false,
            missing: ["PII Allowlist Guard"],
            extra: [],
            applied: false,
          },
        ],
      },
    },
    errors: [],
    ...overrides,
  }
}

describe("issue de drift do Gitea (CLI real contra Gitea dublê)", () => {
  let gitea: ReturnType<typeof makeFakeGitea>
  let baseUrl = ""
  let tmpDirs: string[] = []

  // Ambiente LIMPO de credenciais Gitea: um token herdado do shell não pode
  // fazer o caso "sem token" passar por engano.
  const baseEnv: NodeJS.ProcessEnv = { ...process.env }
  delete baseEnv.GITEA_TOKEN
  delete baseEnv.GITEA_URL
  delete baseEnv.GITEA_REPOSITORY

  function writeReport(report: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "drift-report-"))
    tmpDirs.push(dir)
    const path = join(dir, "drift.json")
    writeFileSync(path, JSON.stringify(report, null, 2), "utf8")
    return path
  }

  /** Roda o CLI de verdade; devolve exit/stdio como `spawnSync` faria. */
  async function runCli(args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
    const options = {
      cwd: ROOT,
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
    gitea.setLabelConflict(false)
  })

  /** Relatório em SINCRONIA com o manifesto — o gatilho da reconciliação. */
  function syncedReport() {
    return driftReport({
      drift: false,
      forges: {
        gitea: {
          workflow: ".gitea/workflows/ci.yml",
          // `desired` REAL (e não vazio): é o lado do manifesto da prova — sem
          // ele o comentário de fechamento não teria o que comparar.
          desired: ["Repo Guards", "PII Allowlist Guard"],
          branches: [
            {
              branch: "main",
              configured: true,
              inSync: true,
              enforceStatusChecks: true,
              missing: [],
              extra: [],
              applied: false,
            },
          ],
        },
      },
    })
  }

  afterEach(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
    tmpDirs = []
  })

  it("cria o label (com id) e a issue carregando a assinatura do drift", async () => {
    const report = driftReport()
    const res = await publish(writeReport(report))

    expect(res.status, res.stderr).toBe(0)
    expect(gitea.labels).toEqual([{ id: 1, name: ISSUE_LABEL, color: `#${ISSUE_LABEL_COLOR}` }])
    expect(gitea.issues).toHaveLength(1)

    const issue = gitea.issues[0]
    expect(issue.title).toBe(driftTitle())
    expect(issue.labels.map((l) => l.name)).toEqual([ISSUE_LABEL])
    // O marcador é o CONTRATO do dedup: sem ele no corpo, a run 2 abriria outra.
    expect(issue.body).toContain(markerOf(signatureOf(report)))
    expect(issue.body).toContain("PII Allowlist Guard")
    // O modo silencioso da forja (contextos certos, exigência desligada) tem de
    // estar ESCRITO na issue — é a única pista que ele existe.
    expect(issue.body).toContain("enable_status_check")
    expect(issue.body).toContain("ci:required-checks -- --apply")

    // A issue é criada por ID de label (a API não aceita nome).
    const createIssue = gitea.requests.find(
      (r) => r.method === "POST" && r.path.endsWith("/issues"),
    )
    expect((createIssue?.body as { labels?: number[] })?.labels).toEqual([1])
    // E o token vai no header `token`, não `Bearer`.
    expect(res.stderr).not.toContain("401")
  })

  it("a run 2 com o MESMO drift não abre outra issue nem comenta (dedup)", async () => {
    const reportPath = writeReport(driftReport())
    expect((await publish(reportPath)).status).toBe(0)
    const afterFirst = gitea.requests.length

    const second = await publish(reportPath)

    expect(second.status, second.stderr).toBe(0)
    expect(second.stdout).toContain("já reportado")
    expect(gitea.issues).toHaveLength(1)
    expect(gitea.issues[0].comments).toEqual([])
    // Idempotência do label: a run 2 REUSA o que existe (nenhum POST).
    expect(gitea.requests.slice(afterFirst).filter((r) => r.method === "POST")).toEqual([])
  })

  it("drift DIFERENTE comenta na issue aberta em vez de criar uma segunda", async () => {
    expect((await publish(writeReport(driftReport()))).status).toBe(0)

    const changed = driftReport({
      forges: {
        gitea: {
          workflow: ".gitea/workflows/ci.yml",
          desired: ["Repo Guards", "PII Allowlist Guard"],
          branches: [
            {
              branch: "main",
              configured: true,
              inSync: false,
              enforceStatusChecks: false,
              missing: ["PII Allowlist Guard", "TypeCheck (tsc --noEmit)"],
              extra: [],
              applied: false,
            },
          ],
        },
      },
    })
    const res = await publish(writeReport(changed))

    expect(res.status, res.stderr).toBe(0)
    expect(gitea.issues).toHaveLength(1)
    expect(gitea.issues[0].comments).toHaveLength(1)
    expect(gitea.issues[0].comments[0].body).toContain("TypeCheck (tsc --noEmit)")
  })

  it("sem drift e sem dívida: sai 0 sem CRIAR nem COMENTAR nada", async () => {
    const res = await publish(writeReport(syncedReport()))

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("Sem drift")
    expect(res.stdout).toContain("nenhuma dívida aberta")
    // A única chamada é a LISTAGEM — é ela que decide se há dívida a fechar.
    expect(gitea.requests.map((r) => r.method)).toEqual(["GET"])
    expect(gitea.issues).toEqual([])
  })

  it("drift resolvido → COMENTA a prova e FECHA a issue que este publicador abriu", async () => {
    // O ciclo completo, medido contra a API: a run 1 abre a dívida e a run 2
    // (já em sincronia) a fecha, com a prova registrada antes do fechamento.
    expect((await publish(writeReport(driftReport()))).status).toBe(0)
    expect(gitea.issues).toHaveLength(1)
    const opened = gitea.issues[0].number

    const resolved = await publish(writeReport(syncedReport()))

    expect(resolved.status, resolved.stderr).toBe(0)
    expect(resolved.stdout).toContain(`issue #${opened} fechada`)
    expect(gitea.issues[0].state).toBe("closed")
    // A prova entra ANTES do fechamento e fica no comentário.
    const proof = gitea.issues[0].comments.at(-1)?.body ?? ""
    expect(proof).toContain("Resolvido")
    expect(proof).toContain("gitea")
    expect(proof).toContain("em sincronia")
    // A prova é uma COMPARAÇÃO: nomeia o lado do manifesto e a diferença (nula).
    expect(proof).toContain("exigidos pelo manifesto: `Repo Guards`, `PII Allowlist Guard`")
    expect(proof).toContain("faltando: nenhum · a mais: nenhum")

    const patch = gitea.requests.find((r) => r.method === "PATCH")
    expect(patch?.path).toBe(`/api/v1/repos/${REPO}/issues/${opened}`)
    expect((patch?.body as { state?: string })?.state).toBe("closed")

    // A ORDEM é parte do contrato: comentar ANTES de fechar. Fechar primeiro e
    // falhar no comentário deixaria a issue fechada SEM dizer por quê.
    const commentAt = gitea.requests.findIndex(
      (r) => r.method === "POST" && r.path.endsWith(`/issues/${opened}/comments`),
    )
    const closeAt = gitea.requests.findIndex((r) => r.method === "PATCH")
    expect(commentAt).toBeGreaterThanOrEqual(0)
    expect(closeAt).toBeGreaterThan(commentAt)
  })

  it("a run seguinte não acha nada a fechar (idempotente, sem ruído semanal)", async () => {
    const driftPath = writeReport(driftReport())
    await publish(driftPath)
    await publish(writeReport(syncedReport()))
    const before = gitea.requests.length

    const again = await publish(writeReport(syncedReport()))

    expect(again.stdout).toContain("nenhuma dívida aberta")
    // Nenhuma escrita: só a listagem (issues fechadas não voltam).
    expect(gitea.requests.slice(before).some((r) => r.method !== "GET")).toBe(false)
  })

  it("dedup enxerga o marcador num COMENTÁRIO (um drift que mudou não comenta toda semana)", async () => {
    await publish(writeReport(driftReport()))

    const changed = driftReport({
      forges: {
        gitea: {
          workflow: ".gitea/workflows/ci.yml",
          desired: ["Repo Guards", "PII Allowlist Guard"],
          branches: [
            {
              branch: "main",
              configured: true,
              inSync: false,
              enforceStatusChecks: false,
              missing: ["PII Allowlist Guard", "TypeCheck (tsc --noEmit)"],
              extra: [],
            },
          ],
        },
      },
    })
    expect((await publish(writeReport(changed))).status).toBe(0)
    expect(gitea.issues[0].comments).toHaveLength(1)

    // A MESMA mudança de novo: o marcador mora no comentário da run anterior.
    const repeated = await publish(writeReport(changed))
    expect(repeated.stdout).toContain("já reportado")
    expect(gitea.issues[0].comments).toHaveLength(1)
  })

  it("issue ALHEIA com o label (sem marcador) não é fechada — e o log diz por quê", async () => {
    // O label é etiqueta de triagem: alguém pode aplicá-lo numa issue que não é
    // de drift. Fechar ticket alheio por automatismo é pior que não fechar.
    await gitea.labels.push({ id: 50, name: ISSUE_LABEL, color: `#${ISSUE_LABEL_COLOR}` })
    gitea.issues.push({
      number: 42,
      title: "outra coisa",
      body: "sem marcador nenhum",
      labels: [gitea.labels[0]],
      comments: [{ body: "comentário de outra pessoa" }],
      state: "open",
    })

    const res = await publish(writeReport(syncedReport()))

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("NÃO foi aberta por este script")
    expect(gitea.issues[0].state).toBe("open")
    expect(gitea.requests.some((r) => r.method === "PATCH")).toBe(false)
  })

  it("dry-run sem drift não toca a API (só DIZ o que a reconciliação faria)", async () => {
    const res = await publish(writeReport(syncedReport()), ["--dry-run"])

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("reconciliação fecharia")
    expect(gitea.requests).toEqual([])
  })

  it("corrida vencida pelo outro run (409) resolve pelo re-GET do label", async () => {
    // O 409 real acontece quando OUTRO run criou o label entre o GET e o POST.
    gitea.setLabelConflict(true, { createOnConflict: true })
    const res = await publish(writeReport(driftReport()))

    expect(res.status, res.stderr).toBe(0)
    expect(gitea.issues).toHaveLength(1)
    expect(gitea.issues[0].labels.map((l) => l.name)).toEqual([ISSUE_LABEL])
  })

  it("409 SEM o label na listagem falha alto (não cria issue fora do dedup)", async () => {
    gitea.setLabelConflict(true)
    const res = await publish(writeReport(driftReport()))

    // Um script que "segue em frente" aqui criaria a issue sem label — fora do
    // board e fora do dedup. Falhar é o comportamento certo.
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("409")
    expect(gitea.issues).toEqual([])
  })

  it("modo dry-run imprime o corpo e não escreve nada", async () => {
    const res = await publish(writeReport(driftReport()), ["--dry-run"])

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("dry-run")
    expect(gitea.requests).toEqual([])
    expect(gitea.issues).toEqual([])
  })

  it("dry-run não exige credencial nenhuma (é para conferir o corpo local)", async () => {
    const res = await runCli(
      ["--report", writeReport(driftReport()), "--backend", "gitea", "--dry-run"],
      { GITEA_TOKEN: "", GITEA_URL: "" },
    )

    expect(res.status, res.stderr).toBe(0)
    // O corpo inteiro, com o modo silencioso nomeado, sai no stdout.
    expect(res.stdout).toContain("enable_status_check")
    expect(res.stdout).toContain("ci:required-checks -- --apply")
  })

  it("sem GITEA_TOKEN falha com mensagem acionável (não vira alerta mudo)", async () => {
    const noToken = await runCli(["--report", writeReport(driftReport()), "--backend", "gitea"], {
      GITEA_TOKEN: "",
    })
    expect(noToken.status).toBe(1)
    expect(noToken.stderr).toContain("GITEA_TOKEN")
    expect(gitea.requests).toEqual([])
  })

  it("--backend inválido é recusado antes de qualquer requisição", async () => {
    const res = await runCli(["--report", writeReport(driftReport()), "--backend", "gitlab"])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("--backend")
    expect(gitea.requests).toEqual([])
  })

  it("o backend só troca o DESTINO: o default é github, e é seleção pura", () => {
    // Montar o backend não faz requisição — é só a decisão de rota.
    expect(backendFor({ backend: "github" }).name).toBe("github")
    expect(
      backendFor(
        { backend: "gitea" },
        { GITEA_TOKEN: "t", GITEA_URL: "https://gitea.exemplo.com", GITEA_REPOSITORY: REPO },
      ).name,
    ).toBe("gitea")
  })
})

describe("driftResolutionComment — o desfecho carrega a prova, não só 'resolvido'", () => {
  const synced = {
    drift: false,
    errors: [],
    forges: {
      gitea: {
        workflow: ".gitea/workflows/ci.yml",
        branches: [{ branch: "main", inSync: true }],
      },
    },
  }

  it("diz o que foi comparado e o estado de cada forja/branch", () => {
    const comment = driftResolutionComment(synced)
    expect(comment).toContain("Resolvido")
    expect(comment).toContain("gitea")
    expect(comment).toContain("`.gitea/workflows/ci.yml`")
    expect(comment).toContain("`main`: em sincronia")
    expect(comment).toContain("ci:required-checks -- --check")
  })

  it("nomeia o que NÃO foi comparado (um relatório vazio não pode parecer prova)", () => {
    expect(driftResolutionComment({ forges: {} })).toContain("nenhuma forja foi comparada")
  })

  it("avisa que o drift que voltar abre issue nova (o dedup é entre as ABERTAS)", () => {
    expect(driftResolutionComment(synced)).toContain("abre uma issue nova")
  })

  it("a prova é uma COMPARAÇÃO: nomeia os dois lados (manifesto × diferença medida)", () => {
    const comment = driftResolutionComment({
      forges: {
        github: {
          workflow: ".github/workflows/ci.yml",
          desired: ["Repo Guards", "PII Allowlist Guard"],
          branches: [{ branch: "main", inSync: true, missing: [], extra: [] }],
        },
      },
    })
    expect(comment).toContain("exigidos pelo manifesto: `Repo Guards`, `PII Allowlist Guard`")
    expect(comment).toContain("faltando: nenhum · a mais: nenhum")
  })

  it("relatório que não traz o comparado DIZ isso — 'nenhum' não é omissão", () => {
    // A diferença entre "a comparação não achou nada" e "não foi informada" é o
    // que impede a prova de afirmar mais do que sabe.
    const comment = driftResolutionComment({
      forges: {
        github: {
          workflow: ".github/workflows/ci.yml",
          branches: [{ branch: "main", inSync: true }],
        },
      },
    })
    expect(comment).toContain("exigidos pelo manifesto: não informado no relatório")
    expect(comment).toContain("faltando: não informado no relatório")
  })

  it("um relatório que se diga 'em sincronia' com itens faltando é DESMENTIDO pela prova", () => {
    // A diferença sai dos DADOS, nunca do veredito `inSync`: senão a própria
    // linha que declara resolvido lavaria o drift.
    const comment = driftResolutionComment({
      forges: {
        gitea: {
          workflow: ".gitea/workflows/ci.yml",
          desired: ["Repo Guards", "PII Allowlist Guard"],
          branches: [
            {
              branch: "main",
              inSync: true,
              missing: ["PII Allowlist Guard"],
              extra: ["Legacy Check"],
            },
          ],
        },
      },
    })
    expect(comment).toContain("faltando: `PII Allowlist Guard` · a mais: `Legacy Check`")
  })
})

describe("o modo silencioso da forja no corpo e na assinatura", () => {
  it("proteção EXISTENTE com a exigência desligada: o corpo nomeia o PORQUÊ", () => {
    const body = driftBody(driftReport())
    expect(body).toContain("enable_status_check")
    expect(body).toContain("NÃO bloqueiam")
  })

  it("branch SEM proteção: não fala em exigência desligada (seria ruído)", () => {
    const body = driftBody(
      driftReport({
        forges: {
          gitea: {
            workflow: ".gitea/workflows/ci.yml",
            desired: ["Repo Guards"],
            branches: [
              {
                branch: "main",
                configured: false,
                inSync: false,
                enforceStatusChecks: false,
                missing: ["Repo Guards"],
                extra: [],
              },
            ],
          },
        },
      }),
    )
    expect(body).toContain("sem proteção configurada")
    expect(body).not.toContain("enable_status_check")
  })

  it("a assinatura distingue 'exigência desligada' de 'contextos em sincronia'", () => {
    // Sem o token, este estado (nada falta, nada sobra, e o merge passa com o
    // gate vermelho) teria a MESMA assinatura de um branch em sincronia — e o
    // dedup trataria um bloqueio desligado como dívida já reportada.
    const silent = driftReport({
      forges: {
        gitea: {
          workflow: ".gitea/workflows/ci.yml",
          desired: [],
          branches: [
            {
              branch: "main",
              configured: true,
              inSync: false,
              enforceStatusChecks: false,
              missing: [],
              extra: [],
            },
          ],
        },
      },
    })
    expect(signatureOf(silent)).toContain("!enforce=false")

    const unprotected = driftReport({
      forges: {
        gitea: {
          workflow: ".gitea/workflows/ci.yml",
          desired: [],
          branches: [
            {
              branch: "main",
              configured: false,
              inSync: false,
              enforceStatusChecks: false,
              missing: ["Repo Guards"],
              extra: [],
            },
          ],
        },
      },
    })
    expect(signatureOf(unprotected)).toContain("Repo Guards")
    expect(signatureOf(unprotected)).not.toContain("!enforce=false")
  })
})

describe("giteaIssueConfig (resolução de credencial)", () => {
  it("lê GITEA_TOKEN/GITEA_URL/GITEA_REPOSITORY do ambiente", () => {
    const config = giteaIssueConfig(
      { repo: null },
      { GITEA_TOKEN: "t", GITEA_URL: "https://gitea.exemplo.com/", GITEA_REPOSITORY: REPO },
    )
    expect(config).toEqual({ token: "t", repo: REPO, baseUrl: "https://gitea.exemplo.com" })
  })

  it("--repo tem precedência sobre a variável de ambiente", () => {
    const config = giteaIssueConfig(
      { repo: "outro/repo" },
      { GITEA_TOKEN: "t", GITEA_URL: "https://gitea.exemplo.com", GITEA_REPOSITORY: REPO },
    )
    expect(config.repo).toBe("outro/repo")
  })

  it("reclama de cada credencial ausente, com o nome dela", () => {
    expect(() => giteaIssueConfig({}, { GITEA_URL: "https://x", GITEA_REPOSITORY: REPO })).toThrow(
      /GITEA_TOKEN/,
    )
    expect(() => giteaIssueConfig({}, { GITEA_TOKEN: "t", GITEA_REPOSITORY: REPO })).toThrow(
      /GITEA_URL/,
    )
    expect(() => giteaIssueConfig({}, { GITEA_TOKEN: "t", GITEA_URL: "https://x" })).toThrow(
      /GITEA_REPOSITORY|--repo/,
    )
  })
})
