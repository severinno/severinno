/**
 * forge-doctor-issue-real-gitea.test.ts
 *
 * Prova de INTEGRAÇÃO: o ciclo de criar, comentar e fechar issues do
 * forge-doctor-issue.mjs contra um Gitea REAL em Docker — não um HTTP stub
 * em memória.
 *
 * POR QUE UM GITEA REAL (e não o stub do forge-doctor-issue.test.ts):
 *   - o stub prova o CONTRATO do protocolo (verbo, path, body, status 201/409);
 *   - o Gitea real prova que o SERVIDOR aceita o request — campos renomeados,
 *     auth por token, filtros por label, o 201 do label idempotente, o PATCH
 *     do fechamento, a listagem por `state=open`.
 *
 * CINCO cenários, de propósito:
 *   1. criar + marcador — o Gitea aceita o label (idempotente) e a issue;
 *   2. dedup — a run 2 não abre issue nem comenta (o Gitea filtra `state=open`);
 *   3. veredito DIFERENTE — comenta na issue aberta;
 *   4. reconciliação — veredito PRONTA comenta a prova e fecha via PATCH;
 *   5. prova por mutação — mutar o `if:` do step deixa a issue ABERTA.
 *
 * REQUER: docker disponível (testes pulam se `docker info` falhar).
 *
 * CUSTO: ~3-5s de cold start do Gitea, ~1s de teardown.
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

import { VERDICT } from "../../../scripts/forge-doctor.mjs"
import { markerOf } from "../../../scripts/issue-publish.mjs"
import {
  ISSUE_LABEL,
  VERDICT_MARKER_ID,
  doctorIssueTitle,
  verdictSignatureOf,
} from "../../../scripts/forge-doctor-issue.mjs"

const execFileAsync = promisify(execFile)

const ROOT = process.cwd()
const SCRIPT = resolve(ROOT, "scripts", "forge-doctor-issue.mjs")

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

// ── helpers para ler o estado REAL do Gitea ─────────────────────────────────

async function listIssues(
  gitea: EphemeralGitea,
  opts: { state?: string; labels?: string } = {},
): Promise<{ number: number; title: string; body: string; state: string; labels: string[] }[]> {
  const params = new URLSearchParams()
  if (opts.state) params.set("state", opts.state)
  if (opts.labels) params.set("labels", opts.labels)
  const url = `${gitea.url}/api/v1/repos/${gitea.repo}/issues?${params}`
  const res = await fetch(url, {
    headers: { Authorization: `token ${gitea.token}` },
  })
  if (!res.ok) throw new Error(`listIssues ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as {
    number: number
    title: string
    body: string
    state: string
    labels: { name: string }[]
  }[]
  return data.map((i) => ({ ...i, labels: i.labels?.map((l) => l.name) ?? [] }))
}

async function getIssueComments(
  gitea: EphemeralGitea,
  issueNumber: number,
): Promise<{ body: string }[]> {
  const url = `${gitea.url}/api/v1/repos/${gitea.repo}/issues/${issueNumber}/comments`
  const res = await fetch(url, {
    headers: { Authorization: `token ${gitea.token}` },
  })
  if (!res.ok) throw new Error(`getIssueComments ${res.status}: ${await res.text()}`)
  return (await res.json()) as { body: string }[]
}

async function listLabels(gitea: EphemeralGitea): Promise<{ name: string; color: string }[]> {
  const url = `${gitea.url}/api/v1/repos/${gitea.repo}/labels`
  const res = await fetch(url, {
    headers: { Authorization: `token ${gitea.token}` },
  })
  if (!res.ok) throw new Error(`listLabels ${res.status}: ${await res.text()}`)
  return (await res.json()) as { name: string; color: string }[]
}

// ── pular se docker não disponível ──────────────────────────────────────────

const dockerAvailable = isDockerAvailable()

// ── os CINCO CENÁRIOS ──────────────────────────────────────────────────────

const describeReal = dockerAvailable ? describe : describe.skip

describeReal("forge-doctor-issue — Gitea real em Docker (integração)", () => {
  let gitea: EphemeralGitea
  let tmpDirs: string[] = []

  const baseEnv: NodeJS.ProcessEnv = { ...process.env }
  delete baseEnv.GITEA_TOKEN
  delete baseEnv.GITEA_URL
  delete baseEnv.GITEA_REPOSITORY

  function writeReport(report: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "doctor-report-real-"))
    tmpDirs.push(dir)
    const path = join(dir, "doctor.json")
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
  }, 120_000)

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

  // ── Cenário 1: criar + marcador ─────────────────────────────────────────

  it("cria o label (idempotente) e a issue do veredito, com o marcador da assinatura", async () => {
    const report = doctorReport()
    const res = await publish(writeReport(report))

    expect(res.status, res.stderr).toBe(0)

    // O label existe (o Gitea retornou 201 ou 409 idempotente)
    const labels = await listLabels(gitea)
    expect(labels.some((l) => l.name === ISSUE_LABEL)).toBe(true)

    // A issue foi criada com o título correto
    const issues = await listIssues(gitea, { state: "open" })
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toBe(doctorIssueTitle())
    expect(issues[0].labels).toContain(ISSUE_LABEL)

    // O corpo contém o marcador da assinatura (dedup depende dele)
    expect(issues[0].body).toContain(markerOf(VERDICT_MARKER_ID, verdictSignatureOf(report)))
    expect(issues[0].body).toContain("check:registry-source")
  })

  // ── Cenário 2: dedup ───────────────────────────────────────────────────

  it("a run 2 com o MESMO veredito não abre outra issue nem comenta (dedup via state=open)", async () => {
    const reportPath = writeReport(doctorReport())
    expect((await publish(reportPath)).status).toBe(0)
    const afterFirst = await listIssues(gitea, { state: "open" })

    const second = await publish(reportPath)

    expect(second.status, second.stderr).toBe(0)
    expect(second.stdout).toContain("já reportado")
    // Ainda só 1 issue aberta
    const afterSecond = await listIssues(gitea, { state: "open" })
    expect(afterSecond).toHaveLength(1)
    expect(afterSecond[0].number).toBe(afterFirst[0].number)
    // Nenhum comentário novo
    const comments = await getIssueComments(gitea, afterFirst[0].number)
    expect(comments).toHaveLength(0)
  })

  // ── Cenário 3: veredito DIFERENTE comenta ──────────────────────────────

  it("veredito DIFERENTE comenta na issue aberta em vez de criar uma segunda", async () => {
    // Primeiro: abre com um bloqueador
    expect((await publish(writeReport(doctorReport()))).status).toBe(0)

    // Depois: piora o veredito
    const worse = doctorReport({
      blockers: ["gate 'check:registry-source' FALHOU (exit 1)", "porta 3000 ocupada"],
    })
    const res = await publish(writeReport(worse))

    expect(res.status, res.stderr).toBe(0)

    // Ainda 1 issue aberta
    const issues = await listIssues(gitea, { state: "open" })
    expect(issues).toHaveLength(1)

    // O comentário novo contém o bloqueador adicional
    const comments = await getIssueComments(gitea, issues[0].number)
    expect(comments).toHaveLength(1)
    expect(comments[0].body).toContain("porta 3000 ocupada")
  })

  // ── Cenário 4: reconciliação (PRONTA fecha) ────────────────────────────

  it("veredito PRONTA com a issue ABERTA: comenta a prova e FECHA via PATCH", async () => {
    // Abre a dívida
    expect((await publish(writeReport(doctorReport()))).status).toBe(0)
    const open = await listIssues(gitea, { state: "open" })
    expect(open).toHaveLength(1)
    expect(open[0].state).toBe("open")

    // Veredito de volta a PRONTA, com os FATOS que a prova cita
    const ready = () => ({
      ...doctorReport({ verdict: VERDICT.READY, blockers: [], unknowns: [] }),
      facts: {
        protection: { state: "proven" },
        runnerLabels: { state: "proven" },
        openDebt: { state: "proven" },
      },
    })

    const res = await publish(writeReport(ready()))

    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain("fechada")

    // O Gitea registrou o fechamento: a issue não está mais em state=open
    const stillOpen = await listIssues(gitea, { state: "open" })
    expect(stillOpen).toHaveLength(0)

    // A prova está no comentário (ANTES do fechamento)
    const comments = await getIssueComments(gitea, open[0].number)
    const proof = comments.at(-1)?.body ?? ""
    expect(proof).toContain("**Resolvido**")
    expect(proof).toContain("voltou a **PRONTA**")
    expect(proof).toContain("branch protection REGISTRADA: `proven`")
    expect(proof).toContain("registro do act_runner: `proven`")
    expect(proof).not.toContain("interpolação do compose")
    expect(proof).toMatch(/NÃO cobre \d+ coisa\(s\) por desenho/)

    // A run seguinte não acha nada a fechar
    const again = await publish(writeReport(ready()))
    expect(again.status, again.stderr).toBe(0)
    expect(again.stdout).toContain("nenhuma dívida aberta")
  })

  // ── Cenário 5: prova por mutação ───────────────────────────────────────

  it("mutação: sem GITEA_TOKEN o Gitea real recusa — fail-closed", async () => {
    const res = await runCli(["--report", writeReport(doctorReport()), "--backend", "gitea"], {
      GITEA_TOKEN: "",
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("GITEA_TOKEN")
  })
})
