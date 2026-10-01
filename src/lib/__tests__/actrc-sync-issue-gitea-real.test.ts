/**
 * actrc-sync-issue-gitea-real.test.ts
 *
 * Prova de INTEGRAÇÃO: o ciclo de criar, comentar, deduplicar e fechar
 * issues de drift dos espelhos de BUN_VERSION contra um Gitea REAL em Docker.
 *
 * POR QUE UM GITEA REAL: o stub HTTP prova o protocolo; o Gitea real prova
 * que o servidor aceita o request — o 201/409 do label, o filtro `state=open`,
 * o PATCH do fechamento, a auth por token.
 *
 * CENÁRIOS (mesmos do required-checks-drift-issue-gitea-real):
 *   1. drift → cria issue com label e marcador
 *   2. mesmo drift → dedup (não cria segunda)
 *   3. drift DIFERENTE → comenta na issue aberta
 *   4. drift resolvido → comenta a prova e fecha
 *   5. sem GITEA_TOKEN → fail-closed
 *
 * REQUER: docker disponível.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { execFile } from "node:child_process"
import { rmSync } from "node:fs"
import { resolve } from "node:path"
import { promisify } from "node:util"

import {
  isDockerAvailable,
  makeEphemeralGitea,
  type EphemeralGitea,
} from "./helpers/gitea-ephemeral"

import { ISSUE_LABEL, MARKER_PREFIX, driftTitle } from "../../../scripts/actrc-sync-issue.mjs"

const execFileAsync = promisify(execFile)

const ROOT = process.cwd()
const SCRIPT = resolve(ROOT, "scripts", "actrc-sync-issue.mjs")

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

// ── pular se docker não disponível ──────────────────────────────────────────

const dockerAvailable = isDockerAvailable()
const describeReal = dockerAvailable ? describe : describe.skip

describeReal("actrc-sync-issue Gitea — Gitea real em Docker (integração)", () => {
  let gitea: EphemeralGitea
  let tmpDirs: string[] = []

  const baseEnv: NodeJS.ProcessEnv = { ...process.env }
  delete baseEnv.GITEA_TOKEN
  delete baseEnv.GITEA_URL
  delete baseEnv.GITEA_REPOSITORY

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

  // drift com variável divergente
  const driftArgs = ["--expected", "0.0.0-drift", "--backend", "gitea"]
  // sync: variável igual ao .actrc (1.3.14)
  const syncArgs = ["--expected", "1.3.14", "--backend", "gitea"]

  beforeAll(async () => {
    gitea = await makeEphemeralGitea()
    // 180s (medido em 30/09/2026 na forja): o cold start do Gitea no netns do
    // job levou 99s no pior caso, sob a suíte inteira em paralelo — o default
    // de 30s e o orçamento de 120s ficaram atrás do custo real do ambiente.
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
    const res = await runCli(driftArgs)

    expect(res.status, res.stderr).toBe(0)

    const issues = await listIssues(gitea, { state: "open" })
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toBe(driftTitle())
    expect(issues[0].labels).toContain(ISSUE_LABEL)
    expect(issues[0].body).toContain(MARKER_PREFIX)
  })

  // ── 2. dedup ───────────────────────────────────────────────────────────

  it("mesmo drift na run 2 → não abre segunda issue", async () => {
    const second = await runCli(driftArgs)

    expect(second.status, second.stderr).toBe(0)
    const issues = await listIssues(gitea, { state: "open" })
    expect(issues).toHaveLength(1)
    // sem comentário novo (dedup por assinatura)
    const comments = await getIssueComments(gitea, issues[0].number)
    expect(comments).toHaveLength(0)
  })

  // ── 3. drift DIFERENTE → comenta ───────────────────────────────────────

  it("drift DIFERENTE → comenta na issue aberta em vez de criar segunda", async () => {
    // drift com variável ainda mais errada
    const changed = ["--expected", "9.9.9-different", "--backend", "gitea"]
    const res = await runCli(changed)

    expect(res.status, res.stderr).toBe(0)
    const issues = await listIssues(gitea, { state: "open" })
    expect(issues).toHaveLength(1)
    const comments = await getIssueComments(gitea, issues[0].number)
    expect(comments).toHaveLength(1)
  })

  // ── 4. reconciliação ───────────────────────────────────────────────────

  it("drift resolvido → comenta a prova e fecha", async () => {
    const res = await runCli(syncArgs)

    expect(res.status, res.stderr).toBe(0)

    // A issue não está mais aberta
    const stillOpen = await listIssues(gitea, { state: "open" })
    expect(stillOpen).toHaveLength(0)

    // A prova ficou registrada no comentário
    const allIssues = await listIssues(gitea, { state: "closed" })
    expect(allIssues.length).toBeGreaterThanOrEqual(1)
    const comments = await getIssueComments(gitea, allIssues[0].number)
    const proof = comments.at(-1)?.body ?? ""
    expect(proof).toContain("Resolvido")
  })

  // ── 5. fail-closed ─────────────────────────────────────────────────────

  it("sem GITEA_TOKEN → fail-closed com mensagem acionável", async () => {
    const res = await runCli(driftArgs, {
      GITEA_TOKEN: "",
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("GITEA_TOKEN")
  })
})
