/**
 * env-mirror-drift-issue-gitea-real.test.ts
 *
 * Prova de INTEGRAÇÃO do ciclo do cron `env-mirror-drift` contra um Gitea REAL
 * em Docker: criar a issue na divergência, deduplicar por assinatura, comentar
 * quando o drift muda e — o outro lado da dívida — COMENTAR A PROVA E FECHAR
 * quando o env do host volta a espelhar o template comitado.
 *
 * POR QUE UM GITEA REAL (e não o dublê que já existe no
 * `env-mirror-drift-issue.test.ts`): o dublê prova o protocolo — o request que
 * saiu. O servidor prova o que o protocolo NÃO garante: o 409 idempotente da
 * criação do label, o filtro `state=open` devolvendo o que está aberto AGORA, o
 * `PATCH` do fechamento sendo aceito, e a auth por token. É a mesma razão pela
 * qual `required-checks-drift`, `actrc-sync` e `forge-doctor` já têm o seu.
 *
 * CENÁRIOS:
 *   1. divergência → cria a issue com o label e o marcador da assinatura, e o
 *      corpo carrega a PROVA COMPARADA (o par host × template e quantas
 *      variáveis do compose foram conferidas);
 *   2. o MESMO drift na run seguinte → dedup: não abre uma segunda issue;
 *   3. drift DIFERENTE → comenta na issue aberta em vez de abrir outra;
 *   4. o env VOLTA a espelhar (state `in-sync`) → comenta a prova e FECHA;
 *   5. sem `GITEA_TOKEN` → fail-closed (nunca "publicou" sem publicar).
 *
 * REQUER: docker disponível (o arquivo inteiro é `skip` sem ele — o mesmo
 * contrato dos outros suites reais; um teste que não pode rodar não pode
 * passar por engano).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { execFile } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

import {
  isDockerAvailable,
  makeEphemeralGitea,
  type EphemeralGitea,
} from "./helpers/gitea-ephemeral"

import {
  ISSUE_LABEL,
  driftTitle,
  markerOf,
  signatureOf,
} from "../../../scripts/env-mirror-drift-issue.mjs"

const execFileAsync = promisify(execFile)

const ROOT = process.cwd()
const SCRIPT = resolve(ROOT, "scripts", "env-mirror-drift-issue.mjs")

const HOST = "deploy/.env.gitea"
const TEMPLATE = "deploy/env.gitea.example"

/**
 * Um relatório com a forma REAL do `check-env-mirror.mjs --json` (o
 * `MirrorResult` inteiro, não um resumo): `state` decide publicar × reconciliar,
 * `violations` é o que a issue lista e `consumed` é a PROVA do que foi
 * comparado — a lista sai do próprio compose, não de uma lista escrita à mão.
 */
function reportOf(overrides: Record<string, unknown> = {}) {
  return {
    state: "diverged",
    violations: ["BUN_VERSION: host='1.3.12' x template='1.3.14'"],
    consumed: ["BUN_VERSION", "IMAGE_REGISTRY", "IMAGE_NAMESPACE"],
    host: HOST,
    template: TEMPLATE,
    detail: "1 divergencia(s) entre o env do host e o template comitado",
    plan: { consumed: [], edits: [], manual: [], reconciled: "", patch: "", patchMasked: false },
    remaining: [],
    ...overrides,
  }
}

/** O MESMO host, agora espelhando o template: a dívida deixou de existir. */
function inSyncReport() {
  return reportOf({ state: "in-sync", violations: [], detail: "host e template espelham" })
}

// ── leitura do estado REAL do Gitea (não do stdout do publicador) ───────────

interface Issue {
  number: number
  title: string
  body: string
  state: string
  labels: string[]
}

