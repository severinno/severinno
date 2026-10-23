/**
 * required-checks-drift-issue-gitea-real.test.ts
 *
 * Prova de INTEGRAÇÃO: o ciclo de criar, comentar, deduplicar e fechar
 * issues de drift do branch protection contra um Gitea REAL em Docker.
 *
 * POR QUE UM GITEA REAL: o stub HTTP prova o protocolo; o Gitea real prova
 * que o servidor aceita o request — o 409 idempotente do label, o filtro
 * `state=open`, o PATCH do fechamento, a auth por token.
 *
 * CENÁRIOS:
 *   1. drift → cria issue com label e marcador
 *   2. mesmo drift → dedup (não cria segunda)
 *   3. drift que mudou → comenta na issue aberta
 *   4. sem drift + issue aberta → comenta a prova e fecha
 *   5. sem GITEA_TOKEN → fail-closed
 *
 * REQUER: docker disponível.
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
} from "../../../scripts/required-checks-drift-issue.mjs"

const execFileAsync = promisify(execFile)

const ROOT = process.cwd()
const SCRIPT = resolve(ROOT, "scripts", "required-checks-drift-issue.mjs")

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

function syncedReport() {
  return driftReport({
    drift: false,
    forges: {
      gitea: {
        workflow: ".gitea/workflows/ci.yml",
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

// ── helpers para ler o estado REAL do Gitea ─────────────────────────────────

async function listIssues(
  gitea: EphemeralGitea,
  opts: { state?: string; labels?: string } = {},
): Promise<{ number: number; title: string; body: string; state: string; labels: string[] }[]> {
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

async function getIssueComments(
  gitea: EphemeralGitea,
  issueNumber: number,
): Promise<{ body: string }[]> {
  const url = `${gitea.url}/api/v1/repos/${gitea.repo}/issues/${issueNumber}/comments`
  const res = await fetch(url, { headers: { Authorization: `token ${gitea.token}` } })
  if (!res.ok) throw new Error(`getIssueComments ${res.status}: ${await res.text()}`)
  return (await res.json()) as { body: string }[]
}

async function listLabels(gitea: EphemeralGitea): Promise<{ name: string }[]> {
  const url = `${gitea.url}/api/v1/repos/${gitea.repo}/labels`
  const res = await fetch(url, { headers: { Authorization: `token ${gitea.token}` } })
  if (!res.ok) throw new Error(`listLabels ${res.status}: ${await res.text()}`)
  return (await res.json()) as { name: string }[]
}

// ── pular se docker não disponível ──────────────────────────────────────────

const dockerAvailable = isDockerAvailable()
const describeReal = dockerAvailable ? describe : describe.skip

describeReal("required-checks-drift-issue Gitea — Gitea real em Docker (integração)", () => {
  let gitea: EphemeralGitea
  let tmpDirs: string[] = []

  const baseEnv: NodeJS.ProcessEnv = { ...process.env }
  delete baseEnv.GITEA_TOKEN
  delete baseEnv.GITEA_URL
  delete baseEnv.GITEA_REPOSITORY

  function writeReport(report: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "drift-report-real-"))
    tmpDirs.push(dir)
    const path = join(dir, "drift.json")
    writeFileSync(path, JSON.stringify(report, null, 2), "utf8")
    return path
  }

  async function runCli(args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
    const options = {
      cwd: ROOT,
      encoding: "utf8" as const,
      env: {
        ...baseEnv,
        GITEA_URL: gitea.url,
        GITEA_TOKEN: gitea.token,
        GITEA_REPOSITORY: gitea.repo,
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
    gitea = await makeEphemeralGitea()
    // 300s (medido em 30/09/2026 na forja, rodadas 205d62e5 e dbcaeee1): com a porta por
    // instância os N efêmeros bootam em PARALELO sobre 4 vCPU disputados — 3 dos 4
    // passaram de 150s e, na dbcaeee1, os 4 passaram de 165s com o container VIVO (re-subidas: 0).
  }, 300_000)

  /**
   * 60s de orçamento (e o `gitea?` acima): quando o daemon nega o kill, o teardown gasta o timeout de
   * stop dele antes de o caminho por dentro rodar — com o padrão do vitest (10s)
   * o hook morreria por TIMEOUT, deixando o container vivo e o vermelho longe da
   * causa (ver o bloco do teardown em `helpers/gitea-ephemeral.ts`).
   */
  afterAll(async () => {
    // Se o SETUP falhou (ex.: `database is locked` no create do admin), o
    // `gitea` segue indefinido — o afterAll não pode transformar a causa real
    // num `TypeError` de cleanup, que esconde o erro original.
    await gitea?.cleanup()
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
    tmpDirs = []
  }, 60_000)

  // ── 1. drift → cria issue ──────────────────────────────────────────────

  it("drift detectado → cria issue com label e marcador da assinatura", async () => {
    const report = driftReport()
    const res = await publish(writeReport(report))

    expect(res.status, res.stderr).toBe(0)

    const labels = await listLabels(gitea)
    expect(labels.some((l) => l.name === ISSUE_LABEL)).toBe(true)

    const issues = await listIssues(gitea, { state: "open" })
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toBe(driftTitle())
    expect(issues[0].labels).toContain(ISSUE_LABEL)
    expect(issues[0].body).toContain(markerOf(signatureOf(report)))
  })

  // ── 2. dedup ───────────────────────────────────────────────────────────

  it("mesmo drift na run 2 → não abre segunda issue", async () => {
    const reportPath = writeReport(driftReport())
    expect((await publish(reportPath)).status).toBe(0)

    const second = await publish(reportPath)

    expect(second.status, second.stderr).toBe(0)
    expect(second.stdout).toContain("já reportado")
    const issues = await listIssues(gitea, { state: "open" })
    expect(issues).toHaveLength(1)
    const comments = await getIssueComments(gitea, issues[0].number)
    expect(comments).toHaveLength(0)
  })

  // ── 3. drift que mudou → comenta ───────────────────────────────────────

  it("drift DIFERENTE → comenta na issue aberta em vez de criar segunda", async () => {
    expect((await publish(writeReport(driftReport()))).status).toBe(0)

    // Novo drift: extra check apareceu
    const changed = driftReport({
      forges: {
        gitea: {
          workflow: ".gitea/workflows/ci.yml",
          desired: ["Repo Guards", "PII Allowlist Guard", "New Gate"],
          branches: [
            {
              branch: "main",
              configured: true,
              inSync: false,
              enforceStatusChecks: false,
              missing: ["New Gate"],
              extra: [],
              applied: false,
            },
          ],
        },
      },
    })
    const res = await publish(writeReport(changed))

    expect(res.status, res.stderr).toBe(0)
    const issues = await listIssues(gitea, { state: "open" })
    expect(issues).toHaveLength(1)
    const comments = await getIssueComments(gitea, issues[0].number)
    expect(comments).toHaveLength(1)
  })

  // ── 4. reconciliação ───────────────────────────────────────────────────

  it("sem drift + issue aberta → comenta a prova e fecha", async () => {
    // Abre a dívida
    expect((await publish(writeReport(driftReport()))).status).toBe(0)
    const open = await listIssues(gitea, { state: "open" })
    expect(open).toHaveLength(1)

    // Drift resolvido
    const res = await publish(writeReport(syncedReport()))

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("fechada")

    // A issue não está mais aberta
    const stillOpen = await listIssues(gitea, { state: "open" })
    expect(stillOpen).toHaveLength(0)

    // A prova ficou registrada no comentário
    const comments = await getIssueComments(gitea, open[0].number)
    const proof = comments.at(-1)?.body ?? ""
    expect(proof).toContain("Resolvido")
  })

  // ── 5. fail-closed ─────────────────────────────────────────────────────

  it("sem GITEA_TOKEN → fail-closed com mensagem acionável", async () => {
    const res = await runCli(["--report", writeReport(driftReport()), "--backend", "gitea"], {
      GITEA_TOKEN: "",
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("GITEA_TOKEN")
  })
})