async function listIssues(
  gitea: EphemeralGitea,
  opts: { state?: string; labels?: string } = {},
): Promise<Issue[]> {
  const params = new URLSearchParams()
  if (opts.state) params.set("state", opts.state)
  if (opts.labels) params.set("labels", opts.labels)
  const url = `${gitea.url}/api/v1/repos/${gitea.repo}/issues?${params}`
  const res = await fetch(url, { headers: { Authorization: `token ${gitea.token}` } })
  if (!res.ok) throw new Error(`listIssues ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as any[]
  return data.map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body,
    state: i.state,
    labels: i.labels?.map((l: any) => l.name) ?? [],
  }))
}

async function getIssueComments(gitea: EphemeralGitea, issueNumber: number) {
  const url = `${gitea.url}/api/v1/repos/${gitea.repo}/issues/${issueNumber}/comments`
  const res = await fetch(url, { headers: { Authorization: `token ${gitea.token}` } })
  if (!res.ok) throw new Error(`getIssueComments ${res.status}: ${await res.text()}`)
  return (await res.json()) as { body: string }[]
}

async function listLabels(gitea: EphemeralGitea) {
  const url = `${gitea.url}/api/v1/repos/${gitea.repo}/labels`
  const res = await fetch(url, { headers: { Authorization: `token ${gitea.token}` } })
  if (!res.ok) throw new Error(`listLabels ${res.status}: ${await res.text()}`)
  return (await res.json()) as { name: string }[]
}

const dockerAvailable = isDockerAvailable()
const describeReal = dockerAvailable ? describe : describe.skip

describeReal("env-mirror-drift-issue Gitea — Gitea real em Docker (integração)", () => {
  let gitea: EphemeralGitea
  let tmpDirs: string[] = []

  // O ambiente do teste é o do runner: NADA de token herdado. Cada CLI recebe o
  // do container efêmero (o cenário 5 remove o token de propósito).
  const baseEnv: NodeJS.ProcessEnv = { ...process.env }
  delete baseEnv.GITEA_TOKEN
  delete baseEnv.GITEA_URL
  delete baseEnv.GITEA_REPOSITORY

  function writeReport(report: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "env-mirror-report-"))
    tmpDirs.push(dir)
    const path = join(dir, "env-mirror.json")
    writeFileSync(path, JSON.stringify(report, null, 2), "utf8")
    return path
  }

  async function runCli(args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT, ...args], {
        cwd: ROOT,
        encoding: "utf8" as const,
        env: {
          ...baseEnv,
          GITEA_URL: gitea.url,
          GITEA_TOKEN: gitea.token,
          GITEA_REPOSITORY: gitea.repo,
          ...env,
        },
      })
      return { status: 0, stdout, stderr }
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string }
      return { status: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
    }
  }

  const publish = (reportPath: string, extra: string[] = []) =>
    runCli(["--report", reportPath, "--backend", "gitea", ...extra])

  beforeAll(async () => {
    gitea = await makeEphemeralGitea()
  }, 30_000)

  /**
   * 60s de orçamento: quando o daemon nega o kill, o teardown gasta o timeout de
   * stop dele antes de o caminho por dentro rodar — com o padrão do vitest (10s)
   * o hook morreria por TIMEOUT, deixando o container vivo e o vermelho longe da
   * causa (ver o bloco do teardown em `helpers/gitea-ephemeral.ts`).
   */
  afterAll(async () => {
    await gitea.cleanup()
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
    tmpDirs = []
  }, 60_000)

  // ── 1. divergência → cria a issue, com a prova comparada no corpo ────────

  it("divergência → cria a issue com o label, o marcador e a PROVA no corpo", async () => {
    const report = reportOf()
    const res = await publish(writeReport(report))

    expect(res.status, res.stderr).toBe(0)

    // O label foi criado no servidor (409 idempotente na criação).
    const labels = await listLabels(gitea)
    expect(labels.some((l) => l.name === ISSUE_LABEL)).toBe(true)

    const issues = await listIssues(gitea, { state: "open" })
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toBe(driftTitle())
    expect(issues[0].labels).toContain(ISSUE_LABEL)
    // A assinatura é o que o fechamento automático depois reconhece.
    expect(issues[0].body).toContain(markerOf(signatureOf(report)))
    // A PROVA: o par comparado e o tamanho do conjunto conferido. Sem isso a
    // issue diz "divergiu" sem dizer contra o quê — e quem abre não sabe o que
    // foi olhado.
    expect(issues[0].body).toContain(`\`${HOST}\``)
    expect(issues[0].body).toContain(`\`${TEMPLATE}\``)
    expect(issues[0].body).toContain("### O que foi comparado")
    expect(issues[0].body).toContain("3 variável(is)")
    expect(issues[0].body).toContain("1.3.12")
  })

  // ── 2. o MESMO drift → dedup (não abre segunda, não comenta) ────────────

  it("o MESMO drift na run 2 → não abre segunda issue", async () => {
    const reportPath = writeReport(reportOf())
    expect((await publish(reportPath)).status).toBe(0)

    const antes = await listIssues(gitea, { state: "open" })
    expect(antes).toHaveLength(1)
    const comentariosAntes = (await getIssueComments(gitea, antes[0].number)).length

    const segunda = await publish(reportPath)

    expect(segunda.status, segunda.stderr).toBe(0)
    const depois = await listIssues(gitea, { state: "open" })
    expect(depois).toHaveLength(1)
    expect(depois[0].number).toBe(antes[0].number)
    // Idempotência também no canal: uma run sem novidade não gera comentário.
    expect((await getIssueComments(gitea, depois[0].number)).length).toBe(comentariosAntes)
  })

  // ── 3. drift DIFERENTE → comenta na aberta ──────────────────────────────

  it("drift DIFERENTE → comenta na issue aberta em vez de abrir outra", async () => {
    const antes = await listIssues(gitea, { state: "open" })
    expect(antes).toHaveLength(1)
    const comentariosAntes = (await getIssueComments(gitea, antes[0].number)).length

    const mudou = reportOf({
      violations: [
        "BUN_VERSION: host='1.3.12' x template='1.3.14'",
        "IMAGE_NAMESPACE: host='severinno-old' x template='severinno'",
      ],
    })
    const res = await publish(writeReport(mudou))

    expect(res.status, res.stderr).toBe(0)
    const depois = await listIssues(gitea, { state: "open" })
    expect(depois).toHaveLength(1)
    expect(depois[0].number).toBe(antes[0].number)
    const comentarios = await getIssueComments(gitea, depois[0].number)
    expect(comentarios.length).toBe(comentariosAntes + 1)
    // O comentário diz o que MUDOU, não só "ainda divergindo".
    expect(comentarios.at(-1)?.body).toContain("IMAGE_NAMESPACE")
  })

  // ── 4. o env volta a espelhar → comenta a PROVA e FECHA ─────────────────

  it("env de volta em sincronia → comenta a prova e FECHA a issue", async () => {
    const abertas = await listIssues(gitea, { state: "open" })
    expect(abertas).toHaveLength(1)
    const number = abertas[0].number
    const comentariosAntes = (await getIssueComments(gitea, number)).length

    const res = await publish(writeReport(inSyncReport()))

    expect(res.status, res.stderr).toBe(0)

    // 1. A issue não está mais aberta (o `PATCH` de fechamento foi aceito).
    expect(await listIssues(gitea, { state: "open" })).toHaveLength(0)
    const fechada = (await listIssues(gitea, { state: "closed" })).find((i) => i.number === number)
    expect(fechada, "a issue fechada continua existindo (histórico)").toBeTruthy()

    // 2. E a prova ficou ANTES do fechamento: quem chega depois lê o desfecho
    //    sem reconstruir o estado do mundo na data do fechamento.
    const comentarios = await getIssueComments(gitea, number)
    expect(comentarios.length).toBe(comentariosAntes + 1)
    const prova = comentarios.at(-1)?.body ?? ""
    expect(prova).toContain("**Resolvido**")
    expect(prova).toContain("a prova")
    expect(prova).toContain(`\`${HOST}\``)
    expect(prova).toContain(`\`${TEMPLATE}\``)
    expect(prova).toContain("3 variável(is)")
  })

  // ── 5. uma run que NÃO conseguiu medir não "fecha" nada ─────────────────
  //
  // O outro lado do fail-closed: com medicação ausente (`absent`) o publicador
  // não publica E não reconcilia — um medidor quebrado não é evidência de que a
  // dívida foi resolvida. O cenário abre a dívida de novo para que a asserção
  // tenha o que perder.

  it("state `absent` → NÃO publica e NÃO fecha (não medido ≠ resolvido)", async () => {
    expect((await publish(writeReport(reportOf()))).status).toBe(0)
    const abertas = await listIssues(gitea, { state: "open" })
    expect(abertas).toHaveLength(1)
    const comentariosAntes = (await getIssueComments(gitea, abertas[0].number)).length

    const res = await publish(
      writeReport(
        reportOf({
          state: "absent",
          violations: [],
          host: null,
          detail: "nao havia o que comparar: o env do host nao existe(m)",
        }),
      ),
    )

    expect(res.status, res.stderr).toBe(0)
    const aindaAbertas = await listIssues(gitea, { state: "open" })
    expect(aindaAbertas).toHaveLength(1)
    expect((await getIssueComments(gitea, abertas[0].number)).length).toBe(comentariosAntes)
  })

  // ── 6. fail-closed: sem token, nada é publicado ─────────────────────────

  it("sem GITEA_TOKEN → fail-closed com mensagem acionável", async () => {
    const res = await runCli(["--report", writeReport(reportOf()), "--backend", "gitea"], {
      GITEA_TOKEN: "",
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("GITEA_TOKEN")
  })
})
